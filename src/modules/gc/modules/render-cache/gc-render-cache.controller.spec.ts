import type { Request } from "express";
import { GcRenderCacheController } from "./gc-render-cache.controller";
import type { GcRenderCacheService } from "./gc-render-cache.service";

describe("GcRenderCacheController", () => {
  it("queries render cache status", async () => {
    const renderCacheService = {
      getStatus: jest.fn().mockResolvedValue({ renderVersion: "test" }),
      sweepPublishedReachability: jest.fn(),
    } as unknown as GcRenderCacheService;
    const controller = new GcRenderCacheController(renderCacheService);

    await expect(controller.getStatus({ docId: "doc_1" })).resolves.toEqual({
      renderVersion: "test",
    });
    expect(renderCacheService.getStatus).toHaveBeenCalledWith({
      docId: "doc_1",
    });
  });

  it("sweeps render caches with operator from header", async () => {
    const renderCacheService = {
      getStatus: jest.fn(),
      sweepPublishedReachability: jest
        .fn()
        .mockResolvedValue({ status: "completed" }),
    } as unknown as GcRenderCacheService;
    const controller = new GcRenderCacheController(renderCacheService);

    await expect(
      controller.sweep({ dryRun: true, docId: "doc_1" }, {
        headers: { "x-operator-id": "admin_1" },
        ip: "127.0.0.1",
      } as unknown as Request),
    ).resolves.toEqual({ status: "completed" });

    expect(renderCacheService.sweepPublishedReachability).toHaveBeenCalledWith(
      { dryRun: true, docId: "doc_1" },
      "admin_1",
    );
  });
});
