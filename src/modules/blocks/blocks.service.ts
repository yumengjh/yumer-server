import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectDataSource } from "@nestjs/typeorm";
import { Repository, DataSource, EntityManager } from "typeorm";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { Document } from "../../entities/document.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { SyncBatchReceipt } from "../../entities/sync-batch-receipt.entity";
import { DocumentSyncSession } from "../../entities/document-sync-session.entity";
import { SyncCreateTombstone } from "../../entities/sync-create-tombstone.entity";
import { DocumentsService } from "../documents/documents.service";
import { DocumentDraftService } from "../documents/services/document-draft.service";
import { DocumentSnapshotService } from "../documents/services/document-snapshot.service";
import { generateBlockId, generateVersionId } from "../../common/utils/id-generator.util";
import { generateSortKey as generateSortKeyUtil } from "../../common/utils/sort-key.util";
import { CreateBlockDto } from "./dto/create-block.dto";
import { UpdateBlockDto } from "./dto/update-block.dto";
import { MoveBlockDto } from "./dto/move-block.dto";
import {
  BatchBlockDto,
  BatchCreateOperation,
  BatchDeleteOperation,
  BatchMoveOperation,
  BatchOperationType,
  BatchUpdateOperation,
} from "./dto/batch-block.dto";
import { SyncBatchResponseDto, SyncOperationResultDto } from "./dto/sync-batch-response.dto";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { ActivitiesService } from "../activities/activities.service";
import { BLOCK_ACTIONS } from "../activities/constants/activity-actions";
import { createHash } from "node:crypto";

type SyncCreateDeleteCompensation = {
  blockId: string;
  createdAt: number;
  deletedAt: number;
  ageMs: number;
  createClientBatchId?: string;
  deleteClientBatchId: string;
  clientId?: string;
  syncCreateId?: string;
};

type BatchDeleteResult = {
  blockId: string;
  version?: number;
  matchBy?: "blockId" | "syncCreateId" | "clientId" | "not_found";
  diagnosticCode?: string;
  tombstoned?: boolean;
  createDeleteCompensation?: SyncCreateDeleteCompensation;
};

type BatchCreateResult = {
  blockId?: string;
  version?: number;
  sortKey?: string;
  tombstoned?: boolean;
  diagnosticCode?: string;
};

type StoredBatchResponse = {
  response: SyncBatchResponseDto;
  replayed: boolean;
  createDeleteCompensations: SyncCreateDeleteCompensation[];
};

