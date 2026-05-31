import type { ObjectLiteral, Repository } from "typeorm";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { Document } from "../../entities/document.entity";
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
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", blockVersionMap: { b_1: 4 } }]),
      }),
      repository<DocDraft>({ find: jest.fn().mockResolvedValue([]) }),
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
    expect(result.summary.softDeletedMapEntries).toBe(1);
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
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", blockVersionMap: { b_1: 4 } }]),
      }),
      repository<DocDraft>({ find: jest.fn().mockResolvedValue([]) }),
      new GcPolicyService(),
    );

    const result = await collector.preview(
      { docId: "doc_1" },
      { ...policy, tombstoneGracePeriodMs: 1 },
    );

    expect(result.summary.candidateReasons).toEqual({
      deleted_tombstone_map_entry: 1,
    });
    expect(result.summary.candidateBlockVersions).toBe(0);
    expect(result.summary.tombstoneCompactionCandidates).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      resourceKey: "b_1@4",
      reasonCode: "deleted_tombstone_map_entry",
      riskLevel: "low",
      plannedAction: "compact_map_entry",
      readiness: "ready_for_manual_review",
      reasonDetail: {
        rootKind: "tombstone",
        deleted: true,
        source: "doc_snapshots",
        action: "compact_map_entry",
      },
    });
    expect(result.candidates[0].requiredChecks).toEqual(
      expect.arrayContaining(["verify_root_stability", "verify_policy_overlap"]),
    );
    expect(result.candidates[0].riskAssessment.reasons).toContain(
      "tombstone root is old enough to compact",
    );
  });
});
