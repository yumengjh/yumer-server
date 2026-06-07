import { Module } from "@nestjs/common";
import { SystemAdminTokenGuard } from "../../common/guards/system-admin-token.guard";
import { GcModulesController } from "./gc-modules.controller";
import { GcRegistryService } from "./gc-registry.service";
import { BlockVersionGcModule } from "./modules/block-version/block-version-gc.module";
import { GcRenderCacheModule } from "./modules/render-cache/gc-render-cache.module";
import { GcStorageModule } from "./modules/storage/gc-storage.module";

@Module({
  imports: [BlockVersionGcModule, GcRenderCacheModule, GcStorageModule],
  controllers: [GcModulesController],
  providers: [SystemAdminTokenGuard, GcRegistryService],
  exports: [
    BlockVersionGcModule,
    GcRenderCacheModule,
    GcStorageModule,
    GcRegistryService,
  ],
})
export class GcModule {}
