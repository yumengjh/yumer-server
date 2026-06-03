import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { SystemAdminTokenGuard } from "../../common/guards/system-admin-token.guard";
import { GcRegistryService } from "./gc-registry.service";

@ApiTags("gc")
@ApiHeader({
  name: "x-system-admin-token",
  description: "System admin token for internal GC APIs",
  required: true,
})
@Controller("admin/gc")
@SkipThrottle()
@UseGuards(SystemAdminTokenGuard)
export class GcModulesController {
  constructor(private readonly gcRegistryService: GcRegistryService) {}

  @Get("modules")
  @ApiOperation({ summary: "List registered GC modules and their hierarchy" })
  listModules() {
    return this.gcRegistryService.listModules();
  }
}
