import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class DiffVersionsDto {
  @ApiProperty({ description: '起始版本号', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromVer: number;

  @ApiProperty({ description: '目标版本号', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toVer: number;
}
