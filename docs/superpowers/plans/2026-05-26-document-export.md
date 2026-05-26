# Document Export Implementation Plan

<!-- cspell:words StreamableFile Playwright JSZip Turndown TurndownService DownloadOutlined agentic nodebuffer networkidle autosync -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add document export for the latest committed version in Markdown, HTML zip, and PDF, with pending-draft prompting in the editor.

**Architecture:** The backend owns file generation and streams attachments from a dedicated export endpoint. `DocumentsService` exposes a committed-version export source, and `DocumentExportService` converts that source into Markdown, zipped HTML, or PDF. The frontend adds an export dropdown, checks `sync-state` for pending drafts, and either exports the latest saved version or saves first.

**Tech Stack:** NestJS, TypeORM, `StreamableFile`, `Turndown`, `JSZip`, `Playwright`, React, Ant Design, Vitest, Jest.

---

### Task 1: Backend Export Route Contract

**Files:**

- Create: `src/modules/documents/dto/export-document-query.dto.ts`
- Create: `src/modules/documents/services/document-export.types.ts`
- Create: `src/modules/documents/services/document-export.service.ts`
- Modify: `src/modules/documents/documents.controller.ts`
- Modify: `src/modules/documents/documents.controller.spec.ts`
- Modify: `src/modules/documents/documents.module.ts`

- [ ] **Step 1: Write the failing controller test**

Add this to `src/modules/documents/documents.controller.spec.ts`, and update `beforeEach` to instantiate `new DocumentsController(documentsService as any, documentExportService as any)`:

```ts
import { StreamableFile } from "@nestjs/common";

const documentExportService = {
  exportDocument: jest.fn(),
};

it("exports a document as an attachment with the requested format", async () => {
  documentExportService.exportDocument.mockResolvedValue({
    filename: "Test-Doc-v3.md",
    mimeType: "text/markdown; charset=utf-8",
    buffer: Buffer.from("# Test Doc", "utf8"),
  });
  const response = { setHeader: jest.fn() };

  const result = await controller.exportDocument(
    "doc_1",
    { format: "md" } as any,
    { userId: "user_1" },
    response as any,
  );

  expect(documentExportService.exportDocument).toHaveBeenCalledWith(
    "doc_1",
    "md",
    "user_1",
  );
  expect(response.setHeader).toHaveBeenCalledWith(
    "Content-Type",
    "text/markdown; charset=utf-8",
  );
  expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(response.setHeader).toHaveBeenCalledWith(
    "Content-Disposition",
    expect.stringContaining("Test-Doc-v3.md"),
  );
  expect(result).toBeInstanceOf(StreamableFile);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `back/server`:

```powershell
pnpm test -- documents.controller.spec.ts -t "exports a document as an attachment"
```

Expected: FAIL because `DocumentsController.exportDocument` does not exist.

- [ ] **Step 3: Add DTO, service shell, module provider, and route**

Create `src/modules/documents/dto/export-document-query.dto.ts`:

```ts
import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

export const DOCUMENT_EXPORT_FORMATS = ["md", "html", "pdf"] as const;
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

export class ExportDocumentQueryDto {
  @ApiProperty({
    description: "导出格式",
    enum: DOCUMENT_EXPORT_FORMATS,
    example: "md",
  })
  @IsIn(DOCUMENT_EXPORT_FORMATS)
  format: DocumentExportFormat;
}
```

Create `src/modules/documents/services/document-export.types.ts`:

```ts
export type ExportedDocumentFile = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};
```

Create `src/modules/documents/services/document-export.service.ts`:

```ts
import { BadRequestException, Injectable } from "@nestjs/common";
import type { DocumentExportFormat } from "../dto/export-document-query.dto";
import type { ExportedDocumentFile } from "./document-export.types";

