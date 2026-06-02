import { IsIn, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export type DiffRefKind = 'revision' | 'draft';

export class DiffVersionsDto {
  @ApiProperty({
    description: '起始比较对象类型',
    enum: ['revision', 'draft'],
    required: false,
    default: 'revision',
  })
  @IsOptional()
  @IsIn(['revision', 'draft'])
  fromKind?: DiffRefKind;

  @ApiProperty({ description: '起始版本号（fromKind=revision 时必填）', minimum: 1, required: false })
  @Type(() => Number)
  @ValidateIf((obj) => (obj.fromKind ?? 'revision') === 'revision')
  @IsInt()
  @Min(1)
  fromVer?: number;

  @ApiProperty({
    description: '目标比较对象类型',
    enum: ['revision', 'draft'],
    required: false,
    default: 'revision',
  })
  @IsOptional()
  @IsIn(['revision', 'draft'])
  toKind?: DiffRefKind;

  @ApiProperty({ description: '目标版本号（toKind=revision 时必填）', minimum: 1, required: false })
  @Type(() => Number)
  @ValidateIf((obj) => (obj.toKind ?? 'revision') === 'revision')
  @IsInt()
  @Min(1)
  toVer?: number;
}
