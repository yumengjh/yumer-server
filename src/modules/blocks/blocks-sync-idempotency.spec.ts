import { BlocksService } from "./blocks.service";
import { BatchOperationType, BatchSourceType } from "./dto/batch-block.dto";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { Document } from "../../entities/document.entity";

type PersistedValue = Partial<Block> & Partial<BlockVersion> & Partial<Document>;
type BlocksServiceConstructorArgs = ConstructorParameters<typeof BlocksService>;

function createBlocksServiceWithInMemoryRepositories() {
  const doc = {
    docId: "doc_1",
    rootBlockId: "root_1",
    head: 1,
    workspaceId: "workspace_1",
    updatedBy: "user_1",
  };
  const blocks: Array<Partial<Block>> = [
    {
      blockId: "root_1",
      docId: "doc_1",
      type: "root",
      latestVer: 1,
      isDeleted: false,
    },
  ];
  const versions: Array<Partial<BlockVersion>> = [
    {
      versionId: "root_1_v1",
      docId: "doc_1",
      blockId: "root_1",
      ver: 1,
      parentId: "",
      sortKey: "000000",
      payload: { type: "root" },
      hash: "root",
      refs: [],
    },
  ];

  const manager = {
    create: (_entity: unknown, value: Record<string, unknown>) => ({ ...value }),
    save: async (entity: unknown, value: PersistedValue) => {
      if (entity === Block) {
        const index = blocks.findIndex((item) => item.blockId === value.blockId);
        if (index >= 0) blocks[index] = { ...blocks[index], ...value };
        else blocks.push(value);
      }
      if (entity === BlockVersion) {
        const index = versions.findIndex((item) => item.versionId === value.versionId);
        if (index >= 0) versions[index] = { ...versions[index], ...value };
        else versions.push(value);
      }
      if (entity === Document) {
        Object.assign(doc, value);
      }
      return value;
    },
    findOne: async (entity: unknown, options: { where?: Record<string, unknown> }) => {
      const where = options.where ?? {};
      if (entity === Document && where.docId === doc.docId) return doc;
      if (entity === Block) {
        return blocks.find((item) => {
          return Object.entries(where).every(([key, value]) => item[key as keyof Block] === value);
        }) ?? null;
      }
      if (entity === BlockVersion) {
        return versions.find((item) => {
          return Object.entries(where).every(
            ([key, value]) => item[key as keyof BlockVersion] === value,
          );
        }) ?? null;
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
            if (entity === Document) return doc;
            if (entity !== BlockVersion) return null;
            return versions.find((version) => {
              const block = blocks.find((item) => item.blockId === version.blockId);
              const attrs = (version.payload as { attrs?: Record<string, unknown> })?.attrs ?? {};
              return (
                version.docId === params.docId &&
                block?.latestVer === version.ver &&
                block.isDeleted === false &&
                attrs.clientBatchId === params.clientBatchId &&
                attrs.clientId === params.clientId
              );
            }) ?? null;
          },
          getMany: async () => versions,
        };
        return query;
      },
    }),
  };

  const dataSource = {
    options: { type: "better-sqlite3" },
    transaction: async <T>(callback: (txManager: typeof manager) => Promise<T>) =>
      callback(manager),
  };

  const service = new BlocksService(
    {} as BlocksServiceConstructorArgs[0],
    {} as BlocksServiceConstructorArgs[1],
    { createSnapshotForRevision: jest.fn() } as unknown as BlocksServiceConstructorArgs[2],
    { findOne: jest.fn().mockResolvedValue({ workspaceId: "workspace_1" }) } as unknown as BlocksServiceConstructorArgs[3],
    dataSource as unknown as BlocksServiceConstructorArgs[4],
    { assertAccessWithoutViewIncrement: jest.fn().mockResolvedValue(undefined) } as unknown as BlocksServiceConstructorArgs[5],
    {
      ensureDraftForMutation: jest.fn().mockResolvedValue({ docId: "doc_1", draftId: "draft_1" }),
      pointBlockToVersion: jest.fn().mockResolvedValue(undefined),
      pointBlockToDeletedVersion: jest.fn().mockResolvedValue(undefined),
    } as unknown as BlocksServiceConstructorArgs[6],
    { record: jest.fn().mockResolvedValue(undefined) } as unknown as BlocksServiceConstructorArgs[7],
  );

  return { service, blocks, versions };
}

