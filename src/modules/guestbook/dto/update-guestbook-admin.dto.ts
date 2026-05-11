import { IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGuestbookAdminDto {
  @ApiPropertyOptional({ description: '状态: 0=待审核 1=通过 2=拒绝', enum: [0, 1, 2] })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  status?: number;

  @ApiPropertyOptional({ description: '是否置顶' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}
