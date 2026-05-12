import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateRateLimitConfigDto {
  @ApiPropertyOptional({
    description: '是否启用全局限流',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: '限流时间窗口（毫秒，1000~86400000）',
    example: 60000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(86_400_000)
  ttlMs?: number;

  @ApiPropertyOptional({
    description: '时间窗口内允许的最大请求数（1~100000）',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  limit?: number;
}
