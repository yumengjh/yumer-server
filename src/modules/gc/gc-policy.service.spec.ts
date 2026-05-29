import { GcPolicyService } from "./gc-policy.service";

describe("GcPolicyService", () => {
  it("returns current default policy for block version preview", () => {
    const service = new GcPolicyService();

    expect(service.getBlockVersionPolicy()).toEqual({
      gracePeriodMs: 10_000,
      tombstoneGracePeriodMs: 10_000,
      keepLatestPerBlock: 0,
      maxCandidatesToStore: 1000,
      rootSources: ["doc_snapshots", "document_drafts"],
    });
  });

  it("explains why a tombstone compaction candidate is low risk", () => {
    const service = new GcPolicyService();

    const result = service.assessBlockVersionCandidate({
      reasonCode: "deleted_tombstone_map_entry",
      rootKind: "tombstone",
      deleted: true,
      source: "doc_snapshots",
      action: "compact_map_entry",
      hardRooted: true,
      retainedByPolicy: false,
      versionCreatedAt: Date.now() - 86_400_000,
      ageMs: 86_400_000,
      ageBucket: "stable",
      rootSourceCount: 1,
      distanceFromLatestVer: 3,
      gracePeriodMs: 10_000,
      tombstoneGracePeriodMs: 10_000,
      keepLatestPerBlock: 1,
      decisionPath: ["tombstone_root", "old_enough_for_compaction"],
    });

    expect(result.riskAssessment.level).toBe("low");
    expect(result.plannedAction).toBe("compact_map_entry");
    expect(result.requiredChecks).toContain("verify_root_stability");
    expect(result.readiness).toBe("ready_for_manual_review");
    expect(result.riskAssessment.reasons).toContain("tombstone root is old enough to compact");
  });
});
