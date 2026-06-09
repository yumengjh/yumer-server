import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class DocumentActorSummaryResponse {
  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  avatar: string | null;
}

class DocumentBaseItemResponse {
  @ApiProperty()
  docId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true })
  icon: string | null;

  @ApiProperty({ nullable: true })
  cover: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  visibility: string;

  @ApiProperty({ nullable: true })
  parentId: string | null;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ nullable: true })
  category: string | null;

  @ApiProperty()
  publishedHead: number;

  @ApiProperty()
  viewCount: number;

  @ApiProperty()
  favoriteCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
  trashRetentionDays?: number;

  @ApiPropertyOptional({ nullable: true })
  trashExpiresAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  trashDaysRemaining?: number | null;
}

export class DocumentListItemResponse extends DocumentBaseItemResponse {
  @ApiPropertyOptional()
  workspaceId?: string;
}

export class DocumentDetailResponse extends DocumentBaseItemResponse {
  @ApiProperty()
  workspaceId: string;

  @ApiProperty()
  rootBlockId: string;

  @ApiProperty()
  head: number;

  @ApiProperty()
  draftRevision: number;

  @ApiProperty({ type: DocumentActorSummaryResponse, nullable: true })
  creator: DocumentActorSummaryResponse | null;

  @ApiProperty({ type: DocumentActorSummaryResponse, nullable: true })
  updater: DocumentActorSummaryResponse | null;
}

export class PublicDocumentDetailResponse extends DocumentBaseItemResponse {
  @ApiProperty({ type: DocumentActorSummaryResponse, nullable: true })
  creator: DocumentActorSummaryResponse | null;

  @ApiProperty({ type: DocumentActorSummaryResponse, nullable: true })
  updater: DocumentActorSummaryResponse | null;
}

export class DocumentRevisionListItemResponse {
  @ApiProperty()
  docVer: number;

  @ApiProperty()
  message: string;

  @ApiProperty()
  createdAt: number;

  @ApiProperty()
  branch: string;

  @ApiProperty({ type: DocumentActorSummaryResponse, nullable: true })
  creator: DocumentActorSummaryResponse | null;
}

export class DocumentSnapshotResponse {
  @ApiProperty()
  docId: string;

  @ApiProperty()
  docVer: number;

  @ApiProperty()
  createdAt: number;

  @ApiProperty()
  kind: string;

  @ApiProperty()
  pinned: boolean;

  @ApiProperty({ nullable: true })
  retainUntil: number | null;
}
