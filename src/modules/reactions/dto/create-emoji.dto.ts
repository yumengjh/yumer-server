import { IsString, IsOptional, IsBoolean, IsInt, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmojiDto {
  @ApiProperty({ description: '表情代码', example: 'smile' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ description: '表情名称', example: '微笑' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '表情图标（URL 或 emoji 字符）', example: '😊' })
  @IsString()
  icon: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
