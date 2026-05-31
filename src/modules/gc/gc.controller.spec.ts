import type { Request } from "express";
import { GcController } from "./gc.controller";
import type { GcHealthService } from "./gc-health.service";
import type { GcPolicyService } from "./gc-policy.service";
import type { GcRunService } from "./gc-run.service";
import type { GcSweepService } from "./gc-sweep.service";

describe("GcController", () => {
  it("creates a block version preview run with operator from header", async () => {
    const gcRunService = {
      previewBlockVersions: jest.fn().mockResolvedValue({ runId: "gc_run_1" }),
    } as unknown as GcRunService;
    const controller = new GcController(
      gcRunService,
      {
        checkBlockVersionGcHealth: jest.fn(),
      } as unknown as GcHealthService,
      {
        sweepDraftTombstones: jest.fn(),
        sweepRevisionTombstones: jest.fn(),
      } as unknown as GcSweepService,
      { getBlockVersionPolicy: jest.fn() } as unknown as GcPolicyService,
    );

    await expect(
      controller.createBlockVersionRun({ docId: "doc_1", includeCandidates: true }, {
        headers: { "x-operator-id": "admin_1" },
        ip: "127.0.0.1",
      } as unknown as Request),
    ).resolves.toEqual({ runId: "gc_run_1" });

    expect(gcRunService.previewBlockVersions).toHaveBeenCalledWith(
      { docId: "doc_1", includeCandidates: true },
      "admin_1",
    );
  });

  it("exposes current block version health", async () => {
    const health = { status: "ok" };
    const controller = new GcController(
      { previewBlockVersions: jest.fn() } as unknown as GcRunService,
      {
        checkBlockVersionGcHealth: jest.fn().mockResolvedValue(health),
      } as unknown as GcHealthService,
      {
        sweepDraftTombstones: jest.fn(),
        sweepRevisionTombstones: jest.fn(),
      } as unknown as GcSweepService,
      { getBlockVersionPolicy: jest.fn() } as unknown as GcPolicyService,
    );

    await expect(controller.getBlockVersionHealth({ docId: "doc_1" })).resolves.toBe(health);
  });

  it("lists runs with mode and scope filters", async () => {
    const gcRunService = {
      previewBlockVersions: jest.fn(),
      findRuns: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    } as unknown as GcRunService;
    const controller = new GcController(
      gcRunService,
      {
        checkBlockVersionGcHealth: jest.fn(),
      } as unknown as GcHealthService,
      {
        sweepDraftTombstones: jest.fn(),
        sweepRevisionTombstones: jest.fn(),
      } as unknown as GcSweepService,
      { getBlockVersionPolicy: jest.fn() } as unknown as GcPolicyService,
    );

    await expect(
      controller.findBlockVersionRuns({
        mode: "sweep",
        workspaceId: "ws_1",
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });

    expect(gcRunService.findRuns).toHaveBeenCalledWith({
      mode: "sweep",
      workspaceId: "ws_1",
      page: 1,
      pageSize: 20,
    });
  });

  it("exposes the current block version GC policy", () => {
    const policy = {
      gracePeriodMs: 10_000,
      tombstoneGracePeriodMs: 10_000,
      promotionDelayMs: 10_000,
      stableSeenThreshold: 2,
      maxSweepBatchSize: 100,
    };
    const gcPolicyService = {
      getBlockVersionPolicy: jest.fn().mockReturnValue(policy),
    } as unknown as GcPolicyService;
    const controller = new GcController(
      { previewBlockVersions: jest.fn(), findPool: jest.fn() } as unknown as GcRunService,
      {
        checkBlockVersionGcHealth: jest.fn(),
      } as unknown as GcHealthService,
      {
        sweepDraftTombstones: jest.fn(),
        sweepRevisionTombstones: jest.fn(),
      } as unknown as GcSweepService,
      gcPolicyService,
    );

    expect(controller.findBlockVersionPolicy()).toBe(policy);
    expect(gcPolicyService.getBlockVersionPolicy).toHaveBeenCalledTimes(1);
  });

  it("lists candidate pool entries", async () => {
    const gcRunService = {
      previewBlockVersions: jest.fn(),
      findPool: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    } as unknown as GcRunService;
    const controller = new GcController(
      gcRunService,
      {
        checkBlockVersionGcHealth: jest.fn(),
      } as unknown as GcHealthService,
      {
        sweepDraftTombstones: jest.fn(),
        sweepRevisionTombstones: jest.fn(),
      } as unknown as GcSweepService,
      { getBlockVersionPolicy: jest.fn() } as unknown as GcPolicyService,
    );

    await expect(
      controller.findBlockVersionCandidatePool({ state: "eligible", page: 1, pageSize: 20 }),
    ).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });

    expect(gcRunService.findPool).toHaveBeenCalledWith({
      state: "eligible",
      page: 1,
      pageSize: 20,
    });
  });

  it("sweeps eligible draft tombstone entries with operator from header", async () => {
    const gcSweepService = {
      sweepDraftTombstones: jest.fn().mockResolvedValue({ runId: "gc_sweep_1" }),
    } as unknown as GcSweepService;
    const controller = new GcController(
      { previewBlockVersions: jest.fn(), findPool: jest.fn() } as unknown as GcRunService,
      { checkBlockVersionGcHealth: jest.fn() } as unknown as GcHealthService,
      gcSweepService,
      { getBlockVersionPolicy: jest.fn() } as unknown as GcPolicyService,
    );

    await expect(
      controller.sweepDraftTombstones({ workspaceId: "ws_1", dryRun: true }, {
        headers: { "x-operator-id": "admin_2" },
        ip: "127.0.0.1",
      } as unknown as Request),
    ).resolves.toEqual({ runId: "gc_sweep_1" });

    expect(gcSweepService.sweepDraftTombstones).toHaveBeenCalledWith(
      { workspaceId: "ws_1", dryRun: true },
      "admin_2",
    );
  });

  it("sweeps eligible revision tombstone entries with operator from header", async () => {
    const gcSweepService = {
      sweepDraftTombstones: jest.fn(),
      sweepRevisionTombstones: jest.fn().mockResolvedValue({ runId: "gc_sweep_2" }),
    } as unknown as GcSweepService;
    const controller = new GcController(
      { previewBlockVersions: jest.fn(), findPool: jest.fn() } as unknown as GcRunService,
      { checkBlockVersionGcHealth: jest.fn() } as unknown as GcHealthService,
      gcSweepService,
      { getBlockVersionPolicy: jest.fn() } as unknown as GcPolicyService,
    );

    await expect(
      controller.sweepRevisionTombstones({ docId: "doc_2", dryRun: true }, {
        headers: { "x-operator-id": "admin_3" },
        ip: "127.0.0.1",
      } as unknown as Request),
    ).resolves.toEqual({ runId: "gc_sweep_2" });

    expect(gcSweepService.sweepRevisionTombstones).toHaveBeenCalledWith(
      { docId: "doc_2", dryRun: true },
      "admin_3",
    );
  });
});
