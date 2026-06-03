import type { Request } from "express";
import { GcStorageController } from "./gc-storage.controller";
import type { GcStorageMaintenanceService } from "./gc-storage-maintenance.service";

describe("GcStorageController", () => {
  it("compacts storage with operator from header", async () => {
    const storageMaintenanceService = {
      compact: jest.fn().mockResolvedValue({ status: "planned" }),
    } as unknown as GcStorageMaintenanceService;
    const controller = new GcStorageController(storageMaintenanceService);

    await expect(
      controller.compactStorage({ dryRun: true, mode: "vacuum" }, {
        headers: { "x-operator-id": "admin_1" },
        ip: "127.0.0.1",
      } as unknown as Request),
    ).resolves.toEqual({ status: "planned" });

    expect(storageMaintenanceService.compact).toHaveBeenCalledWith(
      { dryRun: true, mode: "vacuum" },
      "admin_1",
    );
  });
});
