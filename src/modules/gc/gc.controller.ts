import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { SystemAdminTokenGuard } from "../../common/guards/system-admin-token.guard";
import { CreateBlockVersionGcSweepDto } from "./dto/create-block-version-gc-sweep.dto";
import { CreateBlockVersionGcRunDto } from "./dto/create-block-version-gc-run.dto";
import { QueryGcCandidatesDto } from "./dto/query-gc-candidates.dto";
import { QueryGcPoolDto } from "./dto/query-gc-pool.dto";
import { QueryGcRunsDto } from "./dto/query-gc-runs.dto";
import { GcHealthService } from "./gc-health.service";
import { GcRunService } from "./gc-run.service";
import { GcSweepService } from "./gc-sweep.service";

@ApiTags("gc")
@ApiHeader({
  name: "x-system-admin-token",
  description: "System admin token for internal GC APIs",
  required: true,
})
@Controller("admin/gc/block-versions")
@SkipThrottle()
@UseGuards(SystemAdminTokenGuard)
export class GcController {
  constructor(
    private readonly gcRunService: GcRunService,
    private readonly gcHealthService: GcHealthService,
    private readonly gcSweepService: GcSweepService,
  ) {}

  @Post("runs")
  @ApiOperation({ summary: "Create a block version GC preview run" })
  @ApiResponse({ status: 201, description: "Preview run created" })
  createBlockVersionRun(@Body() body: CreateBlockVersionGcRunDto, @Req() request: Request) {
    return this.gcRunService.previewBlockVersions(body, this.resolveOperator(request));
  }

  @Get("runs")
  @ApiOperation({ summary: "List block version GC preview runs" })
  findBlockVersionRuns(@Query() query: QueryGcRunsDto) {
    return this.gcRunService.findRuns(query);
  }

  @Get("runs/:runId")
  @ApiOperation({ summary: "Get a block version GC preview run" })
  findBlockVersionRun(@Param("runId") runId: string) {
    return this.gcRunService.findRun(runId);
  }

  @Get("runs/:runId/candidates")
  @ApiOperation({ summary: "List candidates saved for a preview run" })
  findBlockVersionCandidates(@Param("runId") runId: string, @Query() query: QueryGcCandidatesDto) {
    return this.gcRunService.findCandidates(runId, query);
  }

  @Get("pool")
  @ApiOperation({ summary: "List current block version GC candidate pool entries" })
  findBlockVersionCandidatePool(@Query() query: QueryGcPoolDto) {
    return this.gcRunService.findPool(query);
  }

  @Post("sweeps/draft-tombstones")
  @ApiOperation({ summary: "Sweep eligible document draft tombstone map entries" })
  @ApiResponse({ status: 201, description: "Draft tombstone sweep executed" })
  sweepDraftTombstones(@Body() body: CreateBlockVersionGcSweepDto, @Req() request: Request) {
    return this.gcSweepService.sweepDraftTombstones(body, this.resolveOperator(request));
  }

  @Get("health")
  @ApiOperation({ summary: "Check block version GC health for a scope" })
  getBlockVersionHealth(@Query() query: QueryGcRunsDto) {
    return this.gcHealthService.checkBlockVersionGcHealth({
      workspaceId: query.workspaceId,
      docId: query.docId,
    });
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
