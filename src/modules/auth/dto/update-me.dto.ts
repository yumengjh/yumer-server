import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @ApiPropertyOptional({ description: '显示名称', example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '显示名称不能超过100个字符' })
  displayName?: string | null;

  @ApiPropertyOptional({
    description: '头像地址',
    example: 'https://example.com/avatar.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '头像地址不能超过500个字符' })
  avatar?: string | null;

  @ApiPropertyOptional({ description: '个人简介', example: '这是我的简介' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: '个人简介不能超过1000个字符' })
  bio?: string | null;
}
