import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSensitiveWordDto {
  @ApiProperty({ description: '敏感词', example: 'badword' })
  @IsString()
  @MaxLength(100)
  word: string;

  @ApiPropertyOptional({ description: '替换文本', default: '***' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  replacement?: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
