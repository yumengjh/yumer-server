import { GcRegistryService } from "./gc-registry.service";
import { BlockVersionGcSubmodule } from "./modules/block-version/block-version-gc.submodule";
import { GcStorageSubmodule } from "./modules/storage/gc-storage.submodule";

describe("GcRegistryService", () => {
  it("lists registered GC submodules and builds a tree", () => {
    const service = new GcRegistryService(
      new BlockVersionGcSubmodule(),
      new GcStorageSubmodule(),
    );

    expect(service.listModules()).toEqual({
      items: [
        {
          key: "block_version_gc",
          displayName: "Block Version GC",
          parentKey: null,
          routePrefix: "/admin/gc/block-versions",
          capabilities: {
            health: true,
            preview: true,
            sweep: true,
            policy: true,
            candidates: true,
            pool: true,
          },
        },
        {
          key: "storage_gc",
          displayName: "Storage Maintenance GC",
          parentKey: null,
          routePrefix: "/admin/gc/storage",
          capabilities: {
            maintenance: true,
          },
        },
      ],
      tree: [
        {
          key: "block_version_gc",
          displayName: "Block Version GC",
          parentKey: null,
          routePrefix: "/admin/gc/block-versions",
          capabilities: {
            health: true,
            preview: true,
            sweep: true,
            policy: true,
            candidates: true,
            pool: true,
          },
          children: [],
        },
        {
          key: "storage_gc",
          displayName: "Storage Maintenance GC",
          parentKey: null,
          routePrefix: "/admin/gc/storage",
          capabilities: {
            maintenance: true,
          },
          children: [],
        },
      ],
    });
  });
});
