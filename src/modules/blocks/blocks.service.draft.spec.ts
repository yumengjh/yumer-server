// cspell:ignore AUTOSYNC

import { BlocksService } from "./blocks.service";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { Document } from "../../entities/document.entity";
import { SyncBatchReceipt } from "../../entities/sync-batch-receipt.entity";
import { BatchOperationType, BatchSourceType } from "./dto/batch-block.dto";
import type { DocumentDraftService } from "../documents/services/document-draft.service";
import type { DocumentSnapshotService } from "../documents/services/document-snapshot.service";
import type { DataSource } from "typeorm";

type BlockState = Partial<Block>;
type BlockVersionState = Partial<BlockVersion>;

function createDraftAwareBlocksService(config?: { throwOnBlockVersionFind?: boolean }) {
  const document = {
    docId: "doc_1",
    rootBlockId: "root_1",
    head: 1,
    draftRevision: 0,
    workspaceId: "workspace_1",
    updatedBy: "user_1",
  } as Partial<Document>;

  const blocks: BlockState[] = [
    {
      blockId: "root_1",
      docId: "doc_1",
      type: "root",
      latestVer: 1,
      isDeleted: false,
    },
    {
      blockId: "block_1",
      docId: "doc_1",
      type: "paragraph",
      latestVer: 1,
      latestAt: 1,
      latestBy: "user_1",
      isDeleted: false,
    },
  ];

  const versions: BlockVersionState[] = [
    {
      versionId: "root_1_v1",
      docId: "doc_1",
      blockId: "root_1",
      ver: 1,
      parentId: "",
      sortKey: "000000",
      indent: 0,
      collapsed: false,
      payload: { type: "root", children: [] },
      hash: "root",
      plainText: "",
      refs: [],
    },
    {
      versionId: "block_1_v1",
      docId: "doc_1",
      blockId: "block_1",
      ver: 1,
      parentId: "root_1",
      sortKey: "001000",
      indent: 0,
      collapsed: false,
      payload: { type: "paragraph", content: [{ type: "text", text: "old" }] },
      hash: "old",
      plainText: "old",
      refs: [],
    },
  ];
  const revisions: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];

  const draft = {
    docId: "doc_1",
    draftId: "draft_1",
    blockVersionMap: { root_1: 1, block_1: 1 },
  };
  let draftExists = false;
  const pointDraft = async () => {
    draftExists = true;
    return draft;
  };
  const documentDraftService = {
    lockDocumentForDraftMutation: jest.fn().mockResolvedValue(document),
    findByDocId: jest.fn().mockImplementation(async () => (draftExists ? draft : null)),
    ensureDraftForMutation: jest.fn().mockImplementation(async () => {
      draftExists = true;
      return draft;
    }),
    pointBlockToVersion: jest.fn().mockImplementation(pointDraft),
    pointBlockToDeletedVersion: jest.fn().mockImplementation(pointDraft),
    incrementDraftRevision: jest.fn().mockImplementation(async () => {
      document.draftRevision = (document.draftRevision ?? 0) + 1;
      return document.draftRevision;
    }),
  } as unknown as jest.Mocked<DocumentDraftService>;

  const manager = {
    create: (_entity: unknown, value: Record<string, unknown>) => ({
      ...value,
    }),
    save: async (entity: unknown, value: Record<string, unknown>) => {
      if (entity === Block) {
        const index = blocks.findIndex((item) => item.blockId === value.blockId);
        if (index >= 0) blocks[index] = { ...blocks[index], ...value };
        else blocks.push(value as BlockState);
      }
      if (entity === BlockVersion) {
        const index = versions.findIndex((item) => item.versionId === value.versionId);
        if (index >= 0) versions[index] = { ...versions[index], ...value };
        else versions.push(value as BlockVersionState);
      }
      if (entity === Document) {
        Object.assign(document, value);
      }
      return value;
    },
    findOne: async (
      entity: unknown,
      options: { where?: Record<string, unknown>; select?: string[] },
    ) => {
      const where = options.where ?? {};
      if (entity === Document && where.docId === document.docId) {
        return document;
      }
      if (entity === Block) {
        return (
          blocks.find((item) =>
            Object.entries(where).every(([key, value]) => item[key as keyof Block] === value),
          ) ?? null
        );
      }
      if (entity === BlockVersion) {
        return (
          versions.find((item) =>
            Object.entries(where).every(
              ([key, value]) => item[key as keyof BlockVersion] === value,
            ),
          ) ?? null
        );
      }
      return null;
    },
    find: async (
      entity: unknown,
      options: { where?: Record<string, unknown>; select?: string[] },
    ) => {
      const where = options.where ?? {};
      if (entity === BlockVersion) {
        if (config?.throwOnBlockVersionFind) {
          throw new Error("full block version scan is disabled in this test");
        }
        return versions.filter((item) =>
          Object.entries(where).every(([key, value]) => item[key as keyof BlockVersion] === value),
        );
      }
      if (entity === Block) {
        return blocks.filter((item) =>
          Object.entries(where).every(([key, value]) => item[key as keyof Block] === value),
        );
      }
      return [];
    },
    getRepository: (entity: unknown) => ({
      create: (value: Record<string, unknown>) => ({ ...value }),
      save: async (value: Record<string, unknown>) => {
        if (entity === DocRevision) {
          revisions.push(value);
        }
        if (entity === SyncBatchReceipt) {
          const index = receipts.findIndex(
            (item) =>
              item.docId === value.docId && item.clientBatchId === value.clientBatchId,
          );
          if (index >= 0) receipts[index] = { ...receipts[index], ...value };
          else receipts.push(value);
        }
        return value;
      },
      findOne: async (options: { where?: Record<string, unknown> }) => {
        const where = options.where ?? {};
        if (entity === SyncBatchReceipt) {
          return (
            receipts.find((item) =>
              Object.entries(where).every(([key, value]) => item[key] === value),
            ) ?? null
          );
        }
        return null;
      },
      createQueryBuilder: () => {
        const params: Record<string, unknown> = {};
        const query = {
          select: () => query,
          setLock: () => query,
          where: (_condition: string, values?: Record<string, unknown>) => {
            Object.assign(params, values);
            return query;
          },
          andWhere: (_condition: string, values?: Record<string, unknown>) => {
            Object.assign(params, values);
            return query;
          },
          innerJoin: () => query,
          getOne: async () => {
            if (entity === Document) return document;
            if (entity === Block) {
              return (
                blocks.find(
                  (item) => item.blockId === params.blockId && item.isDeleted === params.isDeleted,
                ) ?? null
              );
            }
            return null;
          },
          getRawOne: async () => {
            if (entity !== BlockVersion) return null;
            const matched = versions.filter(
              (item) => item.docId === params.docId && item.blockId === params.blockId,
            );
            const maxVer = matched.reduce((max, item) => Math.max(max, Number(item.ver ?? 0)), 0);
            return { maxVer };
          },
          getMany: async () => versions,
        };
        return query;
      },
    }),
  };

  const blockRepository = {
    findOne: jest.fn().mockImplementation(async ({ where }) => {
      return (
        blocks.find((item) =>
          Object.entries(where).every(([key, value]) => item[key as keyof Block] === value),
        ) ?? null
      );
    }),
  };

  const blockVersionRepository = {
    findOne: jest.fn().mockImplementation(async ({ where }) => {
      return (
        versions.find((item) =>
          Object.entries(where).every(([key, value]) => item[key as keyof BlockVersion] === value),
        ) ?? null
      );
    }),
  };

  const documentRepository = {
    findOne: jest.fn().mockResolvedValue({ rootBlockId: "root_1", workspaceId: "workspace_1" }),
  };

  const documentsService = {
    assertAccessWithoutViewIncrement: jest.fn().mockResolvedValue(undefined),
  };

  const dataSource = {
    options: { type: "better-sqlite3" },
    transaction: async <T>(callback: (txManager: typeof manager) => Promise<T>) =>
      callback(manager),
  };

  const service = new BlocksService(
    blockRepository as unknown as Parameters<typeof BlocksService>[0],
    blockVersionRepository as unknown as Parameters<typeof BlocksService>[1],
    {
      createSnapshotForRevision: jest.fn(),
    } as unknown as DocumentSnapshotService,
    documentRepository as unknown as Parameters<typeof BlocksService>[3],
    dataSource as unknown as DataSource,
    documentsService as unknown as Parameters<typeof BlocksService>[5],
    documentDraftService,
    { record: jest.fn().mockResolvedValue(undefined) } as unknown as Parameters<
      typeof BlocksService
    >[7],
  );

  return { service, documentDraftService, versions };
}

