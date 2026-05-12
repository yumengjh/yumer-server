import { IsString, IsOptional, IsObject, IsNumber, Min, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBlockDto {
  @ApiProperty({ description: '文档ID', example: 'doc_1234567890_abc123' })
  @IsString()
  docId: string;

  @ApiProperty({ description: '块类型', example: 'paragraph' })
  @IsString()
  type: string;

  @ApiProperty({ description: '块内容（JSON格式）', example: { text: '块内容' } })
  @IsObject()
  payload: object;

  @ApiPropertyOptional({ description: '父块ID（根块为空）', example: 'b_1234567890_abc123' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: '排序键', example: '0' })
  @IsOptional()
  @IsString()
  sortKey?: string;

  @ApiPropertyOptional({ description: '缩进级别', example: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  indent?: number;

  @ApiPropertyOptional({ description: '是否折叠', example: false, default: false })
  @IsOptional()
  collapsed?: boolean;

  @ApiPropertyOptional({
    description: '是否立即创建文档版本',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createVersion?: boolean;
}
