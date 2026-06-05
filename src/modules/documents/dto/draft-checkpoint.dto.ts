import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class DraftCheckpointBlockDto {
  @ApiProperty({ example: "cid_123" })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiPropertyOptional({ example: "block_123", nullable: true })
  @IsOptional()
  @IsString()
  blockId?: string | null;

  @ApiPropertyOptional({ example: "sync-create:cid_123", nullable: true })
  @IsOptional()
  @IsString()
  syncCreateId?: string | null;

  @ApiProperty({ example: "paragraph" })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ example: "root_1", nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiProperty({ example: "001000" })
  @IsString()
  @IsNotEmpty()
  orderKey: string;

  @ApiProperty({ type: Object })
  payload: Record<string, unknown>;

  @ApiPropertyOptional({ example: "plain text" })
  @IsOptional()
  @IsString()
  plainText?: string;
}

export class DraftCheckpointDto {
  @ApiProperty({ enum: ["checkpoint"] })
  @IsIn(["checkpoint"])
  mode: "checkpoint";

  @ApiProperty({ enum: ["full"] })
  @IsIn(["full"])
  coverage: "full";

  @ApiProperty({ example: "checkpoint_1710000000000_abcd" })
  @IsString()
  @IsNotEmpty()
  clientCheckpointId: string;

  @ApiProperty({ example: "frontend-client" })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ example: 12 })
  @IsInt()
  baseVersion: number;

  @ApiProperty({ example: 34 })
  @IsInt()
  draftRevision: number;

  @ApiProperty({ example: "sync_1" })
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  sessionEpoch: number;

  @ApiProperty({ example: "sha256:abc" })
  @IsString()
  @IsNotEmpty()
  contentHash: string;

  @ApiProperty({ example: 1710000000000 })
  @IsNumber()
  generatedAt: number;

  @ApiPropertyOptional({ example: "user_1" })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @IsInt()
  documentClock?: number;

  @ApiPropertyOptional({ example: "checkpoint_previous", nullable: true })
  @IsOptional()
  @IsString()
  parentCheckpointId?: string | null;

  @ApiProperty({ example: "root_1" })
  @IsString()
  @IsNotEmpty()
  rootBlockId: string;

  @ApiProperty({ type: [DraftCheckpointBlockDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftCheckpointBlockDto)
  blocks: DraftCheckpointBlockDto[];
}

export class DraftCheckpointResponseDto {
  acceptedCheckpointId: string;
  appliedAt: number;
  serverHead: number;
  draftRevision: number;
  needsReload: boolean;
  conflicts: Array<{ code: string; message: string }>;
  contentHash: string;
  mappings: Array<{
    clientId: string;
    blockId: string;
    orderKey: string;
    sortKey?: string;
  }>;
  tombstoned: Array<{
    blockId: string;
    clientId?: string | null;
    syncCreateId?: string | null;
  }>;
}
