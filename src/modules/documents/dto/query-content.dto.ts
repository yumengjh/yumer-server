import { IsOptional, IsInt, Min, Max, IsIn } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

export type ContentRenderMode = "json" | "html" | "all";

export class QueryContentDto {
  @ApiPropertyOptional({ description: "文档版本号（不传则使用最新版本）", example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    description: "最大层级深度（从根块开始计算，0表示只返回根块，1表示根块+第一层子块，以此类推）",
    example: 2,
    default: undefined,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxDepth?: number;

  @ApiPropertyOptional({
    description: "起始块ID（用于分页，返回该块及其后续兄弟块）",
    example: "b_1705123456790_block001",
  })
  @IsOptional()
  startBlockId?: string;

  @ApiPropertyOptional({
    description: "每页返回的最大块数量（包括所有层级的块）",
    example: 100,
    default: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;

  @ApiPropertyOptional({
    description:
      "内容返回模式：json 为原始块树；html/all 会在可服务端渲染的块上附加 html，渲染失败时回退 json",
    enum: ["json", "html", "all"],
    default: "json",
  })
  @IsOptional()
  @IsIn(["json", "html", "all"])
  mode?: ContentRenderMode;
}
