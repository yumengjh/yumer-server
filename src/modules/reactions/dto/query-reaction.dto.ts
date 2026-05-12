import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryReactionDto extends PaginationDto {
  @ApiPropertyOptional({ description: '目标类型筛选', example: 'guestbook' })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional({ description: '目标 ID 筛选' })
  @IsOptional()
  @IsString()
  targetId?: string;
}
