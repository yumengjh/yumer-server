import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import { PaginationDto } from "../../../common/dto/pagination.dto";

export class QueryGcPoolDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ["pending", "eligible", "sweeping", "swept", "resurrected", "blocked"],
  })
  @IsOptional()
  @IsIn(["pending", "eligible", "sweeping", "swept", "resurrected", "blocked"])
  state?: string;

  @ApiPropertyOptional({ enum: ["candidate_block_version", "compact_map_entry"] })
  @IsOptional()
  @IsIn(["candidate_block_version", "compact_map_entry"])
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docId?: string;
}
