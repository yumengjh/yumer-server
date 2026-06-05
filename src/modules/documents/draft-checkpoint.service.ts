import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { Document } from "../../entities/document.entity";
import { DocumentSyncSession } from "../../entities/document-sync-session.entity";
import { SyncCheckpointReceipt } from "../../entities/sync-checkpoint-receipt.entity";
import { SyncCreateTombstone } from "../../entities/sync-create-tombstone.entity";
import {
  DraftCheckpointBlockDto,
  DraftCheckpointDto,
  DraftCheckpointResponseDto,
} from "./dto/draft-checkpoint.dto";

type DraftVersion = BlockVersion & {
  payload: { attrs?: Record<string, unknown> };
};

@Injectable()
export class DraftCheckpointService {
  private idCounter = 0;

  constructor(private readonly dataSource: DataSource) {}

  async applyDraftCheckpoint(
    docId: string,
    userId: string,
    dto: DraftCheckpointDto,
  ): Promise<DraftCheckpointResponseDto> {
    return this.dataSource.transaction((manager) =>
      this.applyDraftCheckpointInTransaction(manager, docId, userId, dto),
    );
  }

  private async applyDraftCheckpointInTransaction(
    manager: EntityManager,
    docId: string,
    userId: string,
    dto: DraftCheckpointDto,
  ): Promise<DraftCheckpointResponseDto> {
    const clientCheckpointId = this.normalizeCheckpointId(dto.clientCheckpointId);
    const fingerprint = this.buildRequestFingerprint({ ...dto, clientCheckpointId });
    const receiptRepository = manager.getRepository(SyncCheckpointReceipt);
    const existingReceipt = await receiptRepository.findOne({
      where: { docId, clientCheckpointId },
    });
    if (existingReceipt) {
      if (existingReceipt.requestFingerprint === fingerprint) {
        return this.mapReceiptToResponse(existingReceipt);
      }
      const doc = await manager.getRepository(Document).findOne({ where: { docId } });
      return this.conflictResponse({
        dto,
        acceptedCheckpointId: clientCheckpointId,
        serverHead: doc?.head ?? dto.baseVersion,
        draftRevision: doc?.draftRevision ?? dto.draftRevision,
        code: "CHECKPOINT_FINGERPRINT_CONFLICT",
        message: "Checkpoint id was reused with different content",
      });
    }

    const documentRepository = manager.getRepository(Document);
    const document = await documentRepository.findOne({ where: { docId } });
    if (!document) {
      return this.conflictResponse({
        dto,
        acceptedCheckpointId: clientCheckpointId,
        serverHead: dto.baseVersion,
        draftRevision: dto.draftRevision,
        code: "DOCUMENT_NOT_FOUND",
        message: "Document not found",
      });
    }
    if (dto.mode !== "checkpoint" || dto.coverage !== "full") {
      return this.conflictResponse({
        dto,
        acceptedCheckpointId: clientCheckpointId,
        serverHead: document.head,
        draftRevision: document.draftRevision,
        code: "CHECKPOINT_COVERAGE_UNSUPPORTED",
        message: "Only full checkpoint coverage is supported",
      });
    }
    if (document.head !== dto.baseVersion) {
      return this.conflictResponse({
        dto,
        acceptedCheckpointId: clientCheckpointId,
        serverHead: document.head,
        draftRevision: document.draftRevision,
        code: "BASE_VERSION_MISMATCH",
        message: "Base version mismatch",
      });
    }
    if (document.draftRevision !== dto.draftRevision) {
      return this.conflictResponse({
        dto,
        acceptedCheckpointId: clientCheckpointId,
        serverHead: document.head,
        draftRevision: document.draftRevision,
        code: "DRAFT_REVISION_MISMATCH",
        message: "Draft revision mismatch",
      });
    }

    const session = await manager.getRepository(DocumentSyncSession).findOne({
      where: { docId },
    });
    if (
      !session ||
      session.sessionId !== dto.sessionId ||
      session.sessionEpoch !== dto.sessionEpoch ||
      session.holderUserId !== userId ||
      Number(session.leaseExpiresAt) <= Date.now()
    ) {
      return this.conflictResponse({
        dto,
        acceptedCheckpointId: clientCheckpointId,
        serverHead: document.head,
        draftRevision: document.draftRevision,
        code: "SYNC_SESSION_MISMATCH",
        message: "Sync session mismatch",
      });
    }

    const draft = await manager.getRepository(DocDraft).findOne({ where: { docId } });
    if (!draft) {
      return this.conflictResponse({
        dto,
        acceptedCheckpointId: clientCheckpointId,
        serverHead: document.head,
        draftRevision: document.draftRevision,
        code: "DRAFT_NOT_FOUND",
        message: "Document draft not found",
      });
    }

    const appliedAt = Date.now();
    const mappings: DraftCheckpointResponseDto["mappings"] = [];
    const tombstoned: DraftCheckpointResponseDto["tombstoned"] = [];
    const nextMap = { ...(draft.blockVersionMap ?? {}) };
    const keptBlockIds = new Set<string>();

    for (const checkpointBlock of dto.blocks) {
      const matched = await this.findDraftBlock(manager, draft, checkpointBlock);
      const block =
        matched?.block ??
        (await this.createBlock(manager, {
          docId,
          userId,
          now: appliedAt,
          checkpointBlock,
        }));
      const nextVersion = Number(block.latestVer ?? 0) + 1;
      const version = await this.writeBlockVersion(manager, {
        docId,
        userId,
        now: appliedAt,
        block,
        ver: nextVersion,
        checkpointBlock,
        deleted: false,
      });
      block.latestVer = version.ver;
      block.latestAt = appliedAt;
      block.latestBy = userId;
      block.isDeleted = false;
      await manager.getRepository(Block).save(block);
      nextMap[block.blockId] = version.ver;
      keptBlockIds.add(block.blockId);
      mappings.push({
        clientId: checkpointBlock.clientId,
        blockId: block.blockId,
        orderKey: checkpointBlock.orderKey,
        sortKey: checkpointBlock.orderKey,
      });
    }

    const currentMap = draft.blockVersionMap ?? {};
    const rootBlockIds = new Set([draft.rootBlockId, dto.rootBlockId].filter(Boolean));
    for (const blockId of Object.keys(currentMap)) {
      if (keptBlockIds.has(blockId) || rootBlockIds.has(blockId)) continue;
      const version = await manager.getRepository(BlockVersion).findOne({
        where: { docId, blockId, ver: currentMap[blockId] },
      });
      if (!version) continue;
      const attrs = this.readAttrs(version);
      if (attrs.deleted === true) continue;
      const block = await manager.getRepository(Block).findOne({ where: { blockId } });
      if (!block) continue;
      const deletedVersion = await this.writeDeletedVersion(manager, {
        docId,
        userId,
        now: appliedAt,
        block,
        previousVersion: version,
      });
      block.latestVer = deletedVersion.ver;
      block.latestAt = appliedAt;
      block.latestBy = userId;
      await manager.getRepository(Block).save(block);
      nextMap[blockId] = deletedVersion.ver;
      const clientId = typeof attrs.clientId === "string" ? attrs.clientId : null;
      const syncCreateId =
        typeof attrs.syncCreateId === "string" ? attrs.syncCreateId : null;
      tombstoned.push({ blockId, clientId, syncCreateId });
      if (clientId || syncCreateId) {
        await manager.getRepository(SyncCreateTombstone).save({
          docId,
          blockId,
          sessionId: dto.sessionId,
          sessionEpoch: dto.sessionEpoch,
          clientId,
          syncCreateId,
          deleteClientBatchId: clientCheckpointId,
          deletedAt: appliedAt,
          expiresAt: appliedAt + 30 * 60 * 1000,
          createdBy: userId,
        } as never);
      }
    }

    draft.blockVersionMap = nextMap;
    draft.changedBlocksCount = Object.keys(nextMap).length;
    draft.updatedAt = appliedAt;
    draft.updatedBy = userId;
    await manager.getRepository(DocDraft).save(draft);

    document.draftRevision = Number(document.draftRevision ?? 0) + 1;
    document.updatedBy = userId;
    await manager.getRepository(Document).save(document);

    const response: DraftCheckpointResponseDto = {
      acceptedCheckpointId: clientCheckpointId,
      appliedAt,
      serverHead: document.head,
      draftRevision: document.draftRevision,
      needsReload: false,
      conflicts: [],
      contentHash: dto.contentHash,
      mappings,
      tombstoned,
    };
    await this.saveReceipt({
      manager,
      docId,
      userId,
      now: appliedAt,
      fingerprint,
      response,
    });
    return response;
  }

