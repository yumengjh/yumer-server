import { IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export class ListAiConversationsDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  workspaceId?: string;
}
