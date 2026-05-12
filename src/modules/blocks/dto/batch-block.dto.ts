import {
  IsArray,
  IsEnum,
  ValidateNested,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateBlockDto } from './create-block.dto';
import { UpdateBlockDto } from './update-block.dto';

export enum BatchOperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  MOVE = 'move',
}

export class BatchCreateOperation {
  @ApiProperty({ description: '操作类型', example: 'create', enum: BatchOperationType })
  @IsEnum(BatchOperationType)
  type: BatchOperationType.CREATE;

  @ApiProperty({ description: '创建块的数据', type: CreateBlockDto })
  @ValidateNested()
  @Type(() => CreateBlockDto)
  data: CreateBlockDto;
}

export class BatchUpdateOperation {
  @ApiProperty({ description: '操作类型', example: 'update', enum: BatchOperationType })
  @IsEnum(BatchOperationType)
  type: BatchOperationType.UPDATE;

  @ApiProperty({ description: '块ID', example: 'b_1234567890_abc123' })
  @IsString()
  blockId: string;

  @ApiProperty({ description: '更新块的数据', type: UpdateBlockDto })
  @ValidateNested()
  @Type(() => UpdateBlockDto)
  data: UpdateBlockDto;
}

export class BatchDeleteOperation {
  @ApiProperty({ description: '操作类型', example: 'delete', enum: BatchOperationType })
  @IsEnum(BatchOperationType)
  type: BatchOperationType.DELETE;

  @ApiProperty({ description: '块ID', example: 'b_1234567890_abc123' })
  @IsString()
  blockId: string;
}

export class BatchMoveOperation {
  @ApiProperty({ description: '操作类型', example: 'move', enum: BatchOperationType })
  @IsEnum(BatchOperationType)
  type: BatchOperationType.MOVE;

  @ApiProperty({ description: '块ID', example: 'b_1234567890_abc123' })
  @IsString()
  blockId: string;

  @ApiProperty({ description: '目标父块ID', example: 'b_1234567890_abc123' })
  @IsString()
  parentId: string;

  @ApiProperty({ description: '排序键', example: '0.5' })
  @IsString()
  sortKey: string;

  @ApiPropertyOptional({ description: '缩进级别', example: 0 })
  @IsOptional()
  @IsNumber()
  indent?: number;
}

export type BatchOperation =
  | BatchCreateOperation
  | BatchUpdateOperation
  | BatchDeleteOperation
  | BatchMoveOperation;

export class BatchBlockDto {
  @ApiProperty({ description: '文档ID', example: 'doc_1234567890_abc123' })
  @IsString()
  docId: string;

  @ApiProperty({
    description: '批量操作列表',
    type: 'array',
    items: {
      oneOf: [
        { $ref: '#/components/schemas/BatchCreateOperation' },
        { $ref: '#/components/schemas/BatchUpdateOperation' },
        { $ref: '#/components/schemas/BatchDeleteOperation' },
        { $ref: '#/components/schemas/BatchMoveOperation' },
      ],
    },
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: BatchCreateOperation, name: 'create' },
        { value: BatchUpdateOperation, name: 'update' },
        { value: BatchDeleteOperation, name: 'delete' },
        { value: BatchMoveOperation, name: 'move' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  operations: BatchOperation[];

  @ApiPropertyOptional({
    description: '是否立即创建文档版本',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createVersion?: boolean;
}
