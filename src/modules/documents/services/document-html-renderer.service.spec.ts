import { DocumentHtmlRendererService } from "./document-html-renderer.service";

describe("DocumentHtmlRendererService", () => {
  let service: DocumentHtmlRendererService;

  beforeEach(() => {
    service = new DocumentHtmlRendererService();
  });

  it("将 Tiptap paragraph JSON 渲染为安全 HTML", () => {
    const html = service.renderBlock({
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "hello" }],
      },
    });

    expect(service.sanitize(html)).toBe("<p>hello</p>");
  });

  it("清洗危险 HTML 属性", () => {
    const sanitized = service.sanitize('<p onclick="alert(1)">safe</p><script>alert(1)</script>');

    expect(sanitized).toBe("<p>safe</p>");
  });
});
