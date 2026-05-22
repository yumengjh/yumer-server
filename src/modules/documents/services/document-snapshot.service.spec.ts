import type { EntityManager, Repository } from "typeorm";
import { Block } from "../../../entities/block.entity";
import { BlockVersion } from "../../../entities/block-version.entity";
import { DocRevision } from "../../../entities/doc-revision.entity";
import { DocSnapshot } from "../../../entities/doc-snapshot.entity";
import { Document } from "../../../entities/document.entity";
import { DocumentSnapshotService } from "./document-snapshot.service";

describe("DocumentSnapshotService", () => {
  const documentRepository = { findOne: jest.fn() } as unknown as Repository<Document>;
  const blockRepository = { find: jest.fn() } as unknown as Repository<Block>;
  const blockVersionRepository = {} as unknown as Repository<BlockVersion>;
  const docRevisionRepository = {} as unknown as Repository<DocRevision>;
  const docSnapshotRepository = {
    findOne: jest.fn(),
  } as unknown as Repository<DocSnapshot>;

  let service: DocumentSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentSnapshotService(
      documentRepository,
      blockRepository,
      blockVersionRepository,
      docRevisionRepository,
      docSnapshotRepository,
    );
  });

  it("creates an immutable revision snapshot from current live block latest versions", async () => {
    const snapshotRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Document) {
          return {
            findOne: jest.fn().mockResolvedValue({
              docId: "doc_1",
              rootBlockId: "root_1",
            }),
          };
        }
        if (entity === Block) {
          return {
            find: jest.fn().mockResolvedValue([
              { blockId: "root_1", latestVer: 1 },
              { blockId: "b_1", latestVer: 3 },
            ]),
          };
        }
        if (entity === DocSnapshot) return snapshotRepo;
        return {};
      }),
    } as unknown as EntityManager;

    const snapshot = await service.createSnapshotForRevision("doc_1", 5, manager, {
      kind: "revision",
      pinned: false,
      metadata: { source: "test" },
    });

    expect(snapshot).toMatchObject({
      snapshotId: "doc_1@snap@5",
      docId: "doc_1",
      docVer: 5,
      rootBlockId: "root_1",
      blockVersionMap: { root_1: 1, b_1: 3 },
      kind: "revision",
      pinned: false,
      retainUntil: null,
      metadata: { source: "test" },
    });
    expect(snapshotRepo.save).toHaveBeenCalledTimes(1);
  });

  it("returns an existing snapshot without writing a duplicate row", async () => {
    const existing = {
      snapshotId: "doc_1@snap@2",
      docId: "doc_1",
      docVer: 2,
    } as DocSnapshot;
    const snapshotRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn(),
      save: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === DocSnapshot) return snapshotRepo;
        return { findOne: jest.fn(), find: jest.fn() };
      }),
    } as unknown as EntityManager;

    await expect(service.createSnapshotForRevision("doc_1", 2, manager)).resolves.toBe(existing);
    expect(snapshotRepo.create).not.toHaveBeenCalled();
    expect(snapshotRepo.save).not.toHaveBeenCalled();
  });

  it("upgrades an existing snapshot when a caller pins or changes its kind", async () => {
    const existing = {
      snapshotId: "doc_1@snap@2",
      docId: "doc_1",
      docVer: 2,
      kind: "revision",
      pinned: false,
      metadata: {},
    } as DocSnapshot;
    const snapshotRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn(),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === DocSnapshot) return snapshotRepo;
        return { findOne: jest.fn(), find: jest.fn() };
      }),
    } as unknown as EntityManager;

    await expect(
      service.createSnapshotForRevision("doc_1", 2, manager, {
        kind: "manual",
        pinned: true,
        metadata: { source: "manual-api" },
      }),
    ).resolves.toMatchObject({
      kind: "manual",
      pinned: true,
      metadata: { source: "manual-api" },
    });
    expect(snapshotRepo.create).not.toHaveBeenCalled();
    expect(snapshotRepo.save).toHaveBeenCalledWith(existing);
  });

  it("returns a stored snapshot map for a document version", async () => {
    jest.mocked(docSnapshotRepository.findOne).mockResolvedValue({
      snapshotId: "doc_1@snap@3",
      docId: "doc_1",
      docVer: 3,
      rootBlockId: "root_1",
      blockVersionMap: { root_1: 1, b_1: 7 },
    } as unknown as DocSnapshot);

    await expect(service.getSnapshotMapForVersion("doc_1", 3)).resolves.toMatchObject({
      map: { root_1: 1, b_1: 7 },
      rootBlockId: "root_1",
      snapshot: { snapshotId: "doc_1@snap@3" },
    });
  });

  it("reports a missing snapshot without using legacy reconstruction", async () => {
    jest.mocked(docSnapshotRepository.findOne).mockResolvedValue(null);

    await expect(service.getSnapshotMapForVersion("doc_1", 99)).resolves.toEqual({
      map: {},
      rootBlockId: "",
      snapshot: null,
    });
  });
});
