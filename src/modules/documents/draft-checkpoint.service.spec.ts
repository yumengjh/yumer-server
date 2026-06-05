import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { Document } from "../../entities/document.entity";
import { DocumentSyncSession } from "../../entities/document-sync-session.entity";
import { SyncCheckpointReceipt } from "../../entities/sync-checkpoint-receipt.entity";
import { SyncCreateTombstone } from "../../entities/sync-create-tombstone.entity";
import { DraftCheckpointService } from "./draft-checkpoint.service";
import type { DraftCheckpointBlockDto, DraftCheckpointDto } from "./dto/draft-checkpoint.dto";

type ExistingBlockInput = {
  blockId: string;
  clientId: string;
  syncCreateId?: string;
  sortKey: string;
  text: string;
};

function createDraftCheckpointHarness(config?: {
  existingBlocks?: ExistingBlockInput[];
  documentDraftRevision?: number;
}) {
  const now = Date.now();
  const doc: Partial<Document> = {
    docId: "doc_1",
    rootBlockId: "root_1",
    head: 3,
    draftRevision: config?.documentDraftRevision ?? 0,
    workspaceId: "workspace_1",
    updatedBy: "user_1",
  };
  const draft: Partial<DocDraft> = {
    docId: "doc_1",
    draftId: "draft_1",
    workspaceId: "workspace_1",
    rootBlockId: "root_1",
    baseDocVer: 3,
    blockVersionMap: {},
    changedBlocksCount: 0,
    createdBy: "user_1",
    updatedBy: "user_1",
    createdAt: now,
    updatedAt: now,
  };
  const blocks: Array<Partial<Block>> = [];
  const versions: Array<Partial<BlockVersion>> = [];
  const receipts: Array<Partial<SyncCheckpointReceipt>> = [];
  const tombstones: Array<Partial<SyncCreateTombstone>> = [];
  const syncSessions: Array<Partial<DocumentSyncSession>> = [
    {
      docId: "doc_1",
      sessionId: "sync_1",
      sessionEpoch: 1,
      holderUserId: "user_1",
      leaseExpiresAt: now + 60_000,
      lastAckedOpSeq: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const item of config?.existingBlocks ?? []) {
    blocks.push({
      blockId: item.blockId,
      docId: "doc_1",
      type: "paragraph",
      latestVer: 1,
      latestAt: now,
      latestBy: "user_1",
      isDeleted: false,
    });
    versions.push({
      versionId: `${item.blockId}_v1`,
      docId: "doc_1",
      blockId: item.blockId,
      ver: 1,
      parentId: "root_1",
      sortKey: item.sortKey,
      plainText: item.text,
      payload: {
        type: "paragraph",
        attrs: {
          clientId: item.clientId,
          blockId: item.blockId,
          sortKey: item.sortKey,
          ...(item.syncCreateId ? { syncCreateId: item.syncCreateId } : {}),
        },
        content: [{ type: "text", text: item.text }],
      },
      hash: `hash:${item.blockId}:1`,
      refs: [],
    });
    draft.blockVersionMap![item.blockId] = 1;
  }

  const findMatches = <T extends Record<string, unknown>>(
    items: T[],
    where: Record<string, unknown>,
  ) =>
    items.filter((item) =>
      Object.entries(where).every(([key, value]) => item[key] === value),
    );

  const repositoryFor = (entity: unknown) => ({
    create: (value: Record<string, unknown>) => ({ ...value }),
    save: async (value: Record<string, unknown>) => {
      if (entity === Document) {
        Object.assign(doc, value);
        return doc;
      }
      if (entity === DocDraft) {
        Object.assign(draft, value);
        return draft;
      }
      if (entity === Block) {
        const index = blocks.findIndex((item) => item.blockId === value.blockId);
        if (index >= 0) blocks[index] = { ...blocks[index], ...value };
        else blocks.push(value);
        return value;
      }
      if (entity === BlockVersion) {
        const index = versions.findIndex((item) => item.versionId === value.versionId);
        if (index >= 0) versions[index] = { ...versions[index], ...value };
        else versions.push(value);
        return value;
      }
      if (entity === SyncCheckpointReceipt) {
        const index = receipts.findIndex(
          (item) =>
            item.docId === value.docId &&
            item.clientCheckpointId === value.clientCheckpointId,
        );
        if (index >= 0) receipts[index] = { ...receipts[index], ...value };
        else receipts.push({ id: receipts.length + 1, ...value });
        return value;
      }
      if (entity === SyncCreateTombstone) {
        const saved = { id: tombstones.length + 1, ...value };
        tombstones.push(saved);
        return saved;
      }
      if (entity === DocumentSyncSession) {
        const index = syncSessions.findIndex((item) => item.docId === value.docId);
        if (index >= 0) syncSessions[index] = { ...syncSessions[index], ...value };
        else syncSessions.push(value);
        return value;
      }
      return value;
    },
    findOne: async (options: { where?: Record<string, unknown> }) => {
      const where = options.where ?? {};
      if (entity === Document) return findMatches([doc], where)[0] ?? null;
      if (entity === DocDraft) return findMatches([draft], where)[0] ?? null;
      if (entity === Block) return findMatches(blocks as Record<string, unknown>[], where)[0] ?? null;
      if (entity === BlockVersion) {
        return findMatches(versions as Record<string, unknown>[], where)[0] ?? null;
      }
      if (entity === DocumentSyncSession) {
        return findMatches(syncSessions as Record<string, unknown>[], where)[0] ?? null;
      }
      if (entity === SyncCheckpointReceipt) {
        return findMatches(receipts as Record<string, unknown>[], where)[0] ?? null;
      }
      return null;
    },
    find: async (options: { where?: Record<string, unknown> } = {}) => {
      const where = options.where ?? {};
      if (entity === Block) return findMatches(blocks as Record<string, unknown>[], where);
      if (entity === BlockVersion) {
        return findMatches(versions as Record<string, unknown>[], where);
      }
      return [];
    },
  });

  const manager = {
    getRepository: repositoryFor,
  };
  const dataSource = {
    transaction: async <T>(callback: (txManager: typeof manager) => Promise<T>) =>
      callback(manager),
  };

  const service = new DraftCheckpointService(dataSource as never);

  const baseCheckpoint = (
    clientCheckpointId: string,
    overrides: Partial<DraftCheckpointDto> = {},
  ): DraftCheckpointDto => ({
    mode: "checkpoint",
    coverage: "full",
    clientCheckpointId,
    clientId: "frontend-client",
    baseVersion: 3,
    draftRevision: config?.documentDraftRevision ?? 0,
    sessionId: "sync_1",
    sessionEpoch: 1,
    contentHash: `sha256:${clientCheckpointId}`,
    generatedAt: now,
    rootBlockId: "root_1",
    blocks: [],
    ...overrides,
  });

  const block = (input: {
    clientId: string;
    blockId?: string | null;
    syncCreateId?: string | null;
    orderKey: string;
    text: string;
  }): DraftCheckpointBlockDto => ({
    clientId: input.clientId,
    blockId: input.blockId ?? null,
    syncCreateId: input.syncCreateId ?? `sync-create:${input.clientId}`,
    type: "paragraph",
    parentId: "root_1",
    orderKey: input.orderKey,
    plainText: input.text,
    payload: {
      type: "paragraph",
      attrs: {
        clientId: input.clientId,
        blockId: input.blockId ?? null,
        sortKey: input.orderKey,
        syncCreateId: input.syncCreateId ?? `sync-create:${input.clientId}`,
      },
      content: [{ type: "text", text: input.text }],
    },
  });

  const visibleDraftBlocks = () =>
    Object.entries(draft.blockVersionMap ?? {})
      .flatMap(([blockId, ver]) => {
        const version = versions.find(
          (item) => item.blockId === blockId && item.ver === ver,
        );
        if (!version) return [];
        const attrs = (version.payload as { attrs?: Record<string, unknown> })?.attrs ?? {};
        if (attrs.deleted === true) return [];
        return [{ blockId, sortKey: version.sortKey, plainText: version.plainText }];
      })
      .sort((left, right) => Number(left.sortKey) - Number(right.sortKey));

  return {
    service,
    doc,
    blocks,
    versions,
    receipts,
    tombstones,
    syncSessions,
    baseCheckpoint,
    block,
    visibleDraftBlocks,
  };
}

describe("DraftCheckpointService", () => {
  it("creates draft blocks from a full checkpoint and returns mappings", async () => {
    const harness = createDraftCheckpointHarness();

    const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_create_1"),
      blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "hello" })],
    });

    expect(response.needsReload).toBe(false);
    expect(response.draftRevision).toBe(1);
    expect(response.mappings).toHaveLength(1);
    expect(response.mappings[0]).toMatchObject({ clientId: "cid_1", orderKey: "001000" });
    expect(response.mappings[0].blockId).toMatch(/^block_/);
    expect(harness.visibleDraftBlocks()).toEqual([
      expect.objectContaining({
        blockId: response.mappings[0].blockId,
        sortKey: "001000",
        plainText: "hello",
      }),
    ]);
  });

  it("updates an existing draft block matched by blockId", async () => {
    const harness = createDraftCheckpointHarness({
      existingBlocks: [
        { blockId: "block_existing", clientId: "cid_existing", sortKey: "001000", text: "old" },
      ],
    });

    const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_update_1"),
      blocks: [
        harness.block({
          clientId: "cid_existing",
          blockId: "block_existing",
          orderKey: "001000",
          text: "new",
        }),
      ],
    });

    expect(response.draftRevision).toBe(1);
    expect(harness.visibleDraftBlocks()).toEqual([
      expect.objectContaining({
        blockId: "block_existing",
        plainText: "new",
        sortKey: "001000",
      }),
    ]);
  });

  it("updates sortKey/orderKey for reordered blocks", async () => {
    const harness = createDraftCheckpointHarness({
      existingBlocks: [
        { blockId: "block_a", clientId: "cid_a", sortKey: "001000", text: "A" },
        { blockId: "block_b", clientId: "cid_b", sortKey: "002000", text: "B" },
      ],
    });

    await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_reorder_1"),
      blocks: [
        harness.block({ clientId: "cid_b", blockId: "block_b", orderKey: "001000", text: "B" }),
        harness.block({ clientId: "cid_a", blockId: "block_a", orderKey: "002000", text: "A" }),
      ],
    });

    expect(harness.visibleDraftBlocks().map((item) => [item.blockId, item.sortKey])).toEqual([
      ["block_b", "001000"],
      ["block_a", "002000"],
    ]);
  });

  it("tombstones draft blocks missing from a full checkpoint", async () => {
    const harness = createDraftCheckpointHarness({
      existingBlocks: [
        {
          blockId: "block_keep",
          clientId: "cid_keep",
          syncCreateId: "sync-create:cid_keep",
          sortKey: "001000",
          text: "keep",
        },
        {
          blockId: "block_delete",
          clientId: "cid_delete",
          syncCreateId: "sync-create:cid_delete",
          sortKey: "002000",
          text: "delete",
        },
      ],
    });

    const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_delete_1"),
      blocks: [
        harness.block({
          clientId: "cid_keep",
          blockId: "block_keep",
          syncCreateId: "sync-create:cid_keep",
          orderKey: "001000",
          text: "keep",
        }),
      ],
    });

    expect(response.tombstoned).toEqual([
      expect.objectContaining({
        blockId: "block_delete",
        clientId: "cid_delete",
        syncCreateId: "sync-create:cid_delete",
      }),
    ]);
    expect(harness.visibleDraftBlocks().map((item) => item.blockId)).toEqual(["block_keep"]);
    expect(harness.tombstones).toEqual([
      expect.objectContaining({
        docId: "doc_1",
        blockId: "block_delete",
        clientId: "cid_delete",
        syncCreateId: "sync-create:cid_delete",
      }),
    ]);
  });

  it("replays the original response for the same checkpoint fingerprint", async () => {
    const harness = createDraftCheckpointHarness();
    const dto = {
      ...harness.baseCheckpoint("checkpoint_replay_1"),
      blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "hello" })],
    };

    const first = await harness.service.applyDraftCheckpoint("doc_1", "user_1", dto);
    const second = await harness.service.applyDraftCheckpoint("doc_1", "user_1", dto);

    expect(second).toEqual(first);
    expect(harness.receipts).toHaveLength(1);
    expect(harness.visibleDraftBlocks()).toHaveLength(1);
  });

  it("returns conflict when checkpoint id is reused with different content", async () => {
    const harness = createDraftCheckpointHarness();
    await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_conflict_1"),
      blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "one" })],
    });

    const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_conflict_1"),
      blocks: [harness.block({ clientId: "cid_1", orderKey: "001000", text: "two" })],
    });

    expect(response.needsReload).toBe(true);
    expect(response.conflicts[0]?.code).toBe("CHECKPOINT_FINGERPRINT_CONFLICT");
  });

  it("returns conflict when draftRevision is stale", async () => {
    const harness = createDraftCheckpointHarness({ documentDraftRevision: 2 });

    const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_stale_revision", { draftRevision: 1 }),
      blocks: [],
    });

    expect(response.needsReload).toBe(true);
    expect(response.conflicts[0]?.code).toBe("DRAFT_REVISION_MISMATCH");
  });

  it("returns conflict when sync session does not match", async () => {
    const harness = createDraftCheckpointHarness();

    const response = await harness.service.applyDraftCheckpoint("doc_1", "user_1", {
      ...harness.baseCheckpoint("checkpoint_bad_session", { sessionId: "other_session" }),
      blocks: [],
    });

    expect(response.needsReload).toBe(true);
    expect(response.conflicts[0]?.code).toBe("SYNC_SESSION_MISMATCH");
  });
});
