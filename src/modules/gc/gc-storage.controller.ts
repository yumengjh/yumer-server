import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { SystemAdminTokenGuard } from "../../common/guards/system-admin-token.guard";
import { CreateStorageCompactDto } from "./dto/create-storage-compact.dto";
import { GcStorageMaintenanceService } from "./gc-storage-maintenance.service";

@ApiTags("gc")
@ApiHeader({
  name: "x-system-admin-token",
  description: "System admin token for internal GC APIs",
  required: true,
})
@Controller("admin/gc/storage")
@SkipThrottle()
@UseGuards(SystemAdminTokenGuard)
export class GcStorageController {
  constructor(private readonly storageMaintenanceService: GcStorageMaintenanceService) {}

  @Post("compact")
  @ApiOperation({ summary: "Run or plan SQLite storage compaction" })
  @ApiResponse({ status: 201, description: "Storage compaction planned or executed" })
  compactStorage(@Body() body: CreateStorageCompactDto, @Req() request: Request) {
    return this.storageMaintenanceService.compact(body, this.resolveOperator(request));
  }

  private resolveOperator(request: Request): string {
    const operatorHeader = request.headers["x-operator-id"];
    const operator = Array.isArray(operatorHeader) ? operatorHeader[0] : operatorHeader;

    if (operator && operator.trim().length > 0) {
      return operator.trim().slice(0, 64);
    }

    return request.ip || "system_admin";
  }
}
