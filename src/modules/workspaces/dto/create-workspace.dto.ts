import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkspaceDto {
  @ApiProperty({ description: '工作空间名称', example: '我的工作空间' })
  @IsString()
  @MinLength(1, { message: '工作空间名称不能为空' })
  @MaxLength(100, { message: '工作空间名称不能超过100个字符' })
  name: string;

  @ApiPropertyOptional({ description: '工作空间描述', example: '这是一个工作空间描述' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '描述不能超过500个字符' })
  description?: string;

  @ApiPropertyOptional({ description: '工作空间图标（emoji）', example: '📚' })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: '图标不能超过10个字符' })
  icon?: string;
}
