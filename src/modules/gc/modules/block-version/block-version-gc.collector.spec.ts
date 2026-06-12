import type { ObjectLiteral, Repository } from "typeorm";
import { Block } from "../../../../entities/block.entity";
import { BlockVersion } from "../../../../entities/block-version.entity";
import { DocDraft } from "../../../../entities/doc-draft.entity";
import { DocSnapshot } from "../../../../entities/doc-snapshot.entity";
import { Document } from "../../../../entities/document.entity";
import { BlockVersionGcCollector } from "./block-version-gc.collector";
import { GcPolicyService } from "./gc-policy.service";
import type { BlockVersionGcPolicy } from "./gc.types";

function repository<T extends ObjectLiteral>(
  overrides: Partial<Record<keyof Repository<T>, jest.Mock>>,
) {
  return overrides as unknown as Repository<T>;
}

const policy: BlockVersionGcPolicy = {
  gracePeriodMs: 60_000,
  tombstoneGracePeriodMs: 60_000,
  keepLatestPerBlock: 1,
  promotionDelayMs: 60_000,
  stableSeenThreshold: 2,
  maxCandidatesToStore: 1000,
  maxSweepBatchSize: 100,
  poolEntryExpireMs: 604_800_000,
  rootSources: ["doc_snapshots", "document_drafts"],
};