describe("BlocksService draft writes", () => {
  it("locks the document before a versioned create write", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.create(
      {
        docId: "doc_1",
        type: "paragraph",
        payload: { type: "paragraph" },
        parentId: "root_1",
        sortKey: "002000",
        createVersion: true,
      },
      "user_1",
    );

    expect(documentDraftService.lockDocumentForDraftMutation).toHaveBeenCalledWith(
      "doc_1",
      expect.any(Object),
    );
  });

  it("locks the document before a versioned update write", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.updateContent(
      "block_1",
      {
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "updated" }],
        },
        createVersion: true,
      },
      "user_1",
    );

    expect(documentDraftService.lockDocumentForDraftMutation).toHaveBeenCalledWith(
      "doc_1",
      expect.any(Object),
    );
  });

  it("locks the document before a versioned move write", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.move(
      "block_1",
      {
        parentId: "root_1",
        sortKey: "003000",
        indent: 1,
        createVersion: true,
      },
      "user_1",
    );

    expect(documentDraftService.lockDocumentForDraftMutation).toHaveBeenCalledWith(
      "doc_1",
      expect.any(Object),
    );
  });

  it("creates a draft mapping when create runs with createVersion=false", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.create(
      {
        docId: "doc_1",
        type: "paragraph",
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "new" }],
        },
        parentId: "root_1",
        sortKey: "002000",
        createVersion: false,
      },
      "user_1",
    );

    expect(documentDraftService.ensureDraftForMutation).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
      expect.any(Object),
    );
    expect(documentDraftService.pointBlockToVersion).toHaveBeenCalledWith(
      "doc_1",
      expect.any(String),
      1,
      "user_1",
      expect.any(Object),
    );
  });

  it("points updated versions into the draft when updateContent runs with createVersion=false", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.updateContent(
      "block_1",
      {
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "updated" }],
        },
        createVersion: false,
      },
      "user_1",
    );

    expect(documentDraftService.ensureDraftForMutation).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
      expect.any(Object),
    );
    expect(documentDraftService.pointBlockToVersion).toHaveBeenCalledWith(
      "doc_1",
      "block_1",
      2,
      "user_1",
      expect.any(Object),
    );
  });

  it("points moved versions into the draft when move runs with createVersion=false", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.move(
      "block_1",
      {
        parentId: "root_1",
        sortKey: "003000",
        indent: 1,
        createVersion: false,
      },
      "user_1",
    );

    expect(documentDraftService.pointBlockToVersion).toHaveBeenCalledWith(
      "doc_1",
      "block_1",
      2,
      "user_1",
      expect.any(Object),
    );
  });

  it("records batch delete as a deleted-state draft version when createVersion=false", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_delete",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.DELETE,
            blockId: "block_1",
          },
        ],
      },
      "user_1",
    );

    expect(documentDraftService.ensureDraftForMutation).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
      expect.any(Object),
    );
    expect(documentDraftService.pointBlockToDeletedVersion).toHaveBeenCalledWith(
      "doc_1",
      "block_1",
      2,
      "user_1",
      expect.any(Object),
    );
  });

  it("rejects an update based on the stale revision from before a draft delete", async () => {
    const { service, documentDraftService, versions } = createDraftAwareBlocksService();

    await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_delete_then_update",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.DELETE,
            blockId: "block_1",
          },
        ],
      },
      "user_1",
    );

    const response = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_update_after_delete",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.UPDATE,
            blockId: "block_1",
            data: {
              payload: {
                type: "paragraph",
                content: [{ type: "text", text: "revived" }],
              },
            },
          },
        ],
      },
      "user_1",
    );

    expect(response.needsReload).toBe(true);
    expect(response.conflicts).toEqual([
      expect.objectContaining({ code: "DRAFT_REVISION_MISMATCH" }),
    ]);
    expect(documentDraftService.pointBlockToVersion).not.toHaveBeenCalled();
    const latestVersion = versions.find((item) => item.blockId === "block_1" && item.ver === 3);
    expect(latestVersion).toBeUndefined();
  });

  it("continues from the historical max block version after a revert-style latestVer rewind", async () => {
    const { service, documentDraftService, versions } = createDraftAwareBlocksService();
    versions.push({
      versionId: "block_1_v5",
      docId: "doc_1",
      blockId: "block_1",
      ver: 5,
      parentId: "root_1",
      sortKey: "001000",
      indent: 0,
      collapsed: false,
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "future" }],
      },
      hash: "future",
      plainText: "future",
      refs: [],
    });

    await service.updateContent(
      "block_1",
      {
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "after revert" }],
        },
        createVersion: false,
      },
      "user_1",
    );

    expect(documentDraftService.pointBlockToVersion).toHaveBeenCalledWith(
      "doc_1",
      "block_1",
      6,
      "user_1",
      expect.any(Object),
    );

    const latestVersion = versions.find((item) => item.blockId === "block_1" && item.ver === 6);
    expect(latestVersion).toBeDefined();
  });

  it("does not require a full version scan to continue from the historical max block version", async () => {
    const { service, documentDraftService, versions } = createDraftAwareBlocksService({
      throwOnBlockVersionFind: true,
    });
    versions.push({
      versionId: "block_1_v5",
      docId: "doc_1",
      blockId: "block_1",
      ver: 5,
      parentId: "root_1",
      sortKey: "001000",
      indent: 0,
      collapsed: false,
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "future" }],
      },
      hash: "future",
      plainText: "future",
      refs: [],
    });

    await service.updateContent(
      "block_1",
      {
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "after revert without scan" }],
        },
        createVersion: false,
      },
      "user_1",
    );

    expect(documentDraftService.pointBlockToVersion).toHaveBeenCalledWith(
      "doc_1",
      "block_1",
      6,
      "user_1",
      expect.any(Object),
    );
  });
});