describe("BlocksService sync idempotency", () => {
  it("does not create a second block when the same clientBatchId and clientId are replayed", async () => {
    const { service, blocks } = createBlocksServiceWithInMemoryRepositories();

    const batch = {
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_repeat",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_inserted",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: { type: "paragraph", attrs: { clientId: "client_inserted" } },
          },
        } as any,
      ],
    };

    const first = await service.batch(batch, "user_1");
    const second = await service.batch(batch, "user_1");

    expect(second.results[0].blockId).toBe(first.results[0].blockId);
    expect(blocks.filter((block) => block.type === "paragraph")).toHaveLength(1);
  });

  it("does not create a second block when the same syncCreateId is replayed in another batch", async () => {
    const { service, blocks } = createBlocksServiceWithInMemoryRepositories();

    const first = await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_first",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_inserted",
          syncCreateId: "sync-create:client_inserted",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: { type: "paragraph", attrs: { clientId: "client_inserted" } },
          },
        } as any,
      ],
    }, "user_1");

    const second = await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_retry_after_lost_response",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_inserted",
          syncCreateId: "sync-create:client_inserted",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: { type: "paragraph", attrs: { clientId: "client_inserted" } },
          },
        },
      ],
    }, "user_1");

    expect(second.results[0].blockId).toBe(first.results[0].blockId);
    expect(blocks.filter((block) => block.type === "paragraph")).toHaveLength(1);
  });

  it("stores unique sortKeys when multiple creates request an occupied sortKey", async () => {
    const { service, blocks, versions } = createBlocksServiceWithInMemoryRepositories();
    blocks.push({
      blockId: "block_b",
      docId: "doc_1",
      type: "paragraph",
      latestVer: 1,
      isDeleted: false,
    });
    versions.push({
      versionId: "block_b_v1",
      docId: "doc_1",
      blockId: "block_b",
      ver: 1,
      parentId: "root_1",
      sortKey: "002000",
      payload: { type: "paragraph", attrs: { clientId: "client_b" } },
      hash: "b",
      refs: [],
    });

    const response = await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_paste",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: ["x", "y"].map((suffix) => ({
        type: BatchOperationType.CREATE,
        clientId: `client_${suffix}`,
        syncCreateId: `sync-create:client_${suffix}`,
        data: {
          docId: "doc_1",
          type: "paragraph",
          parentId: "root_1",
          sortKey: "002000",
          payload: { type: "paragraph", attrs: { clientId: `client_${suffix}` } },
        },
      })) as any,
    }, "user_1");

    const createdSortKeys = response.results
      .map((result) => result.sortKey);

    expect(new Set(createdSortKeys).size).toBe(2);
    expect(createdSortKeys.every((sortKey) => sortKey && sortKey < "002000")).toBe(true);
  });

  it("preserves sync create attrs when updating a created block", async () => {
    const { service, versions } = createBlocksServiceWithInMemoryRepositories();

    const created = await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_create",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_update",
          syncCreateId: "sync-create:client_update",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: { type: "paragraph", attrs: { clientId: "client_update" } },
          },
        } as any,
      ],
    }, "user_1");

    const blockId = created.results[0].blockId!;
    await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_update",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.UPDATE,
          blockId,
          data: {
            payload: {
              type: "paragraph",
              attrs: { clientId: "client_update" },
              content: [{ type: "text", text: "updated" }],
            },
          },
        },
      ],
    }, "user_1");

    const latest = versions.find((version) => version.blockId === blockId && version.ver === 2);
    expect((latest?.payload as { attrs?: Record<string, unknown> })?.attrs).toMatchObject({
      clientId: "client_update",
      syncCreateId: "sync-create:client_update",
    });
  });

  it("keeps payload sortKey aligned with the persisted version sortKey during update", async () => {
    const { service, versions } = createBlocksServiceWithInMemoryRepositories();

    const created = await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_create_sort",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_sort",
          syncCreateId: "sync-create:client_sort",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001000",
            payload: {
              type: "paragraph",
              attrs: { clientId: "client_sort", sortKey: "001000" },
            },
          },
        },
      ],
    }, "user_1");

    const blockId = created.results[0].blockId!;
    const serverSortKey = created.results[0].sortKey!;
    await service.batch({
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_update_stale_sort",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.UPDATE,
          blockId,
          data: {
            payload: {
              type: "paragraph",
              attrs: { clientId: "client_sort", sortKey: "stale-client-sort-key" },
              content: [{ type: "text", text: "updated" }],
            },
          },
        },
      ],
    }, "user_1");

    const latest = versions.find((version) => version.blockId === blockId && version.ver === 2);
    expect(latest?.sortKey).toBe(serverSortKey);
    expect((latest?.payload as { attrs?: Record<string, unknown> })?.attrs?.sortKey).toBe(serverSortKey);
  });
});
