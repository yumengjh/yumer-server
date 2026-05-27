import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import { PaginationDto } from "../../../common/dto/pagination.dto";

export class QueryGcRunsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ["running", "completed", "blocked", "failed"] })
  @IsOptional()
  @IsIn(["running", "completed", "blocked", "failed"])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docId?: string;
}
