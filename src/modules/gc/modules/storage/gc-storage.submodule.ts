import { Injectable } from "@nestjs/common";
import type {
  GcSubmoduleDefinition,
  GcSubmoduleDescriptor,
} from "../../contracts/gc-submodule.interface";

@Injectable()
export class GcStorageSubmodule implements GcSubmoduleDefinition {
  describe(): GcSubmoduleDescriptor {
    return {
      key: "storage_gc",
      displayName: "Storage Maintenance GC",
      parentKey: null,
      routePrefix: "/admin/gc/storage",
      capabilities: {
        maintenance: true,
      },
    };
  }
}
