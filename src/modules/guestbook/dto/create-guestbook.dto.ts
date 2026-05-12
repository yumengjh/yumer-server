import { IsString, IsOptional, IsEmail, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGuestbookDto {
  @ApiProperty({ description: '昵称', example: '访客' })
  @IsString()
  @MaxLength(50)
  nickname: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: '留言内容', example: '你好！' })
  @IsString()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ description: '头像 URL' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ description: '回复目标留言 ID' })
  @IsOptional()
  parentId?: number;
}
