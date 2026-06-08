import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { DocumentStatus } from "./query-documents.dto";

export class SearchQueryDto {
  @ApiProperty({ description: "Search keyword", example: "Document title" })
  @IsString()
  @MinLength(1, { message: "Search keyword cannot be empty" })
  query: string;

  @ApiPropertyOptional({
    description: "Workspace ID to limit search scope",
    example: "ws_1234567890_abc123",
  })
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional({
    description: "Document status",
    example: "normal",
    enum: DocumentStatus,
  })
  @IsOptional()
  @IsEnum(DocumentStatus, {
    message: "status must be draft, normal, archived, or deleted",
  })
  status?: string;

  @ApiPropertyOptional({
    description: "Tag filters",
    example: ["tag_1234567890_abc123"],
  })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    description: "Page number",
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page",
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
