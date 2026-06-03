import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const MAX_GC_SWEEP_LIMIT = 10_000;

export class CreateBlockVersionGcSweepDto {
  @ApiPropertyOptional({ description: "Scope sweep to one workspace" })
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional({ description: "Scope sweep to one document" })
  @IsOptional()
  @IsString()
  docId?: string;

  @ApiPropertyOptional({
    description: `Maximum number of pool candidates to process (hard-capped at ${MAX_GC_SWEEP_LIMIT})`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_GC_SWEEP_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: "Validate and plan only, without mutating GC targets" })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
