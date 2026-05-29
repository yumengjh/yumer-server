# GC Sweep Phase 1 Implementation Plan

<!-- cspell:words agentic explainability -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first real GC sweep path for tombstone map compaction, while keeping ordinary block-version deletion out of scope.

**Architecture:** Reuse the existing GC preview and explainability model, but add an explicit sweep gate and execution service that only accepts `compact_map_entry` candidates after fresh revalidation. The sweep flow should be idempotent, auditable, and scoped to `document_drafts` / `doc_snapshots` map cleanup, not `block_versions` physical deletion.

**Tech Stack:** NestJS 11, TypeORM 0.3, Jest, TypeScript.

---

## File Structure

Create:

- `src/modules/gc/gc-sweep.service.ts`: sweep orchestration and execution gate.
- `src/modules/gc/gc-sweep.service.spec.ts`: sweep gate and execution tests.
- `src/modules/gc/dto/create-block-version-gc-sweep.dto.ts`: sweep request DTO.

Modify:

- `src/modules/gc/gc.types.ts`: add sweep request/result types and sweep status enums.
- `src/modules/gc/gc-policy.service.ts`: expose sweep eligibility rules for tombstone compaction.
- `src/modules/gc/gc-run.service.ts`: store sweep linkage on run records when a preview is promoted to sweep.
- `src/modules/gc/gc.controller.ts`: add internal sweep endpoints.
- `src/modules/gc/block-version-gc.collector.ts`: keep `compact_map_entry` candidate facts stable for promotion.
- `src/modules/gc/gc-run.service.spec.ts`: add sweep-linkage coverage.
- `src/modules/gc/gc-policy.service.spec.ts`: add eligibility regression tests.
- `src/modules/gc/gc.controller.spec.ts`: add sweep endpoint coverage.

Do not modify:

- `src/entities/gc-run-candidate.entity.ts`
- `src/database/migrations/**`
- ordinary `block_versions` physical deletion code paths

---

### Task 1: Define Sweep Contracts And Eligibility

**Files:**

- Modify: `src/modules/gc/gc.types.ts`
- Modify: `src/modules/gc/gc-policy.service.ts`
- Test: `src/modules/gc/gc-policy.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { GcPolicyService } from "./gc-policy.service";

describe("GcPolicyService sweep eligibility", () => {
  it("only allows tombstone map compaction when the candidate is old enough and no root revalidation fails", () => {
    const service = new GcPolicyService();

    const result = service.assessSweepEligibility({
      reasonCode: "deleted_tombstone_map_entry",
      plannedAction: "compact_map_entry",
      riskLevel: "low",
      rootKind: "tombstone",
      deleted: true,
      rootSourceCount: 1,
      ageMs: 86_400_000,
      gracePeriodMs: 10_000,
      tombstoneGracePeriodMs: 10_000,
      keepLatestPerBlock: 0,
      decisionPath: ["tombstone_root", "old_enough_for_compaction"],
    });

    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/gc/gc-policy.service.spec.ts`
Expected: fail because `assessSweepEligibility` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add a sweep eligibility model that returns:

```ts
type GcSweepEligibility = {
  eligible: boolean;
  blockers: string[];
  targetAction: "compact_map_entry";
};
```

The first phase only accepts `deleted_tombstone_map_entry` candidates.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/gc/gc-policy.service.spec.ts`
Expected: PASS.

---

### Task 2: Add Tombstone Compaction Sweep Service

**Files:**

- Create: `src/modules/gc/gc-sweep.service.ts`
- Create: `src/modules/gc/dto/create-block-version-gc-sweep.dto.ts`
- Modify: `src/modules/gc/gc.types.ts`
- Test: `src/modules/gc/gc-sweep.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("sweep requires a fresh eligibility check before compacting tombstone map entries", async () => {
  const service = new GcSweepService(
    {} as unknown as GcRunService,
    {} as unknown as Repository<GcRunCandidate>,
    {} as unknown as GcPolicyService,
    {} as unknown as BlockVersionGcCollector,
  );

  await expect(
    service.sweepBlockVersions({
      runId: "gc_run_1",
      candidateIds: [1],
      mode: "tombstone_map_compaction",
    }),
  ).resolves.toMatchObject({
    status: "completed",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/gc/gc-sweep.service.spec.ts`
Expected: fail because the service does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement a sweep service that:

- reloads the run and candidates
- rechecks eligibility using current policy and current root state
- only executes `compact_map_entry`
- records sweep result status and blocker reasons

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/gc/gc-sweep.service.spec.ts`
Expected: PASS.

---

### Task 3: Expose Internal Sweep Endpoints

**Files:**

- Modify: `src/modules/gc/gc.controller.ts`
- Modify: `src/modules/gc/gc.controller.spec.ts`
- Modify: `src/modules/gc/gc.module.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(
  controller.sweepBlockVersions({ runId: "gc_run_1", candidateIds: [1] }),
).resolves.toMatchObject({
  status: "completed",
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/gc/gc.controller.spec.ts`
Expected: fail because sweep endpoint is not present yet.

- [ ] **Step 3: Write minimal implementation**

Add an internal admin endpoint for sweep execution, protected by `SystemAdminTokenGuard`, and wire the controller through `GcSweepService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/gc/gc.controller.spec.ts`
Expected: PASS.

---

### Task 4: Link Preview Runs To Sweep

**Files:**

- Modify: `src/modules/gc/gc-run.service.ts`
- Modify: `src/modules/gc/gc-run.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(run.sweepStatus).toBe("not_started");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/gc/gc-run.service.spec.ts`
Expected: fail because sweep metadata is not tracked yet.

- [ ] **Step 3: Write minimal implementation**

Add sweep linkage fields to run records so preview and sweep can be correlated without mutating the existing candidate storage model.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/gc/gc-run.service.spec.ts`
Expected: PASS.

---

### Task 5: Validate The Sweep Boundary

**Files:**

- Modify: none
- Test: `src/modules/gc/*.spec.ts`

- [ ] **Step 1: Run the targeted GC suite**

Run: `pnpm test -- src/modules/gc/block-version-gc.collector.spec.ts src/modules/gc/gc-policy.service.spec.ts src/modules/gc/gc-run.service.spec.ts src/modules/gc/gc-sweep.service.spec.ts src/modules/gc/gc.controller.spec.ts`

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm exec eslint src/modules/gc/**/*.ts`
Run: `pnpm exec tsc --noEmit`

Expected: sweep code compiles cleanly, and the phase stays scoped to tombstone map compaction only.
