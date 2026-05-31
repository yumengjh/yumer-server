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

  it("渲染 taskItem 时使用编辑器同款自定义 checkbox 结构并保留字号变量", () => {
    const html = service.sanitize(
      service.renderBlock({
        payload: {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "放大的代办",
                      marks: [{ type: "textStyle", attrs: { fontSize: 28 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    expect(html).toContain('data-list-font-size="28px"');
    expect(html).toContain("--task-checkbox-size:");
    expect(html).toContain('class="checkbox-wrapper"');
    expect(html).toContain('class="check task-item-checkbox-input"');
    expect(html).toContain('class="label task-item-checkbox"');
    expect(html).toContain('viewBox="0 0 95 95"');
    expect(html).toContain('class="path1 task-item-check-path"');
    expect(html).toContain(
      'd="m 56,963 c -102,122 6,9 7,9 17,-5 -66,69 -38,52 122,-77 -7,14 18,4 29,-11 45,-43 23,-4"',
    );
  });

  it("渲染普通列表项时给 li 注入字号变量用于 marker 跟随缩放", () => {
    const html = service.sanitize(
      service.renderBlock({
        payload: {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "放大的列表",
                      marks: [{ type: "textStyle", attrs: { fontSize: "24px" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    expect(html).toContain('data-list-font-size="24px"');
    expect(html).toContain("--list-font-size:24px");
    expect(html).toContain("<li");
    expect(html).toContain("<ul");
  });
});
