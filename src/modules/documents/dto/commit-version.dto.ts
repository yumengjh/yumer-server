import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CommitVersionDto {
  @ApiPropertyOptional({
    description: '版本提交消息',
    example: '完成文档编辑',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '版本消息不能超过500个字符' })
  message?: string;
}
