import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CreateBlockVersionGcRunDto {
  @ApiPropertyOptional({ description: "Scope preview to one workspace" })
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional({ description: "Scope preview to one document" })
  @IsOptional()
  @IsString()
  docId?: string;

  @ApiPropertyOptional({ description: "Persist candidate details for this preview run" })
  @IsOptional()
  @IsBoolean()
  includeCandidates?: boolean;
}
