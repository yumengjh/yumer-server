import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCommentDto {
  @ApiProperty({ description: '评论内容' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
