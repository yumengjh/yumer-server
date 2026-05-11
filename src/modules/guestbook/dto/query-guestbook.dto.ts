import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryGuestbookDto extends PaginationDto {
  @ApiPropertyOptional({ description: '状态筛选: 0=待审核 1=通过 2=拒绝, -1=全部' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;
}
