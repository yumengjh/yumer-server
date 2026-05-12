import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RevertVersionDto {
  @ApiProperty({ description: '要回滚到的文档版本号', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}
