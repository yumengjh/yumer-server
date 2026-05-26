import type { DataSource, Repository } from "typeorm";
import type { Document } from "../../entities/document.entity";
import type { Block } from "../../entities/block.entity";
import type { BlockVersion } from "../../entities/block-version.entity";
import type { DocRevision } from "../../entities/doc-revision.entity";
import type { DocSnapshot } from "../../entities/doc-snapshot.entity";
import type { Tag } from "../../entities/tag.entity";
import type { User } from "../../entities/user.entity";
import { DocumentsService } from "./documents.service";
import type { DocumentDraftService } from "./services/document-draft.service";
import type { DocumentSnapshotService } from "./services/document-snapshot.service";
import { VersionControlService } from "./services/version-control.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ActivitiesService } from "../activities/activities.service";

describe("DocumentsService", () => {
  const originalFetch = global.fetch;
  const documentRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as Repository<Document>;
  const userRepository = {
    find: jest.fn(),
  } as unknown as Repository<User>;
  const versionControlService = {} as VersionControlService;
  const documentSnapshotService = {
    createSnapshotForRevision: jest.fn(),
    getSnapshotMapForVersion: jest.fn(),
  } as unknown as DocumentSnapshotService;
  const documentDraftService = {
    findByDocId: jest.fn(),
    discardDraft: jest.fn(),
    commitDraft: jest.fn(),
  } as unknown as DocumentDraftService;
  const blockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
  } as unknown as Repository<Block>;
  const blockVersionRepository = {
    find: jest.fn(),
  } as unknown as Repository<BlockVersion>;
  const docRevisionRepository = {
    findOne: jest.fn(),
  } as unknown as Repository<DocRevision>;
  const docSnapshotRepository = {} as Repository<DocSnapshot>;
  const tagRepository = {} as Repository<Tag>;
  const dataSource = {
    transaction: jest.fn(),
  } as unknown as DataSource;
  const workspacesService = {
    checkAccess: jest.fn(),
    findOne: jest.fn(),
    checkEditPermission: jest.fn(),
  } as unknown as WorkspacesService;
  const activitiesService = {
    record: jest.fn(),
  } as unknown as ActivitiesService;
  const documentRenderService = {
    renderTree: jest.fn(),
  };

  let service: DocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
    delete process.env.PUBLIC_SITE_REVALIDATE_URL;
    delete process.env.PUBLIC_SITE_REVALIDATE_SECRET;
    service = new (DocumentsService as any)(
      documentRepository,
      versionControlService,
      documentSnapshotService,
      documentDraftService,
      blockRepository,
      blockVersionRepository,
      docRevisionRepository,
      docSnapshotRepository,
      tagRepository,
      userRepository,
      dataSource,
      workspacesService,
      activitiesService,
      documentRenderService,
    );
  });

  it("returns draft-backed edit content when a draft exists", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).findByDocId).mockResolvedValue({
      draftId: "draft_1",
      docId: "doc_1",
      baseDocVer: 3,
      updatedAt: Date.now(),
      updatedBy: "user_1",
      lockOwnerUserId: null,
      lockExpiresAt: null,
      blockVersionMap: { root_1: 1 },
    });
    jest.mocked(blockRepository.findOne as any).mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    jest.mocked(blockRepository.find as any).mockResolvedValue([]);
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        indent: 0,
        collapsed: false,
        payload: { type: "root", children: [] },
      },
    ] as BlockVersion[]);

    await expect(
      (service as any).getEditContent("doc_1", "user_1", undefined, undefined, undefined),
    ).resolves.toMatchObject({
      source: "draft",
    });
  });

  it("discards a draft idempotently", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(workspacesService.checkEditPermission as any).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).discardDraft).mockResolvedValue({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });

    await expect((service as any).discardDraft("doc_1", "user_1")).resolves.toEqual({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
  });

  it("commits the current draft through POST /documents/:docId/commit", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(workspacesService.checkEditPermission as any).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).commitDraft).mockResolvedValue({
      docId: "doc_1",
      committed: true,
      version: 4,
      draftRemoved: true,
    });

    await expect(service.commitVersion("doc_1", "manual save", "user_1")).resolves.toMatchObject({
      docId: "doc_1",
      committed: true,
      version: 4,
    });
  });

  it("maps pending-versions to draft existence for compatibility", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).findByDocId).mockResolvedValue({
      draftId: "draft_1",
    });

    await expect(service.getPendingVersions("doc_1", "user_1")).resolves.toEqual({
      docId: "doc_1",
      pendingCount: 1,
      hasPending: true,
    });
  });

  it("返回登录态文档详情时补充 creator 和 updater 公开信息", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_123",
      workspaceId: "ws_123",
      title: "Test document",
      createdBy: "u_creator",
      updatedBy: "u_updater",
      visibility: "workspace",
      status: "draft",
      viewCount: 4,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([
      {
        userId: "u_creator",
        displayName: "Alice",
        avatar: "https://cdn.example.com/alice.png",
      },
      {
        userId: "u_updater",
        displayName: "Bob",
        avatar: "https://cdn.example.com/bob.png",
      },
    ] as User[]);

    const result = await service.findOne("doc_123", "u_viewer");

    expect(result).toMatchObject({
      docId: "doc_123",
      creator: {
        userId: "u_creator",
        displayName: "Alice",
        avatar: "https://cdn.example.com/alice.png",
      },
      updater: {
        userId: "u_updater",
        displayName: "Bob",
        avatar: "https://cdn.example.com/bob.png",
      },
    });
  });

  it("返回站点公开文档详情时补充 creator 和 updater 公开信息", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_public",
      workspaceId: "ws_public",
      title: "Public document",
      createdBy: "u_creator",
      updatedBy: "u_creator",
      visibility: "public",
      status: "draft",
      publishedHead: 3,
      viewCount: 9,
      favoriteCount: 1,
      tags: [],
      category: null,
      createdAt: new Date("2026-05-20T11:04:48.000Z"),
      updatedAt: new Date("2026-05-20T15:00:44.000Z"),
    } as unknown as Document);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([
      {
        userId: "u_creator",
        displayName: "Alice",
        avatar: "https://cdn.example.com/alice.png",
      },
    ] as User[]);

    const result = await service.findOneSitePublic("doc_public");

    expect(result).toMatchObject({
      docId: "doc_public",
      createdBy: "u_creator",
      creator: {
        userId: "u_creator",
        displayName: "Alice",
        avatar: "https://cdn.example.com/alice.png",
      },
      updater: {
        userId: "u_creator",
        displayName: "Alice",
        avatar: "https://cdn.example.com/alice.png",
      },
    });
  });

  it("读取历史版本映射时优先使用 doc_snapshots 中的精确块版本映射", async () => {
    jest.mocked((documentSnapshotService as any).getSnapshotMapForVersion).mockResolvedValue({
      map: { root_1: 1, b_1: 7 },
      rootBlockId: "root_1",
      snapshot: { snapshotId: "doc_1@snap@3", createdAt: 12345 },
    });
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 3,
      createdAt: 10000,
    } as DocRevision);

    const result = await (service as any).getBlockVersionMapForVersion("doc_1", 3);

    expect(result).toEqual({
      map: { root_1: 1, b_1: 7 },
      createdAt: 10000,
    });
  });

  it("发布文档时绑定当前 head 对应的发布快照", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      head: 5,
      publishedHead: 0,
      publishedSnapshotId: null,
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest.fn().mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_1@snap@5",
    });
    jest.mocked((documentSnapshotService as any).createSnapshotForRevision).mockResolvedValue({
      snapshotId: "doc_1@snap@5",
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(docRepo),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));

    await service.publish("doc_1", "user_1");

    expect(documentSnapshotService.createSnapshotForRevision).toHaveBeenCalledWith(
      "doc_1",
      5,
      manager,
      expect.objectContaining({
        kind: "publish",
        pinned: true,
        metadata: { source: "publish" },
      }),
    );
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedHead: 5,
        publishedSnapshotId: "doc_1@snap@5",
        updatedBy: "user_1",
      }),
    );
  });

  it("公开文档发布成功后调用前端缓存失效接口", async () => {
    process.env.PUBLIC_SITE_REVALIDATE_URL = "http://frontend.test/api/revalidate-doc";
    process.env.PUBLIC_SITE_REVALIDATE_SECRET = "top-secret";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as typeof fetch;

    const document = {
      docId: "doc_36_abcd1234",
      workspaceId: "ws_1",
      head: 5,
      publishedHead: 0,
      publishedSnapshotId: null,
      visibility: "public",
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest.fn().mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest.mocked((documentSnapshotService as any).createSnapshotForRevision).mockResolvedValue({
      snapshotId: "doc_36_abcd1234@snap@5",
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(docRepo),
    };
    jest.mocked(dataSource.transaction).mockImplementation(async (callback: any) => callback(manager));

    const result = await service.publish("doc_36_abcd1234", "user_1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://frontend.test/api/revalidate-doc",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-revalidate-secret": "top-secret",
        }),
        body: JSON.stringify({ slug: "10-abcd1234" }),
      }),
    );
    expect(result).toMatchObject({
      document: {
        docId: "doc_36_abcd1234",
        publishedHead: 5,
        publishedSnapshotId: "doc_36_abcd1234@snap@5",
      },
      revalidation: {
        attempted: true,
        success: true,
        slug: "10-abcd1234",
        status: 200,
      },
    });
  });

  it("公开文档发布后缺少缓存失效配置时记录跳过日志", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;

    const document = {
      docId: "doc_36_abcd1234",
      workspaceId: "ws_1",
      head: 5,
      publishedHead: 0,
      publishedSnapshotId: null,
      visibility: "public",
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest.fn().mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest.mocked((documentSnapshotService as any).createSnapshotForRevision).mockResolvedValue({
      snapshotId: "doc_36_abcd1234@snap@5",
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(docRepo),
    };
    jest.mocked(dataSource.transaction).mockImplementation(async (callback: any) => callback(manager));

    const result = await service.publish("doc_36_abcd1234", "user_1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("公开文档缓存失效跳过：未配置回调"),
    );
    expect(result).toMatchObject({
      document: {
        docId: "doc_36_abcd1234",
        publishedHead: 5,
      },
      revalidation: {
        attempted: false,
        success: false,
        skippedReason: "missing_config",
        slug: "10-abcd1234",
      },
    });
  });

  it("公开文档发布后缓存失效成功时记录生产可见日志", async () => {
    process.env.PUBLIC_SITE_REVALIDATE_URL = "http://frontend.test/api/revalidate-doc";
    process.env.PUBLIC_SITE_REVALIDATE_SECRET = "top-secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as typeof fetch;
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;

    const document = {
      docId: "doc_36_abcd1234",
      workspaceId: "ws_1",
      head: 5,
      publishedHead: 0,
      publishedSnapshotId: null,
      visibility: "public",
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest.fn().mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest.mocked((documentSnapshotService as any).createSnapshotForRevision).mockResolvedValue({
      snapshotId: "doc_36_abcd1234@snap@5",
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(docRepo),
    };
    jest.mocked(dataSource.transaction).mockImplementation(async (callback: any) => callback(manager));

    await service.publish("doc_36_abcd1234", "user_1");

    expect(loggerLog).toHaveBeenCalledWith(
      "公开文档缓存失效成功: docId=doc_36_abcd1234, slug=10-abcd1234, status=200",
    );
  });

  it("前端缓存失效失败时不影响发布成功", async () => {
    process.env.PUBLIC_SITE_REVALIDATE_URL = "http://frontend.test/api/revalidate-doc";
    process.env.PUBLIC_SITE_REVALIDATE_SECRET = "top-secret";
    global.fetch = jest.fn().mockRejectedValue(new Error("network")) as typeof fetch;

    const document = {
      docId: "doc_36_abcd1234",
      workspaceId: "ws_1",
      head: 5,
      publishedHead: 0,
      publishedSnapshotId: null,
      visibility: "public",
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest.fn().mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest.mocked((documentSnapshotService as any).createSnapshotForRevision).mockResolvedValue({
      snapshotId: "doc_36_abcd1234@snap@5",
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(docRepo),
    };
    jest.mocked(dataSource.transaction).mockImplementation(async (callback: any) => callback(manager));

    await expect(service.publish("doc_36_abcd1234", "user_1")).resolves.toMatchObject({
      document: {
        publishedHead: 5,
        publishedSnapshotId: "doc_36_abcd1234@snap@5",
      },
      revalidation: {
        attempted: true,
        success: false,
        slug: "10-abcd1234",
        error: "network",
      },
    });
  });

  it("前端缓存失效返回非 2xx 时发布响应包含状态码和前端响应体", async () => {
    process.env.PUBLIC_SITE_REVALIDATE_URL = "http://frontend.test/api/revalidate-doc";
    process.env.PUBLIC_SITE_REVALIDATE_SECRET = "top-secret";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue(JSON.stringify({ success: false, error: "Unauthorized" })),
    }) as typeof fetch;

    const document = {
      docId: "doc_36_abcd1234",
      workspaceId: "ws_1",
      head: 5,
      publishedHead: 0,
      publishedSnapshotId: null,
      visibility: "public",
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest.fn().mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest.mocked((documentSnapshotService as any).createSnapshotForRevision).mockResolvedValue({
      snapshotId: "doc_36_abcd1234@snap@5",
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(docRepo),
    };
    jest.mocked(dataSource.transaction).mockImplementation(async (callback: any) => callback(manager));

    await expect(service.publish("doc_36_abcd1234", "user_1")).resolves.toMatchObject({
      document: {
        publishedHead: 5,
        publishedSnapshotId: "doc_36_abcd1234@snap@5",
      },
      revalidation: {
        attempted: true,
        success: false,
        slug: "10-abcd1234",
        status: 401,
        responseBody: '{"success":false,"error":"Unauthorized"}',
      },
    });
  });

  it("HTML 渲染失败时内容接口回退到原 JSON tree", async () => {
    const document = {
      docId: "doc_1",
      title: "Doc",
      rootBlockId: "root_1",
    } as Document;
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      createdAt: 1000,
    } as DocRevision);
    jest.mocked((documentSnapshotService as any).getSnapshotMapForVersion).mockResolvedValue({
      map: { root_1: 1, b_1: 1 },
      rootBlockId: "root_1",
      snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
    });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest.fn().mockResolvedValue([{ blockId: "b_1" }]);
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        payload: { type: "root", children: [] },
      },
      {
        id: 2,
        docId: "doc_1",
        blockId: "b_1",
        ver: 1,
        parentId: "root_1",
        sortKey: "1",
        payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      },
    ] as BlockVersion[]);
    documentRenderService.renderTree.mockRejectedValue(new Error("renderer unavailable"));

    const result = await (service as any).getContentByDocument(
      document,
      2,
      undefined,
      undefined,
      1000,
      "html",
    );

    expect(documentRenderService.renderTree).toHaveBeenCalled();
    expect(result.tree.children[0]).toMatchObject({
      blockId: "b_1",
      payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
    });
    expect(result.tree.children[0].html).toBeUndefined();
    expect(result.tree.children[0].blockVersionId).toBeUndefined();
  });

  it("HTML 渲染成功时内容接口附加响应头诊断所需的内部渲染信息", async () => {
    const document = {
      docId: "doc_1",
      title: "Doc",
      rootBlockId: "root_1",
    } as Document;
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      createdAt: 1000,
    } as DocRevision);
    jest.mocked((documentSnapshotService as any).getSnapshotMapForVersion).mockResolvedValue({
      map: { root_1: 1, b_1: 1 },
      rootBlockId: "root_1",
      snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
    });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest.fn().mockResolvedValue([{ blockId: "b_1" }]);
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        payload: { type: "root", children: [] },
      },
      {
        id: 2,
        docId: "doc_1",
        blockId: "b_1",
        ver: 1,
        parentId: "root_1",
        sortKey: "1",
        payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      },
    ] as BlockVersion[]);
    documentRenderService.renderTree.mockResolvedValue({
      tree: {
        blockId: "root_1",
        type: "root",
        payload: { type: "root", children: [] },
        children: [
          {
            blockId: "b_1",
            type: "paragraph",
            payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
            html: "<p>hello</p>",
          },
        ],
      },
      failures: [],
      diagnostics: {
        renderVersion: "tiptap-static-v1",
        renderMode: "fresh",
        cache: "miss",
        totalBlocks: 1,
        renderableBlocks: 1,
        cachedBlocks: 0,
        freshBlocks: 1,
        clientBlocks: 0,
        failedBlocks: 0,
      },
    });

    const result = await (service as any).getContentByDocument(
      document,
      2,
      undefined,
      undefined,
      1000,
      "all",
    );

    expect(result.renderDiagnostics).toMatchObject({
      requestedMode: "all",
      renderMode: "fresh",
      cache: "miss",
      freshBlocks: 1,
    });
  });

  it("mode=html ????????????? payload", async () => {
    const document = {
      docId: "doc_1",
      title: "Doc",
      rootBlockId: "root_1",
    } as Document;
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      createdAt: 1000,
    } as DocRevision);
    jest.mocked((documentSnapshotService as any).getSnapshotMapForVersion).mockResolvedValue({
      map: { root_1: 1, b_1: 1 },
      rootBlockId: "root_1",
      snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
    });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest.fn().mockResolvedValue([{ blockId: "b_1" }]);
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        payload: { type: "root", children: [] },
      },
      {
        id: 2,
        docId: "doc_1",
        blockId: "b_1",
        ver: 1,
        parentId: "root_1",
        sortKey: "1",
        payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      },
    ] as BlockVersion[]);
    documentRenderService.renderTree.mockResolvedValue({
      tree: {
        blockId: "root_1",
        type: "root",
        payload: { type: "root", children: [] },
        children: [
          {
            blockId: "b_1",
            type: "paragraph",
            payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
            html: "<p>hello</p>",
          },
        ],
      },
      failures: [],
      diagnostics: {
        renderVersion: "tiptap-static-v1",
        renderMode: "fresh",
        cache: "miss",
        totalBlocks: 1,
        renderableBlocks: 1,
        cachedBlocks: 0,
        freshBlocks: 1,
        clientBlocks: 0,
        failedBlocks: 0,
      },
    });

    const result = await (service as any).getContentByDocument(
      document,
      2,
      undefined,
      undefined,
      1000,
      "html",
    );

    expect(result.tree.children[0]).toMatchObject({
      blockId: "b_1",
      type: "paragraph",
      html: "<p>hello</p>",
    });
    expect(result.tree.children[0].payload).toBeUndefined();
  });

  it("mode=html ?? codeBlock ?? JSON payload", async () => {
    const document = {
      docId: "doc_1",
      title: "Doc",
      rootBlockId: "root_1",
    } as Document;
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      createdAt: 1000,
    } as DocRevision);
    jest.mocked((documentSnapshotService as any).getSnapshotMapForVersion).mockResolvedValue({
      map: { root_1: 1, code_1: 1 },
      rootBlockId: "root_1",
      snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
    });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest.fn().mockResolvedValue([{ blockId: "code_1" }]);
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        payload: { type: "root", children: [] },
      },
      {
        id: 2,
        docId: "doc_1",
        blockId: "code_1",
        ver: 1,
        parentId: "root_1",
        sortKey: "1",
        payload: { type: "codeBlock", content: [{ type: "text", text: "const x = 1" }] },
      },
    ] as BlockVersion[]);
    documentRenderService.renderTree.mockResolvedValue({
      tree: {
        blockId: "root_1",
        type: "root",
        payload: { type: "root", children: [] },
        children: [
          {
            blockId: "code_1",
            type: "codeBlock",
            payload: { type: "codeBlock", content: [{ type: "text", text: "const x = 1" }] },
          },
        ],
      },
      failures: [],
      diagnostics: {
        renderVersion: "tiptap-static-v1",
        renderMode: "client-json",
        cache: "none",
        totalBlocks: 1,
        renderableBlocks: 0,
        cachedBlocks: 0,
        freshBlocks: 0,
        clientBlocks: 1,
        failedBlocks: 0,
      },
    });

    const result = await (service as any).getContentByDocument(
      document,
      2,
      undefined,
      undefined,
      1000,
      "html",
    );

    expect(result.tree.children[0]).toMatchObject({
      blockId: "code_1",
      type: "codeBlock",
      payload: { type: "codeBlock", content: [{ type: "text", text: "const x = 1" }] },
    });
    expect(result.tree.children[0].html).toBeUndefined();
  });

  it("mode=all ?????????? payload", async () => {
    const document = {
      docId: "doc_1",
      title: "Doc",
      rootBlockId: "root_1",
    } as Document;
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      createdAt: 1000,
    } as DocRevision);
    jest.mocked((documentSnapshotService as any).getSnapshotMapForVersion).mockResolvedValue({
      map: { root_1: 1, b_1: 1 },
      rootBlockId: "root_1",
      snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
    });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest.fn().mockResolvedValue([{ blockId: "b_1" }]);
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        payload: { type: "root", children: [] },
      },
      {
        id: 2,
        docId: "doc_1",
        blockId: "b_1",
        ver: 1,
        parentId: "root_1",
        sortKey: "1",
        payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      },
    ] as BlockVersion[]);
    documentRenderService.renderTree.mockResolvedValue({
      tree: {
        blockId: "root_1",
        type: "root",
        payload: { type: "root", children: [] },
        children: [
          {
            blockId: "b_1",
            type: "paragraph",
            payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
            html: "<p>hello</p>",
          },
        ],
      },
      failures: [],
      diagnostics: {
        renderVersion: "tiptap-static-v1",
        renderMode: "fresh",
        cache: "miss",
        totalBlocks: 1,
        renderableBlocks: 1,
        cachedBlocks: 0,
        freshBlocks: 1,
        clientBlocks: 0,
        failedBlocks: 0,
      },
    });

    const result = await (service as any).getContentByDocument(
      document,
      2,
      undefined,
      undefined,
      1000,
      "all",
    );

    expect(result.tree.children[0]).toMatchObject({
      blockId: "b_1",
      type: "paragraph",
      html: "<p>hello</p>",
      payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
    });
  });

});
