import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DeleteResult, In, Repository } from "typeorm";
import { BlockRenderCache } from "../../../../entities/block-render-cache.entity";
import { BlockVersion } from "../../../../entities/block-version.entity";
import { DocSnapshot } from "../../../../entities/doc-snapshot.entity";
import { Document } from "../../../../entities/document.entity";
import { GcRun } from "../../../../entities/gc-run.entity";
import { DOCUMENT_RENDER_VERSION } from "../../../documents/services/document-render.service";

export type RenderCacheDeleteReason =
  | "doc_unpublished"
  | "document_missing"
  | "document_deleted"
  | "published_snapshot_missing"
  | "not_in_current_published_snapshot"
  | "stale_render_version"
  | "block_version_missing";

export type QueryRenderCacheGcStatusInput = {
  workspaceId?: string;
  docId?: string;
};

export type CreateRenderCacheGcSweepInput = QueryRenderCacheGcStatusInput & {
  dryRun?: boolean;
  limit?: number;
  confirm?: string;
};

type ReasonCounts = Record<RenderCacheDeleteReason, number>;

type ClassifiedCache = {
  cache: BlockRenderCache;
  keep: boolean;
  reason: RenderCacheDeleteReason | null;
};

@Injectable()
export class GcRenderCacheService {
  constructor(
    @InjectRepository(BlockRenderCache)
    private readonly cacheRepository: Repository<BlockRenderCache>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocSnapshot)
    private readonly snapshotRepository: Repository<DocSnapshot>,
    @InjectRepository(BlockVersion)
    private readonly blockVersionRepository: Repository<BlockVersion>,
    @InjectRepository(GcRun)
    private readonly gcRunRepository: Repository<GcRun>,
  ) {}

  async getStatus(input: QueryRenderCacheGcStatusInput) {
    const caches = await this.findScopedCaches(input);
    const classified = await this.classifyCaches(caches);
    const docIdsWithCaches = new Set(caches.map((cache) => cache.docId));
    const publishedDocs = new Set<string>();
    const unpublishedDocs = new Set<string>();
    const documents = await this.findDocumentsForCaches(caches);

    for (const docId of docIdsWithCaches) {
      const document = documents.get(docId);
      if (document && this.isDocumentPublished(document)) {
        publishedDocs.add(docId);
      } else {
        unpublishedDocs.add(docId);
      }
    }

    return {
      renderVersion: DOCUMENT_RENDER_VERSION,
      scope: {
        workspaceId: input.workspaceId ?? null,
        docId: input.docId ?? null,
      },
      summary: {
        totalCaches: caches.length,
        publishedReachableCaches: classified.filter((item) => item.keep).length,
        deletableCaches: classified.filter((item) => !item.keep).length,
        publishedDocsWithCaches: publishedDocs.size,
        unpublishedDocsWithCaches: unpublishedDocs.size,
        missingPublishedSnapshots: this.countReason(
          classified,
          "published_snapshot_missing",
        ),
      },
      deleteReasons: this.countReasons(classified),
    };
  }

  async sweepPublishedReachability(
    input: CreateRenderCacheGcSweepInput,
    triggeredBy: string,
  ) {
    const dryRun = input.dryRun !== false;

    if (!dryRun && input.confirm !== "SWEEP_RENDER_CACHE") {
      throw new BadRequestException(
        "confirm must be SWEEP_RENDER_CACHE to sweep render caches",
      );
    }

    const run = this.gcRunRepository.create({
      runId: this.generateRunId(),
      resourceType: "block_render_cache",
      mode: "sweep",
      status: "running",
      scope: {
        mode: "published_reachability",
        workspaceId: input.workspaceId ?? null,
        docId: input.docId ?? null,
        dryRun,
      },
      policySnapshot: {
        renderVersion: DOCUMENT_RENDER_VERSION,
        ttl: "not_used",
      },
      health: {},
      summary: {},
      candidateDetailsStored: false,
      candidateDetailsTruncated: false,
      triggeredBy,
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: null,
    });
    await this.gcRunRepository.save(run);

    try {
      const caches = await this.findScopedCaches(input, input.limit ?? 1000);
      const classified = await this.classifyCaches(caches);
      const deletableIds = classified
        .filter((item) => !item.keep)
        .map((item) => item.cache.id)
        .filter((id): id is number => typeof id === "number");
      let deleteResult: DeleteResult | null = null;

      if (!dryRun && deletableIds.length > 0) {
        deleteResult = await this.cacheRepository.delete({
          id: In(deletableIds),
        });
      }

      run.status = "completed";
      run.summary = {
        scannedDocs: new Set(caches.map((cache) => cache.docId)).size,
        selectedCaches: caches.length,
        wouldDeleteCaches: dryRun ? deletableIds.length : 0,
        deletedCaches: dryRun ? 0 : (deleteResult?.affected ?? 0),
        wouldKeepCaches: classified.filter((item) => item.keep).length,
        deleteReasons: this.countReasons(classified),
      };
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    } catch (error) {
      run.status = "failed";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    }
  }

  async sweepDocumentPublishedReachability(docId: string, triggeredBy: string) {
    const result = await this.sweepPublishedReachability(
      {
        docId,
        dryRun: false,
        confirm: "SWEEP_RENDER_CACHE",
      },
      triggeredBy,
    );

    return {
      docId,
      triggeredBy,
      deletedCaches: Number(result.summary.deletedCaches ?? 0),
      deleteReasons: result.summary.deleteReasons,
    };
  }

  async clearDocumentRenderCaches(docId: string, triggeredBy: string) {
    const result = await this.cacheRepository.delete({ docId });
    return {
      docId,
      triggeredBy,
      deletedCaches: result.affected ?? 0,
    };
  }

  private async findScopedCaches(
    input: QueryRenderCacheGcStatusInput,
    limit?: number,
  ): Promise<BlockRenderCache[]> {
    if (input.docId) {
      return this.cacheRepository.find({
        where: { docId: input.docId },
        take: limit,
      });
    }

    if (input.workspaceId) {
      const documents = await this.documentRepository.find({
        where: { workspaceId: input.workspaceId },
      });
      const docIds = documents.map((document) => document.docId);
      if (docIds.length === 0) return [];

      return this.cacheRepository.find({
        where: { docId: In(docIds) },
        take: limit,
      });
    }

    return this.cacheRepository.find({ take: limit });
  }

  private async classifyCaches(
    caches: BlockRenderCache[],
  ): Promise<ClassifiedCache[]> {
    const documents = await this.findDocumentsForCaches(caches);
    const snapshots = await this.findPublishedSnapshots(documents);
    const publishedVersionIds =
      await this.findPublishedBlockVersionIds(snapshots);

    return caches.map((cache) => {
      const document = documents.get(cache.docId);

      if (!document) {
        return { cache, keep: false, reason: "document_missing" };
      }

      if (document.status === "deleted") {
        return { cache, keep: false, reason: "document_deleted" };
      }

      if (!this.isDocumentPublished(document)) {
        return { cache, keep: false, reason: "doc_unpublished" };
      }

      const snapshot = snapshots.get(document.publishedSnapshotId as string);
      if (!snapshot) {
        return { cache, keep: false, reason: "published_snapshot_missing" };
      }

      if (cache.renderVersion !== DOCUMENT_RENDER_VERSION) {
        return { cache, keep: false, reason: "stale_render_version" };
      }

      const keepSet =
        publishedVersionIds.get(snapshot.snapshotId) ?? new Set<number>();
      if (keepSet.has(cache.blockVersionId)) {
        return { cache, keep: true, reason: null };
      }

      return {
        cache,
        keep: false,
        reason: "not_in_current_published_snapshot",
      };
    });
  }

  private async findDocumentsForCaches(
    caches: BlockRenderCache[],
  ): Promise<Map<string, Document>> {
    const docIds = [...new Set(caches.map((cache) => cache.docId))];
    if (docIds.length === 0) return new Map();

    const documents = await this.documentRepository.find({
      where: { docId: In(docIds) },
    });

    return new Map(documents.map((document) => [document.docId, document]));
  }

  private async findPublishedSnapshots(
    documents: Map<string, Document>,
  ): Promise<Map<string, DocSnapshot>> {
    const snapshotIds = [...documents.values()]
      .filter((document) => this.isDocumentPublished(document))
      .map((document) => document.publishedSnapshotId)
      .filter(
        (snapshotId): snapshotId is string => typeof snapshotId === "string",
      );

    if (snapshotIds.length === 0) return new Map();

    const snapshots = await this.snapshotRepository.find({
      where: { snapshotId: In(snapshotIds) },
    });

    return new Map(
      snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]),
    );
  }

  private async findPublishedBlockVersionIds(
    snapshots: Map<string, DocSnapshot>,
  ): Promise<Map<string, Set<number>>> {
    const lookupRows: Array<{
      snapshotId: string;
      docId: string;
      blockId: string;
      ver: number;
    }> = [];

    for (const snapshot of snapshots.values()) {
      const map = (snapshot.blockVersionMap ?? {}) as Record<string, number>;
      for (const [blockId, ver] of Object.entries(map)) {
        lookupRows.push({
          snapshotId: snapshot.snapshotId,
          docId: snapshot.docId,
          blockId,
          ver,
        });
      }
    }

    if (lookupRows.length === 0) return new Map();

    const versions = await this.blockVersionRepository.find({
      where: lookupRows.map((row) => ({
        docId: row.docId,
        blockId: row.blockId,
        ver: row.ver,
      })),
    });
    const versionByKey = new Map(
      versions.map((version) => [
        this.versionKey(version.docId, version.blockId, version.ver),
        version.id,
      ]),
    );
    const result = new Map<string, Set<number>>();

    for (const row of lookupRows) {
      const id = versionByKey.get(
        this.versionKey(row.docId, row.blockId, row.ver),
      );
      if (id === undefined) continue;

      const set = result.get(row.snapshotId) ?? new Set<number>();
      set.add(id);
      result.set(row.snapshotId, set);
    }

    return result;
  }

  private isDocumentPublished(document: Document): boolean {
    return (
      Number(document.publishedHead) > 0 &&
      typeof document.publishedSnapshotId === "string"
    );
  }

  private countReasons(classified: ClassifiedCache[]): ReasonCounts {
    const counts: ReasonCounts = {
      doc_unpublished: 0,
      document_missing: 0,
      document_deleted: 0,
      published_snapshot_missing: 0,
      not_in_current_published_snapshot: 0,
      stale_render_version: 0,
      block_version_missing: 0,
    };

    for (const item of classified) {
      if (item.reason) counts[item.reason] += 1;
    }

    return counts;
  }

  private countReason(
    classified: ClassifiedCache[],
    reason: RenderCacheDeleteReason,
  ): number {
    return classified.filter((item) => item.reason === reason).length;
  }

  private versionKey(docId: string, blockId: string, ver: number): string {
    return `${docId}:${blockId}:${ver}`;
  }

  private generateRunId(): string {
    return `render_cache_gc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
