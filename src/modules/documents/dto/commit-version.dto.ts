import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({
    description: '当前编辑会话ID（session skeleton）',
    example: 'session_20260604_001',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({
    description: '当前编辑会话纪元（session skeleton）',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  sessionEpoch?: number;

  @ApiPropertyOptional({
    description: '前端已确认提交到的本地操作序号（session skeleton）',
    example: 42,
  })
  @IsOptional()
  @IsNumber()
  ackedThroughOpSeq?: number;
}
