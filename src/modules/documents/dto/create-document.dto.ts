import { IsString, IsOptional, MinLength, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DocumentVisibility {
  PRIVATE = 'private',
  WORKSPACE = 'workspace',
  PUBLIC = 'public',
}

export class CreateDocumentDto {
  @ApiProperty({ description: '工作空间ID', example: 'ws_1234567890_abc123' })
  @IsString()
  workspaceId: string;

  @ApiProperty({ description: '文档标题', example: '我的文档' })
  @IsString()
  @MinLength(1, { message: '文档标题不能为空' })
  @MaxLength(255, { message: '文档标题不能超过255个字符' })
  title: string;

  @ApiPropertyOptional({ description: '文档图标（emoji）', example: '📄' })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: '图标不能超过10个字符' })
  icon?: string;

  @ApiPropertyOptional({ description: '文档封面URL', example: 'https://example.com/cover.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '封面URL不能超过500个字符' })
  cover?: string;

  @ApiPropertyOptional({
    description: '文档可见性',
    example: 'private',
    enum: DocumentVisibility,
    default: 'private',
  })
  @IsOptional()
  @IsEnum(DocumentVisibility, { message: '可见性必须是 private、workspace 或 public' })
  visibility?: string;

  @ApiPropertyOptional({ description: '父文档ID', example: 'doc_1234567890_abc123' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({
    description: '标签ID列表（tagId数组），系统会自动校验标签是否存在',
    example: ['tag_1234567890_abc123', 'tag_1234567890_def456'],
  })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ description: '分类', example: '技术文档' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '分类不能超过50个字符' })
  category?: string;
}
