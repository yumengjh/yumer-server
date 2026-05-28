import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, ValidateNested } from "class-validator";

export class LastEditPositionDto {
  @ApiPropertyOptional()
  @IsString()
  blockId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  previousBlockId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  nextBlockId?: string | null;

  @ApiPropertyOptional()
  @IsISO8601()
  updatedAt: string;
}

class EditorStatePayloadDto {
  @ApiPropertyOptional({ type: LastEditPositionDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LastEditPositionDto)
  lastEditPosition?: LastEditPositionDto | null;
}

export class UpdateEditorStateDto {
  @ApiPropertyOptional({ type: EditorStatePayloadDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => EditorStatePayloadDto)
  editorState?: EditorStatePayloadDto | null;
}
