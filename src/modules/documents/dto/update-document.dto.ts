import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentVisibility } from './create-document.dto';

export class UpdateDocumentDto {
  @ApiPropertyOptional({ description: '文档标题', example: '更新的文档标题' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '文档标题不能为空' })
  @MaxLength(255, { message: '文档标题不能超过255个字符' })
  title?: string;

  @ApiPropertyOptional({ description: '文档图标（emoji）', example: '📝' })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: '图标不能超过10个字符' })
  icon?: string;

  @ApiPropertyOptional({ description: '文档封面URL', example: 'https://example.com/new-cover.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '封面URL不能超过500个字符' })
  cover?: string;

  @ApiPropertyOptional({
    description: '文档可见性',
    example: 'workspace',
    enum: DocumentVisibility,
  })
  @IsOptional()
  @IsEnum(DocumentVisibility, { message: '可见性必须是 private、workspace 或 public' })
  visibility?: string;

  @ApiPropertyOptional({
    description: '标签ID列表（tagId数组），系统会自动校验标签是否存在并更新使用统计',
    example: ['tag_1234567890_abc123', 'tag_1234567890_def456'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '分类', example: '更新后的分类' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '分类不能超过50个字符' })
  category?: string;

  @ApiPropertyOptional({
    description: '文档状态',
    example: 'normal',
    enum: ['draft', 'normal', 'archived'],
  })
  @IsOptional()
  @IsEnum(['draft', 'normal', 'archived'], { message: '状态必须是 draft、normal 或 archived' })
  status?: string;
}
