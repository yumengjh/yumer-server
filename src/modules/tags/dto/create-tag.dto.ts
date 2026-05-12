import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTagDto {
  @ApiProperty({ description: '工作空间ID', example: 'ws_1234567890_abc123' })
  @IsString()
  @MinLength(1, { message: '工作空间ID不能为空' })
  workspaceId: string;

  @ApiProperty({ description: '标签名称', example: '重要', maxLength: 50 })
  @IsString()
  @MinLength(1, { message: '标签名称不能为空' })
  @MaxLength(50, { message: '标签名称不能超过50个字符' })
  name: string;

  @ApiPropertyOptional({ description: '标签颜色（十六进制）', example: '#ff4d4f', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '标签颜色不能超过20个字符' })
  color?: string;
}
