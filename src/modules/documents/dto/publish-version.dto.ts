import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, Min } from "class-validator";

export class PublishVersionDto {
  @ApiProperty({ description: "Version number to publish", example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}
