import { Injectable } from "@nestjs/common";
import type {
  GcSubmoduleDefinition,
  GcSubmoduleDescriptor,
} from "../../contracts/gc-submodule.interface";

@Injectable()
export class BlockVersionGcSubmodule implements GcSubmoduleDefinition {
  describe(): GcSubmoduleDescriptor {
    return {
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
    };
  }
}
