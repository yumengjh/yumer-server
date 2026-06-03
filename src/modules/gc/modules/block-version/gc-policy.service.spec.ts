import { GcPolicyService } from "./gc-policy.service";

describe("GcPolicyService", () => {
  it("returns current default policy for block version preview", () => {
    const service = new GcPolicyService();

    expect(service.getBlockVersionPolicy()).toEqual({
      gracePeriodMs: 10_000,
      tombstoneGracePeriodMs: 10_000,
      keepLatestPerBlock: 0,
      promotionDelayMs: 10_000,
      stableSeenThreshold: 1,
      maxCandidatesToStore: 1000,
      maxSweepBatchSize: 1000,
      poolEntryExpireMs: 604_800_000,
      rootSources: ["doc_snapshots", "document_drafts"],
    });
  });

  it("builds direct decision output without legacy risk/readiness fields", () => {
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

    expect(result.decision).toBe("candidate");
    expect(result.candidateClass).toBe("deleted_tombstone_map_entry");
    expect(result.decisionReasons).toContain("墓碑 root 已经足够老，可以压缩 map 引用");
    expect(result).not.toHaveProperty("riskAssessment");
    expect(result).not.toHaveProperty("plannedAction");
    expect(result).not.toHaveProperty("requiredChecks");
    expect(result).not.toHaveProperty("readiness");
  });
});
