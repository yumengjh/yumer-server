import {
  IsArray,
  IsEnum,
  ValidateNested,
  IsOptional,
  IsDefined,
  IsString,
  IsNumber,
  IsBoolean,
  ArrayMinSize,
  IsNotEmpty,
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

export enum BatchSourceType {
  AUTOSYNC = 'autosync',
  MANUAL_SAVE = 'manual-save',
}

export class BatchCreateOperation {
  @ApiProperty({
    description: '操作类型',
    example: 'create',
    enum: BatchOperationType,
  })
  @IsEnum(BatchOperationType)
  type: BatchOperationType.CREATE;

  @ApiProperty({ description: '创建块的数据', type: CreateBlockDto })
  @ValidateNested()
  @Type(() => CreateBlockDto)
  data: CreateBlockDto;

  @ApiPropertyOptional({
    description: '客户端生成的 clientId（用于 create ack 回填）',
    example: 'cid_01HZXFXXR93Z2',
  })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({
    description: '稳定的创建幂等ID（跨 batch 重试保持不变）',
    example: 'sync-create:cid_01HZXFXXR93Z2',
  })
  @IsOptional()
  @IsString()
  syncCreateId?: string;
}

export class BatchUpdateOperation {
  @ApiProperty({
    description: '操作类型',
    example: 'update',
    enum: BatchOperationType,
  })
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
  @ApiProperty({
    description: '操作类型',
    example: 'delete',
    enum: BatchOperationType,
  })
  @IsEnum(BatchOperationType)
  type: BatchOperationType.DELETE;

  @ApiPropertyOptional({ description: '块ID', example: 'b_1234567890_abc123' })
  @IsOptional()
  @IsString()
  blockId?: string;

  @ApiPropertyOptional({
    description: '客户端生成的 clientId（用于删除尚未回填 blockId 的 create）',
    example: 'cid_01HZXFXXR93Z2',
  })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({
    description: '稳定的创建幂等ID（用于删除尚未回填 blockId 的 create）',
    example: 'sync-create:cid_01HZXFXXR93Z2',
  })
  @IsOptional()
  @IsString()
  syncCreateId?: string;
}

export class BatchMoveOperation {
  @ApiProperty({
    description: '操作类型',
    example: 'move',
    enum: BatchOperationType,
  })
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
  @IsNotEmpty()
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
  @ArrayMinSize(1)
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

  @ApiProperty({
    description: '客户端所基于的文档版本号',
    example: 3,
  })
  @IsDefined()
  @IsNumber()
  baseVersion?: number;

  @ApiPropertyOptional({
    description: '客户端所基于的文档草稿修订号',
    example: 12,
  })
  @IsOptional()
  @IsNumber()
  draftRevision?: number;

  @ApiProperty({
    description: '客户端批次ID（用于幂等和 ack 对应）',
    example: 'batch_20260519_001',
  })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  clientBatchId?: string;

  @ApiPropertyOptional({
    description: '请求来源',
    enum: BatchSourceType,
    example: BatchSourceType.AUTOSYNC,
  })
  @IsOptional()
  @IsEnum(BatchSourceType)
  source?: BatchSourceType;

  @ApiPropertyOptional({
    description: '当前编辑会话ID（session skeleton）',
    example: 'session_20260604_001',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sessionId?: string;

  @ApiPropertyOptional({
    description: '当前编辑会话纪元（session skeleton）',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  sessionEpoch?: number;

  @ApiPropertyOptional({
    description: '本批次已覆盖到的客户端操作序号高水位',
    example: 42,
  })
  @IsOptional()
  @IsNumber()
  ackedThroughOpSeq?: number;

  @ApiPropertyOptional({
    description: '客户端实例 ID，用于实时同步事件去重',
    example: 'client_01HZXY1234',
  })
  @IsOptional()
  @IsString()
  originClientId?: string;

  @ApiPropertyOptional({
    description: '标签页实例 ID，用于实时同步事件去重',
    example: 'tab_01HZXY5678',
  })
  @IsOptional()
  @IsString()
  originTabId?: string;
}
