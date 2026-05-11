import { IsString, IsOptional, IsIn, IsInt, Min, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const ACTIONS = [
  'doc.create',
  'doc.update',
  'doc.delete',
  'doc.move',
  'doc.publish',
  'block.create',
  'block.update',
  'block.delete',
  'block.move',
  'block.batch',
  'workspace.create',
  'workspace.update',
  'workspace.delete',
  'member.invite',
  'member.role',
  'member.remove',
  'favorite.create',
  'favorite.remove',
  'comment.create',
  'comment.update',
  'comment.delete',
  'tag.create',
  'tag.update',
  'tag.delete',
];
const ENTITY_TYPES = ['document', 'block', 'workspace', 'member', 'favorite', 'comment', 'tag'];

export class QueryActivitiesDto {
  @ApiProperty({ description: '工作空间ID', example: 'ws_1234567890_abc123' })
  @IsString()
  workspaceId: string;

  @ApiPropertyOptional({ description: '用户ID（操作者）' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: '操作类型', enum: ACTIONS })
  @IsOptional()
  @IsIn(ACTIONS)
  action?: string;

  @ApiPropertyOptional({ description: '实体类型', enum: ENTITY_TYPES })
  @IsOptional()
  @IsIn(ENTITY_TYPES)
  entityType?: string;

  @ApiPropertyOptional({ description: '开始日期（ISO）', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期（ISO）', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

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