@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name);
  private readonly createDeleteCompensationWindowMs = 60_000;
  private readonly syncSessionLeaseMs = 5 * 60 * 1000;
  private readonly syncCreateTombstoneTtlMs = 30 * 60 * 1000;

  constructor(
    @InjectRepository(Block)
    private blockRepository: Repository<Block>,
    @InjectRepository(BlockVersion)
    private blockVersionRepository: Repository<BlockVersion>,
    private documentSnapshotService: DocumentSnapshotService,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectDataSource()
    private dataSource: DataSource,
    private documentsService: DocumentsService,
    private documentDraftService: DocumentDraftService,
    private activitiesService: ActivitiesService,
  ) {}

  /**
   * 创建块
   */
  async create(createBlockDto: CreateBlockDto, userId: string) {
    // 检查文档权限并获取文档信息（包含根块ID）
    await this.documentsService.assertAccessWithoutViewIncrement(createBlockDto.docId, userId);

    // 确定父块ID：如果未提供 parentId，则使用文档的根块ID
    let parentId = createBlockDto.parentId;
    if (!parentId || typeof parentId !== "string" || parentId.trim() === "") {
      // 获取文档的根块ID
      const docEntity = await this.documentRepository.findOne({
        where: { docId: createBlockDto.docId },
        select: ["rootBlockId"],
      });
      if (!docEntity || !docEntity.rootBlockId) {
        throw new NotFoundException("文档根块不存在");
      }
      parentId = docEntity.rootBlockId;
    } else {
      // 如果指定了父块，验证父块存在
      const parentBlock = await this.blockRepository.findOne({
        where: { blockId: parentId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException("父块不存在");
      }
      if (parentBlock.docId !== createBlockDto.docId) {
        throw new BadRequestException("父块必须属于同一文档");
      }
    }

    // 使用事务创建块和初始版本
    const result = await this.dataSource.transaction(async (manager) => {
      await this.documentDraftService.lockDocumentForDraftMutation(createBlockDto.docId, manager);
      const now = Date.now();
      const blockId = generateBlockId();
      const sortKey = createBlockDto.sortKey
        ? await this.reserveUniqueSortKey({
            docId: createBlockDto.docId,
            parentId,
            requestedSortKey: createBlockDto.sortKey,
            manager,
            reservedByParent: new Map(),
          })
        : await this.generateSortKey(createBlockDto.docId, parentId, manager);
      const payload = this.mergePayloadPreservingSyncAttrs(
        createBlockDto.payload as Record<string, unknown>,
        undefined,
        sortKey,
      );

      // 创建块
      const block = manager.create(Block, {
        blockId,
        docId: createBlockDto.docId,
        type: createBlockDto.type,
        createdAt: now,
        createdBy: userId,
        latestVer: 1,
        latestAt: now,
        latestBy: userId,
        isDeleted: false,
      });

      await manager.save(Block, block);

      // 创建初始版本
      const hash = this.calculateHash(payload);
      const blockVersion = manager.create(BlockVersion, {
        versionId: generateVersionId(blockId, 1),
        docId: createBlockDto.docId,
        blockId,
        ver: 1,
        createdAt: now,
        createdBy: userId,
        parentId: parentId, // 使用确定的父块ID（根块ID或指定的parentId）
        sortKey,
        indent: createBlockDto.indent || 0,
        collapsed: createBlockDto.collapsed || false,
        payload,
        hash,
        plainText: this.extractPlainText(payload),
        refs: [],
      });

      await manager.save(BlockVersion, blockVersion);

      // 根据 createVersion 参数决定是否立即创建文档版本
      const shouldCreateVersion = createBlockDto.createVersion !== false; // 默认为 true
      if (shouldCreateVersion) {
        await this.incrementDocumentHead(createBlockDto.docId, userId, manager);
      } else {
        await this.documentDraftService.ensureDraftForMutation(
          createBlockDto.docId,
          userId,
          manager,
        );
        await this.documentDraftService.pointBlockToVersion(
          createBlockDto.docId,
          blockId,
          1,
          userId,
          manager,
        );
        await this.documentDraftService.incrementDraftRevision(createBlockDto.docId, manager);
      }

      return {
        blockId,
        docId: createBlockDto.docId,
        type: createBlockDto.type,
        version: 1,
        sortKey,
        payload,
      };
    });

    const doc = await this.documentRepository.findOne({
      where: { docId: createBlockDto.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.CREATE,
        "block",
        result.blockId,
        userId,
        {
          docId: createBlockDto.docId,
          type: createBlockDto.type,
        },
      );
    return result;
  }

  /**
   * 更新块内容
   */
  async updateContent(blockId: string, updateBlockDto: UpdateBlockDto, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId, isDeleted: false },
    });

    if (!block) {
      // 检查是否是软删除的块
      const deletedBlock = await this.blockRepository.findOne({
        where: { blockId },
      });

      if (deletedBlock) {
        throw new NotFoundException(`块已被删除 (blockId: ${blockId})`);
      }

      throw new NotFoundException(`块不存在 (blockId: ${blockId})`);
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);
    const docId = block.docId;

    // 使用「行级锁 + 重试」保证同一 block 高频并发更新的稳定性
    const result = await this.executeWithRetry(
      async () =>
        this.dataSource.transaction(async (manager) => {
          await this.documentDraftService.lockDocumentForDraftMutation(docId, manager);
          const now = Date.now();
          const hash = this.calculateHash(updateBlockDto.payload);

          // 锁定当前 block 行，串行化同一 block 的并发写入
          const lockedBlock = await manager
            .getRepository(Block)
            .createQueryBuilder("b")
            .setLock("pessimistic_write")
            .where("b.blockId = :blockId", { blockId })
            .andWhere("b.isDeleted = :isDeleted", { isDeleted: false })
            .getOne();

          if (!lockedBlock) {
            const deletedBlock = await manager.findOne(Block, {
              where: { blockId },
            });
            if (deletedBlock) {
              throw new NotFoundException(`块已被删除 (blockId: ${blockId})`);
            }
            throw new NotFoundException(`块不存在 (blockId: ${blockId})`);
          }

          // 基于锁内最新版本读取，避免并发请求使用同一个 latestVer
          const latestVersionInfo = await manager.findOne(BlockVersion, {
            where: { blockId, ver: lockedBlock.latestVer },
          });

          if (!latestVersionInfo) {
            throw new NotFoundException("块的最新版本不存在");
          }

          // 内容无变化：直接返回当前版本
          if (latestVersionInfo.hash === hash) {
            return {
              blockId,
              version: lockedBlock.latestVer,
              payload: latestVersionInfo.payload,
            };
          }

          const newVer = await this.getNextBlockVersionNumber(
            manager,
            lockedBlock.docId,
            blockId,
            lockedBlock.latestVer,
          );
          const preservedSortKey =
            latestVersionInfo.sortKey && latestVersionInfo.sortKey.trim() !== ""
              ? latestVersionInfo.sortKey
              : "500000";

          const blockVersion = manager.create(BlockVersion, {
            versionId: generateVersionId(blockId, newVer),
            docId: lockedBlock.docId,
            blockId,
            ver: newVer,
            createdAt: now,
            createdBy: userId,
            parentId: latestVersionInfo.parentId,
            sortKey: preservedSortKey,
            indent: latestVersionInfo.indent,
            collapsed: latestVersionInfo.collapsed,
            payload: updateBlockDto.payload,
            hash,
            plainText: updateBlockDto.plainText || this.extractPlainText(updateBlockDto.payload),
            refs: [],
          });

          await manager.save(BlockVersion, blockVersion);

          lockedBlock.latestVer = newVer;
          lockedBlock.latestAt = now;
          lockedBlock.latestBy = userId;
          await manager.save(Block, lockedBlock);

          const shouldCreateVersion = updateBlockDto.createVersion !== false;
          if (shouldCreateVersion) {
            await this.incrementDocumentHead(lockedBlock.docId, userId, manager);
          } else {
            await this.documentDraftService.ensureDraftForMutation(
              lockedBlock.docId,
              userId,
              manager,
            );
            await this.documentDraftService.pointBlockToVersion(
              lockedBlock.docId,
              blockId,
              newVer,
              userId,
              manager,
            );
            await this.documentDraftService.incrementDraftRevision(lockedBlock.docId, manager);
          }

          return {
            blockId,
            version: newVer,
            payload: updateBlockDto.payload,
          };
        }),
      { blockId, userId },
    );

    const doc = await this.documentRepository.findOne({
      where: { docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.UPDATE,
        "block",
        blockId,
        userId,
        { docId },
      );
    return result;
  }

  private isRetryableConflict(error: unknown): boolean {
    const dbCode = (error as { driverError?: { code?: string } })?.driverError?.code;
    // 23505: unique_violation, 40001: serialization_failure, 40P01: deadlock_detected
    return dbCode === "23505" || dbCode === "40001" || dbCode === "40P01";
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildPayloadAttrEqualsCondition(
    alias: string,
    attrName: string,
    paramName: string,
  ): string {
    const dbType = this.dataSource.options.type;
    if (dbType === "sqlite" || dbType === "better-sqlite3") {
      return `json_extract(${alias}.payload, '$.attrs.${attrName}') = :${paramName}`;
    }
    return `${alias}.payload->'attrs'->>'${attrName}' = :${paramName}`;
  }

  private normalizeClientBatchId(clientBatchId?: string): string | null {
    const normalized = clientBatchId?.trim();
    return normalized ? normalized : null;
  }

  private buildBatchRequestFingerprint(batchBlockDto: BatchBlockDto): string {
    return JSON.stringify({
      docId: batchBlockDto.docId,
      createVersion: batchBlockDto.createVersion !== false,
      baseVersion: batchBlockDto.baseVersion ?? null,
      draftRevision: batchBlockDto.draftRevision ?? null,
      source: batchBlockDto.source ?? null,
      sessionId: batchBlockDto.sessionId ?? null,
      sessionEpoch: batchBlockDto.sessionEpoch ?? null,
      ackedThroughOpSeq: batchBlockDto.ackedThroughOpSeq ?? null,
      operations: batchBlockDto.operations,
    });
  }

  private buildBatchResponse(params: {
    acceptedBatchId: string;
    appliedAt: number;
    serverHead: number;
    draftRevision: number;
    ackedThroughOpSeq?: number;
    needsReload: boolean;
    conflicts: SyncBatchResponseDto["conflicts"];
    results: SyncBatchResponseDto["results"];
  }): SyncBatchResponseDto {
    return {
      acceptedBatchId: params.acceptedBatchId,
      appliedAt: params.appliedAt,
      serverHead: params.serverHead,
      draftRevision: params.draftRevision,
      ...(typeof params.ackedThroughOpSeq === "number"
        ? { ackedThroughOpSeq: params.ackedThroughOpSeq }
        : {}),
      needsReload: params.needsReload,
      conflicts: params.conflicts,
      results: params.results,
    };
  }

  private async findStoredBatchReceipt(
    manager: EntityManager,
    docId: string,
    clientBatchId: string,
  ): Promise<SyncBatchReceipt | null> {
    return manager.getRepository(SyncBatchReceipt).findOne({
      where: { docId, clientBatchId },
    });
  }

  private mapReceiptToBatchResponse(receipt: SyncBatchReceipt): SyncBatchResponseDto {
    return this.buildBatchResponse({
      acceptedBatchId: receipt.acceptedBatchId,
      appliedAt: receipt.appliedAt,
      serverHead: receipt.serverHead,
      draftRevision: receipt.draftRevision,
      ...(typeof receipt.ackedThroughOpSeq === "number"
        ? { ackedThroughOpSeq: receipt.ackedThroughOpSeq }
        : {}),
      needsReload: receipt.needsReload,
      conflicts: receipt.conflicts as unknown as SyncBatchResponseDto["conflicts"],
      results: receipt.results as unknown as SyncBatchResponseDto["results"],
    });
  }

  private async saveBatchReceipt(params: {
    manager: EntityManager;
    docId: string;
    clientBatchId: string;
    requestFingerprint: string;
    response: SyncBatchResponseDto;
    userId: string;
    now: number;
  }): Promise<void> {
    const receiptRepository = params.manager.getRepository(SyncBatchReceipt);
    const existing = await receiptRepository.findOne({
      where: { docId: params.docId, clientBatchId: params.clientBatchId },
    });
    const receipt = receiptRepository.create({
      ...(existing ? { id: existing.id } : {}),
      docId: params.docId,
      clientBatchId: params.clientBatchId,
      requestFingerprint: params.requestFingerprint,
      acceptedBatchId: params.response.acceptedBatchId,
      appliedAt: params.response.appliedAt,
      serverHead: params.response.serverHead,
      draftRevision: params.response.draftRevision,
      ackedThroughOpSeq: params.response.ackedThroughOpSeq ?? null,
      needsReload: params.response.needsReload,
      conflicts: params.response.conflicts,
      results: params.response.results,
      createdBy: existing?.createdBy ?? params.userId,
      createdAt: existing?.createdAt ?? params.now,
      updatedAt: params.now,
    } as any);
    await receiptRepository.save(receipt);
  }

  private async getCurrentDocumentSyncSession(
    manager: EntityManager,
    docId: string,
  ): Promise<DocumentSyncSession | null> {
    return manager.getRepository(DocumentSyncSession).findOne({
      where: { docId },
    });
  }

  private async refreshDocumentSyncSessionLease(
    manager: EntityManager,
    session: DocumentSyncSession,
  ): Promise<void> {
    session.leaseExpiresAt = Date.now() + this.syncSessionLeaseMs;
    session.updatedAt = Date.now();
    await manager.getRepository(DocumentSyncSession).save(session);
  }

  private async advanceDocumentSyncSessionAck(
    manager: EntityManager,
    session: DocumentSyncSession,
    ackedThroughOpSeq?: number,
  ): Promise<void> {
    if (typeof ackedThroughOpSeq !== "number") return;
    session.lastAckedOpSeq = Math.max(session.lastAckedOpSeq ?? 0, ackedThroughOpSeq);
    session.updatedAt = Date.now();
    await manager.getRepository(DocumentSyncSession).save(session);
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: { blockId: string; userId: string },
    maxAttempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isRetryableConflict(error) || attempt >= maxAttempts) {
          throw error;
        }

        const driverError = error as {
          driverError?: { code?: string; constraint?: string };
        };
        const dbCode = driverError.driverError?.code;
        const constraint = driverError.driverError?.constraint;
        const backoff = attempt === 1 ? 20 : 60;
        this.logger.warn(
          `updateContent 并发冲突重试: blockId=${context.blockId}, userId=${context.userId}, attempt=${attempt}/${maxAttempts}, dbCode=${dbCode ?? "unknown"}, constraint=${constraint ?? "unknown"}, backoffMs=${backoff}`,
        );
        await this.delay(backoff);
      }
    }
    throw lastError;
  }

  /**
   * 计算内容的哈希值
   */
  private calculateHash(content: unknown): string {
    return createHash("sha256").update(JSON.stringify(content)).digest("hex");
  }

  /**
   * 从 payload 中提取纯文本
   */
  private extractPlainText(payload: unknown): string {
    if (typeof payload === "string") {
      return payload;
    }
    if (payload && typeof payload === "object" && "text" in payload) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === "string") {
        return text;
      }
    }
    if (payload && typeof payload === "object" && "content" in payload) {
      const content = (payload as { content?: unknown }).content;
      return Array.isArray(content)
        ? content.map((item) => this.extractPlainText(item)).join(" ")
        : String(content);
    }
    return JSON.stringify(payload);
  }

  private parseSortKey(value: string | null | undefined): number | null {
    if (!value || value.trim() === "") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatSortKey(value: number): string {
    return String(Math.max(0, Math.floor(value))).padStart(6, "0");
  }

  private createSortKeyBetween(previous: string | null, next: string | null): string {
    const previousValue = this.parseSortKey(previous);
    const nextValue = this.parseSortKey(next);

    if (previousValue == null && nextValue == null) return "001000";
    if (previousValue == null && nextValue != null) return this.formatSortKey(nextValue / 2);
    if (previousValue != null && nextValue == null) return this.formatSortKey(previousValue + 1000);

    const left = previousValue ?? 0;
    const right = nextValue ?? left + 1000;
    if (right - left <= 1) return this.formatSortKey(left + 1);
    return this.formatSortKey((left + right) / 2);
  }

  private compareSortKeys(left: string, right: string): number {
    return (this.parseSortKey(left) ?? 0) - (this.parseSortKey(right) ?? 0);
  }

  private mergePayloadPreservingSyncAttrs(
    incomingPayload: Record<string, unknown>,
    previousPayload?: Record<string, unknown> | null,
    canonicalSortKey?: string | null,
  ): Record<string, unknown> {
    const previousAttrs = (previousPayload?.attrs as Record<string, unknown> | undefined) ?? {};
    const incomingAttrs = (incomingPayload.attrs as Record<string, unknown> | undefined) ?? {};
    const shouldPreserveLegacyClientBatchId =
      !previousAttrs.syncCreateId &&
      !incomingAttrs.syncCreateId &&
      typeof previousAttrs.clientBatchId === "string" &&
      incomingAttrs.clientBatchId == null;
    const attrs: Record<string, unknown> = {
      ...previousAttrs,
      ...incomingAttrs,
      ...(previousAttrs.clientId && incomingAttrs.clientId == null
        ? { clientId: previousAttrs.clientId }
        : {}),
      ...(shouldPreserveLegacyClientBatchId ? { clientBatchId: previousAttrs.clientBatchId } : {}),
      ...(previousAttrs.syncCreateId && incomingAttrs.syncCreateId == null
        ? { syncCreateId: previousAttrs.syncCreateId }
        : {}),
      ...(canonicalSortKey ? { sortKey: canonicalSortKey } : {}),
    };

    if (incomingAttrs.deleted === true) {
      attrs.deleted = true;
    } else {
      delete attrs.deleted;
    }

    return {
      ...incomingPayload,
      attrs,
    };
  }

  private async listSiblingSortKeys(
    docId: string,
    parentId: string,
    manager: EntityManager,
    excludeBlockId?: string,
  ): Promise<string[]> {
    const siblings = await manager
      .getRepository(BlockVersion)
      .createQueryBuilder("bv")
      .innerJoin(Block, "b", "bv.blockId = b.blockId AND b.isDeleted = false")
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.parentId = :parentId", { parentId })
      .andWhere("bv.ver = b.latestVer")
      .getMany();

    return siblings
      .filter((sibling) => sibling.blockId !== excludeBlockId)
      .filter((sibling) => {
        const attrs = (sibling.payload as { attrs?: Record<string, unknown> } | undefined)?.attrs;
        return attrs?.deleted !== true;
      })
      .map((sibling) => sibling.sortKey)
      .filter((sortKey): sortKey is string => typeof sortKey === "string" && sortKey.trim() !== "")
      .sort((left, right) => this.compareSortKeys(left, right));
  }

  private async reserveUniqueSortKey(input: {
    docId: string;
    parentId: string;
    requestedSortKey?: string;
    manager: EntityManager;
    reservedByParent: Map<string, Set<string>>;
    excludeBlockId?: string;
  }): Promise<string> {
    const siblingSortKeys = await this.listSiblingSortKeys(
      input.docId,
      input.parentId,
      input.manager,
      input.excludeBlockId,
    );
    const reserved = input.reservedByParent.get(input.parentId) ?? new Set<string>();
    const taken = new Set<string>([...siblingSortKeys, ...reserved]);
    const requestedSortKey = input.requestedSortKey?.trim() ? input.requestedSortKey : undefined;

    if (requestedSortKey && !taken.has(requestedSortKey)) {
      reserved.add(requestedSortKey);
      input.reservedByParent.set(input.parentId, reserved);
      return requestedSortKey;
    }

    const orderedTaken = [...taken].sort((left, right) => this.compareSortKeys(left, right));
    let previous: string | null = null;
    let next: string | null = null;

    if (requestedSortKey) {
      const nextIndex = orderedTaken.findIndex(
        (sortKey) => this.compareSortKeys(sortKey, requestedSortKey) >= 0,
      );
      next = nextIndex === -1 ? null : orderedTaken[nextIndex];
      previous = nextIndex <= 0 ? null : orderedTaken[nextIndex - 1];
    } else {
      previous = orderedTaken.length > 0 ? orderedTaken[orderedTaken.length - 1] : null;
      next = null;
    }

    let candidate = this.createSortKeyBetween(previous, next);
    while (taken.has(candidate)) {
      previous = candidate;
      candidate = this.createSortKeyBetween(previous, next);
    }

    reserved.add(candidate);
    input.reservedByParent.set(input.parentId, reserved);
    return candidate;
  }

  /**
   * 生成排序键（异步方法，基于同级块的位置）
   */
  private async generateSortKey(
    docId: string,
    parentId: string,
    manager: EntityManager,
  ): Promise<string> {
    // 查询同级块的最新版本
    const siblings = await manager
      .createQueryBuilder(BlockVersion, "bv")
      .innerJoin(Block, "b", "bv.blockId = b.blockId AND b.isDeleted = false")
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.parentId = :parentId", { parentId })
      .andWhere("bv.ver = b.latestVer") // 只获取最新版本
      .getMany();

    if (siblings.length === 0) {
      // 没有同级块，返回中间值
      return generateSortKeyUtil();
    }

    // 在 JavaScript 中按 sortKey 排序（数字比较）
    siblings.sort((a, b) => {
      const sortKeyA = a.sortKey && a.sortKey.trim() !== "" ? parseInt(a.sortKey, 10) || 0 : 0;
      const sortKeyB = b.sortKey && b.sortKey.trim() !== "" ? parseInt(b.sortKey, 10) || 0 : 0;
      if (sortKeyA !== sortKeyB) {
        return sortKeyA - sortKeyB;
      }
      // 如果 sortKey 相同，按 blockId 排序
      return a.blockId.localeCompare(b.blockId);
    });

    // 获取最后一个同级块的 sortKey
    const lastSibling = siblings[siblings.length - 1];
    const lastSortKey =
      lastSibling.sortKey && lastSibling.sortKey.trim() !== "" ? lastSibling.sortKey : "500000";

    // 生成比最后一个更大的 sortKey
    return generateSortKeyUtil(lastSortKey);
  }

  /**
   * 增加文档版本号，并创建文档修订记录
   */
  private async incrementDocumentHead(
    docId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    const document = await manager.findOne(Document, { where: { docId } });
    if (document) {
      document.head += 1;
      document.updatedBy = userId;
      await manager.save(Document, document);

      // 创建文档修订记录 (DocRevision)
      const docRevisionRepo = manager.getRepository(DocRevision);
      const revision = docRevisionRepo.create({
        revisionId: `${docId}@${document.head}`,
        docId,
        docVer: document.head,
        createdAt: Date.now(),
        createdBy: userId,
        message: "Document updated",
        branch: "draft",
        patches: [],
        rootBlockId: document.rootBlockId,
        source: "editor",
        opSummary: {},
      });
      await docRevisionRepo.save(revision);
      await this.documentSnapshotService.createSnapshotForRevision(docId, document.head, manager, {
        kind: "revision",
        pinned: false,
        metadata: { source: "immediate-block-operation" },
      });
    }
  }

  /**
   * 移动块
   */
  async move(blockId: string, moveBlockDto: MoveBlockDto, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException("块不存在");
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);

    // 验证父块
    if (moveBlockDto.parentId) {
      const parentBlock = await this.blockRepository.findOne({
        where: { blockId: moveBlockDto.parentId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException("父块不存在");
      }
      if (parentBlock.docId !== block.docId) {
        throw new BadRequestException("父块必须属于同一文档");
      }
      // 防止循环引用
      if (await this.wouldCreateCycle(blockId, moveBlockDto.parentId)) {
        throw new BadRequestException("移动操作会导致循环引用");
      }
    }

    // 使用事务更新块位置
    const result = await this.dataSource.transaction(async (manager) => {
      await this.documentDraftService.lockDocumentForDraftMutation(block.docId, manager);
      const now = Date.now();
      const latestVersion = await manager.findOne(BlockVersion, {
        where: { blockId, ver: block.latestVer },
      });

      if (!latestVersion) {
        throw new NotFoundException("块版本不存在");
      }

      const resolvedParentId = moveBlockDto.parentId || latestVersion.parentId || "";
      const resolvedSortKey = await this.reserveUniqueSortKey({
        docId: block.docId,
        parentId: resolvedParentId,
        requestedSortKey: moveBlockDto.sortKey,
        manager,
        reservedByParent: new Map(),
        excludeBlockId: blockId,
      });

      // 创建新版本（移动操作会创建新版本）
      const newVer = await this.getNextBlockVersionNumber(
        manager,
        block.docId,
        blockId,
        block.latestVer,
      );
      const blockVersion = manager.create(BlockVersion, {
        versionId: generateVersionId(blockId, newVer),
        docId: block.docId,
        blockId,
        ver: newVer,
        createdAt: now,
        createdBy: userId,
        parentId: resolvedParentId,
        sortKey: resolvedSortKey,
        indent: moveBlockDto.indent || 0,
        collapsed: latestVersion.collapsed,
        payload: latestVersion.payload,
        hash: latestVersion.hash,
        plainText: latestVersion.plainText,
        refs: latestVersion.refs,
      });

      await manager.save(BlockVersion, blockVersion);

      // 更新块的最新版本信息
      block.latestVer = newVer;
      block.latestAt = now;
      block.latestBy = userId;
      await manager.save(Block, block);

      // 根据 createVersion 参数决定是否立即创建文档版本
      const shouldCreateVersion = moveBlockDto.createVersion !== false; // 默认为 true
      if (shouldCreateVersion) {
        await this.incrementDocumentHead(block.docId, userId, manager);
      } else {
        await this.documentDraftService.ensureDraftForMutation(block.docId, userId, manager);
        await this.documentDraftService.pointBlockToVersion(
          block.docId,
          blockId,
          newVer,
          userId,
          manager,
        );
        await this.documentDraftService.incrementDraftRevision(block.docId, manager);
      }

      return {
        blockId,
        version: newVer,
        parentId: resolvedParentId,
        sortKey: resolvedSortKey,
      };
    });

    const doc = await this.documentRepository.findOne({
      where: { docId: block.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.MOVE,
        "block",
        blockId,
        userId,
        {
          docId: block.docId,
          parentId: moveBlockDto.parentId,
        },
      );
    return result;
  }

  /**
   * 删除块
   */
  async remove(blockId: string, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException("块不存在");
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);

    // 使用事务软删除块
    const result = await this.dataSource.transaction(async (manager) => {
      await this.documentDraftService.lockDocumentForDraftMutation(block.docId, manager);
      const now = Date.now();

      // 软删除块
      block.isDeleted = true;
      block.deletedAt = now;
      block.deletedBy = userId;
      await manager.save(Block, block);

      // 删除操作默认立即创建版本（重要操作）
      await this.incrementDocumentHead(block.docId, userId, manager);

      return { message: "块已删除" };
    });
    const doc = await this.documentRepository.findOne({
      where: { docId: block.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.DELETE,
        "block",
        blockId,
        userId,
        {
          docId: block.docId,
        },
      );
    return result;
  }

  /**
   * 获取块版本历史
   */
  async getVersions(blockId: string, paginationDto: PaginationDto, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId },
    });

    if (!block) {
      throw new NotFoundException("块不存在");
    }

    // 检查块是否已被删除
    if (block.isDeleted) {
      throw new NotFoundException("块已被删除，无法查看历史记录");
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);

    const { page = 1, pageSize = 20 } = paginationDto;
    const skip = (page - 1) * pageSize;

    const [versions, total] = await this.blockVersionRepository.findAndCount({
      where: { blockId },
      order: { ver: "DESC" },
      skip,
      take: pageSize,
    });

    return {
      items: versions,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 检查移动操作是否会导致循环引用
   */
  private async wouldCreateCycle(blockId: string, newParentId: string): Promise<boolean> {
    let currentParentId = newParentId;
    const visited = new Set<string>([blockId]);

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        return true; // 发现循环
      }
      visited.add(currentParentId);

      const parent = await this.blockRepository.findOne({
        where: { blockId: currentParentId, isDeleted: false },
      });

      if (!parent) {
        break;
      }

      // 获取父块的父块ID
      const parentVersion = await this.blockVersionRepository.findOne({
        where: { blockId: currentParentId, ver: parent.latestVer },
      });

      if (!parentVersion || !parentVersion.parentId) {
        break;
      }
      currentParentId = parentVersion.parentId;
    }

    return false;
  }

  private async wouldCreateCycleInManager(
    docId: string,
    blockId: string,
    newParentId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    let currentParentId = newParentId;
    const visited = new Set<string>([blockId]);

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        return true;
      }
      visited.add(currentParentId);

      const parent = await manager.findOne(Block, {
        where: { blockId: currentParentId, docId, isDeleted: false },
      });
      if (!parent) {
        break;
      }

      const parentVersion = await manager.findOne(BlockVersion, {
        where: { docId, blockId: currentParentId, ver: parent.latestVer },
      });
      if (!parentVersion || !parentVersion.parentId) {
        break;
      }
      currentParentId = parentVersion.parentId;
    }

    return false;
  }

  /**
   * 批量操作块
   */
  async batch(batchBlockDto: BatchBlockDto, userId: string): Promise<SyncBatchResponseDto> {
    await this.documentsService.assertAccessWithoutViewIncrement(batchBlockDto.docId, userId);

    const acceptedBatchId = this.normalizeClientBatchId(batchBlockDto.clientBatchId);
    const requestFingerprint = this.buildBatchRequestFingerprint(batchBlockDto);

    const txResult = await this.dataSource.transaction(
      async (manager): Promise<StoredBatchResponse> => {
        const docQuery = manager
          .getRepository(Document)
          .createQueryBuilder("doc")
          .where("doc.docId = :docId", { docId: batchBlockDto.docId });
        const dbType = this.dataSource.options.type;
        if (dbType !== "sqlite" && dbType !== "better-sqlite3") {
          docQuery.setLock("pessimistic_write");
        }
        const docInTx = await docQuery.getOne();
        if (!docInTx) {
          throw new NotFoundException("Document not found");
        }

        const shouldCreateVersion = batchBlockDto.createVersion !== false;
        const serverDraftRevision = docInTx.draftRevision ?? 0;
        const clientDraftRevision = batchBlockDto.draftRevision ?? 0;
        const appliedAt = Date.now();

        if (!acceptedBatchId) {
          return {
            response: this.buildBatchResponse({
              acceptedBatchId: "missing-client-batch-id",
              appliedAt,
              serverHead: docInTx.head,
              draftRevision: serverDraftRevision,
              needsReload: true,
              conflicts: [
                {
                  code: "CLIENT_BATCH_ID_REQUIRED",
                  message: "clientBatchId is required for sync batch writes",
                  serverHead: docInTx.head,
                },
              ],
              results: [],
            }),
            replayed: false,
            createDeleteCompensations: [],
          };
        }

        const existingReceipt = await this.findStoredBatchReceipt(
          manager,
          batchBlockDto.docId,
          acceptedBatchId,
        );
        if (existingReceipt) {
          if (existingReceipt.requestFingerprint !== requestFingerprint) {
            return {
              response: this.buildBatchResponse({
                acceptedBatchId,
                appliedAt,
                serverHead: docInTx.head,
                draftRevision: serverDraftRevision,
                needsReload: true,
                conflicts: [
                  {
                    code: "CLIENT_BATCH_ID_REUSED",
                    message: `clientBatchId(${acceptedBatchId}) has already been used for a different batch request`,
                    serverHead: docInTx.head,
                  },
                ],
                results: [],
              }),
              replayed: false,
              createDeleteCompensations: [],
            };
          }
          return {
            response: this.mapReceiptToBatchResponse(existingReceipt),
            replayed: true,
            createDeleteCompensations: [],
          };
        }

        if (typeof batchBlockDto.baseVersion !== "number") {
          const response = this.buildBatchResponse({
            acceptedBatchId,
            appliedAt,
            serverHead: docInTx.head,
            draftRevision: serverDraftRevision,
            needsReload: true,
            conflicts: [
              {
                code: "BASE_VERSION_REQUIRED",
                message: "baseVersion is required for sync batch writes",
                serverHead: docInTx.head,
              },
            ],
            results: [],
          });
          await this.saveBatchReceipt({
            manager,
            docId: batchBlockDto.docId,
            clientBatchId: acceptedBatchId,
            requestFingerprint,
            response,
            userId,
            now: appliedAt,
          });
          return {
            response,
            replayed: false,
            createDeleteCompensations: [],
          };
        }

        if (batchBlockDto.baseVersion !== docInTx.head) {
          const response = this.buildBatchResponse({
            acceptedBatchId,
            appliedAt,
            serverHead: docInTx.head,
            draftRevision: serverDraftRevision,
            needsReload: true,
            conflicts: [
              {
                code: "BASE_VERSION_MISMATCH",
                message: `baseVersion(${batchBlockDto.baseVersion}) does not match serverHead(${docInTx.head})`,
                serverHead: docInTx.head,
                clientBaseVersion: batchBlockDto.baseVersion,
              },
            ],
            results: [],
          });
          await this.saveBatchReceipt({
            manager,
            docId: batchBlockDto.docId,
            clientBatchId: acceptedBatchId,
            requestFingerprint,
            response,
            userId,
            now: appliedAt,
          });
          return {
            response,
            replayed: false,
            createDeleteCompensations: [],
          };
        }

        if (!shouldCreateVersion && clientDraftRevision !== serverDraftRevision) {
          const response = this.buildBatchResponse({
            acceptedBatchId,
            appliedAt,
            serverHead: docInTx.head,
            draftRevision: serverDraftRevision,
            needsReload: true,
            conflicts: [
              {
                code: "DRAFT_REVISION_MISMATCH",
                message: `draftRevision(${clientDraftRevision}) does not match serverDraftRevision(${serverDraftRevision})`,
                serverHead: docInTx.head,
                serverDraftRevision,
                clientDraftRevision,
              },
            ],
            results: [],
          });
          await this.saveBatchReceipt({
            manager,
            docId: batchBlockDto.docId,
            clientBatchId: acceptedBatchId,
            requestFingerprint,
            response,
            userId,
            now: appliedAt,
          });
          return {
            response,
            replayed: false,
            createDeleteCompensations: [],
          };
        }

        const currentSyncSession = await this.getCurrentDocumentSyncSession(
          manager,
          batchBlockDto.docId,
        );
        if (currentSyncSession) {
          if (!batchBlockDto.sessionId || typeof batchBlockDto.sessionEpoch !== "number") {
            const response = this.buildBatchResponse({
              acceptedBatchId,
              appliedAt,
              serverHead: docInTx.head,
              draftRevision: serverDraftRevision,
              needsReload: true,
              conflicts: [
                {
                  code: "SYNC_SESSION_REQUIRED",
                  message: "sessionId and sessionEpoch are required for sync batch writes",
                  serverHead: docInTx.head,
                },
              ],
              results: [],
            });
            await this.saveBatchReceipt({
              manager,
              docId: batchBlockDto.docId,
              clientBatchId: acceptedBatchId,
              requestFingerprint,
              response,
              userId,
              now: appliedAt,
            });
            return {
              response,
              replayed: false,
              createDeleteCompensations: [],
            };
          }
          if (
            currentSyncSession.sessionId !== batchBlockDto.sessionId ||
            currentSyncSession.sessionEpoch !== batchBlockDto.sessionEpoch
          ) {
            const response = this.buildBatchResponse({
              acceptedBatchId,
              appliedAt,
              serverHead: docInTx.head,
              draftRevision: serverDraftRevision,
              needsReload: true,
              conflicts: [
                {
                  code: "SYNC_SESSION_MISMATCH",
                  message: "sync session is stale, please reload the document",
                  serverHead: docInTx.head,
                },
              ],
              results: [],
            });
            await this.saveBatchReceipt({
              manager,
              docId: batchBlockDto.docId,
              clientBatchId: acceptedBatchId,
              requestFingerprint,
              response,
              userId,
              now: appliedAt,
            });
            return {
              response,
              replayed: false,
              createDeleteCompensations: [],
            };
          }
          if (currentSyncSession.leaseExpiresAt < Date.now()) {
            const response = this.buildBatchResponse({
              acceptedBatchId,
              appliedAt,
              serverHead: docInTx.head,
              draftRevision: serverDraftRevision,
              needsReload: true,
              conflicts: [
                {
                  code: "SYNC_SESSION_EXPIRED",
                  message: "sync session lease expired, please reload the document",
                  serverHead: docInTx.head,
                },
              ],
              results: [],
            });
            await this.saveBatchReceipt({
              manager,
              docId: batchBlockDto.docId,
              clientBatchId: acceptedBatchId,
              requestFingerprint,
              response,
              userId,
              now: appliedAt,
            });
            return {
              response,
              replayed: false,
              createDeleteCompensations: [],
            };
          }
          await this.refreshDocumentSyncSessionLease(manager, currentSyncSession);
        }

        const results: SyncOperationResultDto[] = [];
        const now = Date.now();
        let draftRevision = serverDraftRevision;
        const reservedSortKeysByParent = new Map<string, Set<string>>();
        const draftMutations: Array<{
          type: "point" | "deleted";
          blockId: string;
          version: number;
        }> = [];
        const createDeleteCompensations: SyncCreateDeleteCompensation[] = [];

        for (const operation of batchBlockDto.operations) {
          try {
            if (operation.type === BatchOperationType.CREATE) {
              const created = await this.handleBatchCreate(
                operation,
                batchBlockDto.docId,
                acceptedBatchId,
                userId,
                now,
                manager,
                reservedSortKeysByParent,
              );
              if (!shouldCreateVersion && created.blockId && created.version) {
                draftMutations.push({
                  type: "point",
                  blockId: created.blockId,
                  version: created.version,
                });
              }
              results.push({
                operation: BatchOperationType.CREATE,
                success: true,
                clientId: operation.clientId,
                ...created,
              });
            } else if (operation.type === BatchOperationType.UPDATE) {
              const updated = await this.handleBatchUpdate(
                operation,
                batchBlockDto.docId,
                userId,
                now,
                manager,
              );
              if (!shouldCreateVersion) {
                draftMutations.push({
                  type: "point",
                  blockId: updated.blockId,
                  version: updated.version,
                });
              }
              results.push({
                operation: BatchOperationType.UPDATE,
                success: true,
                ...updated,
              });
            } else if (operation.type === BatchOperationType.DELETE) {
              const removed = await this.handleBatchDelete(
                operation,
                batchBlockDto.docId,
                acceptedBatchId,
                userId,
                now,
                manager,
                shouldCreateVersion,
                batchBlockDto.sessionId,
                batchBlockDto.sessionEpoch,
              );
              const { createDeleteCompensation, ...removedAck } = removed;
              if (createDeleteCompensation) {
                createDeleteCompensations.push(createDeleteCompensation);
              }
              if (!shouldCreateVersion && removed.version) {
                draftMutations.push({
                  type: "deleted",
                  blockId: removed.blockId,
                  version: removed.version,
                });
              }
              results.push({
                operation: BatchOperationType.DELETE,
                success: true,
                ...removedAck,
              });
            } else if (operation.type === BatchOperationType.MOVE) {
              const moved = await this.handleBatchMove(
                operation,
                batchBlockDto.docId,
                userId,
                now,
                manager,
                reservedSortKeysByParent,
              );
              if (!shouldCreateVersion) {
                draftMutations.push({
                  type: "point",
                  blockId: moved.blockId,
                  version: moved.version,
                });
              }
              results.push({
                operation: BatchOperationType.MOVE,
                success: true,
                ...moved,
              });
            }
          } catch (error) {
            results.push({
              operation: operation.type,
              success: false,
              ...(operation.type === BatchOperationType.CREATE
                ? { clientId: operation.clientId }
                : {}),
              ...(operation.type !== BatchOperationType.CREATE &&
              (operation as BatchUpdateOperation | BatchDeleteOperation | BatchMoveOperation).blockId
                ? {
                    blockId: (
                      operation as BatchUpdateOperation | BatchDeleteOperation | BatchMoveOperation
                    ).blockId,
                  }
                : {}),
              error: (error as Error).message,
            });
          }
        }

        const successCount = results.filter((item) => item.success).length;
        const hasFailures = results.some((item) => !item.success);
        if (shouldCreateVersion && successCount > 0 && !hasFailures) {
          await this.incrementDocumentHead(batchBlockDto.docId, userId, manager);
        } else if (!shouldCreateVersion && draftMutations.length > 0) {
          await this.documentDraftService.ensureDraftForMutation(
            batchBlockDto.docId,
            userId,
            manager,
          );
          for (const mutation of draftMutations) {
            if (mutation.type === "deleted") {
              await this.documentDraftService.pointBlockToDeletedVersion(
                batchBlockDto.docId,
                mutation.blockId,
                mutation.version,
                userId,
                manager,
              );
            } else {
              await this.documentDraftService.pointBlockToVersion(
                batchBlockDto.docId,
                mutation.blockId,
                mutation.version,
                userId,
                manager,
              );
            }
          }
          docInTx.draftRevision = serverDraftRevision + 1;
          docInTx.updatedBy = userId;
          await manager.save(Document, docInTx);
          draftRevision = docInTx.draftRevision;
        }

        const docAfterBatch = await manager.findOne(Document, {
          where: { docId: batchBlockDto.docId },
          select: ["head"],
        });

        const response = this.buildBatchResponse({
          acceptedBatchId,
          appliedAt,
          serverHead: docAfterBatch?.head ?? docInTx.head,
          draftRevision,
          ...(!hasFailures && typeof batchBlockDto.ackedThroughOpSeq === "number"
            ? { ackedThroughOpSeq: batchBlockDto.ackedThroughOpSeq }
            : {}),
          needsReload: false,
          conflicts: [],
          results,
        });
        await this.saveBatchReceipt({
          manager,
          docId: batchBlockDto.docId,
          clientBatchId: acceptedBatchId,
          requestFingerprint,
          response,
          userId,
          now,
        });
        if (currentSyncSession && !hasFailures) {
          await this.advanceDocumentSyncSessionAck(
            manager,
            currentSyncSession,
            (batchBlockDto as BatchBlockDto & { ackedThroughOpSeq?: number }).ackedThroughOpSeq,
          );
        }

        return {
          response,
          replayed: false,
          createDeleteCompensations,
        };
      },
    );

    if (txResult.response.needsReload || txResult.replayed) {
      return txResult.response;
    }

    this.logger.log(
      `sync batch: docId=${batchBlockDto.docId}, clientBatchId=${acceptedBatchId}, source=${batchBlockDto.source ?? "unknown"}, operations=${batchBlockDto.operations.length}, serverHead=${txResult.response.serverHead}`,
    );
    if (txResult.createDeleteCompensations.length > 0) {
      const examples = txResult.createDeleteCompensations.slice(0, 5).map((item) => ({
        blockId: item.blockId,
        clientId: item.clientId,
        syncCreateId: item.syncCreateId,
        createClientBatchId: item.createClientBatchId,
        ageMs: item.ageMs,
      }));
      this.logger.warn(
        `sync create-delete compensation: docId=${batchBlockDto.docId}, deleteClientBatchId=${acceptedBatchId}, count=${txResult.createDeleteCompensations.length}, windowMs=${this.createDeleteCompensationWindowMs}, examples=${JSON.stringify(examples)}`,
      );
    }

    const doc = await this.documentRepository.findOne({
      where: { docId: batchBlockDto.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.BATCH,
        "block",
        batchBlockDto.docId,
        userId,
        {
          count: batchBlockDto.operations.length,
        },
      );

    return {
      ...txResult.response,
    };
  }

  private async handleBatchCreate(
    operation: BatchCreateOperation,
    docId: string,
    clientBatchId: string,
    userId: string,
    now: number,
    manager: EntityManager,
    reservedSortKeysByParent: Map<string, Set<string>>,
  ): Promise<BatchCreateResult> {
    if (operation.data.docId && operation.data.docId !== docId) {
      throw new BadRequestException(
        `Create operation docId mismatch: ${operation.data.docId} !== ${docId}`,
      );
    }

    const tombstone = await this.findActiveSyncCreateTombstone(
      manager,
      docId,
      operation.clientId,
      operation.syncCreateId,
    );
    if (tombstone) {
      return {
        tombstoned: true,
        diagnosticCode: "CREATE_SUPPRESSED_BY_TOMBSTONE",
      };
    }

    let parentId = operation.data.parentId;
    if (!parentId || typeof parentId !== "string" || parentId.trim() === "") {
      const docEntity = await manager.findOne(Document, {
        where: { docId },
        select: ["rootBlockId"],
      });
      if (!docEntity || !docEntity.rootBlockId) {
        throw new NotFoundException("Document root block not found");
      }
      parentId = docEntity.rootBlockId;
    } else {
      const parentBlock = await manager.findOne(Block, {
        where: { blockId: parentId, docId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException(`Parent block ${parentId} not found in document ${docId}`);
      }
    }

    const existing = await this.findExistingCreateByClientIdentity(
      manager,
      docId,
      clientBatchId,
      operation.clientId,
      operation.syncCreateId,
    );
    if (existing) {
      return {
        blockId: existing.blockId,
        version: existing.ver,
        sortKey: existing.sortKey,
      };
    }

    const blockId = generateBlockId();
    const sortKey = await this.reserveUniqueSortKey({
      docId,
      parentId,
      requestedSortKey: operation.data.sortKey,
      manager,
      reservedByParent: reservedSortKeysByParent,
    });
    const payload = this.mergePayloadPreservingSyncAttrs(
      {
        ...(operation.data.payload as Record<string, unknown>),
        attrs: {
          ...(((operation.data.payload as Record<string, unknown>).attrs as
            | Record<string, unknown>
            | undefined) ?? {}),
          ...(!operation.syncCreateId && operation.clientId ? { clientBatchId } : {}),
          ...(operation.clientId ? { clientId: operation.clientId } : {}),
          ...(operation.syncCreateId ? { syncCreateId: operation.syncCreateId } : {}),
        },
      },
      undefined,
      sortKey,
    );

    const block = manager.create(Block, {
      blockId,
      docId,
      type: operation.data.type,
      createdAt: now,
      createdBy: userId,
      latestVer: 1,
      latestAt: now,
      latestBy: userId,
      isDeleted: false,
    });

    await manager.save(Block, block);

    const hash = this.calculateHash(payload);
    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(blockId, 1),
      docId,
      blockId,
      ver: 1,
      createdAt: now,
      createdBy: userId,
      parentId,
      sortKey,
      indent: operation.data.indent || 0,
      collapsed: operation.data.collapsed || false,
      payload,
      hash,
      plainText: this.extractPlainText(payload),
      refs: [],
    });

    await manager.save(BlockVersion, blockVersion);

    return { blockId, version: 1, sortKey };
  }

  private async findExistingCreateByClientIdentity(
    manager: EntityManager,
    docId: string,
    clientBatchId: string | undefined,
    clientId: string | undefined,
    syncCreateId?: string,
  ): Promise<BlockVersion | null> {
    if (!syncCreateId && (!clientBatchId || !clientId)) return null;

    if (syncCreateId) {
      const matchedBySyncCreateId = await manager
        .getRepository(BlockVersion)
        .createQueryBuilder("bv")
        .innerJoin(Block, "b", "b.blockId = bv.blockId AND b.latestVer = bv.ver")
        .where("bv.docId = :docId", { docId })
        .andWhere("b.isDeleted = false")
        .andWhere(this.buildPayloadAttrEqualsCondition("bv", "syncCreateId", "syncCreateId"), {
          syncCreateId,
        })
        .getOne();
      if (matchedBySyncCreateId) {
        return matchedBySyncCreateId;
      }
    }

    if (!clientBatchId || !clientId) {
      return null;
    }

    return manager
      .getRepository(BlockVersion)
      .createQueryBuilder("bv")
      .innerJoin(Block, "b", "b.blockId = bv.blockId AND b.latestVer = bv.ver")
      .where("bv.docId = :docId", { docId })
      .andWhere("b.isDeleted = false")
      .andWhere(
        this.buildPayloadAttrEqualsCondition("bv", "clientBatchId", "clientBatchId"),
        {
          clientBatchId,
        },
      )
      .andWhere(this.buildPayloadAttrEqualsCondition("bv", "clientId", "clientId"), {
        clientId,
      })
      .getOne();
  }

  private async findActiveBlockVersionByClientIdentity(
    manager: EntityManager,
    docId: string,
    clientId: string | undefined,
    syncCreateId?: string,
  ): Promise<{ version: BlockVersion; matchBy: "syncCreateId" | "clientId" } | null> {
    if (!syncCreateId && !clientId) return null;

    if (syncCreateId) {
      const matchedBySyncCreateId = await manager
        .getRepository(BlockVersion)
        .createQueryBuilder("bv")
        .innerJoin(Block, "b", "b.blockId = bv.blockId AND b.latestVer = bv.ver")
        .where("bv.docId = :docId", { docId })
        .andWhere("b.isDeleted = false")
        .andWhere(this.buildPayloadAttrEqualsCondition("bv", "syncCreateId", "syncCreateId"), {
          syncCreateId,
        })
        .getOne();
      if (matchedBySyncCreateId) {
        return { version: matchedBySyncCreateId, matchBy: "syncCreateId" };
      }
    }

    if (!clientId) return null;

    const matchedByClientId = await manager
      .getRepository(BlockVersion)
      .createQueryBuilder("bv")
      .innerJoin(Block, "b", "b.blockId = bv.blockId AND b.latestVer = bv.ver")
      .where("bv.docId = :docId", { docId })
      .andWhere("b.isDeleted = false")
      .andWhere(this.buildPayloadAttrEqualsCondition("bv", "clientId", "clientId"), {
        clientId,
      })
      .getOne();
    return matchedByClientId ? { version: matchedByClientId, matchBy: "clientId" } : null;
  }

  private async findActiveSyncCreateTombstone(
    manager: EntityManager,
    docId: string,
    clientId: string | undefined,
    syncCreateId?: string,
  ): Promise<SyncCreateTombstone | null> {
    if (!syncCreateId && !clientId) return null;

    const query = manager
      .getRepository(SyncCreateTombstone)
      .createQueryBuilder("t")
      .where("t.docId = :docId", { docId })
      .andWhere("t.expiresAt > :now", { now: Date.now() });

    if (syncCreateId && clientId) {
      query.andWhere("(t.syncCreateId = :syncCreateId OR t.clientId = :clientId)", {
        syncCreateId,
        clientId,
      });
    } else if (syncCreateId) {
      query.andWhere("t.syncCreateId = :syncCreateId", { syncCreateId });
    } else if (clientId) {
      query.andWhere("t.clientId = :clientId", { clientId });
    }

    return query.getOne();
  }

  private async saveSyncCreateTombstone(params: {
    manager: EntityManager;
    docId: string;
    clientId?: string;
    syncCreateId?: string;
    sessionId?: string;
    sessionEpoch?: number;
    deleteClientBatchId: string;
    userId: string;
    now: number;
  }): Promise<SyncCreateTombstone | null> {
    if (!params.clientId && !params.syncCreateId) return null;

    const existing = await this.findActiveSyncCreateTombstone(
      params.manager,
      params.docId,
      params.clientId,
      params.syncCreateId,
    );
    if (existing) return existing;

    const repository = params.manager.getRepository(SyncCreateTombstone);
    const tombstone = repository.create({
      docId: params.docId,
      sessionId: params.sessionId ?? null,
      sessionEpoch:
        typeof params.sessionEpoch === "number" ? params.sessionEpoch : null,
      clientId: params.clientId ?? null,
      syncCreateId: params.syncCreateId ?? null,
      deleteClientBatchId: params.deleteClientBatchId,
      deletedAt: params.now,
      expiresAt: params.now + this.syncCreateTombstoneTtlMs,
      createdBy: params.userId,
    });
    return repository.save(tombstone);
  }

  private async handleBatchUpdate(
    operation: BatchUpdateOperation,
    docId: string,
    userId: string,
    now: number,
    manager: EntityManager,
  ): Promise<{ blockId: string; version: number }> {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, docId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`Block ${operation.blockId} not found`);
    }

    const newVer = await this.getNextBlockVersionNumber(
      manager,
      block.docId,
      operation.blockId,
      block.latestVer,
    );
    const latestVersion = await manager.findOne(BlockVersion, {
      where: { docId, blockId: operation.blockId, ver: block.latestVer },
    });
    const payload = this.mergePayloadPreservingSyncAttrs(
      operation.data.payload as Record<string, unknown>,
      (latestVersion?.payload as Record<string, unknown> | undefined) ?? undefined,
      latestVersion?.sortKey,
    );
    const hash = this.calculateHash(payload);

    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(operation.blockId, newVer),
      docId: block.docId,
      blockId: operation.blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: latestVersion?.parentId || "",
      sortKey: latestVersion?.sortKey || "0",
      indent: latestVersion?.indent || 0,
      collapsed: latestVersion?.collapsed || false,
      payload,
      hash,
      plainText: operation.data.plainText || this.extractPlainText(payload),
      refs: [],
    });

    await manager.save(BlockVersion, blockVersion);

    block.latestVer = newVer;
    block.latestAt = now;
    block.latestBy = userId;
    await manager.save(Block, block);

    return { blockId: operation.blockId, version: newVer };
  }

  private async handleBatchDelete(
    operation: BatchDeleteOperation,
    docId: string,
    clientBatchId: string,
    userId: string,
    now: number,
    manager: EntityManager,
    shouldCreateVersion: boolean,
    sessionId?: string,
    sessionEpoch?: number,
  ): Promise<BatchDeleteResult> {
    let blockId = operation.blockId;
    let matchBy: BatchDeleteResult["matchBy"] = blockId ? "blockId" : undefined;
    if (!blockId) {
      const matched = await this.findActiveBlockVersionByClientIdentity(
        manager,
        docId,
        operation.clientId,
        operation.syncCreateId,
      );
      blockId = matched?.version.blockId;
      matchBy = matched?.matchBy;
    }

    if (!blockId) {
      if (operation.clientId || operation.syncCreateId) {
        await this.saveSyncCreateTombstone({
          manager,
          docId,
          clientId: operation.clientId,
          syncCreateId: operation.syncCreateId,
          sessionId,
          sessionEpoch,
          deleteClientBatchId: clientBatchId,
          userId,
          now,
        });
        return {
          blockId: operation.clientId ?? operation.syncCreateId ?? "client-identity-not-found",
          matchBy: "not_found",
          diagnosticCode: "DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY",
          tombstoned: true,
        };
      }
      throw new BadRequestException("Delete operation requires blockId, clientId, or syncCreateId");
    }

    const block = await manager.findOne(Block, {
      where: { blockId, docId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`Block ${blockId} not found`);
    }

    if (shouldCreateVersion) {
      const latestVersion = await manager.findOne(BlockVersion, {
        where: { docId, blockId, ver: block.latestVer },
      });
      if (!latestVersion) {
        throw new NotFoundException("Block version not found");
      }
      const createDeleteCompensation = this.buildCreateDeleteCompensation(
        block,
        latestVersion,
        clientBatchId,
        now,
      );
      block.isDeleted = true;
      block.deletedAt = now;
      block.deletedBy = userId;
      await manager.save(Block, block);
      return { blockId, matchBy, createDeleteCompensation };
    }

    const latestVersion = await manager.findOne(BlockVersion, {
      where: { docId, blockId, ver: block.latestVer },
    });

    if (!latestVersion) {
      throw new NotFoundException("Block version not found");
    }
    const createDeleteCompensation = this.buildCreateDeleteCompensation(
      block,
      latestVersion,
      clientBatchId,
      now,
    );

    const newVer = await this.getNextBlockVersionNumber(
      manager,
      block.docId,
      blockId,
      block.latestVer,
    );
    const deletedPayload = {
      ...(latestVersion.payload as Record<string, unknown>),
      attrs: {
        ...(((latestVersion.payload as Record<string, unknown>).attrs as
          | Record<string, unknown>
          | undefined) ?? {}),
        deleted: true,
      },
    };

    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(blockId, newVer),
      docId: block.docId,
      blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: latestVersion.parentId,
      sortKey: latestVersion.sortKey,
      indent: latestVersion.indent,
      collapsed: latestVersion.collapsed,
      payload: deletedPayload,
      hash: this.calculateHash(deletedPayload),
      plainText: latestVersion.plainText,
      refs: latestVersion.refs,
    });

    await manager.save(BlockVersion, blockVersion);

    block.latestVer = newVer;
    block.latestAt = now;
    block.latestBy = userId;
    await manager.save(Block, block);

    return {
      blockId,
      version: newVer,
      matchBy,
      createDeleteCompensation,
    };
  }

  private async getNextBlockVersionNumber(
    manager: EntityManager,
    docId: string,
    blockId: string,
    currentLatestVer: number,
  ): Promise<number> {
    const raw = await manager
      .getRepository(BlockVersion)
      .createQueryBuilder("bv")
      .select("MAX(bv.ver)", "maxVer")
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.blockId = :blockId", { blockId })
      .getRawOne<{ maxVer?: number | string | null }>();
    const maxHistoricalVer = Math.max(
      currentLatestVer,
      Number.isFinite(Number(raw?.maxVer)) ? Number(raw?.maxVer) : currentLatestVer,
    );
    return maxHistoricalVer + 1;
  }

  private buildCreateDeleteCompensation(
    block: Block,
    latestVersion: BlockVersion,
    deleteClientBatchId: string,
    deletedAt: number,
  ): SyncCreateDeleteCompensation | undefined {
    const createdAt = Number(block.createdAt);
    if (!Number.isFinite(createdAt)) return undefined;

    const ageMs = deletedAt - createdAt;
    if (ageMs < 0 || ageMs > this.createDeleteCompensationWindowMs) return undefined;

    const attrs = (latestVersion.payload as { attrs?: Record<string, unknown> } | undefined)?.attrs;
    if (!attrs?.clientBatchId && !attrs?.clientId && !attrs?.syncCreateId) return undefined;

    return {
      blockId: block.blockId,
      createdAt,
      deletedAt,
      ageMs,
      deleteClientBatchId,
      ...(typeof attrs.clientBatchId === "string"
        ? { createClientBatchId: attrs.clientBatchId }
        : {}),
      ...(typeof attrs.clientId === "string" ? { clientId: attrs.clientId } : {}),
      ...(typeof attrs.syncCreateId === "string" ? { syncCreateId: attrs.syncCreateId } : {}),
    };
  }

  private async handleBatchMove(
    operation: BatchMoveOperation,
    docId: string,
    userId: string,
    now: number,
    manager: EntityManager,
    reservedSortKeysByParent: Map<string, Set<string>>,
  ): Promise<{ blockId: string; version: number; sortKey: string }> {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, docId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`Block ${operation.blockId} not found`);
    }

    if (operation.parentId) {
      if (operation.parentId === operation.blockId) {
        throw new BadRequestException("Cannot move block under itself");
      }
      const parentBlock = await manager.findOne(Block, {
        where: { blockId: operation.parentId, docId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException(
          `Parent block ${operation.parentId} not found in document ${docId}`,
        );
      }
      if (
        await this.wouldCreateCycleInManager(docId, operation.blockId, operation.parentId, manager)
      ) {
        throw new BadRequestException("Move operation would create a cycle");
      }
    }

    const latestVersion = await manager.findOne(BlockVersion, {
      where: { docId, blockId: operation.blockId, ver: block.latestVer },
    });

    if (!latestVersion) {
      throw new NotFoundException("Block version not found");
    }

    const resolvedSortKey = await this.reserveUniqueSortKey({
      docId,
      parentId: operation.parentId || "",
      requestedSortKey: operation.sortKey,
      manager,
      reservedByParent: reservedSortKeysByParent,
      excludeBlockId: operation.blockId,
    });

    const newVer = await this.getNextBlockVersionNumber(
      manager,
      block.docId,
      operation.blockId,
      block.latestVer,
    );
    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(operation.blockId, newVer),
      docId: block.docId,
      blockId: operation.blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: operation.parentId || "",
      sortKey: resolvedSortKey,
      indent: operation.indent || 0,
      collapsed: latestVersion.collapsed,
      payload: latestVersion.payload,
      hash: latestVersion.hash,
      plainText: latestVersion.plainText,
      refs: latestVersion.refs,
    });

    await manager.save(BlockVersion, blockVersion);

    block.latestVer = newVer;
    block.latestAt = now;
    block.latestBy = userId;
    await manager.save(Block, block);

    return {
      blockId: operation.blockId,
      version: newVer,
      sortKey: resolvedSortKey,
    };
  }
}
