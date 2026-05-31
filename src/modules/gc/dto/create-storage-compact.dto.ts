import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class CreateStorageCompactDto {
  @ApiPropertyOptional({ description: "Validate and report only, without running VACUUM" })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ enum: ["vacuum"] })
  @IsOptional()
  @IsIn(["vacuum"])
  mode?: "vacuum";

  @ApiPropertyOptional({ description: "Required when dryRun is false" })
  @IsOptional()
  @IsString()
  confirm?: string;
}
