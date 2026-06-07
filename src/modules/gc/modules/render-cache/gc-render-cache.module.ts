import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SystemAdminTokenGuard } from "../../../../common/guards/system-admin-token.guard";
import { BlockRenderCache } from "../../../../entities/block-render-cache.entity";
import { BlockVersion } from "../../../../entities/block-version.entity";
import { DocSnapshot } from "../../../../entities/doc-snapshot.entity";
import { Document } from "../../../../entities/document.entity";
import { GcRun } from "../../../../entities/gc-run.entity";
import { GcRenderCacheController } from "./gc-render-cache.controller";
import { GcRenderCacheService } from "./gc-render-cache.service";
import { GcRenderCacheSubmodule } from "./gc-render-cache.submodule";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BlockRenderCache,
      BlockVersion,
      Document,
      DocSnapshot,
      GcRun,
    ]),
  ],
  controllers: [GcRenderCacheController],
  providers: [
    SystemAdminTokenGuard,
    GcRenderCacheService,
    GcRenderCacheSubmodule,
  ],
  exports: [GcRenderCacheService, GcRenderCacheSubmodule],
})
export class GcRenderCacheModule {}
