import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: '文档 ID' })
  @IsString()
  @IsNotEmpty()
  docId: string;

  @ApiPropertyOptional({ description: '块 ID（评论挂在块上时）' })
  @IsOptional()
  @IsString()
  blockId?: string;

  @ApiProperty({ description: '评论内容' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: '@ 提及的用户 ID 列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @ApiPropertyOptional({ description: '父评论 ID（回复时）' })
  @IsOptional()
  @IsString()
  parentCommentId?: string;
}
