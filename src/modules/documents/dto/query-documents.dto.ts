import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export enum DocumentStatus {
  DRAFT = 'draft',
  NORMAL = 'normal',
  ARCHIVED = 'archived',
}

export enum DocumentSortBy {
  UPDATED_AT = 'updatedAt',
  CREATED_AT = 'createdAt',
  TITLE = 'title',
  VIEW_COUNT = 'viewCount',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class QueryDocumentsDto extends PaginationDto {
  @ApiPropertyOptional({ description: '工作空间ID', example: 'ws_1234567890_abc123' })
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional({
    description: '文档状态',
    example: 'normal',
    enum: DocumentStatus,
  })
  @IsOptional()
  @IsEnum(DocumentStatus, { message: '状态必须是 draft、normal 或 archived' })
  status?: string;

  @ApiPropertyOptional({
    description: '文档可见性',
    example: 'private',
    enum: ['private', 'workspace', 'public'],
  })
  @IsOptional()
  @IsEnum(['private', 'workspace', 'public'], {
    message: '可见性必须是 private、workspace 或 public',
  })
  visibility?: string;

  @ApiPropertyOptional({ description: '父文档ID（查询子文档）', example: 'doc_1234567890_abc123' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: '标签列表（查询包含这些标签的文档）', example: ['标签1'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '分类', example: '技术文档' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: '排序字段',
    example: 'updatedAt',
    enum: DocumentSortBy,
    default: 'updatedAt',
  })
  @IsOptional()
  @IsEnum(DocumentSortBy, { message: '排序字段无效' })
  sortBy?: string;

  @ApiPropertyOptional({
    description: '排序顺序',
    example: 'DESC',
    enum: SortOrder,
    default: 'DESC',
  })
  @IsOptional()
  @IsEnum(SortOrder, { message: '排序顺序必须是 ASC 或 DESC' })
  sortOrder?: string;
}
