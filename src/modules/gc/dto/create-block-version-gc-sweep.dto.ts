import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateBlockVersionGcSweepDto {
  @ApiPropertyOptional({ description: "Scope sweep to one workspace" })
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional({ description: "Scope sweep to one document" })
  @IsOptional()
  @IsString()
  docId?: string;

  @ApiPropertyOptional({ description: "Maximum number of pool candidates to process" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: "Validate and plan only, without mutating draft maps" })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
