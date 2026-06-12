import { IsObject, IsOptional, IsString, IsBoolean, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { BlockDeltaDto } from './block-delta.dto';

export class UpdateBlockDto {
  @ApiPropertyOptional({ description: '块内容（JSON格式）', example: { text: '更新的块内容' } })
  @IsOptional()
  @IsObject()
  payload?: object;

  @ApiPropertyOptional({ description: '块内容 delta 变体（与 payload 二选一）', type: BlockDeltaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BlockDeltaDto)
  delta?: BlockDeltaDto;

  @ApiPropertyOptional({
    description: '新排序键（携带时本次 update 同时完成 move，免去单独的 move 操作）',
    example: 'a1V',
  })
  @IsOptional()
  @IsString()
  sortKey?: string;

  @ApiPropertyOptional({
    description: '新父块ID（仅与 sortKey 搭配使用）',
    example: 'b_1234567890_abc123',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({
    description: '是否立即创建文档版本',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createVersion?: boolean;
}
