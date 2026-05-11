import { IsString, IsOptional, IsEnum, IsInt, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SearchQueryDto {
  @ApiProperty({ description: '搜索关键词', example: '文档标题' })
  @IsString()
  @MinLength(1, { message: '搜索关键词不能为空' })
  query: string;

  @ApiPropertyOptional({
    description: '工作空间ID（限制搜索范围）',
    example: 'ws_1234567890_abc123',
  })
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional({
    description: '文档状态',
    example: 'normal',
    enum: ['draft', 'normal', 'archived'],
  })
  @IsOptional()
  @IsEnum(['draft', 'normal', 'archived'], { message: '状态必须是 draft、normal 或 archived' })
  status?: string;

  @ApiPropertyOptional({ description: '标签列表（筛选）', example: ['标签1'] })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ description: '页码', example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: '每页数量',
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
