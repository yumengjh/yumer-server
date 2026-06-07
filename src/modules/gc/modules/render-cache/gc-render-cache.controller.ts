import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { SystemAdminTokenGuard } from "../../../../common/guards/system-admin-token.guard";
import { CreateRenderCacheGcSweepDto } from "./dto/create-render-cache-gc-sweep.dto";
import { QueryRenderCacheGcStatusDto } from "./dto/query-render-cache-gc-status.dto";
import { GcRenderCacheService } from "./gc-render-cache.service";

@ApiTags("gc")
@ApiHeader({
  name: "x-system-admin-token",
  description: "System admin token for internal GC APIs",
  required: true,
})
@Controller("admin/gc/render-cache")
@SkipThrottle()
@UseGuards(SystemAdminTokenGuard)
export class GcRenderCacheController {
  constructor(private readonly renderCacheService: GcRenderCacheService) {}

  @Get("status")
  @ApiOperation({
    summary: "Inspect render cache GC status by published reachability",
  })
  @ApiResponse({ status: 200, description: "Render cache status" })
  getStatus(@Query() query: QueryRenderCacheGcStatusDto) {
    return this.renderCacheService.getStatus(query);
  }

  @Post("sweep")
  @ApiOperation({
    summary: "Run or plan render cache published reachability GC",
  })
  @ApiResponse({
    status: 201,
    description: "Render cache sweep planned or executed",
  })
  sweep(@Body() body: CreateRenderCacheGcSweepDto, @Req() request: Request) {
    return this.renderCacheService.sweepPublishedReachability(
      body,
      this.resolveOperator(request),
    );
  }

  private resolveOperator(request: Request): string {
    const operatorHeader = request.headers["x-operator-id"];
    const operator = Array.isArray(operatorHeader)
      ? operatorHeader[0]
      : operatorHeader;

    if (operator && operator.trim().length > 0) {
      return operator.trim().slice(0, 64);
    }

    return request.ip || "system_admin";
  }
}
