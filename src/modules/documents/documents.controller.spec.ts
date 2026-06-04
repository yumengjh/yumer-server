import { StreamableFile } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { SITE_PUBLIC_ANONYMOUS_USER_ID } from "../../common/decorators/public.decorator";

describe("DocumentsController", () => {
  const documentsService = {
    getContent: jest.fn(),
    getContentSitePublic: jest.fn(),
    getEditContent: jest.fn(),
    updateEditorState: jest.fn(),
    discardDraft: jest.fn(),
  };
  const documentExportService = {
    exportDocument: jest.fn(),
  };

  let controller: DocumentsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DocumentsController(
      documentsService as any,
      documentExportService as any,
    );
  });

  it("writes render diagnostics headers for authenticated content requests", async () => {
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

  it("writes render diagnostics headers for site public content requests", async () => {
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
      syncSession: {
        sessionId: "session_1",
        sessionEpoch: 1,
        leaseExpiresAt: "2026-06-04T23:30:00.000Z",
        lastAckedOpSeq: null,
      },
      editorState: {
        mode: "edit",
        lastEditPosition: {
          blockId: "block_b",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
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
      syncSession: {
        sessionId: "session_1",
        sessionEpoch: 1,
      },
      editorState: {
        mode: "edit",
        lastEditPosition: {
          blockId: "block_b",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
    });
  });

  it("updates document editor state through the dedicated endpoint", async () => {
    documentsService.updateEditorState.mockResolvedValue({
      docId: "doc_1",
      editorState: {
        mode: "view",
        lastEditPosition: {
          blockId: "block_c",
          updatedAt: "2026-05-28T12:30:00.000Z",
        },
      },
    });

    await expect(
      controller.updateEditorState(
        "doc_1",
        {
          editorState: {
            mode: "view",
            lastEditPosition: {
              blockId: "block_c",
              updatedAt: "2026-05-28T12:30:00.000Z",
            },
          },
        } as any,
        { userId: "user_1" },
      ),
    ).resolves.toEqual({
      docId: "doc_1",
      editorState: {
        mode: "view",
        lastEditPosition: {
          blockId: "block_c",
          updatedAt: "2026-05-28T12:30:00.000Z",
        },
      },
    });
  });

  it("discards a draft idempotently", async () => {
    documentsService.discardDraft.mockResolvedValue({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });

    await expect(
      controller.discardDraft(
        "doc_1",
        {} as any,
        {
          userId: "user_1",
        },
      ),
    ).resolves.toEqual({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
  });

  it("passes optional sync session metadata when discarding a draft", async () => {
    documentsService.discardDraft.mockResolvedValue({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });

    await controller.discardDraft(
      "doc_1",
      {
        sessionId: "session_1",
        sessionEpoch: 2,
      } as any,
      { userId: "user_1" },
    );

    expect(documentsService.discardDraft).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
      expect.objectContaining({
        sessionId: "session_1",
        sessionEpoch: 2,
      }),
    );
  });

  it("passes optional sync session metadata when committing a version", async () => {
    documentsService.commitVersion = jest.fn().mockResolvedValue({
      docId: "doc_1",
      version: 5,
      draftRevision: 8,
      committed: true,
      draftRemoved: true,
    });

    await controller.commitVersion(
      "doc_1",
      {
        message: "手动保存",
        sessionId: "session_1",
        sessionEpoch: 3,
        ackedThroughOpSeq: 42,
      } as any,
      { userId: "user_1" },
    );

    expect(documentsService.commitVersion).toHaveBeenCalledWith(
      "doc_1",
      "手动保存",
      "user_1",
      expect.objectContaining({
        sessionId: "session_1",
        sessionEpoch: 3,
        ackedThroughOpSeq: 42,
      }),
    );
  });

  it("returns a download response for document export", async () => {
    documentExportService.exportDocument.mockResolvedValue({
      buffer: Buffer.from("hello"),
      filename: "Demo-v2.md",
      contentType: "text/markdown; charset=utf-8",
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
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="Demo-v2.md"',
    );
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", "5");
    expect(result).toBeInstanceOf(StreamableFile);
  });

  it("uses an RFC 5987 filename for exported documents with non-ASCII names", async () => {
    documentExportService.exportDocument.mockResolvedValue({
      buffer: Buffer.from("hello"),
      filename: "中文文档-v2.md",
      contentType: "text/markdown; charset=utf-8",
    });
    const response = { setHeader: jest.fn() };

    await controller.exportDocument(
      "doc_1",
      { format: "md" } as any,
      { userId: "user_1" },
      response as any,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      "attachment; filename=\"____-v2.md\"; filename*=UTF-8''%E4%B8%AD%E6%96%87%E6%96%87%E6%A1%A3-v2.md",
    );
  });
});
