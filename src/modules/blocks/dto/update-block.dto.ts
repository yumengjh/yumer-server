import { IsObject, IsOptional, IsString, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBlockDto {
  @ApiProperty({ description: '块内容（JSON格式）', example: { text: '更新的块内容' } })
  @IsObject()
  payload: object;

  @ApiPropertyOptional({ description: '纯文本内容（用于搜索）', example: '更新的块内容' })
  @IsOptional()
  @IsString()
  plainText?: string;

  @ApiPropertyOptional({
    description: '是否立即创建文档版本',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createVersion?: boolean;
}
