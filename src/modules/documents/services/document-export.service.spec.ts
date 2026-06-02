import JSZip from "jszip";
import { DocumentExportService } from "./document-export.service";
import { DocumentsService } from "../documents.service";
import { DocumentHtmlRendererService } from "./document-html-renderer.service";
import { chromium } from "playwright";

jest.mock("playwright", () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

describe("DocumentExportService", () => {
  const documentsService = {
    getExportSource: jest.fn(),
  } as unknown as DocumentsService;
  const htmlRenderer = {
    renderBlock: jest.fn(),
    sanitize: jest.fn(),
  } as unknown as DocumentHtmlRendererService;

  let service: DocumentExportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentExportService(documentsService, htmlRenderer);
  });

  function mockSource() {
    jest.mocked(documentsService.getExportSource).mockResolvedValue({
      document: {
        docId: "doc_1",
        title: "Demo Doc",
        head: 2,
      } as any,
      content: {
        docId: "doc_1",
        docVer: 2,
        title: "Demo Doc",
        tree: {
          blockId: "root",
          type: "root",
          children: [
            {
              blockId: "p1",
              type: "paragraph",
              html: "<p>Hello export</p>",
              children: [],
            },
            {
              blockId: "p2",
              type: "paragraph",
              payload: {
                type: "paragraph",
                content: [{ type: "text", text: "Fallback render" }],
              },
              children: [],
            },
          ],
        },
      },
    } as any);
    jest.mocked(htmlRenderer.renderBlock).mockReturnValue("<p>Fallback render</p>");
    jest.mocked(htmlRenderer.sanitize).mockImplementation((html) => html);
  }

  it("exports markdown from the latest committed version", async () => {
    mockSource();

    const artifact = await service.exportDocument("doc_1", "md", "user_1");
    const content = artifact.buffer.toString("utf8");

    expect(documentsService.getExportSource).toHaveBeenCalledWith("doc_1", "user_1");
    expect(artifact.filename).toBe("Demo Doc.md");
    expect(artifact.contentType).toContain("text/markdown");
    expect(content).toContain("# Demo Doc");
    expect(content).toContain("Hello export");
    expect(content).toContain("Fallback render");
  });

  it("exports html as a zip package with index and style files", async () => {
    mockSource();

    const artifact = await service.exportDocument("doc_1", "html", "user_1");
    const zip = await JSZip.loadAsync(artifact.buffer);
    const indexHtml = await zip.file("index.html")!.async("string");
    const styleCss = await zip.file("style.css")!.async("string");

    expect(artifact.filename).toBe("Demo Doc.zip");
    expect(artifact.contentType).toBe("application/zip");
    expect(indexHtml).toContain("<title>Demo Doc</title>");
    expect(indexHtml).toContain("Hello export");
    expect(styleCss).toContain(".export-document");
  });

  it("exports pdf through the browser engine", async () => {
    mockSource();
    const page = {
      setContent: jest.fn().mockResolvedValue(undefined),
      emulateMedia: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from("PDF")),
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.mocked(chromium.launch).mockResolvedValue(browser as any);

    const artifact = await service.exportDocument("doc_1", "pdf", "user_1");

    expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
    expect(page.setContent).toHaveBeenCalled();
    expect(page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "A4",
        printBackground: true,
      }),
    );
    expect(browser.close).toHaveBeenCalled();
    expect(artifact.filename).toBe("Demo Doc.pdf");
    expect(artifact.contentType).toBe("application/pdf");
    expect(artifact.buffer.toString("utf8")).toBe("PDF");
  });
});
