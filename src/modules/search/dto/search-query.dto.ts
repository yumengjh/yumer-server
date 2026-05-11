import { IsString, IsOptional, IsIn, IsInt, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SearchQueryDto {
  @ApiProperty({ description: '搜索关键词', example: '文档标题或块内容' })
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
    description: '搜索类型：doc=仅文档, block=仅块内容, all=全部',
    enum: ['doc', 'block', 'all'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['doc', 'block', 'all'], { message: 'type 必须是 doc、block 或 all' })
  type?: 'doc' | 'block' | 'all' = 'all';

  @ApiPropertyOptional({ description: '页码', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
