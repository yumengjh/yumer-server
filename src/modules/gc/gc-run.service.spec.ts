import type { ObjectLiteral, Repository } from "typeorm";
import { GcRun } from "../../entities/gc-run.entity";
import { GcRunCandidate } from "../../entities/gc-run-candidate.entity";
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
    const service = new GcRunService(
      runRepo,
      candidateRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 5,
          maxCandidatesToStore: 1000,
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
    const service = new GcRunService(
      runRepo,
      candidateRepo,
      {
        getBlockVersionPolicy: jest.fn().mockReturnValue({
          gracePeriodMs: 60_000,
          tombstoneGracePeriodMs: 60_000,
          keepLatestPerBlock: 5,
          maxCandidatesToStore: 1,
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
              riskLevel: "medium",
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
              riskLevel: "medium",
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
          maxCandidatesToStore: 1000,
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
            riskLevel: "low",
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
        maxCandidatesToStore: 1000,
        rootSources: ["doc_snapshots", "document_drafts"],
      }),
      explainPersistedBlockVersionCandidate: jest.fn().mockReturnValue({
        plannedAction: "candidate_block_version",
        requiredChecks: ["verify_root_stability"],
        readiness: "ready_for_manual_review",
        riskAssessment: {
          level: "low",
          score: 12,
          reasons: ["version is far beyond the grace window"],
          factors: [],
        },
      }),
    } as unknown as GcPolicyService;
    const service = new GcRunService(
      runRepo,
      candidateRepo,
      policyService,
      {} as GcHealthService,
      {} as BlockVersionGcCollector,
    );

    const result = await service.findCandidates("gc_run_1", { page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      resourceKey: "b_1@1",
      reasonCode: "unreferenced_older_than_policy",
      riskLevel: "low",
      plannedAction: "candidate_block_version",
      requiredChecks: ["verify_root_stability"],
      readiness: "ready_for_manual_review",
      riskAssessment: {
        level: "low",
        score: 12,
        reasons: ["version is far beyond the grace window"],
      },
    });
  });
});
