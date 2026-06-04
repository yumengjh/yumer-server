import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { DocDraft } from "../../../entities/doc-draft.entity";
import { Block } from "../../../entities/block.entity";
import { Document } from "../../../entities/document.entity";
import { DocRevision } from "../../../entities/doc-revision.entity";
import { DocSnapshot } from "../../../entities/doc-snapshot.entity";
import { generateVersionId } from "../../../common/utils/id-generator.util";
import { BlockVersion } from "../../../entities/block-version.entity";

@Injectable()
export class DocumentDraftService {
  constructor(
    @InjectRepository(DocDraft)
    private readonly docDraftRepository: Repository<DocDraft>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(Block)
    private readonly blockRepository: Repository<Block>,
    @InjectRepository(BlockVersion)
    private readonly blockVersionRepository: Repository<BlockVersion>,
    @InjectRepository(DocRevision)
    private readonly docRevisionRepository: Repository<DocRevision>,
    @InjectRepository(DocSnapshot)
    private readonly docSnapshotRepository: Repository<DocSnapshot>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByDocId(docId: string): Promise<DocDraft | null> {
    return this.docDraftRepository.findOne({ where: { docId } });
  }

  async ensureDraftForMutation(
    docId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<DocDraft> {
    await this.lockDocumentForDraftMutation(docId, manager);
    const draftRepository = manager.getRepository(DocDraft);
    const existing = await draftRepository.findOne({ where: { docId } });
    if (existing) return existing;
    return this.createDraftFromHeadSnapshot(docId, userId, manager);
  }

  async pointBlockToVersion(
    docId: string,
    blockId: string,
    version: number,
    userId: string,
    manager: EntityManager,
  ): Promise<DocDraft> {
    const draftRepository = manager.getRepository(DocDraft);
    const draft = await this.ensureDraftForMutation(docId, userId, manager);
    draft.blockVersionMap = {
      ...(draft.blockVersionMap ?? {}),
      [blockId]: version,
    };
    draft.updatedBy = userId;
    draft.updatedAt = Date.now();
    draft.changedBlocksCount = await this.calculateChangedBlocksCount(draft, manager);
    return draftRepository.save(draft);
  }

  async pointBlockToDeletedVersion(
    docId: string,
    blockId: string,
    version: number,
    userId: string,
    manager: EntityManager,
  ): Promise<DocDraft> {
    return this.pointBlockToVersion(docId, blockId, version, userId, manager);
  }

  async discardDraft(docId: string) {
    return this.dataSource.transaction((manager) => this.discardDraftWithManager(docId, manager));
  }

  async discardDraftWithManager(docId: string, manager: EntityManager) {
    await this.lockDocumentForDraftMutation(docId, manager);
    await this.deleteDraft(docId, manager);
    await this.incrementDraftRevision(docId, manager);
    return {
      docId,
      discarded: true,
      fallbackSource: "head" as const,
    };
  }

  async incrementDraftRevision(docId: string, manager: EntityManager): Promise<number> {
    const documentRepository = manager.getRepository(Document);
    await documentRepository.increment({ docId }, "draftRevision", 1);
    const document = await documentRepository.findOne({
      where: { docId },
      select: ["draftRevision"],
    });
    if (!document) {
      throw new NotFoundException(`文档 ${docId} 不存在`);
    }
    return document.draftRevision;
  }

  async commitDraft(docId: string, userId: string, message?: string) {
    return this.dataSource.transaction((manager) =>
      this.commitDraftWithManager(docId, userId, message, manager),
    );
  }

  async commitDraftWithManager(
    docId: string,
    userId: string,
    message: string | undefined,
    manager: EntityManager,
  ) {
    const document = await this.lockDocumentForDraftMutation(docId, manager);
    const draft = await manager.getRepository(DocDraft).findOne({ where: { docId } });
    if (!draft) {
      throw new BadRequestException("没有可提交的草稿");
    }

    const newVersion = document.head + 1;
    document.head = newVersion;
    document.updatedBy = userId;
    await manager.save(Document, document);

    const revision = manager.getRepository(DocRevision).create({
      revisionId: `${docId}@${newVersion}`,
      docId,
      docVer: newVersion,
      createdAt: Date.now(),
      createdBy: userId,
      message: message || "Document updated from draft",
      branch: "draft",
      patches: [],
      rootBlockId: document.rootBlockId,
      source: "editor",
      opSummary: {
        source: "draft-commit",
        baseDocVer: draft.baseDocVer,
        changedBlocksCount: draft.changedBlocksCount,
        draftId: draft.draftId,
      },
    });
    await manager.save(DocRevision, revision);

    const snapshot = manager.getRepository(DocSnapshot).create({
      snapshotId: `${docId}@snap@${newVersion}`,
      docId,
      docVer: newVersion,
      createdAt: Date.now(),
      rootBlockId: draft.rootBlockId,
      blockVersionMap: draft.blockVersionMap,
      kind: "revision",
      pinned: false,
      retainUntil: null,
      metadata: {
        source: "draft-commit",
        baseDocVer: draft.baseDocVer,
        changedBlocksCount: draft.changedBlocksCount,
        draftId: draft.draftId,
      },
    });
    await manager.save(DocSnapshot, snapshot);
    await this.deleteDraft(docId, manager);

    return {
      docId,
      version: newVersion,
      committed: true,
      draftRemoved: true,
    };
  }

  private async createDraftFromHeadSnapshot(
    docId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<DocDraft> {
    const document = await manager.findOne(Document, { where: { docId } });
    if (!document) {
      throw new NotFoundException(`文档 ${docId} 不存在`);
    }

    const snapshotRepository = manager.getRepository(DocSnapshot);
    const draftRepository = manager.getRepository(DocDraft);
    const snapshot = await snapshotRepository.findOne({
      where: {
        docId,
        docVer: document.head,
      },
    });

    const blockVersionMap =
      (snapshot?.blockVersionMap as Record<string, number> | undefined) ??
      (await this.buildHeadBlockVersionMap(docId, manager));

    const now = Date.now();
    const draft = draftRepository.create({
      draftId: `${docId}@draft`,
      docId,
      workspaceId: document.workspaceId,
      rootBlockId: document.rootBlockId,
      baseDocVer: document.head,
      baseSnapshotId: snapshot?.snapshotId ?? null,
      blockVersionMap,
      changedBlocksCount: 0,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
      lockOwnerUserId: null,
      lockAcquiredAt: null,
      lockHeartbeatAt: null,
      lockExpiresAt: null,
      lockToken: null,
    });
    return draftRepository.save(draft);
  }

  private async buildHeadBlockVersionMap(
    docId: string,
    manager: EntityManager,
  ): Promise<Record<string, number>> {
    const blocks = await manager.find(Block, {
      where: { docId, isDeleted: false },
      select: ["blockId", "latestVer"],
    });
    return blocks.reduce<Record<string, number>>((map, block) => {
      map[block.blockId] = block.latestVer;
      return map;
    }, {});
  }

  private async calculateChangedBlocksCount(
    draft: DocDraft,
    manager: EntityManager,
  ): Promise<number> {
    const baseMap = await this.getBaseBlockVersionMap(draft, manager);
    const currentMap = (draft.blockVersionMap ?? {}) as Record<string, number>;
    const blockIds = new Set([...Object.keys(baseMap), ...Object.keys(currentMap)]);
    let changed = 0;

    for (const blockId of blockIds) {
      if (baseMap[blockId] !== currentMap[blockId]) {
        changed += 1;
      }
    }

    return changed;
  }

  private async getBaseBlockVersionMap(
    draft: DocDraft,
    manager: EntityManager,
  ): Promise<Record<string, number>> {
    const snapshotRepository = manager.getRepository(DocSnapshot);
    const snapshot =
      (draft.baseSnapshotId
        ? await snapshotRepository.findOne({
            where: { snapshotId: draft.baseSnapshotId },
          })
        : await snapshotRepository.findOne({
            where: { docId: draft.docId, docVer: draft.baseDocVer },
          })) ?? null;

    if (!snapshot) {
      return {};
    }

    return (snapshot.blockVersionMap as Record<string, number>) ?? {};
  }

  private async deleteDraft(docId: string, manager?: EntityManager) {
    const repository = manager ? manager.getRepository(DocDraft) : this.docDraftRepository;
    await repository.delete({ docId });
  }

  async lockDocumentForDraftMutation(
    docId: string,
    manager: EntityManager,
  ): Promise<Document> {
    const dbType = this.dataSource.options.type;
    const document = await manager.getRepository(Document).findOne({
      where: { docId },
      ...(dbType !== "sqlite" && dbType !== "better-sqlite3"
        ? { lock: { mode: "pessimistic_write" as const } }
        : {}),
    });
    if (!document) {
      throw new NotFoundException(`文档 ${docId} 不存在`);
    }
    return document;
  }
}