  private normalizeCheckpointId(clientCheckpointId: string): string {
    const normalized = clientCheckpointId.trim();
    if (!normalized) throw new Error("clientCheckpointId is required");
    return normalized;
  }

  private buildRequestFingerprint(dto: DraftCheckpointDto): string {
    return JSON.stringify({
      mode: dto.mode,
      coverage: dto.coverage,
      clientCheckpointId: dto.clientCheckpointId,
      clientId: dto.clientId,
      baseVersion: dto.baseVersion,
      draftRevision: dto.draftRevision,
      sessionId: dto.sessionId,
      sessionEpoch: dto.sessionEpoch,
      contentHash: dto.contentHash,
      rootBlockId: dto.rootBlockId,
      actorId: dto.actorId ?? null,
      documentClock: dto.documentClock ?? null,
      parentCheckpointId: dto.parentCheckpointId ?? null,
      blocks: dto.blocks,
    });
  }

  private mapReceiptToResponse(receipt: SyncCheckpointReceipt): DraftCheckpointResponseDto {
    return {
      acceptedCheckpointId: receipt.acceptedCheckpointId,
      appliedAt: Number(receipt.appliedAt),
      serverHead: receipt.serverHead,
      draftRevision: receipt.draftRevision,
      needsReload: receipt.needsReload,
      conflicts: receipt.conflicts as DraftCheckpointResponseDto["conflicts"],
      contentHash: receipt.contentHash,
      mappings: receipt.mappings as DraftCheckpointResponseDto["mappings"],
      tombstoned: receipt.tombstoned as DraftCheckpointResponseDto["tombstoned"],
    };
  }

