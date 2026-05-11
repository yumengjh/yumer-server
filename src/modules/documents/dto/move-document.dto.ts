import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MoveDocumentDto {
  @ApiPropertyOptional({
    description: '目标父文档ID（null 表示移动到根目录）',
    example: 'doc_1234567890_abc123',
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ description: '排序顺序', example: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