@Injectable()
export class DocumentExportService {
  async exportDocument(
    _docId: string,
    _format: DocumentExportFormat,
    _userId: string,
  ): Promise<ExportedDocumentFile> {
    throw new BadRequestException("文档导出暂未实现");
  }
}
```

Register `DocumentExportService` in `DocumentsModule.providers`, inject it into `DocumentsController`, and add:

```ts
@Get(":docId/export")
@ApiOperation({ summary: "导出文档" })
@ApiParam({ name: "docId", description: "文档 ID" })
async exportDocument(
  @Param("docId") docId: string,
  @Query() queryDto: ExportDocumentQueryDto,
  @CurrentUser() user: any,
  @Res({ passthrough: true }) response: Response,
) {
  const file = await this.documentExportService.exportDocument(
    docId,
    queryDto.format,
    user.userId,
  );
  response.setHeader("Content-Type", file.mimeType);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  );
  return new StreamableFile(file.buffer, {
    type: file.mimeType,
    disposition: `attachment; filename="${encodeURIComponent(file.filename)}"`,
  });
}
```

- [ ] **Step 4: Run the controller test again**

Run:

```powershell
pnpm test -- documents.controller.spec.ts -t "exports a document as an attachment"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/documents/dto/export-document-query.dto.ts src/modules/documents/services/document-export.types.ts src/modules/documents/services/document-export.service.ts src/modules/documents/documents.controller.ts src/modules/documents/documents.controller.spec.ts src/modules/documents/documents.module.ts
git commit -m "feat(export): add document export route contract"
```

### Task 2: Export Source And Pending Side Effect Fix

**Files:**

- Modify: `src/modules/documents/documents.service.ts`
- Modify: `src/modules/documents/documents.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/modules/documents/documents.service.spec.ts`:

```ts
it("getPendingVersions checks access without increasing viewCount", async () => {
  (versionControlService as any).getPendingVersionCount = jest
    .fn()
    .mockReturnValue(2);
  const accessSpy = jest
    .spyOn(service, "assertAccessWithoutViewIncrement")
    .mockResolvedValue({ docId: "doc_1" } as Document);
  const findOneSpy = jest
    .spyOn(service, "findOne")
    .mockResolvedValue({} as any);

  const result = await service.getPendingVersions("doc_1", "user_1");

  expect(accessSpy).toHaveBeenCalledWith("doc_1", "user_1");
  expect(findOneSpy).not.toHaveBeenCalled();
  expect(result).toEqual({ docId: "doc_1", pendingCount: 2, hasPending: true });
});

