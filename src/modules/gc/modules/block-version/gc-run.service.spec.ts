// cspell:words explainability
import type { ObjectLiteral, Repository } from "typeorm";
import { GcCandidatePool } from "../../../../entities/gc-candidate-pool.entity";
import { GcRun } from "../../../../entities/gc-run.entity";
import { GcRunCandidate } from "../../../../entities/gc-run-candidate.entity";
import type { BlockVersionGcCollector } from "./block-version-gc.collector";
import type { GcHealthService } from "./gc-health.service";
import type { GcPolicyService } from "./gc-policy.service";
import { GcRunService } from "./gc-run.service";

function repository<T extends ObjectLiteral>(
  overrides: Partial<Record<keyof Repository<T>, jest.Mock>>,
) {
  return overrides as unknown as Repository<T>;
}

describe("GcRunService", () => {
  it("stores a blocked run without collecting candidates when health check fails", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const candidateRepo = repository<GcRunCandidate>({ create: jest.fn(), save: jest.fn() });
    const poolRepo = repository<GcCandidatePool>({
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      create: jest.fn((value) => value),
    });
    const service = new GcRunService(
      runRepo,
      candidateRepo,
      poolRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 5,
          promotionDelayMs: 60_000,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      {
        checkBlockVersionGcHealth: jest.fn().mockResolvedValue({
          status: "blocked",
          missingRevisionSnapshots: 1,
          missingPublishedSnapshots: 0,
          missingRootBlockVersions: 0,
          samples: {
            missingRevisionSnapshots: [{ docId: "doc_1", docVer: 2 }],
            missingPublishedSnapshots: [],
            missingRootBlockVersions: [],
          },
        }),
      } as unknown as GcHealthService,
      { preview: jest.fn() } as unknown as BlockVersionGcCollector,
    );

    const result = await service.previewBlockVersions(
      { docId: "doc_1", includeCandidates: true },
      "tester",
    );

    expect(result.status).toBe("blocked");
    expect(candidateRepo.save).not.toHaveBeenCalled();
  });

  it("stores completed run summary and truncates candidate details by policy", async () => {
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const candidateRepo = repository<GcRunCandidate>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolRepo = repository<GcCandidatePool>({
      create: jest.fn((value) => value),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const service = new GcRunService(
      runRepo,
      candidateRepo,
      poolRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 5,
          promotionDelayMs: 60_000,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        }),
      } as unknown as GcPolicyService,
      {
        checkBlockVersionGcHealth: jest.fn().mockResolvedValue({
          status: "ok",
          missingRevisionSnapshots: 0,
          missingPublishedSnapshots: 0,
          missingRootBlockVersions: 0,
          samples: {
            missingRevisionSnapshots: [],
            missingPublishedSnapshots: [],
            missingRootBlockVersions: [],
          },
        }),
      } as unknown as GcHealthService,
      {
        preview: jest.fn().mockResolvedValue({
          summary: {
            blockVersionsScanned: 2,
            hardRootedBlockVersions: 0,
            liveRootedBlockVersions: 0,
            tombstoneRootedBlockVersions: 0,
            policyRetainedBlockVersions: 0,
            policyRetentionBreakdown: {
              withinGracePeriod: 0,
              activeLatestVersion: 0,
              keepLatestPerBlock: 0,
            },
            softDeletedMapEntries: 0,
            candidateBlockVersions: 2,
            tombstoneCompactionCandidates: 0,
            rootSources: { docSnapshots: 0, documentDrafts: 0 },
            candidateReasons: { unreferenced_older_than_policy: 2 },
          },
          candidates: [
            {
              resourceKey: "b_1@1",
              resourceRowId: 1,
              docId: "doc_1",
              workspaceId: "ws_1",
              blockId: "b_1",
              blockVer: 1,
              versionCreatedAt: 1,
              reasonCode: "unreferenced_older_than_policy",
              reasonDetail: {},
            },
            {
              resourceKey: "b_1@2",
              resourceRowId: 2,
              docId: "doc_1",
              workspaceId: "ws_1",
              blockId: "b_1",
              blockVer: 2,
              versionCreatedAt: 2,
              reasonCode: "unreferenced_older_than_policy",
              reasonDetail: {},
            },
          ],
        }),
      } as unknown as BlockVersionGcCollector,
    );

    const result = await service.previewBlockVersions(
      { docId: "doc_1", includeCandidates: true },
      "tester",
    );

    expect(result.status).toBe("completed");
    expect(result.candidateDetailsStored).toBe(true);
    expect(result.candidateDetailsTruncated).toBe(true);
    expect(candidateRepo.save).toHaveBeenCalledTimes(1);
    expect(poolRepo.save).toHaveBeenCalledTimes(1);
  });

  it("projects explainability fields when listing saved candidates", async () => {
    const runRepo = repository<GcRun>({
      findOne: jest.fn().mockResolvedValue({
        runId: "gc_run_1",
        resourceType: "block_version",
        policySnapshot: {
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 1,
          promotionDelayMs: 60_000,
          stableSeenThreshold: 2,
          maxCandidatesToStore: 1000,
          maxSweepBatchSize: 100,
          poolEntryExpireMs: 604_800_000,
          rootSources: ["doc_snapshots", "document_drafts"],
        },
      }),
    });
    const candidateRepo = repository<GcRunCandidate>({
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 1,
            runId: "gc_run_1",
            resourceType: "block_version",
            resourceKey: "b_1@1",
            resourceRowId: 1,
            docId: "doc_1",
            workspaceId: "ws_1",
            blockId: "b_1",
            blockVer: 1,
            versionCreatedAt: 1,
            reasonCode: "unreferenced_older_than_policy",
            reasonDetail: {
              rootKind: "none",
              deleted: false,
              source: null,
              action: "candidate_block_version",
              hardRooted: false,
              retainedByPolicy: false,
              gracePeriodMs: 60_000,
              tombstoneGracePeriodMs: 60_000,
              keepLatestPerBlock: 1,
              ageMs: 3_600_000,
              ageBucket: "stable",
              rootSourceCount: 0,
              distanceFromLatestVer: 4,
              decisionPath: ["unreferenced", "older_than_policy"],
            },
          },
        ],
        1,
      ]),
    });
    const policyService = {
      getBlockVersionPolicy: jest.fn().mockReturnValue({
        gracePeriodMs: 60_000,
        tombstoneGracePeriodMs: 60_000,
        keepLatestPerBlock: 1,
        promotionDelayMs: 60_000,
        stableSeenThreshold: 2,
        maxCandidatesToStore: 1000,
        maxSweepBatchSize: 100,
        poolEntryExpireMs: 604_800_000,
        rootSources: ["doc_snapshots", "document_drafts"],
      }),
      explainPersistedBlockVersionCandidate: jest.fn().mockReturnValue({
        decision: "candidate",
        candidateClass: "unreferenced_block_version",
        decisionReasons: ["该版本已经远远超过保留时间窗口"],
      }),
    } as unknown as GcPolicyService;
    const service = new GcRunService(
      runRepo,
      candidateRepo,
      repository<GcCandidatePool>({}),
      policyService,
      {} as GcHealthService,
      {} as BlockVersionGcCollector,
    );

    const result = await service.findCandidates("gc_run_1", { page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      resourceKey: "b_1@1",
      reasonCode: "unreferenced_older_than_policy",
      decision: "candidate",
      candidateClass: "unreferenced_block_version",
      decisionReasons: ["该版本已经远远超过保留时间窗口"],
    });
  });

  it("filters runs by mode and scope before pagination", async () => {
    const runRepo = repository<GcRun>({
      find: jest.fn().mockResolvedValue([
        {
          runId: "gc_sweep_2",
          resourceType: "block_version",
          mode: "sweep",
          status: "completed",
          scope: { workspaceId: "ws_1", docId: "doc_1" },
          createdAt: new Date("2026-05-31T00:04:00.000Z"),
        },
        {
          runId: "gc_sweep_1",
          resourceType: "block_version",
          mode: "sweep",
          status: "completed",
          scope: { workspaceId: "ws_1", docId: "doc_1" },
          createdAt: new Date("2026-05-31T00:03:00.000Z"),
        },
        {
          runId: "gc_sweep_other_doc",
          resourceType: "block_version",
          mode: "sweep",
          status: "completed",
          scope: { workspaceId: "ws_1", docId: "doc_2" },
          createdAt: new Date("2026-05-31T00:02:00.000Z"),
        },
        {
          runId: "gc_preview_1",
          resourceType: "block_version",
          mode: "preview",
          status: "completed",
          scope: { workspaceId: "ws_1", docId: "doc_1" },
          createdAt: new Date("2026-05-31T00:01:00.000Z"),
        },
      ]),
    });
    const service = new GcRunService(
      runRepo,
      repository<GcRunCandidate>({}),
      repository<GcCandidatePool>({}),
      {} as GcPolicyService,
      {} as GcHealthService,
      {} as BlockVersionGcCollector,
    );

    const result = await service.findRuns({
      mode: "sweep",
      workspaceId: "ws_1",
      docId: "doc_1",
      page: 2,
      pageSize: 1,
    });

    expect(runRepo.find).toHaveBeenCalledWith({
      where: {
        resourceType: "block_version",
        mode: "sweep",
      },
      order: { createdAt: "DESC" },
    });
    expect(result).toMatchObject({
      total: 2,
      page: 2,
      pageSize: 1,
      items: [{ runId: "gc_sweep_1" }],
    });
  });

  it("promotes recurring preview candidates into the pool after the observation threshold", async () => {
    const savedPoolEntries: Array<Record<string, unknown>> = [];
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => {
        if (value.finishedAt == null) {
          return value;
        }

        value.finishedAt = new Date("2026-05-31T00:01:00.000Z");
        return value;
      }),
    });
    const candidateRepo = repository<GcRunCandidate>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    });
    const poolRepo = repository<GcCandidatePool>({
      create: jest.fn((value) => value),
      find: jest.fn().mockImplementation(async () =>
        savedPoolEntries.map((entry) => ({
          ...entry,
          firstSeenAt: new Date(entry.firstSeenAt as string),
          lastSeenAt: new Date(entry.lastSeenAt as string),
          eligibleAfter: new Date(entry.eligibleAfter as string),
        })),
      ),
      save: jest.fn().mockImplementation(async (value: Array<Record<string, unknown>>) => {
        savedPoolEntries.splice(
          0,
          savedPoolEntries.length,
          ...value.map((item) => ({
            ...item,
            firstSeenAt: (item.firstSeenAt as Date).toISOString(),
            lastSeenAt: (item.lastSeenAt as Date).toISOString(),
            eligibleAfter: (item.eligibleAfter as Date).toISOString(),
          })),
        );
        return value;
      }),
    });
    let runCounter = 0;
    const service = new GcRunService(
      runRepo,
      candidateRepo,
      poolRepo,
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
      {
        checkBlockVersionGcHealth: jest.fn().mockResolvedValue({
          status: "ok",
          missingRevisionSnapshots: 0,
          missingPublishedSnapshots: 0,
          missingRootBlockVersions: 0,
          samples: {
            missingRevisionSnapshots: [],
            missingPublishedSnapshots: [],
            missingRootBlockVersions: [],
          },
        }),
      } as unknown as GcHealthService,
      {
        preview: jest.fn().mockImplementation(async () => ({
          summary: {
            blockVersionsScanned: 1,
            hardRootedBlockVersions: 0,
            liveRootedBlockVersions: 0,
            tombstoneRootedBlockVersions: 0,
            policyRetainedBlockVersions: 0,
            policyRetentionBreakdown: {
              withinGracePeriod: 0,
              activeLatestVersion: 0,
              keepLatestPerBlock: 0,
            },
            softDeletedMapEntries: 0,
            candidateBlockVersions: 1,
            tombstoneCompactionCandidates: 0,
            rootSources: { docSnapshots: 0, documentDrafts: 0 },
            candidateReasons: { unreferenced_older_than_policy: 1 },
          },
          candidates: [
            {
              resourceKey: "b_1@1",
              resourceRowId: 1,
              docId: "doc_1",
              workspaceId: "ws_1",
              blockId: "b_1",
              blockVer: 1,
              versionCreatedAt: 1,
              reasonCode: "unreferenced_older_than_policy",
              reasonDetail: {
                rootKind: "none",
                deleted: false,
                source: null,
                action: "candidate_block_version",
                hardRooted: false,
                retainedByPolicy: false,
                gracePeriodMs: 60_000,
                tombstoneGracePeriodMs: 60_000,
                keepLatestPerBlock: 0,
                ageMs: 3_600_000,
                ageBucket: "stable",
                rootSourceCount: 0,
                distanceFromLatestVer: 3,
                decisionPath: ["unreferenced", "older_than_policy"],
              },
            },
          ],
          runCounter: ++runCounter,
        })),
      } as unknown as BlockVersionGcCollector,
    );

    await service.previewBlockVersions({ docId: "doc_1", includeCandidates: false }, "tester");
    expect(savedPoolEntries[0]).toMatchObject({
      candidateKey: "block_version:b_1@1:candidate_block_version",
      seenCount: 1,
      stableSeenCount: 1,
      state: "pending",
    });

    await service.previewBlockVersions({ docId: "doc_1", includeCandidates: false }, "tester");
    expect(savedPoolEntries[0]).toMatchObject({
      candidateKey: "block_version:b_1@1:candidate_block_version",
      seenCount: 2,
      stableSeenCount: 2,
      state: "eligible",
    });
  });

  it("keeps tombstone compaction pool entries split by root ref", async () => {
    const savedPoolEntries: Array<Record<string, unknown>> = [];
    const runRepo = repository<GcRun>({
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => {
        if (value.finishedAt == null) {
          return value;
        }

        value.finishedAt = new Date("2026-05-31T00:01:00.000Z");
        return value;
      }),
    });
    const service = new GcRunService(
      runRepo,
      repository<GcRunCandidate>({
        create: jest.fn((value) => value),
        save: jest.fn().mockImplementation(async (value) => value),
      }),
      repository<GcCandidatePool>({
        create: jest.fn((value) => value),
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockImplementation(async (value: Array<Record<string, unknown>>) => {
          savedPoolEntries.splice(0, savedPoolEntries.length, ...value);
          return value;
        }),
      }),
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
      {
        checkBlockVersionGcHealth: jest.fn().mockResolvedValue({
          status: "ok",
          missingRevisionSnapshots: 0,
          missingPublishedSnapshots: 0,
          missingRootBlockVersions: 0,
          samples: {
            missingRevisionSnapshots: [],
            missingPublishedSnapshots: [],
            missingRootBlockVersions: [],
          },
        }),
      } as unknown as GcHealthService,
      {
        preview: jest.fn().mockResolvedValue({
          summary: {
            blockVersionsScanned: 1,
            hardRootedBlockVersions: 1,
            liveRootedBlockVersions: 0,
            tombstoneRootedBlockVersions: 1,
            policyRetainedBlockVersions: 0,
            policyRetentionBreakdown: {
              withinGracePeriod: 0,
              activeLatestVersion: 0,
              keepLatestPerBlock: 0,
            },
            softDeletedMapEntries: 2,
            candidateBlockVersions: 0,
            tombstoneCompactionCandidates: 2,
            rootSources: { docSnapshots: 1, documentDrafts: 1 },
            candidateReasons: { deleted_tombstone_map_entry: 2 },
          },
          candidates: [
            {
              resourceKey: "b_1@4",
              resourceRowId: 4,
              docId: "doc_1",
              workspaceId: "ws_1",
              blockId: "b_1",
              blockVer: 4,
              versionCreatedAt: 1,
              reasonCode: "deleted_tombstone_map_entry",
              reasonDetail: {
                rootKind: "tombstone",
                deleted: true,
                source: "doc_snapshots",
                action: "compact_map_entry",
                rootRefType: "snapshot",
                rootRefId: "doc_1@snap@4",
                rootRefKey: "snapshot:doc_1@snap@4:b_1@4",
                hardRooted: true,
                retainedByPolicy: false,
                ageMs: 3_600_000,
                ageBucket: "stable",
                rootSourceCount: 2,
                distanceFromLatestVer: 0,
                gracePeriodMs: 60_000,
                tombstoneGracePeriodMs: 60_000,
                keepLatestPerBlock: 0,
                decisionPath: ["tombstone_root", "old_enough_for_compaction"],
              },
            },
            {
              resourceKey: "b_1@4",
              resourceRowId: 4,
              docId: "doc_1",
              workspaceId: "ws_1",
              blockId: "b_1",
              blockVer: 4,
              versionCreatedAt: 1,
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
                ageMs: 3_600_000,
                ageBucket: "stable",
                rootSourceCount: 2,
                distanceFromLatestVer: 0,
                gracePeriodMs: 60_000,
                tombstoneGracePeriodMs: 60_000,
                keepLatestPerBlock: 0,
                decisionPath: ["tombstone_root", "old_enough_for_compaction"],
              },
            },
          ],
        }),
      } as unknown as BlockVersionGcCollector,
    );

    await service.previewBlockVersions({ docId: "doc_1", includeCandidates: false }, "tester");

    expect(savedPoolEntries).toHaveLength(2);
    expect(savedPoolEntries[0]?.candidateKey).not.toBe(savedPoolEntries[1]?.candidateKey);
    expect(savedPoolEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "compact_map_entry",
          source: "doc_snapshots",
          resourceKey: "b_1@4",
        }),
        expect.objectContaining({
          action: "compact_map_entry",
          source: "document_drafts",
          resourceKey: "b_1@4",
        }),
      ]),
    );
  });
});
