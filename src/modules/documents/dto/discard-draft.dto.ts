import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class DiscardDraftDto {
  @ApiPropertyOptional({
    description: "当前编辑会话ID（session skeleton）",
    example: "session_20260604_001",
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({
    description: "当前编辑会话纪元（session skeleton）",
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  sessionEpoch?: number;

  @ApiPropertyOptional({
    description:
      "Compat field mirrored from sync session payload; accepted but ignored by discard/renew",
    example: "2026-06-04T23:30:00.000Z",
  })
  @IsOptional()
  @IsString()
  leaseExpiresAt?: string | null;

  @ApiPropertyOptional({
    description:
      "Compat field mirrored from sync session payload; accepted but ignored by discard/renew",
    example: 42,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  lastAckedOpSeq?: number | null;
}
