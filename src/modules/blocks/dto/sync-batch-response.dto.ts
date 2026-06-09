import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncConflictDto {
  @ApiProperty({ description: '冲突代码', example: 'BASE_VERSION_MISMATCH' })
  code: string;

  @ApiProperty({
    description: '冲突描述',
    example: 'baseVersion(3) does not match serverHead(4)',
  })
  message: string;

  @ApiPropertyOptional({ description: '服务端当前 head', example: 4 })
  serverHead?: number;

  @ApiPropertyOptional({ description: '客户端提交的 baseVersion', example: 3 })
  clientBaseVersion?: number;

  @ApiPropertyOptional({ description: '服务端当前草稿修订号', example: 12 })
  serverDraftRevision?: number;

  @ApiPropertyOptional({ description: '客户端提交的草稿修订号', example: 11 })
  clientDraftRevision?: number;
}

export class SyncOperationResultDto {
  @ApiProperty({ description: '操作类型', example: 'create' })
  operation: string;

  @ApiPropertyOptional({
    description: '是否成功；省略时表示 true',
    example: false,
  })
  success?: boolean;

  @ApiPropertyOptional({
    description: '客户端传入的 clientId（create/delete ack 回填）',
    example: 'cid_01HZXFXXR93Z2',
  })
  clientId?: string;

  @ApiPropertyOptional({
    description: '服务端 blockId',
    example: 'b_1234567890_abc123',
  })
  blockId?: string;

  @ApiPropertyOptional({
    description: '服务端最终采用的排序键',
    example: '001500',
  })
  sortKey?: string;

  @ApiPropertyOptional({ description: '错误信息', example: 'Block not found' })
  error?: string;

  @ApiPropertyOptional({
    description: 'delete/create 诊断码',
    example: 'DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY',
  })
  diagnosticCode?: string;

  @ApiPropertyOptional({
    description: 'delete 操作目标命中方式',
    example: 'syncCreateId',
  })
  matchBy?: string;

  @ApiPropertyOptional({
    description: '操作被 create tombstone 覆盖',
    example: true,
  })
  tombstoned?: boolean;
}

export class SyncBatchResponseDto {
  @ApiProperty({ description: '服务端最新 head', example: 5 })
  serverHead: number;

  @ApiProperty({
    description: '服务端最新文档草稿修订号',
    example: 12,
  })
  draftRevision: number;

  @ApiPropertyOptional({
    description: '服务端已确认的当前会话客户端操作序号高水位',
    example: 42,
  })
  ackedThroughOpSeq?: number;

  @ApiPropertyOptional({
    description: '是否需要客户端 reload；省略时表示 false',
    example: true,
  })
  needsReload?: boolean;

  @ApiPropertyOptional({ type: () => [SyncConflictDto], description: '冲突列表；空数组时省略' })
  conflicts?: SyncConflictDto[];

  @ApiPropertyOptional({
    type: () => [SyncOperationResultDto],
    description: '逐操作结果与 ack 信息；空数组时省略',
  })
  results?: SyncOperationResultDto[];
}
