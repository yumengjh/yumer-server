import { Injectable, Logger } from "@nestjs/common";
import JSZip from "jszip";
import TurndownService from "turndown";
import { chromium } from "playwright";
import type { Document } from "../../../entities/document.entity";
import { DocumentsService } from "../documents.service";
import { DocumentHtmlRendererService } from "./document-html-renderer.service";
import type { DocumentExportFormat } from "../dto/export-document.dto";

type ExportTreeNode = {
  blockId?: string;
  type?: string;
  html?: string;
  payload?: Record<string, unknown> | null;
  children?: ExportTreeNode[];
};

export interface DocumentExportArtifact {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

@Injectable()
export class DocumentExportService {
  private readonly logger = new Logger(DocumentExportService.name);
  private readonly turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly htmlRenderer: DocumentHtmlRendererService,
  ) {}

  async exportDocument(
    docId: string,
    format: DocumentExportFormat,
    userId: string,
  ): Promise<DocumentExportArtifact> {
    const source = await this.documentsService.getExportSource(docId, userId);
    const title = source.document.title?.trim() || source.document.docId;
    const bodyHtml = this.renderBodyHtml(source.content.tree);
    const filenameBase = this.buildFilenameBase(title, source.document.head);

    if (format === "html") {
      return {
        buffer: await this.buildHtmlZip(source.document, title, bodyHtml),
        filename: `${filenameBase}.zip`,
        contentType: "application/zip",
      };
    }

    if (format === "pdf") {
      return {
        buffer: await this.buildPdfBuffer(title, bodyHtml),
        filename: `${filenameBase}.pdf`,
        contentType: "application/pdf",
      };
    }

    return {
      buffer: Buffer.from(this.buildMarkdown(title, bodyHtml), "utf8"),
      filename: `${filenameBase}.md`,
      contentType: "text/markdown; charset=utf-8",
    };
  }

  private renderBodyHtml(tree: ExportTreeNode): string {
    return this.flattenBlocks(tree)
      .filter((block) => block.type !== "root")
      .map((block) => this.renderBlockHtml(block))
      .filter((html) => html.trim().length > 0)
      .join("\n");
  }

  private flattenBlocks(tree: ExportTreeNode): ExportTreeNode[] {
    const flat: ExportTreeNode[] = [];
    const walk = (node: ExportTreeNode) => {
      flat.push(node);
      for (const child of node.children ?? []) {
        walk(child);
      }
    };
    walk(tree);
    return flat;
  }

  private renderBlockHtml(block: ExportTreeNode): string {
    if (typeof block.html === "string" && block.html.trim()) {
      return block.html;
    }

    const payload = block.payload;
    if (!payload || typeof payload !== "object") {
      return "";
    }

    try {
      const rawHtml = this.htmlRenderer.renderBlock({ payload });
      return this.htmlRenderer.sanitize(rawHtml);
    } catch (error) {
      this.logger.warn(
        `导出块渲染失败，已跳过: blockId=${block.blockId || "<unknown>"}, error=${(error as Error).message}`,
      );
      return "";
    }
  }

  private buildMarkdown(title: string, bodyHtml: string): string {
    const markdown = this.turndown.turndown(bodyHtml || "").trim();
    const titleBlock = `# ${title}`;
    return markdown ? `${titleBlock}\n\n${markdown}\n` : `${titleBlock}\n`;
  }

  private async buildHtmlZip(
    document: Document,
    title: string,
    bodyHtml: string,
  ): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("index.html", this.buildHtmlDocument(title, bodyHtml));
    zip.file("style.css", this.buildHtmlStyles(document));
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }

  private async buildPdfBuffer(title: string, bodyHtml: string): Promise<Buffer> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 1800 },
        deviceScaleFactor: 1,
      });
      await page.setContent(this.buildHtmlDocument(title, bodyHtml), {
        waitUntil: "load",
      });
      await page.emulateMedia({ media: "screen" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "20mm",
          bottom: "20mm",
          left: "18mm",
          right: "18mm",
        },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private buildHtmlDocument(title: string, bodyHtml: string): string {
    const styles = this.buildBaseStyles();
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(title)}</title>
    <style>${styles}</style>
  </head>
  <body>
    <main class="export-document">
      <header class="export-document__header">
        <h1>${this.escapeHtml(title)}</h1>
      </header>
      <section class="export-document__content">
        ${bodyHtml}
      </section>
    </main>
  </body>
</html>`;
  }

  private buildHtmlStyles(document: Document): string {
    return `${this.buildBaseStyles()}\n/* docId: ${this.escapeCssComment(document.docId)} */\n`;
  }

  private buildBaseStyles(): string {
    return `
      :root {
        color-scheme: light;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #1f1f1f;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        line-height: 1.7;
      }
      .export-document {
        max-width: 880px;
        margin: 0 auto;
        padding: 40px 28px 56px;
        box-sizing: border-box;
      }
      .export-document__header {
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid #e5e7eb;
      }
      .export-document__header h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.3;
        font-weight: 700;
      }
      .export-document__content > * {
        margin-top: 0;
        margin-bottom: 16px;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      pre {
        padding: 16px;
        overflow: auto;
        border-radius: 8px;
        background: #f6f8fa;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, SF Mono, Consolas, Liberation Mono, monospace;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #d0d7de;
        padding: 8px 10px;
        vertical-align: top;
      }
      blockquote {
        margin-left: 0;
        margin-right: 0;
        padding-left: 16px;
        border-left: 4px solid #d0d7de;
        color: #4b5563;
      }
    `;
  }

  private buildFilenameBase(title: string, version: number): string {
    const safeTitle = this.sanitizeFilenamePart(title) || "document";
    return `${safeTitle}-v${version}`;
  }

  private sanitizeFilenamePart(input: string): string {
    return input
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private escapeCssComment(input: string): string {
    return input.replace(/\*\//g, "* /");
  }
}
