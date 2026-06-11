/* cspell:words AUTOSYNC */
import fs from "node:fs";
import path from "node:path";
import { Logger } from "@nestjs/common";
import { BlocksService } from "./blocks.service";
import { BatchCreateOperation, BatchOperationType, BatchSourceType } from "./dto/batch-block.dto";
import { CreateBlockDto } from "./dto/create-block.dto";
import { MoveBlockDto } from "./dto/move-block.dto";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { Document } from "../../entities/document.entity";
import { DocumentSyncSession } from "../../entities/document-sync-session.entity";
import { SyncBatchReceipt } from "../../entities/sync-batch-receipt.entity";
import { SyncCreateTombstone } from "../../entities/sync-create-tombstone.entity";
import {
  compareSortKeys,
  integerToSortKey,
} from "../../common/utils/sort-key.util";

const SK0 = integerToSortKey(1);
const SK1 = integerToSortKey(2);
const SK2 = integerToSortKey(3);

type PersistedValue = Partial<Block> & Partial<BlockVersion> & Partial<Document>;
type BlocksServiceConstructorArgs = ConstructorParameters<typeof BlocksService>;

function createBlocksServiceWithInMemoryRepositories(config?: { throwOnLatestVersionsGetMany?: boolean }) {
  const doc = {
    docId: "doc_1",
    rootBlockId: "root_1",
    head: 1,
    draftRevision: 0,
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
  const revisions: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const syncSessions: Array<Record<string, unknown>> = [];
  const tombstones: Array<Record<string, unknown>> = [];

  const manager = {
    create: (_entity: unknown, value: Record<string, unknown>) => ({
      ...value,
    }),
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
        return (
          blocks.find((item) => {
            return Object.entries(where).every(
              ([key, value]) => item[key as keyof Block] === value,
            );
          }) ?? null
        );
      }
      if (entity === BlockVersion) {
        return (
          versions.find((item) => {
            return Object.entries(where).every(
              ([key, value]) => item[key as keyof BlockVersion] === value,
            );
          }) ?? null
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
        if ((entity as { name?: string })?.name === "SyncBatchReceipt") {
          const index = receipts.findIndex(
            (item) =>
              item.docId === value.docId && item.clientBatchId === value.clientBatchId,
          );
          if (index >= 0) receipts[index] = { ...receipts[index], ...value };
          else receipts.push(value);
        }
        if ((entity as { name?: string })?.name === "DocumentSyncSession") {
          const index = syncSessions.findIndex((item) => item.docId === value.docId);
          if (index >= 0) syncSessions[index] = { ...syncSessions[index], ...value };
          else syncSessions.push(value);
        }
        if (entity === SyncCreateTombstone) {
          const saved = {
            id: value.id ?? tombstones.length + 1,
            ...value,
          };
          tombstones.push(saved);
          return saved;
        }
        return value;
      },
      findOne: async (options: { where?: Record<string, unknown> }) => {
        const where = options.where ?? {};
        if ((entity as { name?: string })?.name === "SyncBatchReceipt") {
          return (
            receipts.find((item) =>
              Object.entries(where).every(([key, value]) => item[key] === value),
            ) ?? null
          );
        }
        if ((entity as { name?: string })?.name === "DocumentSyncSession") {
          return (
            syncSessions.find((item) =>
              Object.entries(where).every(([key, value]) => item[key] === value),
            ) ?? null
          );
        }
        if (entity === SyncCreateTombstone) {
          return (
            tombstones.find((item) =>
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
            if (entity === Document) return doc;
            if (entity === SyncCreateTombstone) {
              return (
                tombstones.find((item) => {
                  if (item.docId !== params.docId) return false;
                  if (Number(item.expiresAt ?? 0) <= Number(params.now ?? Date.now())) return false;
                  return (
                    (typeof params.syncCreateId === "string" &&
                      item.syncCreateId === params.syncCreateId) ||
                    (typeof params.clientId === "string" && item.clientId === params.clientId)
                  );
                }) ?? null
              );
            }
            if (entity !== BlockVersion) return null;
            return (
              versions.find((version) => {
                const block = blocks.find((item) => item.blockId === version.blockId);
                const attrs = (version.payload as { attrs?: Record<string, unknown> })?.attrs ?? {};
                return (
                  version.docId === params.docId &&
                  block?.latestVer === version.ver &&
                  block.isDeleted === false &&
                  ((typeof params.syncCreateId === "string" &&
                    attrs.syncCreateId === params.syncCreateId) ||
                    (typeof params.clientBatchId === "string" &&
                      typeof params.clientId === "string" &&
                      attrs.clientBatchId === params.clientBatchId &&
                      attrs.clientId === params.clientId) ||
                    (!params.clientBatchId &&
                      typeof params.clientId === "string" &&
                      attrs.clientId === params.clientId))
                );
              }) ?? null
            );
          },
          getRawOne: async () => {
            if (entity !== BlockVersion) return null;
            const matched = versions.filter(
              (item) => item.docId === params.docId && item.blockId === params.blockId,
            );
            const maxVer = matched.reduce((max, item) => Math.max(max, Number(item.ver ?? 0)), 0);
            return { maxVer };
          },
          getMany: async () => {
            if (
              config?.throwOnLatestVersionsGetMany &&
              entity === BlockVersion &&
              typeof params.docId === "string" &&
              typeof params.parentId !== "string"
            ) {
              throw new Error("latest version full scan is disabled in this test");
            }
            return versions;
          },
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
  const blockRepository = {
    findOne: jest.fn(async (options: { where?: Record<string, unknown> }) => {
      const where = options.where ?? {};
      return (
        blocks.find((item) =>
          Object.entries(where).every(([key, value]) => item[key as keyof Block] === value),
        ) ?? null
      );
    }),
  };
  const blockVersionRepository = {
    findOne: jest.fn(async (options: { where?: Record<string, unknown> }) => {
      const where = options.where ?? {};
      return (
        versions.find((item) =>
          Object.entries(where).every(([key, value]) => item[key as keyof BlockVersion] === value),
        ) ?? null
      );
    }),
  };
  const documentRepository = {
    findOne: jest.fn(async (options: { where?: Record<string, unknown>; select?: string[] }) => {
      if (options.where?.docId !== doc.docId) return null;
      return doc;
    }),
  };

  const draft = {
    docId: "doc_1",
    draftId: "draft_1",
  };
  let draftExists = false;
  const pointDraft = async () => {
    draftExists = true;
    return draft;
  };

  const service = new BlocksService(
    blockRepository as unknown as BlocksServiceConstructorArgs[0],
    blockVersionRepository as unknown as BlocksServiceConstructorArgs[1],
    {
      createSnapshotForRevision: jest.fn(),
    } as unknown as BlocksServiceConstructorArgs[2],
    documentRepository as unknown as BlocksServiceConstructorArgs[3],
    dataSource as unknown as BlocksServiceConstructorArgs[4],
    {
      assertAccessWithoutViewIncrement: jest.fn().mockResolvedValue(undefined),
    } as unknown as BlocksServiceConstructorArgs[5],
    {
      lockDocumentForDraftMutation: jest.fn().mockResolvedValue(doc),
      findByDocId: jest.fn().mockImplementation(async () => (draftExists ? draft : null)),
      ensureDraftForMutation: jest.fn().mockImplementation(async () => {
        draftExists = true;
        return draft;
      }),
      pointBlockToVersion: jest.fn().mockImplementation(pointDraft),
      pointBlockToDeletedVersion: jest.fn().mockImplementation(pointDraft),
      incrementDraftRevision: jest.fn().mockImplementation(async () => {
        doc.draftRevision = (doc.draftRevision ?? 0) + 1;
        return doc.draftRevision;
      }),
    } as unknown as BlocksServiceConstructorArgs[6],
    {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as BlocksServiceConstructorArgs[7],
  );

  return { service, blocks, versions, syncSessions, tombstones };
}

describe("BlocksService sync idempotency", () => {
  it("replays the stored response for the same clientBatchId", async () => {
    const { service, blocks } = createBlocksServiceWithInMemoryRepositories();

    const batch = {
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_replay_same_key",
      source: BatchSourceType.AUTOSYNC,
      createVersion: true,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_replay",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: {
              type: "paragraph",
            },
          },
        } satisfies BatchCreateOperation,
      ],
    };

    const first = await service.batch(batch, "user_1");
    const second = await service.batch(batch, "user_1");

    expect(first.needsReload ?? false).toBe(false);
    expect(first.serverHead).toBe(2);
    expect(second).toEqual(first);
    expect(blocks.filter((block) => block.type === "paragraph")).toHaveLength(1);
  });

  it("rejects reused clientBatchId with a different request fingerprint", async () => {
    const { service, blocks } = createBlocksServiceWithInMemoryRepositories();

    await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_reused_with_different_body",
        source: BatchSourceType.AUTOSYNC,
        createVersion: true,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_reused",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "paragraph",
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    const response = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_reused_with_different_body",
        source: BatchSourceType.AUTOSYNC,
        createVersion: true,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_reused",
            data: {
              docId: "doc_1",
              type: "heading",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "heading",
                attrs: { level: 2 },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    expect(response.needsReload).toBe(true);
    expect(response.conflicts).toEqual([
      expect.objectContaining({ code: "CLIENT_BATCH_ID_REUSED" }),
    ]);
    expect(blocks.filter((block) => block.type !== "root")).toHaveLength(1);
  });

  it("reuses syncCreateId without relying on a latest-version full scan", async () => {
    const { service } = createBlocksServiceWithInMemoryRepositories({
      throwOnLatestVersionsGetMany: true,
    });

    const first = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: 0,
        clientBatchId: "batch_sync_create_first",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_sync_create",
            syncCreateId: "sync-create:client_sync_create",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_sync_create" },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    const second = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: first.draftRevision,
        clientBatchId: "batch_sync_create_retry",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_sync_create",
            syncCreateId: "sync-create:client_sync_create",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_sync_create" },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    expect(first.needsReload ?? false).toBe(false);
    expect(second.needsReload ?? false).toBe(false);
    expect(second.results[0]).toEqual(
      expect.objectContaining({
        operation: BatchOperationType.CREATE,
        clientId: "client_sync_create",
      }),
    );
    expect(second.results[0].blockId).toBe(first.results[0].blockId);
  });

  it("rejects batch writes when baseVersion is missing", async () => {
    const { service, blocks } = createBlocksServiceWithInMemoryRepositories();
    jest.spyOn(service as any, "getCurrentDocumentSyncSession").mockResolvedValue({
      docId: "doc_1",
      sessionId: "session_required",
      sessionEpoch: 1,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() + 60_000,
      lastAckedOpSeq: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await service.batch(
      {
        docId: "doc_1",
        clientBatchId: "batch_missing_base_version",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_missing_base",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "paragraph",
              },
            },
          } satisfies BatchCreateOperation,
        ],
      } as any,
      "user_1",
    );

    expect(response.needsReload).toBe(true);
    expect(response.conflicts).toEqual([
      expect.objectContaining({ code: "BASE_VERSION_REQUIRED" }),
    ]);
    expect(blocks.filter((block) => block.type === "paragraph")).toHaveLength(0);
  });

  it("guards batch writes behind sync session validation", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/modules/blocks/blocks.service.ts"),
      "utf8",
    );

    expect(source).toContain('code: "SYNC_SESSION_REQUIRED"');
    expect(source).toContain("sessionId and sessionEpoch are required for sync batch writes");
    expect(source).toContain('code: "SYNC_SESSION_MISMATCH"');
  });

  it("omits transport-only timestamps and block version numbers from batch ack responses", async () => {
    const { service } = createBlocksServiceWithInMemoryRepositories();

    const response = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: 0,
        clientBatchId: "batch_trim_ack",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_trim",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: { type: "paragraph" },
            },
          } satisfies BatchCreateOperation,
        ],
      } as any,
      "user_1",
    );

    expect(response).not.toHaveProperty("acceptedBatchId");
    expect(response).not.toHaveProperty("appliedAt");
    expect(response).not.toHaveProperty("needsReload");
    expect(response).not.toHaveProperty("conflicts");
    expect(response.results[0]).toMatchObject({
      operation: "create",
      clientId: "client_trim",
      blockId: expect.any(String),
      sortKey: "001500",
    });
    expect(response.results[0]).not.toHaveProperty("success");
    expect(response.results[0]).not.toHaveProperty("version");
  });

  it("stores the batch ack high watermark in the active sync session", async () => {
    const { service, syncSessions } = createBlocksServiceWithInMemoryRepositories();
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_ack",
      sessionEpoch: 2,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() + 60_000,
      lastAckedOpSeq: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: 0,
        clientBatchId: "batch_ack_seq",
        source: BatchSourceType.AUTOSYNC,
        sessionId: "session_ack",
        sessionEpoch: 2,
        ackedThroughOpSeq: 7,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_ack",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: { type: "paragraph" },
            },
          } satisfies BatchCreateOperation,
        ],
      } as any,
      "user_1",
    );

    expect(syncSessions[0].lastAckedOpSeq).toBe(7);
    expect(response.ackedThroughOpSeq).toBe(7);
  });

  it("does not advance head when a versioned batch contains failures", async () => {
    const { service } = createBlocksServiceWithInMemoryRepositories();

    const response = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_partial_failure",
        source: BatchSourceType.AUTOSYNC,
        createVersion: true,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_ok",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: { type: "paragraph" },
            },
          } satisfies BatchCreateOperation,
          {
            type: BatchOperationType.UPDATE,
            blockId: "missing_block",
            data: {
              payload: {
                type: "paragraph",
                content: [{ type: "text", text: "broken" }],
              },
            },
          },
        ],
      } as any,
      "user_1",
    );

    expect(response.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: BatchOperationType.CREATE }),
        expect.objectContaining({ operation: BatchOperationType.UPDATE, success: false }),
      ]),
    );
    expect(response.serverHead).toBe(1);
  });

  it("replays a same-batch draft write without creating a second block", async () => {
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
            payload: {
              type: "paragraph",
              attrs: { clientId: "client_inserted" },
            },
          },
        } satisfies BatchCreateOperation,
      ],
    };

    const first = await service.batch(batch, "user_1");
    const second = await service.batch(batch, "user_1");

    expect(first.needsReload ?? false).toBe(false);
    expect(second).toEqual(first);
    expect(blocks.filter((block) => block.type === "paragraph")).toHaveLength(1);
  });

  it("rejects a stale syncCreateId replay without creating a second block", async () => {
    const { service, blocks } = createBlocksServiceWithInMemoryRepositories();

    const first = await service.batch(
      {
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
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_inserted" },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    const second = await service.batch(
      {
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
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_inserted" },
              },
            },
          },
        ],
      },
      "user_1",
    );

    expect(first.needsReload ?? false).toBe(false);
    expect(second.needsReload).toBe(true);
    expect(second.conflicts).toEqual([
      expect.objectContaining({ code: "DRAFT_REVISION_MISMATCH" }),
    ]);
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
      sortKey: SK2,
      payload: { type: "paragraph", attrs: { clientId: "client_b" } },
      hash: "b",
      refs: [],
    });

    const response = await service.batch(
      {
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
            sortKey: SK2,
            payload: {
              type: "paragraph",
              attrs: { clientId: `client_${suffix}` },
            },
          },
        })),
      },
      "user_1",
    );

    const createdSortKeys = response.results.map((result) => result.sortKey);

    expect(response.draftRevision).toBe(1);
    expect(new Set(createdSortKeys).size).toBe(2);
    expect(
      createdSortKeys.every(
        (sortKey) => sortKey && compareSortKeys(sortKey, SK2) < 0,
      ),
    ).toBe(true);
  });

  it("stores a unique sortKey when non-batch create requests an occupied sortKey", async () => {
    const { service, blocks, versions } = createBlocksServiceWithInMemoryRepositories();
    blocks.push({
      blockId: "block_existing",
      docId: "doc_1",
      type: "paragraph",
      latestVer: 1,
      isDeleted: false,
    });
    versions.push({
      versionId: "block_existing_v1",
      docId: "doc_1",
      blockId: "block_existing",
      ver: 1,
      parentId: "root_1",
      sortKey: SK0,
      payload: { type: "paragraph" },
      hash: "existing",
      refs: [],
    });

    const created = await service.create(
      {
        docId: "doc_1",
        type: "paragraph",
        parentId: "root_1",
        sortKey: SK0,
        payload: {
          type: "paragraph",
          attrs: { clientId: "client_non_batch_create" },
        },
        createVersion: false,
      } satisfies CreateBlockDto,
      "user_1",
    );

    expect(created.sortKey).not.toBe(SK0);
    expect(
      new Set(
        versions
          .filter((version) => version.parentId === "root_1")
          .map((version) => version.sortKey),
      ).size,
    ).toBe(versions.filter((version) => version.parentId === "root_1").length);
  });

  it("stores a unique sortKey when non-batch move requests an occupied sortKey", async () => {
    const { service, blocks, versions } = createBlocksServiceWithInMemoryRepositories();
    blocks.push(
      {
        blockId: "block_a",
        docId: "doc_1",
        type: "paragraph",
        latestVer: 1,
        isDeleted: false,
      },
      {
        blockId: "block_b",
        docId: "doc_1",
        type: "paragraph",
        latestVer: 1,
        isDeleted: false,
      },
    );
    versions.push(
      {
        versionId: "block_a_v1",
        docId: "doc_1",
        blockId: "block_a",
        ver: 1,
        parentId: "root_1",
        sortKey: SK0,
        payload: { type: "paragraph", attrs: { clientId: "client_a" } },
        hash: "a",
        refs: [],
      },
      {
        versionId: "block_b_v1",
        docId: "doc_1",
        blockId: "block_b",
        ver: 1,
        parentId: "root_1",
        sortKey: SK2,
        payload: { type: "paragraph", attrs: { clientId: "client_b" } },
        hash: "b",
        refs: [],
      },
    );

    const moved = await service.move(
      "block_a",
      {
        parentId: "root_1",
        sortKey: SK2,
        createVersion: false,
      } satisfies MoveBlockDto,
      "user_1",
    );

    expect(moved.sortKey).not.toBe(SK2);
    const latestA = versions.find((version) => version.blockId === "block_a" && version.ver === 2);
    expect(latestA?.sortKey).toBe(moved.sortKey);
  });

  it("preserves sync create attrs when updating a created block", async () => {
    const { service, versions } = createBlocksServiceWithInMemoryRepositories();

    const created = await service.batch(
      {
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
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_update" },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    const blockId = created.results[0].blockId!;
    const createdVersion = versions.find(
      (version) => version.blockId === blockId && version.ver === 1,
    );
    expect((createdVersion?.payload as { attrs?: Record<string, unknown> })?.attrs).toMatchObject({
      clientId: "client_update",
      syncCreateId: "sync-create:client_update",
    });
    expect(
      (createdVersion?.payload as { attrs?: Record<string, unknown> })?.attrs?.clientBatchId,
    ).toBeUndefined();

    await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: created.draftRevision,
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
      },
      "user_1",
    );

    const latest = versions.find((version) => version.blockId === blockId && version.ver === 2);
    expect((latest?.payload as { attrs?: Record<string, unknown> })?.attrs).toMatchObject({
      clientId: "client_update",
      syncCreateId: "sync-create:client_update",
    });
    expect(
      (latest?.payload as { attrs?: Record<string, unknown> })?.attrs?.clientBatchId,
    ).toBeUndefined();
  });

  it("keeps payload sortKey aligned with the persisted version sortKey during update", async () => {
    const { service, versions } = createBlocksServiceWithInMemoryRepositories();

    const created = await service.batch(
      {
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
      },
      "user_1",
    );

    const blockId = created.results[0].blockId!;
    const serverSortKey = created.results[0].sortKey!;
    await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: created.draftRevision,
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
                attrs: {
                  clientId: "client_sort",
                  sortKey: "stale-client-sort-key",
                },
                content: [{ type: "text", text: "updated" }],
              },
            },
          },
        ],
      },
      "user_1",
    );

    const latest = versions.find((version) => version.blockId === blockId && version.ver === 2);
    expect(latest?.sortKey).toBe(serverSortKey);
    expect((latest?.payload as { attrs?: Record<string, unknown> })?.attrs?.sortKey).toBe(
      serverSortKey,
    );
  });

  it("logs recent sync create-delete compensation without changing delete ack shape", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { service } = createBlocksServiceWithInMemoryRepositories();

    const created = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_create_orphan",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_orphan",
            syncCreateId: "sync-create:client_orphan",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_orphan" },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    const blockId = created.results[0].blockId!;
    const deleted = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: created.draftRevision,
        clientBatchId: "batch_delete_orphan",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.DELETE,
            blockId,
          },
        ],
      },
      "user_1",
    );

    expect(deleted.results[0]).toEqual({
      operation: BatchOperationType.DELETE,
      blockId,
      matchBy: "blockId",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("sync create-delete compensation: docId=doc_1"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("client_orphan"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("sync-create:client_orphan"));

    warnSpy.mockRestore();
  });

  it("deletes a recently created block by client identity when blockId is not available", async () => {
    const { service } = createBlocksServiceWithInMemoryRepositories();

    const created = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        clientBatchId: "batch_create_client_tombstone",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_tombstone",
            syncCreateId: "sync-create:client_tombstone",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_tombstone" },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    const deleted = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: created.draftRevision,
        clientBatchId: "batch_delete_client_tombstone",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.DELETE,
            clientId: "client_tombstone",
            syncCreateId: "sync-create:client_tombstone",
          },
        ],
      },
      "user_1",
    );

    expect(deleted.results[0]).toMatchObject({
      operation: BatchOperationType.DELETE,
      blockId: created.results[0].blockId,
    });
  });

  it("records a tombstone when client identity delete does not find an active block", async () => {
    const { service, tombstones } = createBlocksServiceWithInMemoryRepositories();

    const deleted = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: 0,
        clientBatchId: "batch_delete_missing_client_identity",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.DELETE,
            clientId: "client_missing_delete",
            syncCreateId: "sync-create:client_missing_delete",
          },
        ],
      },
      "user_1",
    );

    expect(deleted.results[0]).toMatchObject({
      operation: BatchOperationType.DELETE,
      clientId: "client_missing_delete",
      matchBy: "not_found",
      diagnosticCode: "DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY",
      tombstoned: true,
    });
    expect(tombstones).toEqual([
      expect.objectContaining({
        docId: "doc_1",
        clientId: "client_missing_delete",
        syncCreateId: "sync-create:client_missing_delete",
        deleteClientBatchId: "batch_delete_missing_client_identity",
      }),
    ]);
  });

  it("suppresses a late create when its syncCreateId was already tombstoned", async () => {
    const { service, blocks } = createBlocksServiceWithInMemoryRepositories();

    await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: 0,
        clientBatchId: "batch_delete_before_late_create",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.DELETE,
            clientId: "client_late_create",
            syncCreateId: "sync-create:client_late_create",
          },
        ],
      },
      "user_1",
    );

    const created = await service.batch(
      {
        docId: "doc_1",
        baseVersion: 1,
        draftRevision: 0,
        clientBatchId: "batch_late_create",
        source: BatchSourceType.AUTOSYNC,
        createVersion: false,
        operations: [
          {
            type: BatchOperationType.CREATE,
            clientId: "client_late_create",
            syncCreateId: "sync-create:client_late_create",
            data: {
              docId: "doc_1",
              type: "paragraph",
              parentId: "root_1",
              sortKey: "001500",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_late_create" },
              },
            },
          } satisfies BatchCreateOperation,
        ],
      },
      "user_1",
    );

    expect(created.results[0]).toMatchObject({
      operation: BatchOperationType.CREATE,
      clientId: "client_late_create",
      tombstoned: true,
      diagnosticCode: "CREATE_SUPPRESSED_BY_TOMBSTONE",
    });
    expect(created.results[0].blockId).toBeUndefined();
    expect(blocks.filter((block) => block.type === "paragraph")).toHaveLength(0);
  });
});
