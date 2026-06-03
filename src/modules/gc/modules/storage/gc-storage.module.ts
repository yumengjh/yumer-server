import { Module } from "@nestjs/common";
import { SystemAdminTokenGuard } from "../../../../common/guards/system-admin-token.guard";
import { GcStorageController } from "./gc-storage.controller";
import { GcStorageMaintenanceService } from "./gc-storage-maintenance.service";
import { GcStorageSubmodule } from "./gc-storage.submodule";

@Module({
  controllers: [GcStorageController],
  providers: [SystemAdminTokenGuard, GcStorageMaintenanceService, GcStorageSubmodule],
  exports: [GcStorageMaintenanceService, GcStorageSubmodule],
})
export class GcStorageModule {}
