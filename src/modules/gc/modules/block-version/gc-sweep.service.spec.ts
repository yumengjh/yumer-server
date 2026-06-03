import type { ObjectLiteral, Repository } from "typeorm";
import { Block } from "../../../../entities/block.entity";
import { BlockVersion } from "../../../../entities/block-version.entity";
import { DocDraft } from "../../../../entities/doc-draft.entity";
import { DocSnapshot } from "../../../../entities/doc-snapshot.entity";
import { Document } from "../../../../entities/document.entity";
import { GcCandidatePool } from "../../../../entities/gc-candidate-pool.entity";
import { GcRun } from "../../../../entities/gc-run.entity";
import type { GcPolicyService } from "./gc-policy.service";
import { GcSweepService } from "./gc-sweep.service";

function repository<T extends ObjectLiteral>(
  overrides: Partial<Record<keyof Repository<T>, jest.Mock>>,
) {
  return overrides as unknown as Repository<T>;
}

describe("GcSweepService", () => {
  it("compacts eligible draft tombstone entries and marks pool candidates swept", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolCandidate = {
      id: 1,
      candidateKey: "block_version:b_1@4:compact_map_entry",
      resourceType: "block_version",
      action: "compact_map_entry",
      source: "document_drafts",
      resourceKey: "b_1@4",
      resourceRowId: 4,
      docId: "doc_1",
      workspaceId: "ws_1",
      blockId: "b_1",
      blockVer: 4,
      versionCreatedAt: 1,
      firstSeenRunId: "gc_run_1",
      lastSeenRunId: "gc_run_2",
      firstSeenAt: new Date("2026-05-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-31T00:01:00.000Z"),
      seenCount: 2,
      stableSeenCount: 2,
      state: "eligible",
      eligibleAfter: new Date("2026-05-31T00:00:30.000Z"),
      lastSweepAt: null,
      lastValidationAt: null,
      reasonCode: "deleted_tombstone_map_entry",
      reasonDetail: {
        rootKind: "tombstone",
        deleted: true,
        source: "document_drafts",
        action: "compact_map_entry",
        rootRefType: "draft",
        rootRefId: "draft_1",
        rootRefKey: "draft:draft_1:b_1@4",
        hardRooted: true,
        retainedByPolicy: false,
        ageMs: 1000,
        ageBucket: "stable",
        rootSourceCount: 1,
        distanceFromLatestVer: 0,
        decisionPath: ["tombstone_root", "old_enough_for_compaction"],
      },
      riskLevel: "low",
      policySnapshot: {},
      lastBlockers: [],
      createdAt: new Date("2026-05-31T00:00:00.000Z"),
      updatedAt: new Date("2026-05-31T00:01:00.000Z"),
    } as GcCandidatePool;
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([poolCandidate]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const draft = {
      id: 1,
      draftId: "draft_1",
      docId: "doc_1",
      workspaceId: "ws_1",
      baseDocVer: 3,
      baseSnapshotId: "doc_1@snap@3",
      blockVersionMap: { root_1: 1, b_1: 4 },
      changedBlocksCount: 1,
      updatedAt: 0,
      updatedBy: "editor_1",
    } as unknown as DocDraft;
    const draftRepo = repository<DocDraft>({
      findOne: jest.fn().mockResolvedValue(draft),
    });
    const documentRepo = repository<Document>({
      findOne: jest.fn().mockResolvedValue({
        docId: "doc_1",
        workspaceId: "ws_1",
      }),
    });
    const snapshotRepo = repository<DocSnapshot>({
      findOne: jest.fn().mockResolvedValue({
        snapshotId: "doc_1@snap@3",
        blockVersionMap: { root_1: 1, b_1: 1 },
      }),
    });
    const blockVersionRepo = repository<BlockVersion>({
      findOne: jest.fn().mockResolvedValue({
        id: 4,
        docId: "doc_1",
        blockId: "b_1",
        ver: 4,
        payload: { attrs: { deleted: true } },
      }),
    });
    const savedDrafts: DocDraft[] = [];
    const savedBlocks: Array<Record<string, unknown>> = [];
    const savedPoolEntries: Array<Record<string, unknown>> = [];
    const block = {
      blockId: "b_1",
      docId: "doc_1",
      latestVer: 4,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === DocDraft) {
          return {
            findOne: jest.fn().mockResolvedValue(draft),
            find: jest.fn().mockImplementation(async ({ where }: { where: { docId: string } }) =>
              where.docId === draft.docId ? [draft] : [],
            ),
            save: jest.fn().mockImplementation(async (value: DocDraft) => {
              savedDrafts.push(value);
              Object.assign(draft, value);
              return value;
            }),
          };
        }

        if (entity === DocSnapshot) {
          return {
            findOne: jest.fn().mockResolvedValue({
              snapshotId: "doc_1@snap@3",
              blockVersionMap: { root_1: 1, b_1: 1 },
            }),
            find: jest.fn().mockResolvedValue([
              {
                snapshotId: "doc_1@snap@3",
                blockVersionMap: { root_1: 1, b_1: 1 },
              },
            ]),
          };
        }

        if (entity === Block) {
          return {
            findOne: jest.fn().mockResolvedValue(block),
            save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => {
              savedBlocks.push(value);
              Object.assign(block, value);
              return value;
            }),
          };
        }

        if (entity === BlockVersion) {
          return {
            findOne: jest.fn().mockResolvedValue({
              id: 4,
              docId: "doc_1",
              blockId: "b_1",
              ver: 4,
              payload: { attrs: { deleted: true } },
            }),
          };
        }

        if (entity === GcCandidatePool) {
          return {
            save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => {
              savedPoolEntries.push(value);
              return value;
            }),
          };
        }

        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (transactionManager: never) => Promise<void>) =>
        callback(manager as never),
      ),
    };

    const service = new GcSweepService(
      runRepo,
      poolRepo,
      documentRepo,
      draftRepo,
      snapshotRepo,
      blockVersionRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 0,
          promotionDelayMs: 0,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      dataSource as never,
    );

    const result = await service.sweepDraftTombstones(
      { workspaceId: "ws_1", dryRun: false },
      "gc_operator",
    );

    expect(result.status).toBe("completed");
    expect(result.mode).toBe("sweep");
    expect(result.summary).toMatchObject({
      selectedCandidates: 1,
      processedCandidates: 1,
      compactedDraftEntries: 1,
      blockedCandidates: 0,
      wouldCompactCandidates: 0,
    });
    expect(savedDrafts[0]).toMatchObject({
      docId: "doc_1",
      blockVersionMap: { root_1: 1 },
      changedBlocksCount: 1,
      updatedBy: "gc_operator",
    });
    expect(savedBlocks[0]).toMatchObject({
      blockId: "b_1",
      isDeleted: true,
      deletedBy: "gc_operator",
    });
    expect(savedPoolEntries[0]).toMatchObject({
      candidateKey: "block_version:b_1@4:compact_map_entry",
      state: "swept",
      lastBlockers: [],
    });
  });

  it("marks candidates blocked when fresh revalidation fails", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolCandidate = {
      id: 1,
      candidateKey: "block_version:b_1@4:compact_map_entry",
      resourceType: "block_version",
      action: "compact_map_entry",
      source: "document_drafts",
      resourceKey: "b_1@4",
      resourceRowId: 4,
      docId: "doc_1",
      workspaceId: "ws_1",
      blockId: "b_1",
      blockVer: 4,
      versionCreatedAt: 1,
      firstSeenRunId: "gc_run_1",
      lastSeenRunId: "gc_run_2",
      firstSeenAt: new Date("2026-05-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-31T00:01:00.000Z"),
      seenCount: 2,
      stableSeenCount: 2,
      state: "eligible",
      eligibleAfter: new Date("2026-05-31T00:00:30.000Z"),
      lastSweepAt: null,
      lastValidationAt: null,
      reasonCode: "deleted_tombstone_map_entry",
      reasonDetail: {
        rootKind: "tombstone",
        deleted: true,
        source: "document_drafts",
        action: "compact_map_entry",
        rootRefType: "draft",
        rootRefId: "draft_1",
        rootRefKey: "draft:draft_1:b_1@4",
        hardRooted: true,
        retainedByPolicy: false,
        ageMs: 1000,
        ageBucket: "stable",
        rootSourceCount: 1,
        distanceFromLatestVer: 0,
        decisionPath: ["tombstone_root", "old_enough_for_compaction"],
      },
      riskLevel: "low",
      policySnapshot: {},
      lastBlockers: [],
      createdAt: new Date("2026-05-31T00:00:00.000Z"),
      updatedAt: new Date("2026-05-31T00:01:00.000Z"),
    } as GcCandidatePool;
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([poolCandidate]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const draftRepo = repository<DocDraft>({
      findOne: jest.fn().mockResolvedValue({
        draftId: "draft_1",
        docId: "doc_1",
        workspaceId: "ws_1",
        blockVersionMap: { root_1: 1, b_1: 5 },
      }),
    });
    const documentRepo = repository<Document>({
      findOne: jest.fn().mockResolvedValue({
        docId: "doc_1",
        workspaceId: "ws_1",
      }),
    });
    const snapshotRepo = repository<DocSnapshot>({});
    const blockVersionRepo = repository<BlockVersion>({
      findOne: jest.fn().mockResolvedValue({
        id: 4,
        docId: "doc_1",
        blockId: "b_1",
        ver: 4,
        payload: { attrs: { deleted: true } },
      }),
    });
    const dataSource = {
      transaction: jest.fn(),
    };

    const service = new GcSweepService(
      runRepo,
      poolRepo,
      documentRepo,
      draftRepo,
      snapshotRepo,
      blockVersionRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 0,
          promotionDelayMs: 0,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      dataSource as never,
    );

    const result = await service.sweepDraftTombstones(
      { workspaceId: "ws_1", dryRun: false },
      "gc_operator",
    );

    expect(result.summary).toMatchObject({
      selectedCandidates: 1,
      processedCandidates: 1,
      compactedDraftEntries: 0,
      blockedCandidates: 1,
    });
    expect(poolRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateKey: "block_version:b_1@4:compact_map_entry",
        state: "blocked",
        lastBlockers: ["draft_map_entry_changed"],
      }),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it("compacts eligible revision tombstone entries across revision snapshots", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolCandidate = {
      id: 2,
      candidateKey: "block_version:b_2@6:compact_map_entry",
      resourceType: "block_version",
      action: "compact_map_entry",
      source: "doc_snapshots",
      resourceKey: "b_2@6",
      resourceRowId: 6,
      docId: "doc_2",
      workspaceId: "ws_2",
      blockId: "b_2",
      blockVer: 6,
      versionCreatedAt: 1,
      firstSeenRunId: "gc_run_3",
      lastSeenRunId: "gc_run_4",
      firstSeenAt: new Date("2026-05-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-31T00:01:00.000Z"),
      seenCount: 2,
      stableSeenCount: 2,
      state: "eligible",
      eligibleAfter: new Date("2026-05-31T00:00:30.000Z"),
      lastSweepAt: null,
      lastValidationAt: null,
      reasonCode: "deleted_tombstone_map_entry",
      reasonDetail: {
        rootKind: "tombstone",
        deleted: true,
        source: "doc_snapshots",
        action: "compact_map_entry",
        rootRefType: "snapshot",
        rootRefId: "doc_2@snap@5",
        rootRefKey: "snapshot:doc_2@snap@5:b_2@6",
        hardRooted: true,
        retainedByPolicy: false,
        ageMs: 1000,
        ageBucket: "stable",
        rootSourceCount: 2,
        distanceFromLatestVer: 0,
        decisionPath: ["tombstone_root", "old_enough_for_compaction"],
      },
      riskLevel: "low",
      policySnapshot: {},
      lastBlockers: [],
      createdAt: new Date("2026-05-31T00:00:00.000Z"),
      updatedAt: new Date("2026-05-31T00:01:00.000Z"),
    } as GcCandidatePool;
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([poolCandidate]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const documentRepo = repository<Document>({
      findOne: jest.fn().mockResolvedValue({
        docId: "doc_2",
        workspaceId: "ws_2",
      }),
    });
    const draftRepo = repository<DocDraft>({
      findOne: jest.fn().mockResolvedValue({
        draftId: "draft_2",
        docId: "doc_2",
        workspaceId: "ws_2",
        blockVersionMap: { root_2: 1, b_2: 6 },
      }),
    });
    const snapshot = {
      id: 10,
      snapshotId: "doc_2@snap@5",
      docId: "doc_2",
      docVer: 5,
      kind: "revision",
      pinned: false,
      blockVersionMap: { root_2: 1, b_2: 6 },
    } as DocSnapshot;
    const snapshotRepo = repository<DocSnapshot>({
      findOne: jest.fn().mockResolvedValue(snapshot),
    });
    const blockVersionRepo = repository<BlockVersion>({
      findOne: jest.fn().mockResolvedValue({
        id: 6,
        docId: "doc_2",
        blockId: "b_2",
        ver: 6,
        payload: { attrs: { deleted: true } },
      }),
    });
    const savedSnapshots: DocSnapshot[] = [];
    const savedBlocks: Array<Record<string, unknown>> = [];
    const savedPoolEntries: Array<Record<string, unknown>> = [];
    const block = {
      blockId: "b_2",
      docId: "doc_2",
      latestVer: 6,
      isDeleted: false,
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === DocSnapshot) {
          return {
            findOne: jest.fn().mockResolvedValue(snapshot),
            find: jest.fn().mockImplementation(async ({ where }: { where: { docId: string } }) =>
              where.docId === snapshot.docId ? [snapshot] : [],
            ),
            save: jest.fn().mockImplementation(async (value: DocSnapshot) => {
              savedSnapshots.push(value);
              Object.assign(snapshot, value);
              return value;
            }),
          };
        }

        if (entity === DocDraft) {
          return {
            find: jest.fn().mockResolvedValue([
              {
                draftId: "draft_2",
                docId: "doc_2",
                workspaceId: "ws_2",
                blockVersionMap: { root_2: 1, b_2: 6 },
              },
            ]),
          };
        }

        if (entity === Block) {
          return {
            findOne: jest.fn().mockResolvedValue(block),
            save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => {
              savedBlocks.push(value);
              Object.assign(block, value);
              return value;
            }),
          };
        }

        if (entity === BlockVersion) {
          return {
            findOne: jest.fn().mockResolvedValue({
              id: 6,
              docId: "doc_2",
              blockId: "b_2",
              ver: 6,
              payload: { attrs: { deleted: true } },
            }),
          };
        }

        if (entity === GcCandidatePool) {
          return {
            save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => {
              savedPoolEntries.push(value);
              return value;
            }),
          };
        }

        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (transactionManager: never) => Promise<unknown>) =>
        callback(manager as never),
      ),
    };

    const service = new GcSweepService(
      runRepo,
      poolRepo,
      documentRepo,
      draftRepo,
      snapshotRepo,
      blockVersionRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 0,
          promotionDelayMs: 0,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      dataSource as never,
    );

    const result = await service.sweepRevisionTombstones(
      { workspaceId: "ws_2", dryRun: false },
      "gc_operator",
    );

    expect(result.status).toBe("completed");
    expect(result.summary).toMatchObject({
      selectedCandidates: 1,
      processedCandidates: 1,
      compactedSnapshots: 1,
      compactedSnapshotEntries: 1,
      blockedCandidates: 0,
    });
    expect(savedSnapshots).toHaveLength(1);
    expect(savedSnapshots[0]?.blockVersionMap).toEqual({ root_2: 1 });
    expect(savedBlocks).toHaveLength(0);
    expect(savedPoolEntries[0]).toMatchObject({
      candidateKey: "block_version:b_2@6:compact_map_entry",
      state: "swept",
      lastBlockers: [],
    });
  });

  it("blocks revision sweep when the target snapshot is pinned", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolCandidate = {
      id: 2,
      candidateKey: "block_version:b_2@6:compact_map_entry",
      resourceType: "block_version",
      action: "compact_map_entry",
      source: "doc_snapshots",
      resourceKey: "b_2@6",
      resourceRowId: 6,
      docId: "doc_2",
      workspaceId: "ws_2",
      blockId: "b_2",
      blockVer: 6,
      versionCreatedAt: 1,
      firstSeenRunId: "gc_run_3",
      lastSeenRunId: "gc_run_4",
      firstSeenAt: new Date("2026-05-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-31T00:01:00.000Z"),
      seenCount: 2,
      stableSeenCount: 2,
      state: "eligible",
      eligibleAfter: new Date("2026-05-31T00:00:30.000Z"),
      lastSweepAt: null,
      lastValidationAt: null,
      reasonCode: "deleted_tombstone_map_entry",
      reasonDetail: {
        rootKind: "tombstone",
        deleted: true,
        source: "doc_snapshots",
        action: "compact_map_entry",
        rootRefType: "snapshot",
        rootRefId: "doc_2@snap@9",
        rootRefKey: "snapshot:doc_2@snap@9:b_2@6",
        hardRooted: true,
        retainedByPolicy: false,
        ageMs: 1000,
        ageBucket: "stable",
        rootSourceCount: 1,
        distanceFromLatestVer: 0,
        decisionPath: ["tombstone_root", "old_enough_for_compaction"],
      },
      riskLevel: "low",
      policySnapshot: {},
      lastBlockers: [],
      createdAt: new Date("2026-05-31T00:00:00.000Z"),
      updatedAt: new Date("2026-05-31T00:01:00.000Z"),
    } as GcCandidatePool;
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([poolCandidate]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const documentRepo = repository<Document>({
      findOne: jest.fn().mockResolvedValue({
        docId: "doc_2",
        workspaceId: "ws_2",
      }),
    });
    const draftRepo = repository<DocDraft>({
      findOne: jest.fn().mockResolvedValue(null),
    });
    const snapshotRepo = repository<DocSnapshot>({
      findOne: jest.fn().mockResolvedValue({
        snapshotId: "doc_2@snap@9",
        docId: "doc_2",
        docVer: 9,
        kind: "revision",
        pinned: true,
        blockVersionMap: { root_2: 1, b_2: 6 },
      }),
    });
    const blockVersionRepo = repository<BlockVersion>({
      findOne: jest.fn().mockResolvedValue({
        id: 6,
        docId: "doc_2",
        blockId: "b_2",
        ver: 6,
        payload: { attrs: { deleted: true } },
      }),
    });
    const dataSource = {
      transaction: jest.fn(),
    };

    const service = new GcSweepService(
      runRepo,
      poolRepo,
      documentRepo,
      draftRepo,
      snapshotRepo,
      blockVersionRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 0,
          promotionDelayMs: 0,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      dataSource as never,
    );

    const result = await service.sweepRevisionTombstones(
      { workspaceId: "ws_2", dryRun: false },
      "gc_operator",
    );

    expect(result.summary).toMatchObject({
      selectedCandidates: 1,
      processedCandidates: 1,
      compactedSnapshots: 0,
      compactedSnapshotEntries: 0,
      blockedCandidates: 1,
    });
    expect(poolRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateKey: "block_version:b_2@6:compact_map_entry",
        state: "blocked",
        lastBlockers: ["snapshot_pinned_ref_present"],
      }),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it("dry-runs eligible unreferenced block version deletion without mutating rows", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolCandidate = {
      id: 3,
      candidateKey: "block_version:b_3@2:candidate_block_version",
      resourceType: "block_version",
      action: "candidate_block_version",
      source: null,
      resourceKey: "b_3@2",
      resourceRowId: 20,
      docId: "doc_3",
      workspaceId: "ws_3",
      blockId: "b_3",
      blockVer: 2,
      versionCreatedAt: Date.now() - 120_000,
      firstSeenRunId: "gc_run_5",
      lastSeenRunId: "gc_run_6",
      firstSeenAt: new Date("2026-05-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-31T00:01:00.000Z"),
      seenCount: 3,
      stableSeenCount: 3,
      state: "eligible",
      eligibleAfter: new Date("2026-05-31T00:00:30.000Z"),
      lastSweepAt: null,
      lastValidationAt: null,
      reasonCode: "unreferenced_older_than_policy",
      reasonDetail: {
        rootKind: "none",
        deleted: false,
        source: null,
        action: "candidate_block_version",
        hardRooted: false,
        retainedByPolicy: false,
        ageMs: 120_000,
        ageBucket: "stable",
        rootSourceCount: 0,
        distanceFromLatestVer: 3,
        decisionPath: ["unreferenced", "older_than_policy"],
      },
      riskLevel: "low",
      policySnapshot: {},
      lastBlockers: [],
      createdAt: new Date("2026-05-31T00:00:00.000Z"),
      updatedAt: new Date("2026-05-31T00:01:00.000Z"),
    } as GcCandidatePool;
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([poolCandidate]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const blockVersionRepo = repository<BlockVersion>({
      findOne: jest.fn().mockResolvedValue({
        id: 20,
        docId: "doc_3",
        blockId: "b_3",
        ver: 2,
        createdAt: Date.now() - 120_000,
      }),
      find: jest.fn().mockResolvedValue([{ ver: 5 }]),
    });
    const blockRepo = repository<Block>({
      findOne: jest.fn().mockResolvedValue({
        blockId: "b_3",
        docId: "doc_3",
        latestVer: 5,
      }),
    });
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Block) return blockRepo;
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
      transaction: jest.fn(),
    };
    const service = new GcSweepService(
      runRepo,
      poolRepo,
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_3", workspaceId: "ws_3" }),
      }),
      repository<DocDraft>({
        find: jest.fn().mockResolvedValue([]),
      }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([]),
      }),
      blockVersionRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 1,
          promotionDelayMs: 0,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      dataSource as never,
    );

    const result = await service.sweepBlockVersions(
      { workspaceId: "ws_3", dryRun: true },
      "gc_operator",
    );

    expect(result.summary).toMatchObject({
      dryRun: true,
      selectedCandidates: 1,
      processedCandidates: 1,
      wouldDeleteCandidates: 1,
      deletedBlockVersions: 0,
      blockedCandidates: 0,
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(poolRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateKey: "block_version:b_3@2:candidate_block_version",
        lastBlockers: [],
      }),
    );
  });

  it("deletes eligible unreferenced block versions and marks pool candidates swept", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolCandidate = {
      id: 4,
      candidateKey: "block_version:b_4@2:candidate_block_version",
      resourceType: "block_version",
      action: "candidate_block_version",
      source: null,
      resourceKey: "b_4@2",
      resourceRowId: 30,
      docId: "doc_4",
      workspaceId: "ws_4",
      blockId: "b_4",
      blockVer: 2,
      versionCreatedAt: Date.now() - 120_000,
      firstSeenRunId: "gc_run_7",
      lastSeenRunId: "gc_run_8",
      firstSeenAt: new Date("2026-05-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-31T00:01:00.000Z"),
      seenCount: 3,
      stableSeenCount: 3,
      state: "eligible",
      eligibleAfter: new Date("2026-05-31T00:00:30.000Z"),
      lastSweepAt: null,
      lastValidationAt: null,
      reasonCode: "unreferenced_older_than_policy",
      reasonDetail: {
        rootKind: "none",
        deleted: false,
        source: null,
        action: "candidate_block_version",
        hardRooted: false,
        retainedByPolicy: false,
        ageMs: 120_000,
        ageBucket: "stable",
        rootSourceCount: 0,
        distanceFromLatestVer: 3,
        decisionPath: ["unreferenced", "older_than_policy"],
      },
      riskLevel: "low",
      policySnapshot: {},
      lastBlockers: [],
      createdAt: new Date("2026-05-31T00:00:00.000Z"),
      updatedAt: new Date("2026-05-31T00:01:00.000Z"),
    } as GcCandidatePool;
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([poolCandidate]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const blockVersionRow = {
      id: 30,
      docId: "doc_4",
      blockId: "b_4",
      ver: 2,
      createdAt: Date.now() - 120_000,
    };
    const blockVersionRepo = repository<BlockVersion>({
      findOne: jest.fn().mockResolvedValue(blockVersionRow),
      find: jest.fn().mockResolvedValue([{ ver: 5 }]),
    });
    const deletedRows: Array<Record<string, unknown>> = [];
    const savedPoolEntries: Array<Record<string, unknown>> = [];
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Document) {
          return repository<Document>({
            findOne: jest.fn().mockResolvedValue({ docId: "doc_4", workspaceId: "ws_4" }),
          });
        }
        if (entity === Block) {
          return repository<Block>({
            findOne: jest.fn().mockResolvedValue({
              blockId: "b_4",
              docId: "doc_4",
              latestVer: 5,
            }),
          });
        }
        if (entity === BlockVersion) {
          return repository<BlockVersion>({
            findOne: jest.fn().mockResolvedValue(blockVersionRow),
            find: jest.fn().mockResolvedValue([{ ver: 5 }]),
            delete: jest.fn().mockImplementation(async (criteria: Record<string, unknown>) => {
              deletedRows.push(criteria);
              return { affected: 1 };
            }),
          });
        }
        if (entity === DocSnapshot) {
          return repository<DocSnapshot>({
            find: jest.fn().mockResolvedValue([]),
          });
        }
        if (entity === DocDraft) {
          return repository<DocDraft>({
            find: jest.fn().mockResolvedValue([]),
          });
        }
        if (entity === GcCandidatePool) {
          return repository<GcCandidatePool>({
            save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => {
              savedPoolEntries.push(value);
              return value;
            }),
          });
        }

        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Block) {
          return repository<Block>({
            findOne: jest.fn().mockResolvedValue({
              blockId: "b_4",
              docId: "doc_4",
              latestVer: 5,
            }),
          });
        }
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
      transaction: jest.fn(async (callback: (transactionManager: never) => Promise<void>) =>
        callback(manager as never),
      ),
    };
    const service = new GcSweepService(
      runRepo,
      poolRepo,
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_4", workspaceId: "ws_4" }),
      }),
      repository<DocDraft>({
        find: jest.fn().mockResolvedValue([]),
      }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([]),
      }),
      blockVersionRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 1,
          promotionDelayMs: 0,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      dataSource as never,
    );

    const result = await service.sweepBlockVersions(
      { workspaceId: "ws_4", dryRun: false },
      "gc_operator",
    );

    expect(result.summary).toMatchObject({
      dryRun: false,
      selectedCandidates: 1,
      processedCandidates: 1,
      deletedBlockVersions: 1,
      blockedCandidates: 0,
    });
    expect(deletedRows[0]).toEqual({
      id: 30,
      docId: "doc_4",
      blockId: "b_4",
      ver: 2,
    });
    expect(savedPoolEntries[0]).toMatchObject({
      candidateKey: "block_version:b_4@2:candidate_block_version",
      state: "swept",
      lastBlockers: [],
    });
  });

  it("deletes latest tombstone versions for deleted blocks after compaction removes all roots", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolCandidate = {
      id: 5,
      candidateKey: "block_version:b_5@4:candidate_block_version",
      resourceType: "block_version",
      action: "candidate_block_version",
      source: null,
      resourceKey: "b_5@4",
      resourceRowId: 40,
      docId: "doc_5",
      workspaceId: "ws_5",
      blockId: "b_5",
      blockVer: 4,
      versionCreatedAt: Date.now() - 120_000,
      firstSeenRunId: "gc_run_9",
      lastSeenRunId: "gc_run_10",
      firstSeenAt: new Date("2026-05-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-05-31T00:01:00.000Z"),
      seenCount: 3,
      stableSeenCount: 3,
      state: "eligible",
      eligibleAfter: new Date("2026-05-31T00:00:30.000Z"),
      lastSweepAt: null,
      lastValidationAt: null,
      reasonCode: "unreferenced_older_than_policy",
      reasonDetail: {
        rootKind: "none",
        deleted: true,
        source: null,
        action: "candidate_block_version",
        hardRooted: false,
        retainedByPolicy: false,
        ageMs: 120_000,
        ageBucket: "stable",
        rootSourceCount: 0,
        distanceFromLatestVer: 0,
        decisionPath: ["unreferenced", "older_than_policy"],
      },
      riskLevel: "low",
      policySnapshot: {},
      lastBlockers: [],
      createdAt: new Date("2026-05-31T00:00:00.000Z"),
      updatedAt: new Date("2026-05-31T00:01:00.000Z"),
    } as GcCandidatePool;
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([poolCandidate]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const blockVersionRow = {
      id: 40,
      docId: "doc_5",
      blockId: "b_5",
      ver: 4,
      createdAt: Date.now() - 120_000,
      createdBy: "gc_operator",
      payload: { attrs: { deleted: true } },
    };
    const blockVersionRepo = repository<BlockVersion>({
      findOne: jest.fn().mockResolvedValue(blockVersionRow),
      find: jest.fn(),
    });
    const deletedRows: Array<Record<string, unknown>> = [];
    const deletedBlocks: Array<Record<string, unknown>> = [];
    const savedPoolEntries: Array<Record<string, unknown>> = [];
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Document) {
          return repository<Document>({
            findOne: jest.fn().mockResolvedValue({ docId: "doc_5", workspaceId: "ws_5" }),
          });
        }
        if (entity === Block) {
          return repository<Block>({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({
                blockId: "b_5",
                docId: "doc_5",
                latestVer: 4,
                isDeleted: true,
              })
              .mockResolvedValueOnce({
                blockId: "b_5",
                docId: "doc_5",
                latestVer: 4,
                isDeleted: true,
              }),
            save: jest.fn(),
            delete: jest.fn().mockImplementation(async (criteria: Record<string, unknown>) => {
              deletedBlocks.push(criteria);
              return { affected: 1 };
            }),
          });
        }
        if (entity === BlockVersion) {
          return repository<BlockVersion>({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(blockVersionRow)
              .mockResolvedValueOnce(null),
            find: jest.fn(),
            delete: jest.fn().mockImplementation(async (criteria: Record<string, unknown>) => {
              deletedRows.push(criteria);
              return { affected: 1 };
            }),
          });
        }
        if (entity === DocSnapshot) {
          return repository<DocSnapshot>({
            find: jest.fn().mockResolvedValue([]),
          });
        }
        if (entity === DocDraft) {
          return repository<DocDraft>({
            find: jest.fn().mockResolvedValue([]),
          });
        }
        if (entity === GcCandidatePool) {
          return repository<GcCandidatePool>({
            save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => {
              savedPoolEntries.push(value);
              return value;
            }),
          });
        }

        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Block) {
          return repository<Block>({
            findOne: jest.fn().mockResolvedValue({
              blockId: "b_5",
              docId: "doc_5",
              latestVer: 4,
              isDeleted: true,
            }),
          });
        }
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
      transaction: jest.fn(async (callback: (transactionManager: never) => Promise<void>) =>
        callback(manager as never),
      ),
    };
    const service = new GcSweepService(
      runRepo,
      poolRepo,
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_5", workspaceId: "ws_5" }),
      }),
      repository<DocDraft>({
        find: jest.fn().mockResolvedValue([]),
      }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([]),
      }),
      blockVersionRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 1,
          promotionDelayMs: 0,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      dataSource as never,
    );

    const result = await service.sweepBlockVersions(
      { workspaceId: "ws_5", dryRun: false },
      "gc_operator",
    );

    expect(result.summary).toMatchObject({
      dryRun: false,
      selectedCandidates: 1,
      processedCandidates: 1,
      deletedBlockVersions: 1,
      blockedCandidates: 0,
    });
    expect(deletedRows[0]).toEqual({
      id: 40,
      docId: "doc_5",
      blockId: "b_5",
      ver: 4,
    });
    expect(deletedBlocks[0]).toEqual({
      blockId: "b_5",
      docId: "doc_5",
    });
    expect(savedPoolEntries[0]).toMatchObject({
      candidateKey: "block_version:b_5@4:candidate_block_version",
      state: "swept",
      lastBlockers: [],
    });
  });
});
