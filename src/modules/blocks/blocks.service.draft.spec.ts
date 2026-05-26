import { BlocksService } from "./blocks.service";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { Document } from "../../entities/document.entity";
import { BatchOperationType, BatchSourceType } from "./dto/batch-block.dto";
import type { DocumentDraftService } from "../documents/services/document-draft.service";

type BlockState = Partial<Block>;
type BlockVersionState = Partial<BlockVersion>;

function createDraftAwareBlocksService() {
  const document = {
    docId: "doc_1",
    rootBlockId: "root_1",
    head: 1,
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

  const documentDraftService = {
    ensureDraftForMutation: jest.fn().mockResolvedValue({
      docId: "doc_1",
      draftId: "draft_1",
      blockVersionMap: { root_1: 1, block_1: 1 },
    }),
    pointBlockToVersion: jest.fn().mockResolvedValue(undefined),
    pointBlockToDeletedVersion: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DocumentDraftService>;

  const manager = {
    create: (_entity: unknown, value: Record<string, unknown>) => ({ ...value }),
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
    findOne: async (entity: unknown, options: { where?: Record<string, unknown>; select?: string[] }) => {
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
    getRepository: (entity: unknown) => ({
      createQueryBuilder: () => {
        const params: Record<string, unknown> = {};
        const query = {
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
          Object.entries(where).every(
            ([key, value]) => item[key as keyof BlockVersion] === value,
          ),
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
    transaction: async <T>(callback: (txManager: typeof manager) => Promise<T>) => callback(manager),
  };

  const service = new BlocksService(
    blockRepository as any,
    blockVersionRepository as any,
    { createSnapshotForRevision: jest.fn() } as any,
    documentRepository as any,
    dataSource as any,
    documentsService as any,
    documentDraftService,
    { record: jest.fn().mockResolvedValue(undefined) } as any,
  );

  return { service, documentDraftService };
}

describe("BlocksService draft writes", () => {
  it("creates a draft mapping when create runs with createVersion=false", async () => {
    const { service, documentDraftService } = createDraftAwareBlocksService();

    await service.create(
      {
        docId: "doc_1",
        type: "paragraph",
        payload: { type: "paragraph", content: [{ type: "text", text: "new" }] },
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
        payload: { type: "paragraph", content: [{ type: "text", text: "updated" }] },
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
});
