import { ApiProperty } from '@nestjs/swagger';

export class SyncStateResponseDto {
  @ApiProperty({ description: '文档ID', example: 'doc_1234567890_abc123' })
  docId: string;

  @ApiProperty({ description: '当前草稿 head', example: 5 })
  head: number;

  @ApiProperty({ description: '已发布 head', example: 3 })
  publishedHead: number;

  @ApiProperty({ description: '是否存在待提交草稿变更', example: true })
  hasPendingDraft: boolean;

  @ApiProperty({ description: '待提交变更数量', example: 2 })
  pendingCount: number;

  @ApiProperty({ description: '文档最后更新时间', example: '2026-05-19T00:00:00.000Z' })
  updatedAt: Date;
}

