import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { Block } from "../../../entities/block.entity";
import { BlockVersion } from "../../../entities/block-version.entity";
import { DocRevision } from "../../../entities/doc-revision.entity";
import { DocSnapshot } from "../../../entities/doc-snapshot.entity";
import { Document } from "../../../entities/document.entity";

export type CreateSnapshotOptions = {
  kind?: string;
  pinned?: boolean;
  retainUntil?: number | null;
  metadata?: Record<string, unknown>;
};

export type SnapshotMapResult = {
  map: Record<string, number>;
  rootBlockId: string;
  snapshot: DocSnapshot | null;
};

@Injectable()
export class DocumentSnapshotService {
  constructor(
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
  ) {}

  async createSnapshotForRevision(
    docId: string,
    docVer: number,
    manager: EntityManager,
    options: CreateSnapshotOptions = {},
  ): Promise<DocSnapshot> {
    const snapshotRepository = manager.getRepository(DocSnapshot);
    const existing = await snapshotRepository.findOne({ where: { docId, docVer } });
    if (existing) {
      let shouldSave = false;
      if (options.kind && existing.kind !== options.kind) {
        existing.kind = options.kind;
        shouldSave = true;
      }
      if (options.pinned === true && !existing.pinned) {
        existing.pinned = true;
        shouldSave = true;
      }
      if (options.retainUntil !== undefined && existing.retainUntil !== options.retainUntil) {
        existing.retainUntil = options.retainUntil;
        shouldSave = true;
      }
      if (options.metadata) {
        existing.metadata = {
          ...((existing.metadata as Record<string, unknown> | null) ?? {}),
          ...options.metadata,
        };
        shouldSave = true;
      }
      if (shouldSave) {
        return snapshotRepository.save(existing);
      }
      return existing;
    }

    const document = await manager.getRepository(Document).findOne({
      where: { docId },
      select: ["docId", "rootBlockId"],
    });
    if (!document) {
      throw new NotFoundException(`Document ${docId} not found`);
    }

    const blocks = await manager.getRepository(Block).find({
      where: { docId, isDeleted: false },
      select: ["blockId", "latestVer"],
    });

    const blockVersionMap: Record<string, number> = {};
    for (const block of blocks) {
      blockVersionMap[block.blockId] = block.latestVer;
    }

    const snapshot = snapshotRepository.create({
      snapshotId: `${docId}@snap@${docVer}`,
      docId,
      docVer,
      createdAt: Date.now(),
      rootBlockId: document.rootBlockId,
      blockVersionMap,
      kind: options.kind ?? "revision",
      pinned: options.pinned ?? false,
      retainUntil: options.retainUntil ?? null,
      metadata: options.metadata ?? {},
    });

    return snapshotRepository.save(snapshot);
  }

  async getSnapshotMapForVersion(docId: string, docVer: number): Promise<SnapshotMapResult> {
    const snapshot = await this.docSnapshotRepository.findOne({ where: { docId, docVer } });
    if (!snapshot) {
      return { map: {}, rootBlockId: "", snapshot: null };
    }

    return {
      map: snapshot.blockVersionMap as Record<string, number>,
      rootBlockId: snapshot.rootBlockId,
      snapshot,
    };
  }
}
