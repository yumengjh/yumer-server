import { IsIn, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { DELTA_FORMAT } from "../block-delta";

export class BlockDeltaDto {
  @ApiProperty({ description: "Delta 格式", example: DELTA_FORMAT })
  @IsString()
  @IsIn([DELTA_FORMAT])
  format: typeof DELTA_FORMAT;

  @ApiProperty({ description: "基准块版本号", example: 3 })
  @IsNumber()
  baseVer: number;

  @ApiProperty({ description: "基准 canonical payload 的 SHA256", example: "abc123" })
  @IsString()
  baseHash: string;

  @ApiProperty({ description: "diff-match-patch 文本补丁" })
  @IsString()
  patch: string;

  @ApiProperty({ description: "重建后 canonical payload 的 SHA256", example: "def456" })
  @IsString()
  resultHash: string;
}
