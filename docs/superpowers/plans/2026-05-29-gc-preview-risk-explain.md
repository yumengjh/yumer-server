# GC Preview Risk Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade block version GC preview candidates from coarse risk labels into explainable, policy-driven candidate records with backward-compatible debug responses.

**Architecture:** Keep `reasonDetail` as the persisted facts layer, move risk evaluation into `GcPolicyService`, and project a separate explanation layer in the debug API without adding database columns. Collector output and run-query output should both be derivable from the same policy rules so preview and inspection stay consistent.

**Tech Stack:** NestJS 11, TypeORM 0.3, Jest, TypeScript.

---

## File Structure

Create:

Modify:

- `src/modules/gc/gc.types.ts`: add candidate facts, explanation, and risk-assessment types.
- `src/modules/gc/gc-policy.service.ts`: add explainable block-version candidate evaluation rules.
- `src/modules/gc/block-version-gc.collector.ts`: populate stable facts and use policy-driven risk results.
- `src/modules/gc/gc-run.service.ts`: project debug-only explanation fields for saved candidates.
- `src/modules/gc/gc-policy.service.spec.ts`: policy evaluation tests.
- `src/modules/gc/block-version-gc.collector.spec.ts`: candidate facts and risk-level tests.
- `src/modules/gc/gc-run.service.spec.ts`: response projection tests.

Do not modify:

- `src/entities/gc-run-candidate.entity.ts`
- `src/database/migrations/**`

---

### Task 1: Define Explainability Types And Policy Scoring

**Files:**

- Modify: `src/modules/gc/gc.types.ts`
- Modify: `src/modules/gc/gc-policy.service.ts`
- Test: `src/modules/gc/gc-policy.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { GcPolicyService } from "./gc-policy.service";

describe("GcPolicyService explainability", () => {
  it("classifies a tombstone compaction candidate as low risk with a compact_map_entry plan", () => {
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
      gracePeriodMs: 10_000,
      tombstoneGracePeriodMs: 10_000,
      keepLatestPerBlock: 1,
    });

    expect(result.riskAssessment.level).toBe("low");
    expect(result.plannedAction).toBe("compact_map_entry");
    expect(result.requiredChecks).toContain("verify_root_stability");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/gc/gc-policy.service.spec.ts`
Expected: fail because `assessBlockVersionCandidate` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add types and a policy method that accepts stable candidate facts and returns:

```ts
type GcCandidateExplainability = {
  riskAssessment: {
    level: "low" | "medium" | "high";
    score: number;
    reasons: string[];
    factors: Array<{ code: string; weight: number; detail: Record<string, unknown> }>;
  };
  plannedAction: "candidate_block_version" | "compact_map_entry";
  requiredChecks: string[];
  readiness: "ready_for_manual_review" | "needs_more_validation";
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/gc/gc-policy.service.spec.ts`
Expected: PASS.

---

### Task 2: Thread Stable Facts Through Collector Output

**Files:**

- Modify: `src/modules/gc/block-version-gc.collector.ts`
- Modify: `src/modules/gc/gc.types.ts`
- Test: `src/modules/gc/block-version-gc.collector.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(result.candidates[0]).toMatchObject({
  reasonCode: "deleted_tombstone_map_entry",
  reasonDetail: {
    rootKind: "tombstone",
    deleted: true,
    source: "doc_snapshots",
    action: "compact_map_entry",
    ageMs: expect.any(Number),
    ageBucket: "stable",
    rootSourceCount: 1,
  },
  riskLevel: "low",
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/gc/block-version-gc.collector.spec.ts`
Expected: fail because stable facts and explainability fields are not yet populated.

- [ ] **Step 3: Write minimal implementation**

Update the collector so it:

- computes stable preview-time facts once per candidate
- stores those facts in `reasonDetail`
- asks `GcPolicyService` for `riskAssessment`, `plannedAction`, `requiredChecks`, and `readiness`
- keeps persisted columns unchanged

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/gc/block-version-gc.collector.spec.ts`
Expected: PASS.

---

### Task 3: Project Debug-Only Explanation Fields In Candidate Listing

**Files:**

- Modify: `src/modules/gc/gc-run.service.ts`
- Test: `src/modules/gc/gc-run.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
const result = await service.findCandidates("gc_run_1", { page: 1, pageSize: 20 });

expect(result.items[0]).toMatchObject({
  reasonCode: "unreferenced_older_than_policy",
  riskLevel: "medium",
  plannedAction: "candidate_block_version",
  requiredChecks: ["verify_root_stability"],
  riskAssessment: {
    level: "medium",
    score: expect.any(Number),
    reasons: expect.any(Array),
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/gc/gc-run.service.spec.ts`
Expected: fail because `findCandidates` still returns raw entities only.

- [ ] **Step 3: Write minimal implementation**

Load the run’s stored policy snapshot, then map each candidate into a debug response that keeps all existing entity fields and adds:

- `riskAssessment`
- `plannedAction`
- `requiredChecks`
- `readiness`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/gc/gc-run.service.spec.ts`
Expected: PASS.

---

### Task 4: Full GC Regression Check

**Files:**

- Modify: none
- Test: `src/modules/gc/*.spec.ts`

- [ ] **Step 1: Run the targeted GC suite**

Run: `pnpm test -- src/modules/gc/block-version-gc.collector.spec.ts src/modules/gc/gc-policy.service.spec.ts src/modules/gc/gc-run.service.spec.ts`

- [ ] **Step 2: Run the broader repo checks if the targeted suite is green**

Run: `pnpm lint`
Run: `pnpm typecheck`

Expected: no GC regressions and no type errors introduced by the new explainability layer.
