import type { Repository } from "typeorm";
import { GcRun } from "../../entities/gc-run.entity";
import { GcRunCandidate } from "../../entities/gc-run-candidate.entity";
import type { BlockVersionGcCollector } from "./block-version-gc.collector";
import type { GcHealthService } from "./gc-health.service";
import type { GcPolicyService } from "./gc-policy.service";
import { GcRunService } from "./gc-run.service";

function repository<T>(overrides: Partial<Record<keyof Repository<T>, jest.Mock>>) {
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
});
