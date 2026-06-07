import { BadRequestException } from "@nestjs/common";
import type { Repository } from "typeorm";
import { BlockRenderCache } from "../../../../entities/block-render-cache.entity";
import type { BlockVersion } from "../../../../entities/block-version.entity";
import type { DocSnapshot } from "../../../../entities/doc-snapshot.entity";
import type { Document } from "../../../../entities/document.entity";
import type { GcRun } from "../../../../entities/gc-run.entity";
import { DOCUMENT_RENDER_VERSION } from "../../../documents/services/document-render.service";
import { GcRenderCacheService } from "./gc-render-cache.service";

function repo<T>(
  methods: Partial<Record<keyof Repository<T>, jest.Mock>> = {},
) {
  return methods as unknown as Repository<T>;
}

describe("GcRenderCacheService", () => {
  const cacheRepository = repo<BlockRenderCache>();
  const documentRepository = repo<Document>();
  const snapshotRepository = repo<DocSnapshot>();
  const blockVersionRepository = repo<BlockVersion>();
  const gcRunRepository = repo<GcRun>();

  let service: GcRenderCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(cacheRepository, {
      find: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    });
    Object.assign(documentRepository, {
      find: jest.fn(),
      findOne: jest.fn(),
    });
    Object.assign(snapshotRepository, {
      find: jest.fn(),
      findOne: jest.fn(),
    });
    Object.assign(blockVersionRepository, {
      find: jest.fn(),
    });
    Object.assign(gcRunRepository, {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    });

    service = new GcRenderCacheService(
      cacheRepository,
      documentRepository,
      snapshotRepository,
      blockVersionRepository,
      gcRunRepository,
    );
  });

  it("marks every cache of an unpublished document as deletable", async () => {
    jest.mocked(cacheRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockVersionId: 11,
        renderVersion: DOCUMENT_RENDER_VERSION,
      },
      {
        id: 2,
        docId: "doc_1",
        blockVersionId: 12,
        renderVersion: DOCUMENT_RENDER_VERSION,
      },
    ] as BlockRenderCache[]);
    jest
      .mocked(documentRepository.find)
      .mockResolvedValue([
        {
          docId: "doc_1",
          publishedHead: 0,
          publishedSnapshotId: null,
          status: "draft",
        },
      ] as Document[]);

    const result = await service.getStatus({ docId: "doc_1" });

    expect(result.summary).toMatchObject({
      totalCaches: 2,
      publishedReachableCaches: 0,
      deletableCaches: 2,
      unpublishedDocsWithCaches: 1,
    });
    expect(result.deleteReasons.doc_unpublished).toBe(2);
  });

  it("keeps only the current published snapshot block versions and current render version", async () => {
    jest.mocked(cacheRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockVersionId: 11,
        renderVersion: DOCUMENT_RENDER_VERSION,
      },
      {
        id: 2,
        docId: "doc_1",
        blockVersionId: 12,
        renderVersion: DOCUMENT_RENDER_VERSION,
      },
      {
        id: 3,
        docId: "doc_1",
        blockVersionId: 11,
        renderVersion: "old-renderer",
      },
    ] as BlockRenderCache[]);
    jest.mocked(documentRepository.find).mockResolvedValue([
      {
        docId: "doc_1",
        publishedHead: 5,
        publishedSnapshotId: "snap_1",
        status: "draft",
      },
    ] as Document[]);
    jest.mocked(snapshotRepository.find).mockResolvedValue([
      {
        docId: "doc_1",
        snapshotId: "snap_1",
        blockVersionMap: { block_a: 3 },
      },
    ] as DocSnapshot[]);
    jest
      .mocked(blockVersionRepository.find)
      .mockResolvedValue([
        { id: 11, docId: "doc_1", blockId: "block_a", ver: 3 },
      ] as BlockVersion[]);

    const result = await service.getStatus({ docId: "doc_1" });

    expect(result.summary).toMatchObject({
      totalCaches: 3,
      publishedReachableCaches: 1,
      deletableCaches: 2,
      publishedDocsWithCaches: 1,
    });
    expect(result.deleteReasons.not_in_current_published_snapshot).toBe(1);
    expect(result.deleteReasons.stale_render_version).toBe(1);
  });

  it("dry-runs published reachability sweep without deleting caches", async () => {
    jest
      .mocked(cacheRepository.find)
      .mockResolvedValue([
        {
          id: 1,
          docId: "doc_1",
          blockVersionId: 11,
          renderVersion: DOCUMENT_RENDER_VERSION,
        },
      ] as BlockRenderCache[]);
    jest
      .mocked(documentRepository.find)
      .mockResolvedValue([
        {
          docId: "doc_1",
          publishedHead: 0,
          publishedSnapshotId: null,
          status: "draft",
        },
      ] as Document[]);

    const run = await service.sweepPublishedReachability(
      { dryRun: true, docId: "doc_1" },
      "admin",
    );

    expect(run.summary).toMatchObject({
      selectedCaches: 1,
      wouldDeleteCaches: 1,
      deletedCaches: 0,
    });
    expect(cacheRepository.delete).not.toHaveBeenCalled();
  });

  it("requires confirmation before deleting render caches", async () => {
    await expect(
      service.sweepPublishedReachability(
        { dryRun: false, docId: "doc_1" },
        "admin",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("deletes selected caches when confirmed", async () => {
    jest
      .mocked(cacheRepository.find)
      .mockResolvedValue([
        {
          id: 1,
          docId: "doc_1",
          blockVersionId: 11,
          renderVersion: DOCUMENT_RENDER_VERSION,
        },
      ] as BlockRenderCache[]);
    jest
      .mocked(documentRepository.find)
      .mockResolvedValue([
        {
          docId: "doc_1",
          publishedHead: 0,
          publishedSnapshotId: null,
          status: "draft",
        },
      ] as Document[]);
    jest
      .mocked(cacheRepository.delete)
      .mockResolvedValue({ affected: 1, raw: [] });

    const run = await service.sweepPublishedReachability(
      { dryRun: false, docId: "doc_1", confirm: "SWEEP_RENDER_CACHE" },
      "admin",
    );

    expect(cacheRepository.delete).toHaveBeenCalled();
    expect(run.summary).toMatchObject({
      selectedCaches: 1,
      wouldDeleteCaches: 0,
      deletedCaches: 1,
    });
  });

  it("clears all render caches for one document", async () => {
    jest
      .mocked(cacheRepository.delete)
      .mockResolvedValue({ affected: 3, raw: [] });

    await expect(
      service.clearDocumentRenderCaches("doc_1", "admin"),
    ).resolves.toEqual({
      docId: "doc_1",
      triggeredBy: "admin",
      deletedCaches: 3,
    });
  });
});
