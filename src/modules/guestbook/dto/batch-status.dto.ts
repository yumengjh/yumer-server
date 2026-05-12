import { IsArray, IsInt, Min, Max, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BatchStatusDto {
  @ApiProperty({ description: '留言 ID 列表', type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  ids: number[];

  @ApiProperty({ description: '目标状态: 0=待审核 1=通过 2=拒绝', enum: [0, 1, 2] })
  @IsInt()
  @Min(0)
  @Max(2)
  status: number;
}
