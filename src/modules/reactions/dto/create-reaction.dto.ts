import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReactionDto {
  @ApiProperty({ description: '表情 ID', example: 1 })
  @IsInt()
  @Min(1)
  emojiId: number;
}
