import type { Repository } from "typeorm";
import { DocumentRenderService, DOCUMENT_RENDER_VERSION } from "./document-render.service";
import type { BlockRenderCache } from "../../../entities/block-render-cache.entity";

describe("DocumentRenderService", () => {
  const cacheRepository = {
    find: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  } as unknown as Repository<BlockRenderCache>;

  const htmlRenderer = {
    renderBlock: jest.fn(),
    sanitize: jest.fn((html: string) => html),
  };

  let service: DocumentRenderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentRenderService(cacheRepository, htmlRenderer as any);
  });

  it("使用新的渲染版本以失效旧的 task/list HTML 缓存", () => {
    expect(DOCUMENT_RENDER_VERSION).toBe("tiptap-static-v4");
  });

  it("命中块版本渲染缓存时直接附加 html 且不重新渲染", async () => {
    jest.mocked(cacheRepository.find).mockResolvedValue([
      {
        blockVersionId: 11,
        renderVersion: DOCUMENT_RENDER_VERSION,
        status: "success",
        html: "<p>cached</p>",
      },
    ] as BlockRenderCache[]);

    const tree = {
      blockId: "root",
      type: "root",
      children: [
        {
          blockId: "b1",
          type: "paragraph",
          blockVersionId: 11,
          ver: 3,
          payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
          children: [],
        },
      ],
    };

    const result = await service.renderTree(tree);

    expect(result.tree.children[0].html).toBe("<p>cached</p>");
    expect(result.diagnostics).toMatchObject({
      renderMode: "cache",
      cache: "hit",
      renderableBlocks: 1,
      cachedBlocks: 1,
      freshBlocks: 0,
      clientBlocks: 0,
      failedBlocks: 0,
    });
    expect(htmlRenderer.renderBlock).not.toHaveBeenCalled();
    expect(cacheRepository.save).not.toHaveBeenCalled();
  });

  it("缓存未命中时渲染块并回填 block_render_caches", async () => {
    jest.mocked(cacheRepository.find).mockResolvedValue([]);
    htmlRenderer.renderBlock.mockReturnValue("<p>fresh</p>");

    const tree = {
      blockId: "root",
      type: "root",
      children: [
        {
          blockId: "b1",
          type: "paragraph",
          blockVersionId: 12,
          ver: 1,
          payload: { type: "paragraph", content: [{ type: "text", text: "fresh" }] },
          children: [],
        },
      ],
    };

    const result = await service.renderTree(tree);

    expect(result.tree.children[0].html).toBe("<p>fresh</p>");
    expect(result.diagnostics).toMatchObject({
      renderMode: "fresh",
      cache: "miss",
      renderableBlocks: 1,
      cachedBlocks: 0,
      freshBlocks: 1,
      clientBlocks: 0,
      failedBlocks: 0,
    });
    expect(cacheRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        blockVersionId: 12,
        blockId: "b1",
        blockVer: 1,
        renderVersion: DOCUMENT_RENDER_VERSION,
        status: "success",
        html: "<p>fresh</p>",
      }),
    ]);
  });

  it("硬编码为前端处理的块类型不参与服务端渲染和缓存", async () => {
    jest.mocked(cacheRepository.find).mockResolvedValue([]);

    const tree = {
      blockId: "root",
      type: "root",
      children: [
        {
          blockId: "code_1",
          type: "codeBlock",
          blockVersionId: 13,
          ver: 1,
          payload: { type: "codeBlock", content: [{ type: "text", text: "console.log(1)" }] },
          children: [],
        },
      ],
    };

    const result = await service.renderTree(tree);

    expect(result.tree.children[0].html).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      renderMode: "client-json",
      cache: "none",
      renderableBlocks: 0,
      cachedBlocks: 0,
      freshBlocks: 0,
      clientBlocks: 1,
      failedBlocks: 0,
    });
    expect(htmlRenderer.renderBlock).not.toHaveBeenCalled();
    expect(cacheRepository.save).not.toHaveBeenCalled();
  });

  it("同一棵树同时包含缓存 HTML、首次渲染和前端处理块时标记为混合", async () => {
    jest.mocked(cacheRepository.find).mockResolvedValue([
      {
        blockVersionId: 21,
        renderVersion: DOCUMENT_RENDER_VERSION,
        status: "success",
        html: "<p>cached</p>",
      },
    ] as BlockRenderCache[]);
    htmlRenderer.renderBlock.mockReturnValue("<h2>fresh</h2>");

    const tree = {
      blockId: "root",
      type: "root",
      children: [
        {
          blockId: "cached",
          type: "paragraph",
          blockVersionId: 21,
          ver: 1,
          payload: { type: "paragraph", content: [{ type: "text", text: "cached" }] },
          children: [],
        },
        {
          blockId: "fresh",
          type: "heading",
          blockVersionId: 22,
          ver: 1,
          payload: { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "fresh" }] },
          children: [],
        },
        {
          blockId: "code",
          type: "codeBlock",
          blockVersionId: 23,
          ver: 1,
          payload: { type: "codeBlock", content: [{ type: "text", text: "const x = 1" }] },
          children: [],
        },
      ],
    };

    const result = await service.renderTree(tree);

    expect(result.diagnostics).toMatchObject({
      renderMode: "mixed",
      cache: "mixed",
      totalBlocks: 3,
      renderableBlocks: 2,
      cachedBlocks: 1,
      freshBlocks: 1,
      clientBlocks: 1,
      failedBlocks: 0,
    });
  });

  it("单个块渲染失败时保留原 JSON 块并记录失败缓存", async () => {
    jest.mocked(cacheRepository.find).mockResolvedValue([]);
    htmlRenderer.renderBlock.mockImplementation(() => {
      throw new Error("render failed");
    });

    const tree = {
      blockId: "root",
      type: "root",
      children: [
        {
          blockId: "b1",
          type: "paragraph",
          blockVersionId: 14,
          ver: 1,
          payload: { type: "paragraph", content: [{ type: "text", text: "bad" }] },
          children: [],
        },
      ],
    };

    const result = await service.renderTree(tree);

    expect(result.tree.children[0].html).toBeUndefined();
    expect(result.failures).toEqual([
      expect.objectContaining({ blockId: "b1", blockVersionId: 14 }),
    ]);
    expect(cacheRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        blockVersionId: 14,
        status: "failed",
        html: null,
        error: "render failed",
      }),
    ]);
  });
});
