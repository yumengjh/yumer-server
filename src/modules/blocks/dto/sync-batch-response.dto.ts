import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncConflictDto {
  @ApiProperty({ description: '冲突代码', example: 'BASE_VERSION_MISMATCH' })
  code: string;

  @ApiProperty({ description: '冲突描述', example: 'baseVersion(3) does not match serverHead(4)' })
  message: string;

  @ApiPropertyOptional({ description: '服务端当前 head', example: 4 })
  serverHead?: number;

  @ApiPropertyOptional({ description: '客户端提交的 baseVersion', example: 3 })
  clientBaseVersion?: number;
}

export class SyncOperationResultDto {
  @ApiProperty({ description: '操作类型', example: 'create' })
  operation: string;

  @ApiProperty({ description: '是否成功', example: true })
  success: boolean;

  @ApiPropertyOptional({ description: '客户端传入的 clientId（create 回填）', example: 'cid_01HZXFXXR93Z2' })
  clientId?: string;

  @ApiPropertyOptional({ description: '服务端 blockId', example: 'b_1234567890_abc123' })
  blockId?: string;

  @ApiPropertyOptional({ description: '服务端最终采用的排序键', example: '001500' })
  sortKey?: string;

  @ApiPropertyOptional({ description: '操作后的版本号', example: 2 })
  version?: number;

  @ApiPropertyOptional({ description: '错误信息', example: 'Block not found' })
  error?: string;
}

export class SyncBatchResponseDto {
  @ApiProperty({ description: '服务端接受的批次ID', example: 'batch_20260519_001' })
  acceptedBatchId: string;

  @ApiProperty({ description: '服务端应用时间戳（ms）', example: 1747632000000 })
  appliedAt: number;

  @ApiProperty({ description: '服务端最新 head', example: 5 })
  serverHead: number;

  @ApiProperty({ description: '是否需要客户端 reload', example: false })
  needsReload: boolean;

  @ApiProperty({ type: () => [SyncConflictDto], description: '冲突列表' })
  conflicts: SyncConflictDto[];

  @ApiProperty({ type: () => [SyncOperationResultDto], description: '逐操作结果与 ack 信息' })
  results: SyncOperationResultDto[];
}