it("getExportSource returns the current committed head tree", async () => {
  const document = {
    docId: "doc_1",
    title: "Export Me",
    head: 5,
    rootBlockId: "root_1",
  } as Document;
  jest
    .spyOn(service, "assertAccessWithoutViewIncrement")
    .mockResolvedValue(document);
  jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
    docId: "doc_1",
    docVer: 5,
    createdAt: 123,
  } as DocRevision);
  jest.spyOn(service as any, "getContentByDocument").mockResolvedValue({
    docId: "doc_1",
    docVer: 5,
    title: "Export Me",
    tree: { blockId: "root_1", type: "root", children: [] },
  });

  const result = await service.getExportSource("doc_1", "user_1");

  expect(result.docVer).toBe(5);
  expect(result.document).toBe(document);
  expect(result.revision.docVer).toBe(5);
  expect(result.content.tree.blockId).toBe("root_1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm test -- documents.service.spec.ts -t "getPendingVersions|getExportSource"
```

Expected: FAIL because `getPendingVersions` currently calls `findOne`, and `getExportSource` does not exist.

- [ ] **Step 3: Implement source methods**

Add this exported type and methods in `DocumentsService`:

```ts
export type DocumentExportSource = {
  document: Document;
  revision: DocRevision;
  docVer: number;
  content: {
    docId: string;
    docVer: number;
    title: string;
    tree: any;
  };
};

async getPendingVersions(docId: string, userId: string) {
  await this.assertAccessWithoutViewIncrement(docId, userId);
  const pendingCount = this.versionControlService.getPendingVersionCount(docId);
  return { docId, pendingCount, hasPending: pendingCount > 0 };
}

async getExportSource(docId: string, userId: string): Promise<DocumentExportSource> {
  const document = await this.assertAccessWithoutViewIncrement(docId, userId);
  const docVer = document.head;
  const revision = await this.docRevisionRepository.findOne({ where: { docId, docVer } });
  if (!revision) throw new NotFoundException("文档版本不存在");

  const content = await this.getContentByDocument(
    document,
    docVer,
    undefined,
    undefined,
    10000,
    "all",
  );

  return { document, revision, docVer, content };
}
```

- [ ] **Step 4: Run tests again**

Run:

```powershell
pnpm test -- documents.service.spec.ts -t "getPendingVersions|getExportSource"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/documents/documents.service.ts src/modules/documents/documents.service.spec.ts
git commit -m "fix(documents): avoid view count changes for export state"
```

### Task 3: Markdown And HTML Zip Exporters

**Files:**

- Modify: `src/modules/documents/services/document-export.service.ts`
- Create: `src/modules/documents/services/document-export-html.ts`
- Create: `src/modules/documents/services/document-export-markdown.ts`
- Create: `src/modules/documents/services/document-export.service.spec.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add dependencies**

Run from `back/server`:

```powershell
pnpm add jszip turndown
```

Expected: `package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 2: Write failing exporter tests**

Create `src/modules/documents/services/document-export.service.spec.ts`:

```ts
import JSZip from "jszip";
import { DocumentExportService } from "./document-export.service";

describe("DocumentExportService", () => {
  const documentsService = { getExportSource: jest.fn() };
  let service: DocumentExportService;

  beforeEach(() => {
    service = new DocumentExportService(documentsService as any);
    documentsService.getExportSource.mockResolvedValue({
      docVer: 3,
      document: { title: "Test Doc" },
      revision: { docVer: 3 },
      content: {
        title: "Test Doc",
        tree: {
          blockId: "root",
          type: "root",
          children: [
            {
              blockId: "h1",
              type: "heading",
              html: "<h1>Hello</h1>",
              children: [],
            },
            {
              blockId: "p1",
              type: "paragraph",
              html: "<p>World</p>",
              children: [],
            },
          ],
        },
      },
    });
  });

  it("exports Markdown from the latest committed source", async () => {
    const result = await service.exportDocument("doc_1", "md", "user_1");
    expect(documentsService.getExportSource).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
    );
    expect(result.mimeType).toBe("text/markdown; charset=utf-8");
    expect(result.filename).toBe("Test-Doc-v3.md");
    expect(result.buffer.toString("utf8")).toContain("# Hello");
    expect(result.buffer.toString("utf8")).toContain("World");
  });

  it("exports HTML as a zip containing index and style files", async () => {
    const result = await service.exportDocument("doc_1", "html", "user_1");
    const zip = await JSZip.loadAsync(result.buffer);
    expect(result.mimeType).toBe("application/zip");
    expect(result.filename).toBe("Test-Doc-v3.zip");
    expect(await zip.file("index.html")?.async("string")).toContain(
      "<!doctype html>",
    );
    expect(await zip.file("style.css")?.async("string")).toContain("body");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
pnpm test -- document-export.service.spec.ts
```

Expected: FAIL because `DocumentExportService` still contains the shell implementation.

- [ ] **Step 4: Implement Markdown and HTML zip output**

Create `document-export-html.ts` with `treeToBodyHtml()`, `buildExportHtml()`, and `buildHtmlZip()`:

```ts
import JSZip from "jszip";

export const EXPORT_STYLE_CSS = `
body { margin: 40px auto; max-width: 760px; font: 16px/1.65 system-ui, sans-serif; color: #1f2328; }
img { max-width: 100%; height: auto; }
pre { padding: 12px; overflow: auto; background: #f6f8fa; border-radius: 6px; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #d0d7de; padding: 6px 8px; }
`;

export function treeToBodyHtml(tree: any): string {
  const out: string[] = [];
  const walk = (node: any) => {
    if (node.type !== "root")
      out.push(typeof node.html === "string" ? node.html : "");
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out.join("\n");
}

export function buildExportHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>${title}</title><link rel="stylesheet" href="./style.css" /></head><body>${bodyHtml}</body></html>`;
}

export async function buildHtmlZip(html: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("index.html", html);
  zip.file("style.css", EXPORT_STYLE_CSS);
  return Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}
```

Create `document-export-markdown.ts`:

```ts
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

export function htmlToMarkdown(title: string, bodyHtml: string): string {
  const body = turndown.turndown(bodyHtml).trim();
  return [`# ${title}`, body].filter(Boolean).join("\n\n") + "\n";
}
```

Replace `DocumentExportService` with a real implementation that injects `DocumentsService`, builds `bodyHtml`, and returns `.md` or `.zip` files. Keep unsupported formats throwing `BadRequestException`.

- [ ] **Step 5: Run exporter tests**

Run:

```powershell
pnpm test -- document-export.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml src/modules/documents/services
git commit -m "feat(export): add markdown and html document export"
```

### Task 4: PDF Exporter

**Files:**

- Create: `src/modules/documents/services/document-export-pdf.ts`
- Modify: `src/modules/documents/services/document-export.service.ts`
- Modify: `src/modules/documents/services/document-export.service.spec.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add Playwright**

Run from `back/server`:

```powershell
pnpm add playwright
pnpm exec playwright install chromium
```

Expected: dependency and Chromium install succeed.

- [ ] **Step 2: Write failing PDF test**

Extend `document-export.service.spec.ts`:

```ts
jest.mock("./document-export-pdf", () => ({
  renderPdfFromHtml: jest.fn().mockResolvedValue(Buffer.from("%PDF-1.4")),
}));

it("exports PDF from the shared export HTML", async () => {
  const result = await service.exportDocument("doc_1", "pdf", "user_1");
  expect(result.mimeType).toBe("application/pdf");
  expect(result.filename).toBe("Test-Doc-v3.pdf");
  expect(result.buffer.toString("utf8")).toContain("%PDF");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```powershell
pnpm test -- document-export.service.spec.ts -t "exports PDF"
```

Expected: FAIL because `pdf` format is not implemented.

- [ ] **Step 4: Implement PDF rendering**

Create `document-export-pdf.ts`:

```ts
import { chromium } from "playwright";

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
```

Add a `format === "pdf"` branch in `DocumentExportService` using the same export HTML as the zip output.

- [ ] **Step 5: Run PDF tests**

Run:

```powershell
pnpm test -- document-export.service.spec.ts -t "exports PDF"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml src/modules/documents/services
git commit -m "feat(export): add pdf document export"
```

### Task 5: Frontend Download Helper And Export Menu

**Files:**

- Create: `E:/workspace/editor-demo/app/src/services/document-export.ts`
- Create: `E:/workspace/editor-demo/app/src/services/document-export.test.ts`
- Modify: `E:/workspace/editor-demo/app/src/components/DocumentHeader.tsx`
- Modify: `E:/workspace/editor-demo/app/src/components/DocumentHeader.css`

- [ ] **Step 1: Write failing helper tests**

Create `src/services/document-export.test.ts` in the frontend app:

```ts
import { describe, expect, it } from "vitest";
import { parseDownloadFilename } from "./document-export";

describe("document export download helpers", () => {
  it("parses UTF-8 filenames from content-disposition", () => {
    expect(
      parseDownloadFilename("attachment; filename*=UTF-8''Test-Doc-v3.md"),
    ).toBe("Test-Doc-v3.md");
  });

  it("falls back to plain filename", () => {
    expect(
      parseDownloadFilename('attachment; filename="Test-Doc-v3.zip"'),
    ).toBe("Test-Doc-v3.zip");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `E:/workspace/editor-demo/app`:

```powershell
pnpm test:unit -- src/services/document-export.test.ts
```

Expected: FAIL because `src/services/document-export.ts` does not exist.

- [ ] **Step 3: Implement helper and menu**

Create `src/services/document-export.ts`:

```ts
import { apiFetch } from "./api-client";

export type ExportFormat = "md" | "html" | "pdf";

export function parseDownloadFilename(
  contentDisposition: string | null,
): string | null {
  if (!contentDisposition) return null;
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return contentDisposition.match(/filename="([^"]+)"/i)?.[1] ?? null;
}

export async function downloadDocumentExport(
  docId: string,
  format: ExportFormat,
): Promise<void> {
  const response = await apiFetch(
    `/documents/${docId}/export?format=${format}`,
  );
  if (!response.ok) throw new Error(`导出失败：HTTP ${response.status}`);
  const blob = await response.blob();
  const filename =
    parseDownloadFilename(response.headers.get("Content-Disposition")) ??
    `document.${format === "html" ? "zip" : format}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
```

Add a `DownloadOutlined` dropdown in `DocumentHeader.tsx`. In this task, the click handler can call `downloadDocumentExport()` directly; pending prompting is Task 6.

```tsx
import { DownloadOutlined } from "@ant-design/icons";
import {
  downloadDocumentExport,
  type ExportFormat,
} from "@/services/document-export";

const [exporting, setExporting] = useState(false);

const exportMenuItems: MenuProps["items"] = [
  { key: "md", label: "Markdown" },
  { key: "html", label: "HTML" },
  { key: "pdf", label: "PDF" },
];

const handleExport = useCallback(
  async (format: ExportFormat) => {
    if (!currentDoc || exporting) return;
    setExporting(true);
    try {
      await downloadDocumentExport(currentDoc.docId, format);
      message.success("导出已开始");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  },
  [currentDoc, exporting],
);

<Dropdown
  trigger={["click"]}
  menu={{
    items: exportMenuItems,
    onClick: ({ key }) => handleExport(key as ExportFormat),
  }}
>
  <Button size="small" icon={<DownloadOutlined />} loading={exporting}>
    导出
  </Button>
</Dropdown>;
```

- [ ] **Step 4: Run helper tests**

Run:

```powershell
pnpm test:unit -- src/services/document-export.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/document-export.ts src/services/document-export.test.ts src/components/DocumentHeader.tsx src/components/DocumentHeader.css
git commit -m "feat(export): add document export menu"
```

### Task 6: Pending Draft Prompt And Save-First Flow

**Files:**

- Modify: `E:/workspace/editor-demo/app/src/components/DocumentHeader.tsx`
- Create: `E:/workspace/editor-demo/app/src/components/DocumentHeader.export.test.tsx`

- [ ] **Step 1: Write failing interaction test**

Create `src/components/DocumentHeader.export.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "antd";
import { describe, expect, it, vi } from "vitest";
import { DocumentHeader } from "./DocumentHeader";
import { getDocumentSyncState } from "@/services/sync/api";
import { downloadDocumentExport } from "@/services/document-export";

vi.mock("@/contexts/DocumentContext", () => ({
  useDocument: () => ({
    currentDoc: {
      docId: "doc_1",
      title: "Doc",
      rootBlockId: "root_1",
      visibility: "private",
    },
    saveStatus: "saved",
    lastSavedAt: new Date("2026-05-26T01:00:00.000Z"),
    currentDocSlug: null,
    selectDoc: vi.fn(),
    publishDoc: vi.fn(),
    refreshDocs: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { userId: "user_1", displayName: "User" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/services/sync/api", () => ({
  getDocumentSyncState: vi.fn(),
}));

vi.mock("@/services/document-export", () => ({
  downloadDocumentExport: vi.fn(),
}));

describe("DocumentHeader export", () => {
  it("prompts when pending draft exists and saves before exporting", async () => {
    vi.mocked(getDocumentSyncState).mockResolvedValue({
      docId: "doc_1",
      head: 3,
      publishedHead: 0,
      hasPendingDraft: true,
      pendingCount: 1,
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(Modal, "confirm").mockImplementation((options: any) => {
      void options.onOk();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentHeader
        onSave={onSave}
        saving={false}
        showTOC={false}
        onToggleTOC={vi.fn()}
        settingsScope="user"
        settingsPriority="workspace-first"
        settingsByScope={{ user: {}, workspace: {} } as any}
        effectiveSettings={{} as any}
        onSettingsScopeChange={vi.fn()}
        onSettingsPriorityChange={vi.fn()}
        onSaveSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /导出/ }));
    await userEvent.click(screen.getByText("PDF"));

    await waitFor(() =>
      expect(getDocumentSyncState).toHaveBeenCalledWith("doc_1"),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(downloadDocumentExport).toHaveBeenCalledWith("doc_1", "pdf");
  });
});
```

- [ ] **Step 2: Run the interaction test to verify it fails**

Run:

```powershell
pnpm test:unit -- src/components/DocumentHeader.export.test.tsx
```

Expected: FAIL because export does not check `sync-state`.

- [ ] **Step 3: Implement pending-aware export flow**

Change `DocumentHeaderProps.onSave` to:

```ts
onSave: () => Promise<void> | void;
```

In `handleExport(format)`, call `getDocumentSyncState(currentDoc.docId)`. If `hasPendingDraft` is true, show `Modal.confirm` with:

```tsx
Modal.confirm({
  title: "当前文档有未保存版本",
  content: `还有 ${syncState.pendingCount} 次变更未创建为文档版本。`,
  okText: "先保存再导出",
  cancelText: "导出最近保存版本",
  onOk: async () => {
    await onSave();
    await downloadDocumentExport(currentDoc.docId, format);
  },
  onCancel: async () => {
    await downloadDocumentExport(currentDoc.docId, format);
  },
});
```

Disable export while `saving || exporting`.

- [ ] **Step 4: Run interaction test again**

Run:

```powershell
pnpm test:unit -- src/components/DocumentHeader.export.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/DocumentHeader.tsx src/components/DocumentHeader.export.test.tsx
git commit -m "feat(export): prompt before exporting pending drafts"
```

### Task 7: Verification

**Files:** Verify only.

- [ ] **Step 1: Run backend targeted tests**

Run from `back/server`:

```powershell
pnpm test -- documents.controller.spec.ts documents.service.spec.ts document-export.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend targeted tests**

Run from `E:/workspace/editor-demo/app`:

```powershell
pnpm test:unit -- src/services/document-export.test.ts src/components/DocumentHeader.export.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run build checks**

Run from `back/server`:

```powershell
pnpm build
```

Expected: PASS.

Run from `E:/workspace/editor-demo/app`:

```powershell
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test**

1. Export Markdown with no pending changes. Expected: `.md` downloads and contains the latest saved title/content.
2. Make an edit and wait for autosync without pressing save. Export PDF. Expected: pending prompt appears.
3. Choose "导出最近保存版本". Expected: PDF downloads for the previous committed version.
4. Repeat and choose "先保存再导出". Expected: save completes, then PDF downloads for the new committed version.
5. Export HTML. Expected: zip downloads and contains `index.html` plus `style.css`.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required changes:

```powershell
git add .
git commit -m "fix(export): address document export verification issues"
```

If no changes were needed, do not create an empty commit.
