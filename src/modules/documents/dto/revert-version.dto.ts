import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export type RevertDraftStrategy = 'preserve' | 'discard';

export class RevertVersionDto {
  @ApiProperty({ description: '??????????', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiProperty({
    description: '???????????preserve=??????discard=????',
    enum: ['preserve', 'discard'],
    required: false,
  })
  @IsOptional()
  @IsIn(['preserve', 'discard'])
  draftStrategy?: RevertDraftStrategy;
}
