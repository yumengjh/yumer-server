import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryEffectiveSettingsDto {
  @ApiPropertyOptional({
    description: '工作空间ID（可选，不传则返回用户维度生效设置）',
    example: 'ws_1234567890_abc123',
  })
  @IsOptional()
  @IsString()
  workspaceId?: string;
}
