import { GcPolicyService } from "./gc-policy.service";

describe("GcPolicyService", () => {
  it("returns conservative default policy for block version preview", () => {
    const service = new GcPolicyService();

    expect(service.getBlockVersionPolicy()).toEqual({
      gracePeriodMs: 10_000,
      tombstoneGracePeriodMs: 10_000,
      keepLatestPerBlock: 1,
      maxCandidatesToStore: 1000,
      rootSources: ["doc_snapshots", "document_drafts"],
    });
  });
});
