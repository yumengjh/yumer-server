import { Injectable } from "@nestjs/common";
import type {
  GcSubmoduleDefinition,
  GcSubmoduleDescriptor,
} from "../../contracts/gc-submodule.interface";

@Injectable()
export class GcRenderCacheSubmodule implements GcSubmoduleDefinition {
  describe(): GcSubmoduleDescriptor {
    return {
      key: "render_cache_gc",
      displayName: "Render Cache GC",
      parentKey: null,
      routePrefix: "/admin/gc/render-cache",
      capabilities: {
        sweep: true,
        dryRun: true,
        publishedReachability: true,
      },
    };
  }
}
