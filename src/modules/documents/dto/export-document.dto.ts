import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";

export type DocumentExportFormat = "md" | "html" | "pdf";

export class ExportDocumentDto {
  @ApiPropertyOptional({
    description: "导出格式",
    enum: ["md", "html", "pdf"],
    default: "md",
  })
  @IsOptional()
  @IsIn(["md", "html", "pdf"])
  format?: DocumentExportFormat = "md";
}
