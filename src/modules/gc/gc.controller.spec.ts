import type { Request } from "express";
import { GcController } from "./gc.controller";
import type { GcHealthService } from "./gc-health.service";
import type { GcRunService } from "./gc-run.service";

describe("GcController", () => {
  it("creates a block version preview run with operator from header", async () => {
    const gcRunService = {
      previewBlockVersions: jest.fn().mockResolvedValue({ runId: "gc_run_1" }),
    } as unknown as GcRunService;
    const controller = new GcController(
      gcRunService,
      { checkBlockVersionGcHealth: jest.fn() } as unknown as GcHealthService,
    );

    await expect(
      controller.createBlockVersionRun(
        { docId: "doc_1", includeCandidates: true },
        {
          headers: { "x-operator-id": "admin_1" },
          ip: "127.0.0.1",
        } as unknown as Request,
      ),
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
      { checkBlockVersionGcHealth: jest.fn().mockResolvedValue(health) } as unknown as GcHealthService,
    );

    await expect(controller.getBlockVersionHealth({ docId: "doc_1" })).resolves.toBe(health);
  });
});
