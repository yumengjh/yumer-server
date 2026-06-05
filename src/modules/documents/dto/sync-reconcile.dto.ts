import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class SyncReconcileManifestItemDto {
  @ApiPropertyOptional({
    description: "Server block id currently visible in the editor",
  })
  @IsOptional()
  @IsString()
  blockId?: string | null;

  @ApiPropertyOptional({
    description: "Client id currently visible in the editor",
  })
  @IsOptional()
  @IsString()
  clientId?: string | null;

  @ApiPropertyOptional({
    description: "Stable create id currently visible in the editor",
  })
  @IsOptional()
  @IsString()
  syncCreateId?: string | null;
}

export class SyncReconcileDto {
  @ApiProperty({
    description: "Client draft revision used to build the manifest",
  })
  @IsDefined()
  @IsNumber()
  draftRevision: number;

  @ApiPropertyOptional({ description: "Current sync session id" })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ description: "Current sync session epoch" })
  @IsOptional()
  @IsNumber()
  sessionEpoch?: number;

  @ApiPropertyOptional({
    description: "Idempotency key for this final-state reconcile request",
  })
  @IsOptional()
  @IsString()
  clientBatchId?: string;

  @ApiProperty({
    description:
      "Visible top-level block identities from the editor final state",
    type: [SyncReconcileManifestItemDto],
  })
  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => SyncReconcileManifestItemDto)
  manifest: SyncReconcileManifestItemDto[];
}
