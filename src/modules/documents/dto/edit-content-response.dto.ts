import { ApiProperty } from "@nestjs/swagger";

class EditDraftMetaDto {
  @ApiProperty()
  exists: boolean;

  @ApiProperty({ required: false, nullable: true })
  draftId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  baseDocVer?: number | null;

  @ApiProperty()
  draftRevision: number;

  @ApiProperty({ required: false, nullable: true })
  updatedAt?: string | null;

  @ApiProperty({ required: false, nullable: true })
  updatedBy?: string | null;
}

class EditLockMetaDto {
  @ApiProperty()
  locked: boolean;

  @ApiProperty({ nullable: true })
  lockOwnerUserId: string | null;

  @ApiProperty({ nullable: true })
  lockExpiresAt: string | null;
}

class EditPaginationDto {
  @ApiProperty()
  totalBlocks: number;

  @ApiProperty()
  returnedBlocks: number;

  @ApiProperty()
  hasMore: boolean;

  @ApiProperty({ required: false, nullable: true })
  nextStartBlockId?: string | null;
}

class LastEditPositionDto {
  @ApiProperty()
  blockId: string;

  @ApiProperty({ required: false, nullable: true })
  previousBlockId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  nextBlockId?: string | null;

  @ApiProperty()
  updatedAt: string;
}

class EditorStateDto {
  @ApiProperty({ type: LastEditPositionDto, required: false, nullable: true })
  lastEditPosition?: LastEditPositionDto | null;

  @ApiProperty({ enum: ["view", "edit"], required: false, nullable: true })
  mode?: "view" | "edit";
}

export class EditContentResponseDto {
  @ApiProperty()
  docId: string;

  @ApiProperty({ enum: ["draft", "head"] })
  source: "draft" | "head";

  @ApiProperty()
  head: number;

  @ApiProperty()
  publishedHead: number;

  @ApiProperty({ type: EditorStateDto, required: false, nullable: true })
  editorState?: EditorStateDto | null;

  @ApiProperty({ type: EditDraftMetaDto })
  draft: EditDraftMetaDto;

  @ApiProperty({ type: EditLockMetaDto })
  lock: EditLockMetaDto;

  @ApiProperty({ type: Object })
  tree: Record<string, unknown> | null;

  @ApiProperty({ type: EditPaginationDto })
  pagination: EditPaginationDto;
}
