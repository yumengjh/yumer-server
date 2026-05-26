import { DocumentsController } from "./documents.controller";
import { SITE_PUBLIC_ANONYMOUS_USER_ID } from "../../common/decorators/public.decorator";

describe("DocumentsController", () => {
  const documentsService = {
    getContent: jest.fn(),
    getContentSitePublic: jest.fn(),
    getEditContent: jest.fn(),
    discardDraft: jest.fn(),
  };

  let controller: DocumentsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DocumentsController(documentsService as any);
  });

  it("文档内容接口将渲染诊断写入响应头并从响应体移除", async () => {
    documentsService.getContent.mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      title: "Doc",
      tree: { blockId: "root", type: "root", payload: {}, children: [] },
      renderDiagnostics: {
        requestedMode: "all",
        renderVersion: "tiptap-static-v1",
        renderMode: "mixed",
        cache: "mixed",
        totalBlocks: 3,
        renderableBlocks: 2,
        cachedBlocks: 1,
        freshBlocks: 1,
        clientBlocks: 1,
        failedBlocks: 0,
      },
    });
    const response = { setHeader: jest.fn() };

    const result = await controller.getContent(
      "doc_1",
      { mode: "all" } as any,
      { userId: "user_1" },
      response as any,
    );

    expect(response.setHeader).toHaveBeenCalledWith("X-Yuediter-Content-Mode", "all");
    expect(response.setHeader).toHaveBeenCalledWith("X-Yuediter-Render-Mode", "mixed");
    expect(response.setHeader).toHaveBeenCalledWith("X-Yuediter-Render-Cache", "mixed");
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Yuediter-Render-Blocks",
      "total=3;renderable=2;cached=1;fresh=1;client=1;failed=0",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Yuediter-Render-Version",
      "tiptap-static-v1",
    );
    expect(result).not.toHaveProperty("renderDiagnostics");
  });

  it("站点公开访问也写入渲染诊断响应头", async () => {
    documentsService.getContentSitePublic.mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      title: "Doc",
      tree: { blockId: "root", type: "root", payload: {}, children: [] },
      renderDiagnostics: {
        requestedMode: "html",
        renderVersion: "tiptap-static-v1",
        renderMode: "cache",
        cache: "hit",
        totalBlocks: 1,
        renderableBlocks: 1,
        cachedBlocks: 1,
        freshBlocks: 0,
        clientBlocks: 0,
        failedBlocks: 0,
      },
    });
    const response = { setHeader: jest.fn() };

    await controller.getContent(
      "doc_1",
      { mode: "html" } as any,
      { userId: SITE_PUBLIC_ANONYMOUS_USER_ID },
      response as any,
    );

    expect(response.setHeader).toHaveBeenCalledWith("X-Yuediter-Render-Mode", "cache");
    expect(response.setHeader).toHaveBeenCalledWith("X-Yuediter-Render-Cache", "hit");
  });
  it("returns draft-backed edit content when a draft exists", async () => {
    documentsService.getEditContent.mockResolvedValue({
      docId: "doc_1",
      source: "draft",
      head: 3,
      publishedHead: 2,
      draft: { exists: true, draftId: "draft_1", baseDocVer: 3 },
      lock: { locked: false, lockOwnerUserId: null, lockExpiresAt: null },
      tree: { blockId: "root_1", type: "root", children: [] },
      pagination: { totalBlocks: 1, returnedBlocks: 1, hasMore: false },
    });

    await expect(
      controller.getEditContent("doc_1", {} as any, {
        userId: "user_1",
      }),
    ).resolves.toMatchObject({
      source: "draft",
    });
  });

  it("discards a draft idempotently", async () => {
    documentsService.discardDraft.mockResolvedValue({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });

    await expect(
      controller.discardDraft("doc_1", {
        userId: "user_1",
      }),
    ).resolves.toEqual({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
  });
});
