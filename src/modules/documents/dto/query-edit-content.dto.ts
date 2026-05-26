import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class QueryEditContentDto {
  @ApiPropertyOptional({
    description: "最大层级深度（从根块开始计算）",
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxDepth?: number;

  @ApiPropertyOptional({
    description: "起始块 ID（用于大文档分段加载）",
    example: "b_1705123456790_block001",
  })
  @IsOptional()
  startBlockId?: string;

  @ApiPropertyOptional({
    description: "最大返回块数量（包含所有层级）",
    example: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;
}