describe("BlockVersionGcCollector", () => {
  it("never returns hard rooted snapshot or draft block versions as candidates", async () => {
    const now = Date.now();
    const old = now - 60 * 24 * 60 * 60 * 1000;
    const collector = new BlockVersionGcCollector(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1", workspaceId: "ws_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", workspaceId: "ws_1" }]),
      }),
      repository<Block>({
        find: jest.fn().mockResolvedValue([{ blockId: "b_1", docId: "doc_1", latestVer: 3 }]),
      }),
      repository<BlockVersion>({
        find: jest.fn().mockResolvedValue([
          { id: 1, docId: "doc_1", blockId: "b_1", ver: 1, createdAt: old, payload: {} },
          { id: 2, docId: "doc_1", blockId: "b_1", ver: 2, createdAt: old, payload: {} },
          { id: 3, docId: "doc_1", blockId: "b_1", ver: 3, createdAt: old, payload: {} },
        ]),
      }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", blockVersionMap: { b_1: 1 } }]),
      }),
      repository<DocDraft>({
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", blockVersionMap: { b_1: 2 } }]),
      }),
      new GcPolicyService(),
    );

    const result = await collector.preview({ docId: "doc_1" }, policy);

    expect(result.candidates).toEqual([]);
    expect(result.summary.hardRootedBlockVersions).toBe(2);
    expect(result.summary.liveRootedBlockVersions).toBe(2);
    expect(result.summary.tombstoneRootedBlockVersions).toBe(0);
    expect(result.summary.policyRetainedBlockVersions).toBe(1);
    expect(result.summary.policyRetentionBreakdown).toEqual({
      withinGracePeriod: 0,
      activeLatestVersion: 1,
      keepLatestPerBlock: 1,
    });
  });

  it("returns old unreferenced versions outside the latest-per-block retention as candidates", async () => {
    const now = Date.now();
    const old = now - 60 * 24 * 60 * 60 * 1000;
    const collector = new BlockVersionGcCollector(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1", workspaceId: "ws_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", workspaceId: "ws_1" }]),
      }),
      repository<Block>({
        find: jest.fn().mockResolvedValue([{ blockId: "b_1", docId: "doc_1", latestVer: 4 }]),
      }),
      repository<BlockVersion>({
        find: jest.fn().mockResolvedValue([
          { id: 1, docId: "doc_1", blockId: "b_1", ver: 1, createdAt: old, payload: {} },
          { id: 2, docId: "doc_1", blockId: "b_1", ver: 2, createdAt: old, payload: {} },
          { id: 3, docId: "doc_1", blockId: "b_1", ver: 3, createdAt: old, payload: {} },
          { id: 4, docId: "doc_1", blockId: "b_1", ver: 4, createdAt: old, payload: {} },
        ]),
      }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", blockVersionMap: { b_1: 1 } }]),
      }),
      repository<DocDraft>({ find: jest.fn().mockResolvedValue([]) }),
      new GcPolicyService(),
    );

    const result = await collector.preview({ docId: "doc_1" }, policy);

    expect(result.candidates.map((candidate) => candidate.resourceKey)).toEqual(["b_1@2", "b_1@3"]);
    expect(result.summary.candidateBlockVersions).toBe(2);
    expect(result.summary.candidateReasons).toEqual({
      unreferenced_older_than_policy: 2,
    });
  });

  it("tracks deleted tombstone roots separately and does not treat the tombstone version as a regular block-version candidate", async () => {
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const collector = new BlockVersionGcCollector(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1", workspaceId: "ws_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", workspaceId: "ws_1" }]),
      }),
      repository<Block>({
        find: jest.fn().mockResolvedValue([{ blockId: "b_1", docId: "doc_1", latestVer: 4 }]),
      }),
      repository<BlockVersion>({
        find: jest.fn().mockResolvedValue([
          { id: 1, docId: "doc_1", blockId: "b_1", ver: 1, createdAt: old, payload: {} },
          {
            id: 4,
            docId: "doc_1",
            blockId: "b_1",
            ver: 4,
            createdAt: old,
            payload: { attrs: { deleted: true } },
          },
        ]),
      }),
      repository<DocSnapshot>({
        find: jest
          .fn()
          .mockResolvedValue([
            { snapshotId: "doc_1@snap@4", docId: "doc_1", blockVersionMap: { b_1: 4 } },
          ]),
      }),
      repository<DocDraft>({
        find: jest
          .fn()
          .mockResolvedValue([{ draftId: "draft_1", docId: "doc_1", blockVersionMap: { b_1: 4 } }]),
      }),
      new GcPolicyService(),
    );

    const result = await collector.preview(
      { docId: "doc_1" },
      { ...policy, tombstoneGracePeriodMs: Number.MAX_SAFE_INTEGER },
    );

    expect(result.candidates.map((candidate) => candidate.resourceKey)).toEqual(["b_1@1"]);
    expect(result.summary.hardRootedBlockVersions).toBe(1);
    expect(result.summary.liveRootedBlockVersions).toBe(0);
    expect(result.summary.tombstoneRootedBlockVersions).toBe(1);
    expect(result.summary.softDeletedMapEntries).toBe(2);
    expect(result.summary.candidateBlockVersions).toBe(1);
    expect(result.summary.tombstoneCompactionCandidates).toBe(0);
  });

  it("creates compact_map_entry candidates for old deleted tombstone roots after tombstone grace period", async () => {
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const collector = new BlockVersionGcCollector(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1", workspaceId: "ws_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", workspaceId: "ws_1" }]),
      }),
      repository<Block>({
        find: jest.fn().mockResolvedValue([{ blockId: "b_1", docId: "doc_1", latestVer: 4 }]),
      }),
      repository<BlockVersion>({
        find: jest.fn().mockResolvedValue([
          {
            id: 4,
            docId: "doc_1",
            blockId: "b_1",
            ver: 4,
            createdAt: old,
            payload: { attrs: { deleted: true } },
          },
        ]),
      }),
      repository<DocSnapshot>({
        find: jest
          .fn()
          .mockResolvedValue([
            { snapshotId: "doc_1@snap@4", docId: "doc_1", blockVersionMap: { b_1: 4 } },
          ]),
      }),
      repository<DocDraft>({
        find: jest
          .fn()
          .mockResolvedValue([{ draftId: "draft_1", docId: "doc_1", blockVersionMap: { b_1: 4 } }]),
      }),
      new GcPolicyService(),
    );

    const result = await collector.preview(
      { docId: "doc_1" },
      { ...policy, tombstoneGracePeriodMs: 1 },
    );

    expect(result.summary.candidateReasons).toEqual({
      deleted_tombstone_map_entry: 2,
    });
    expect(result.summary.candidateBlockVersions).toBe(0);
    expect(result.summary.tombstoneCompactionCandidates).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceKey: "b_1@4",
          reasonCode: "deleted_tombstone_map_entry",
          decision: "candidate",
          candidateClass: "deleted_tombstone_map_entry",
          decisionReasons: expect.arrayContaining(["墓碑 root 已经足够老，可以压缩 map 引用"]),
          reasonDetail: expect.objectContaining({
            rootKind: "tombstone",
            deleted: true,
            source: "doc_snapshots",
            action: "compact_map_entry",
            rootRefType: "snapshot",
            rootRefId: "doc_1@snap@4",
          }),
        }),
        expect.objectContaining({
          resourceKey: "b_1@4",
          reasonCode: "deleted_tombstone_map_entry",
          decision: "candidate",
          candidateClass: "deleted_tombstone_map_entry",
          decisionReasons: expect.arrayContaining(["墓碑 root 已经足够老，可以压缩 map 引用"]),
          reasonDetail: expect.objectContaining({
            rootKind: "tombstone",
            deleted: true,
            source: "document_drafts",
            action: "compact_map_entry",
            rootRefType: "draft",
            rootRefId: "draft_1",
          }),
        }),
      ]),
    );
  });

  it("returns unreferenced deleted latest tombstone versions after tombstone compaction removes the root", async () => {
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const collector = new BlockVersionGcCollector(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1", workspaceId: "ws_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", workspaceId: "ws_1" }]),
      }),
      repository<Block>({
        find: jest
          .fn()
          .mockResolvedValue([{ blockId: "b_1", docId: "doc_1", latestVer: 4, isDeleted: true }]),
      }),
      repository<BlockVersion>({
        find: jest.fn().mockResolvedValue([
          {
            id: 4,
            docId: "doc_1",
            blockId: "b_1",
            ver: 4,
            createdAt: old,
            payload: { attrs: { deleted: true } },
          },
        ]),
      }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([]),
      }),
      repository<DocDraft>({
        find: jest.fn().mockResolvedValue([]),
      }),
      new GcPolicyService(),
    );

    const result = await collector.preview({ docId: "doc_1" }, policy);

    expect(result.candidates).toEqual([
      expect.objectContaining({
        resourceKey: "b_1@4",
        reasonCode: "unreferenced_older_than_policy",
        candidateClass: "unreferenced_block_version",
        reasonDetail: expect.objectContaining({
          rootKind: "none",
          deleted: true,
          retainedByPolicy: false,
        }),
      }),
    ]);
    expect(result.summary.policyRetainedBlockVersions).toBe(0);
    expect(result.summary.candidateBlockVersions).toBe(1);
  });

  it("retains the full delta chain when a draft root points at a delta version", async () => {
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const collector = new BlockVersionGcCollector(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1", workspaceId: "ws_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", workspaceId: "ws_1" }]),
      }),
      repository<Block>({
        find: jest.fn().mockResolvedValue([{ blockId: "b_1", docId: "doc_1", latestVer: 8 }]),
      }),
      repository<BlockVersion>({
        find: jest.fn().mockResolvedValue([
          { id: 1, docId: "doc_1", blockId: "b_1", ver: 1, createdAt: old, payload: {}, payloadKind: "full" },
          { id: 5, docId: "doc_1", blockId: "b_1", ver: 5, createdAt: old, payload: {}, payloadKind: "full", baseVer: null },
          { id: 6, docId: "doc_1", blockId: "b_1", ver: 6, createdAt: old, payload: null, payloadKind: "delta", baseVer: 5, delta: "patch" },
          { id: 7, docId: "doc_1", blockId: "b_1", ver: 7, createdAt: old, payload: null, payloadKind: "delta", baseVer: 5, delta: "patch" },
          { id: 8, docId: "doc_1", blockId: "b_1", ver: 8, createdAt: old, payload: null, payloadKind: "delta", baseVer: 5, delta: "patch" },
        ]),
      }),
      repository<DocSnapshot>({ find: jest.fn().mockResolvedValue([]) }),
      repository<DocDraft>({
        find: jest.fn().mockResolvedValue([{ draftId: "draft_1", docId: "doc_1", blockVersionMap: { b_1: 8 } }]),
      }),
      new GcPolicyService(),
    );

    const result = await collector.preview({ docId: "doc_1" }, policy);

    expect(result.candidates.map((candidate) => candidate.resourceKey)).toEqual(["b_1@1"]);
    expect(result.summary.liveRootedBlockVersions).toBe(4);
  });
});
