import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  MinLength,
  IsArray,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AdvancedSearchDto {
  @ApiProperty({ description: '搜索关键词', example: '关键词' })
  @IsString()
  @MinLength(1, { message: '搜索关键词不能为空' })
  query: string;

  @ApiPropertyOptional({ description: '工作空间ID' })
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional({ description: '搜索类型', enum: ['doc', 'block', 'all'] })
  @IsOptional()
  @IsIn(['doc', 'block', 'all'])
  type?: 'doc' | 'block' | 'all' = 'all';

  @ApiPropertyOptional({ description: '标签筛选', example: ['标签1'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '开始日期（ISO）', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期（ISO）', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: '创建者 userId' })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({
    description: '排序字段',
    enum: ['rank', 'updatedAt', 'createdAt'],
    default: 'rank',
  })
  @IsOptional()
  @IsIn(['rank', 'updatedAt', 'createdAt'])
  sortBy?: 'rank' | 'updatedAt' | 'createdAt' = 'rank';

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