  private conflictResponse(params: {
    dto: DraftCheckpointDto;
    acceptedCheckpointId: string;
    serverHead: number;
    draftRevision: number;
    code: string;
    message: string;
  }): DraftCheckpointResponseDto {
    return {
      acceptedCheckpointId: params.acceptedCheckpointId,
      appliedAt: Date.now(),
      serverHead: params.serverHead,
      draftRevision: params.draftRevision,
      needsReload: true,
      conflicts: [{ code: params.code, message: params.message }],
      contentHash: params.dto.contentHash,
      mappings: [],
      tombstoned: [],
    };
  }

  private async saveReceipt(params: {
    manager: EntityManager;
    docId: string;
    userId: string;
    now: number;
    fingerprint: string;
    response: DraftCheckpointResponseDto;
  }) {
    await params.manager.getRepository(SyncCheckpointReceipt).save({
      docId: params.docId,
      clientCheckpointId: params.response.acceptedCheckpointId,
      requestFingerprint: params.fingerprint,
      acceptedCheckpointId: params.response.acceptedCheckpointId,
      appliedAt: params.response.appliedAt,
      serverHead: params.response.serverHead,
      draftRevision: params.response.draftRevision,
      needsReload: params.response.needsReload,
      conflicts: params.response.conflicts,
      contentHash: params.response.contentHash,
      mappings: params.response.mappings,
      tombstoned: params.response.tombstoned,
      createdBy: params.userId,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  private async createBlock(
    manager: EntityManager,
    params: {
      docId: string;
      userId: string;
      now: number;
      checkpointBlock: DraftCheckpointBlockDto;
    },
  ): Promise<Block> {
    const block = manager.getRepository(Block).create({
      blockId: this.createBlockId(),
      docId: params.docId,
      type: params.checkpointBlock.type,
      createdAt: params.now,
      createdBy: params.userId,
      latestVer: 0,
      latestAt: params.now,
      latestBy: params.userId,
      isDeleted: false,
      deletedAt: undefined,
      deletedBy: undefined,
    } as Partial<Block>);
    return manager.getRepository(Block).save(block as Block);
  }

  private async findDraftBlock(
    manager: EntityManager,
    draft: DocDraft,
    checkpointBlock: DraftCheckpointBlockDto,
  ): Promise<{ block: Block; version: BlockVersion } | null> {
    const blockVersionMap = draft.blockVersionMap ?? {};
    const candidates: Array<{ block: Block; version: BlockVersion }> = [];
    for (const [blockId, ver] of Object.entries(blockVersionMap)) {
      const version = await manager.getRepository(BlockVersion).findOne({
        where: { docId: draft.docId, blockId, ver },
      });
      const block = await manager.getRepository(Block).findOne({ where: { blockId } });
      if (version && block) candidates.push({ block, version });
    }

    if (checkpointBlock.blockId) {
      const byBlock = candidates.find(
        (candidate) => candidate.block.blockId === checkpointBlock.blockId,
      );
      if (byBlock) return byBlock;
    }
    if (checkpointBlock.syncCreateId) {
      const bySyncCreate = candidates.find(
        (candidate) => this.readAttrs(candidate.version).syncCreateId === checkpointBlock.syncCreateId,
      );
      if (bySyncCreate) return bySyncCreate;
    }
    return (
      candidates.find(
        (candidate) => this.readAttrs(candidate.version).clientId === checkpointBlock.clientId,
      ) ?? null
    );
  }

  private async writeBlockVersion(
    manager: EntityManager,
    params: {
      docId: string;
      userId: string;
      now: number;
      block: Block;
      ver: number;
      checkpointBlock: DraftCheckpointBlockDto;
      deleted: boolean;
    },
  ): Promise<BlockVersion> {
    const payload = this.mergePayloadAttrs(params.checkpointBlock, params.block.blockId);
    const version = manager.getRepository(BlockVersion).create({
      versionId: `${params.block.blockId}_v${params.ver}`,
      docId: params.docId,
      blockId: params.block.blockId,
      ver: params.ver,
      createdAt: params.now,
      createdBy: params.userId,
      parentId: params.checkpointBlock.parentId ?? "",
      sortKey: params.checkpointBlock.orderKey,
      indent: 0,
      collapsed: false,
      payload,
      hash: this.simpleHash(JSON.stringify(payload)),
      plainText: params.checkpointBlock.plainText ?? "",
      refs: [],
      searchVector: null,
    });
    return manager.getRepository(BlockVersion).save(version);
  }

  private async writeDeletedVersion(
    manager: EntityManager,
    params: {
      docId: string;
      userId: string;
      now: number;
      block: Block;
      previousVersion: BlockVersion;
    },
  ): Promise<BlockVersion> {
    const attrs = {
      ...this.readAttrs(params.previousVersion),
      blockId: params.block.blockId,
      deleted: true,
    };
    const ver = Number(params.block.latestVer ?? params.previousVersion.ver ?? 0) + 1;
    const payload = {
      ...((params.previousVersion.payload as Record<string, unknown>) ?? {}),
      attrs,
    };
    const version = manager.getRepository(BlockVersion).create({
      versionId: `${params.block.blockId}_v${ver}`,
      docId: params.docId,
      blockId: params.block.blockId,
      ver,
      createdAt: params.now,
      createdBy: params.userId,
      parentId: params.previousVersion.parentId,
      sortKey: params.previousVersion.sortKey,
      indent: params.previousVersion.indent ?? 0,
      collapsed: params.previousVersion.collapsed ?? false,
      payload,
      hash: this.simpleHash(JSON.stringify(payload)),
      plainText: params.previousVersion.plainText ?? "",
      refs: params.previousVersion.refs ?? [],
      searchVector: null,
    });
    return manager.getRepository(BlockVersion).save(version);
  }

  private mergePayloadAttrs(
    checkpointBlock: DraftCheckpointBlockDto,
    blockId: string,
  ): Record<string, unknown> {
    const payload = { ...checkpointBlock.payload };
    const attrs: Record<string, unknown> = {
      ...((checkpointBlock.payload.attrs as Record<string, unknown> | undefined) ?? {}),
      clientId: checkpointBlock.clientId,
      blockId,
      "data-block-id": blockId,
      sortKey: checkpointBlock.orderKey,
      "data-sort-key": checkpointBlock.orderKey,
      ...(checkpointBlock.syncCreateId
        ? { syncCreateId: checkpointBlock.syncCreateId }
        : {}),
    };
    delete attrs.clientBatchId;
    delete attrs["data-sync-create-id"];
    return { ...payload, attrs };
  }

  private readAttrs(version: BlockVersion): Record<string, unknown> {
    return ((version as DraftVersion).payload?.attrs ?? {}) as Record<string, unknown>;
  }

  private createBlockId(): string {
    this.idCounter += 1;
    return `block_${Date.now()}_${this.idCounter}`;
  }

  private simpleHash(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
  }
}
