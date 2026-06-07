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
import type { DraftCheckpointService } from "./draft-checkpoint.service";

describe("DocumentsService", () => {
  const originalFetch = global.fetch;
  const syncSessions: Array<Record<string, unknown>> = [];
  const documentRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as Repository<Document>;
  const userRepository = {
    find: jest.fn(),
  } as unknown as Repository<User>;
  const versionControlService = {
    getPendingVersionCount: jest.fn(),
    getPendingDraftState: jest.fn(),
    recordPendingVersion: jest.fn(),
    clearPendingVersions: jest.fn(),
  } as unknown as VersionControlService;
  const documentSnapshotService = {
    createSnapshotForRevision: jest.fn(),
    getSnapshotMapForVersion: jest.fn(),
  } as unknown as DocumentSnapshotService;
  const documentDraftService = {
    findByDocId: jest.fn(),
    lockDocumentForDraftMutation: jest.fn(),
    pointBlockToDeletedVersion: jest.fn(),
    discardDraft: jest.fn(),
    discardDraftWithManager: jest.fn(),
    commitDraft: jest.fn(),
    commitDraftWithManager: jest.fn(),
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
    getRepository: jest.fn((entity: { name?: string }) => {
      if (entity?.name === "DocumentSyncSession") {
        return {
          findOne: jest.fn(
            async ({ where }: { where?: Record<string, unknown> }) => {
              return (
                syncSessions.find((item) =>
                  Object.entries(where ?? {}).every(
                    ([key, value]) => item[key] === value,
                  ),
                ) ?? null
              );
            },
          ),
          create: jest.fn((value) => ({ ...value })),
          save: jest.fn(async (value) => {
            const index = syncSessions.findIndex(
              (item) => item.docId === value.docId,
            );
            if (index >= 0)
              syncSessions[index] = { ...syncSessions[index], ...value };
            else syncSessions.push({ ...value });
            return value;
          }),
        };
      }
      return {
        findOne: jest.fn(),
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
      };
    }),
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
  const draftCheckpointService = {
    applyDraftCheckpoint: jest.fn(),
  } as unknown as DraftCheckpointService;
  const documentRenderService = {
    renderTree: jest.fn(),
  };
  const renderCacheGcService = {
    sweepDocumentPublishedReachability: jest.fn(),
    clearDocumentRenderCaches: jest.fn(),
  };

  let service: DocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    renderCacheGcService.sweepDocumentPublishedReachability.mockResolvedValue(
      undefined,
    );
    renderCacheGcService.clearDocumentRenderCaches.mockResolvedValue(undefined);
    syncSessions.length = 0;
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
      draftCheckpointService,
      documentRenderService,
      renderCacheGcService,
    );
  });

  it("returns draft-backed edit content when a draft exists", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 12,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
      editorState: {
        mode: "edit",
        lastEditPosition: {
          blockId: "block_b",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
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
      (service as any).getEditContent(
        "doc_1",
        "user_1",
        undefined,
        undefined,
        undefined,
      ),
    ).resolves.toMatchObject({
      source: "draft",
      syncSession: {
        sessionId: expect.any(String),
        sessionEpoch: 1,
      },
      draft: {
        draftRevision: 12,
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

  it("updates editor state without touching draft content or block sync state", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 12,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
      editorState: {
        mode: "edit",
      },
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest
      .mocked(documentRepository.save)
      .mockImplementation(async (value) => value as never);

    const result = await (service as any).updateEditorState(
      "doc_1",
      {
        editorState: {
          mode: "view",
          lastEditPosition: {
            blockId: "block_c",
            previousBlockId: "block_b",
            updatedAt: "2026-05-28T12:30:00.000Z",
          },
        },
      },
      "user_1",
    );

    expect(documentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "doc_1",
        editorState: {
          mode: "view",
          lastEditPosition: {
            blockId: "block_c",
            previousBlockId: "block_b",
            updatedAt: "2026-05-28T12:30:00.000Z",
          },
        },
      }),
    );
    expect(documentDraftService.findByDocId).not.toHaveBeenCalled();
    expect(blockVersionRepository.find).not.toHaveBeenCalled();
    expect(result).toEqual({
      docId: "doc_1",
      editorState: {
        mode: "view",
        lastEditPosition: {
          blockId: "block_c",
          previousBlockId: "block_b",
          updatedAt: "2026-05-28T12:30:00.000Z",
        },
      },
    });
  });

  it("defaults missing editor mode to view in head-backed edit content", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 12,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
      editorState: {
        lastEditPosition: {
          blockId: "block_b",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest
      .mocked((documentDraftService as any).findByDocId)
      .mockResolvedValue(null);
    jest.spyOn(service as any, "getContentByDocument").mockResolvedValue({
      tree: { blockId: "root_1", type: "root", children: [] },
      pagination: { totalBlocks: 1, returnedBlocks: 1, hasMore: false },
    });

    await expect(
      (service as any).getEditContent(
        "doc_1",
        "user_1",
        undefined,
        undefined,
        undefined,
      ),
    ).resolves.toMatchObject({
      source: "head",
      draft: {
        exists: false,
        draftRevision: 12,
      },
      editorState: {
        mode: "view",
        lastEditPosition: {
          blockId: "block_b",
          updatedAt: "2026-05-28T12:00:00.000Z",
        },
      },
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
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).discardDraft).mockResolvedValue({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_discard_required",
      sessionEpoch: 1,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() + 60_000,
      lastAckedOpSeq: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expect(
      (service as any).discardDraft("doc_1", "user_1"),
    ).rejects.toThrow("SYNC_SESSION_REQUIRED");
  });

  it("accepts discardDraft when the current sync session matches", async () => {
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
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).discardDraft).mockResolvedValue({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_discard_ok",
      sessionEpoch: 2,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() + 60_000,
      lastAckedOpSeq: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expect(
      (service as any).discardDraft("doc_1", "user_1", {
        sessionId: "session_discard_ok",
        sessionEpoch: 2,
      }),
    ).resolves.toEqual({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
  });

  it("reuses the same active sync session for repeated loads by the same user", async () => {
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 12,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
      editorState: {
        mode: "edit",
      },
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest
      .mocked((documentDraftService as any).findByDocId)
      .mockResolvedValue(null);
    jest.spyOn(service as any, "getContentByDocument").mockResolvedValue({
      tree: { blockId: "root_1", type: "root", children: [] },
      pagination: { totalBlocks: 1, returnedBlocks: 1, hasMore: false },
    });

    const first = await (service as any).getEditContent("doc_1", "user_1");
    const second = await (service as any).getEditContent("doc_1", "user_1");

    expect(first.syncSession.sessionId).toBe(second.syncSession.sessionId);
    expect(first.syncSession.sessionEpoch).toBe(
      second.syncSession.sessionEpoch,
    );
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("同步 session acquired:"),
    );
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("同步 session reused:"),
    );
  });

  it("renews an active sync session and logs the renewal", async () => {
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;
    const now = Date.now();
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_renew_ok",
      sessionEpoch: 3,
      holderUserId: "user_1",
      leaseExpiresAt: now + 60_000,
      lastAckedOpSeq: 7,
      createdAt: now,
      updatedAt: now,
    });
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 12,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);

    const result = await service.renewSyncSession("doc_1", "user_1", {
      sessionId: "session_renew_ok",
      sessionEpoch: 3,
    });

    expect(result).toMatchObject({
      sessionId: "session_renew_ok",
      sessionEpoch: 3,
      lastAckedOpSeq: 7,
    });
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("同步 session renewed:"),
    );
  });

  it("rejects renewing an expired sync session and logs expiration", async () => {
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;
    const now = Date.now();
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_renew_expired",
      sessionEpoch: 4,
      holderUserId: "user_1",
      leaseExpiresAt: now - 1,
      lastAckedOpSeq: 5,
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 12,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);

    await expect(
      service.renewSyncSession("doc_1", "user_1", {
        sessionId: "session_renew_expired",
        sessionEpoch: 4,
      }),
    ).rejects.toThrow("SYNC_SESSION_EXPIRED");
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("同步 session expired:"),
    );
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
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).commitDraft).mockResolvedValue({
      docId: "doc_1",
      committed: true,
      version: 4,
      draftRevision: 12,
      draftRemoved: true,
    });
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_commit_required",
      sessionEpoch: 3,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() + 60_000,
      lastAckedOpSeq: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expect(
      service.commitVersion("doc_1", "manual save", "user_1"),
    ).rejects.toThrow("SYNC_SESSION_REQUIRED");
  });

  it("commits when the provided sync session matches the active editor session", async () => {
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
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).commitDraft).mockResolvedValue({
      docId: "doc_1",
      committed: true,
      version: 4,
      draftRevision: 12,
      draftRemoved: true,
    });
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_commit_ok",
      sessionEpoch: 4,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() + 60_000,
      lastAckedOpSeq: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expect(
      service.commitVersion("doc_1", "manual save", "user_1", {
        sessionId: "session_commit_ok",
        sessionEpoch: 4,
      }),
    ).resolves.toMatchObject({
      docId: "doc_1",
      committed: true,
      version: 4,
      draftRevision: 12,
    });
  });

  it("rejects commit beyond the server-acknowledged operation cursor", async () => {
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
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_commit_cursor",
      sessionEpoch: 6,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() + 60_000,
      lastAckedOpSeq: 8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expect(
      service.commitVersion("doc_1", "manual save", "user_1", {
        sessionId: "session_commit_cursor",
        sessionEpoch: 6,
        ackedThroughOpSeq: 9,
      }),
    ).rejects.toThrow("SYNC_SESSION_ACK_NOT_REACHED");
    expect((documentDraftService as any).commitDraft).not.toHaveBeenCalled();
  });

  it("rejects commit when the sync session lease has already expired", async () => {
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
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_expired",
      sessionEpoch: 5,
      holderUserId: "user_1",
      leaseExpiresAt: Date.now() - 1,
      lastAckedOpSeq: 6,
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
    });

    await expect(
      service.commitVersion("doc_1", "manual save", "user_1", {
        sessionId: "session_expired",
        sessionEpoch: 5,
      }),
    ).rejects.toThrow("SYNC_SESSION_EXPIRED");
  });

  it("preserves draft before revert when requested", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 5,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document;
    jest.spyOn(service as any, "findOne").mockResolvedValue(document);
    jest
      .spyOn(service as any, "checkDocumentEditPermission")
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, "getBlockVersionMapForVersion")
      .mockResolvedValue({
        map: { root_1: 1, block_1: 2 },
        createdAt: 1,
      });
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      createdAt: 1,
    } as DocRevision);
    jest.mocked((documentDraftService as any).findByDocId).mockResolvedValue({
      draftId: "doc_1@draft",
    });
    jest
      .mocked((documentDraftService as any).commitDraftWithManager)
      .mockResolvedValue({
        docId: "doc_1",
        version: 6,
        committed: true,
        draftRemoved: true,
      });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document, head: 6 }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const blockRepo = {
      find: jest.fn().mockResolvedValue([
        { blockId: "root_1", latestVer: 1, isDeleted: false },
        { blockId: "block_1", latestVer: 9, isDeleted: false },
      ]),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const revRepo = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest
        .fn()
        .mockReturnValueOnce(docRepo)
        .mockReturnValueOnce(blockRepo)
        .mockReturnValueOnce(revRepo),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
        snapshotId: "doc_1@snap@7",
      });

    await service.revert("doc_1", 2, "user_1", "preserve");

    expect(documentDraftService.commitDraftWithManager).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
      "保存回退前草稿",
      manager,
    );
    expect(revRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "回退到 v2",
        opSummary: expect.objectContaining({
          revertedFrom: 2,
          draftStrategy: "preserve",
        }),
      }),
    );
  });

  it("discards draft before revert when requested", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 5,
      publishedHead: 2,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document;
    jest.spyOn(service as any, "findOne").mockResolvedValue(document);
    jest
      .spyOn(service as any, "checkDocumentEditPermission")
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, "getBlockVersionMapForVersion")
      .mockResolvedValue({
        map: { root_1: 1, block_1: 2 },
        createdAt: 1,
      });
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 2,
      createdAt: 1,
    } as DocRevision);
    jest.mocked((documentDraftService as any).findByDocId).mockResolvedValue({
      draftId: "doc_1@draft",
    });
    jest
      .mocked((documentDraftService as any).discardDraftWithManager)
      .mockResolvedValue({
        docId: "doc_1",
        discarded: true,
        fallbackSource: "head",
      });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const blockRepo = {
      find: jest.fn().mockResolvedValue([
        { blockId: "root_1", latestVer: 1, isDeleted: false },
        { blockId: "block_1", latestVer: 9, isDeleted: false },
      ]),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const revRepo = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest
        .fn()
        .mockReturnValueOnce(docRepo)
        .mockReturnValueOnce(blockRepo)
        .mockReturnValueOnce(revRepo),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
        snapshotId: "doc_1@snap@6",
      });

    await service.revert("doc_1", 2, "user_1", "discard");

    expect(documentDraftService.discardDraftWithManager).toHaveBeenCalledWith(
      "doc_1",
      manager,
    );
    expect(documentDraftService.commitDraftWithManager).not.toHaveBeenCalled();
    expect(revRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "回退到 v2",
        opSummary: expect.objectContaining({
          revertedFrom: 2,
          draftStrategy: "discard",
        }),
      }),
    );
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

    await expect(
      service.getPendingVersions("doc_1", "user_1"),
    ).resolves.toEqual({
      docId: "doc_1",
      pendingCount: 1,
      hasPending: true,
    });
  });

  it("reopens draft content after navigating away and back, then falls back to head after discard", async () => {
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
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest
      .mocked((documentDraftService as any).findByDocId)
      .mockResolvedValueOnce({
        draftId: "draft_1",
        docId: "doc_1",
        baseDocVer: 3,
        updatedAt: Date.now(),
        updatedBy: "user_1",
        lockOwnerUserId: null,
        lockExpiresAt: null,
        blockVersionMap: { root_1: 1 },
      })
      .mockResolvedValueOnce(null);
    jest.mocked((documentDraftService as any).discardDraft).mockResolvedValue({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
    jest
      .mocked((documentSnapshotService as any).getSnapshotMapForVersion)
      .mockResolvedValue({
        map: { root_1: 1 },
        rootBlockId: "root_1",
        snapshot: { snapshotId: "doc_1@snap@3", createdAt: 1000 },
      });
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 3,
      createdAt: 1000,
    } as DocRevision);
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

    const first = await (service as any).getEditContent(
      "doc_1",
      "user_1",
      undefined,
      undefined,
      undefined,
    );
    expect(first.source).toBe("draft");

    await (service as any).discardDraft("doc_1", "user_1", {
      sessionId: first.syncSession.sessionId,
      sessionEpoch: first.syncSession.sessionEpoch,
    });

    const second = await (service as any).getEditContent(
      "doc_1",
      "user_1",
      undefined,
      undefined,
      undefined,
    );
    expect(second.source).toBe("head");
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
    jest
      .mocked((documentSnapshotService as any).getSnapshotMapForVersion)
      .mockResolvedValue({
        map: { root_1: 1, b_1: 7 },
        rootBlockId: "root_1",
        snapshot: { snapshotId: "doc_1@snap@3", createdAt: 12345 },
      });
    jest.mocked(docRevisionRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      docVer: 3,
      createdAt: 10000,
    } as DocRevision);

    const result = await (service as any).getBlockVersionMapForVersion(
      "doc_1",
      3,
    );

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
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_1@snap@5",
    });
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
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

    expect(
      documentSnapshotService.createSnapshotForRevision,
    ).toHaveBeenCalledWith(
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
    expect(
      renderCacheGcService.sweepDocumentPublishedReachability,
    ).toHaveBeenCalledWith("doc_1", "user_1");
  });

  it("发布后的渲染缓存清理失败不影响发布结果", async () => {
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
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_1@snap@5",
    });
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({ snapshotId: "doc_1@snap@5" });
    renderCacheGcService.sweepDocumentPublishedReachability.mockRejectedValue(
      new Error("render cache gc unavailable"),
    );

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) =>
        callback({ getRepository: jest.fn().mockReturnValue(docRepo) }),
      );

    await expect(service.publish("doc_1", "user_1")).resolves.toMatchObject({
      document: {
        docId: "doc_1",
        publishedHead: 5,
      },
    });
  });

  it("?????????????????????????????? published ???", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      head: 8,
      publishedHead: 7,
      publishedSnapshotId: "doc_1@snap@7",
      visibility: "public",
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    const previousPublishedSnapshot = {
      snapshotId: "doc_1@snap@7",
      docId: "doc_1",
      docVer: 7,
      kind: "publish",
      pinned: true,
      metadata: {
        source: "publish",
        publishRestore: {
          kind: "revision",
          pinned: false,
          source: "revert",
        },
      },
    } as unknown as DocSnapshot;
    const targetSnapshot = {
      snapshotId: "doc_1@snap@3",
      docId: "doc_1",
      docVer: 3,
      kind: "revision",
      pinned: false,
      metadata: {
        source: "commit",
      },
    } as unknown as DocSnapshot;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 3,
      publishedSnapshotId: "doc_1@snap@3",
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const snapshotRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.snapshotId === "doc_1@snap@7") {
          return { ...previousPublishedSnapshot };
        }
        if (where?.docId === "doc_1" && where?.docVer === 3) {
          return { ...targetSnapshot };
        }
        return null;
      }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if ((entity as { name?: string })?.name === "Document") return docRepo;
        if ((entity as { name?: string })?.name === "DocSnapshot")
          return snapshotRepo;
        return docRepo;
      }),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));

    await (service as any).publishVersion("doc_1", 3, "user_1");

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "doc_1@snap@7",
        kind: "revision",
        pinned: false,
        metadata: expect.objectContaining({
          source: "revert",
        }),
      }),
    );
    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "doc_1@snap@3",
        kind: "publish",
        pinned: true,
        metadata: expect.objectContaining({
          source: "publish",
          publishRestore: expect.objectContaining({
            kind: "revision",
            pinned: false,
            source: "commit",
          }),
        }),
      }),
    );
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedHead: 3,
        publishedSnapshotId: "doc_1@snap@3",
        updatedBy: "user_1",
      }),
    );
  });
  it("取消发布时会恢复当前发布快照并清空 published 指针", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      head: 8,
      publishedHead: 5,
      publishedSnapshotId: "doc_1@snap@5",
      visibility: "public",
      status: "draft",
      updatedBy: "old_user",
    } as Document;
    const currentPublishedSnapshot = {
      snapshotId: "doc_1@snap@5",
      docId: "doc_1",
      docVer: 5,
      kind: "publish",
      pinned: true,
      metadata: {
        source: "publish",
        publishRestore: {
          kind: "revision",
          pinned: false,
          source: "commit",
        },
      },
    } as unknown as DocSnapshot;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 0,
      publishedSnapshotId: null,
    });

    const docRepo = {
      findOne: jest.fn().mockResolvedValue({ ...document }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const snapshotRepo = {
      findOne: jest.fn().mockResolvedValue(currentPublishedSnapshot),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if ((entity as { name?: string })?.name === "Document") return docRepo;
        if ((entity as { name?: string })?.name === "DocSnapshot")
          return snapshotRepo;
        return docRepo;
      }),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));

    await (service as any).unpublish("doc_1", "user_1");

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "doc_1@snap@5",
        kind: "revision",
        pinned: false,
        metadata: expect.objectContaining({
          source: "commit",
        }),
      }),
    );
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedHead: 0,
        publishedSnapshotId: null,
        updatedBy: "user_1",
      }),
    );
    expect(renderCacheGcService.clearDocumentRenderCaches).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
    );
  });

  it("公开文档发布成功后调用前端缓存失效接口", async () => {
    process.env.PUBLIC_SITE_REVALIDATE_URL =
      "http://frontend.test/api/revalidate-doc";
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
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
        snapshotId: "doc_36_abcd1234@snap@5",
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
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
        snapshotId: "doc_36_abcd1234@snap@5",
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
    process.env.PUBLIC_SITE_REVALIDATE_URL =
      "http://frontend.test/api/revalidate-doc";
    process.env.PUBLIC_SITE_REVALIDATE_SECRET = "top-secret";
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as typeof fetch;
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
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
        snapshotId: "doc_36_abcd1234@snap@5",
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

    await service.publish("doc_36_abcd1234", "user_1");

    expect(loggerLog).toHaveBeenCalledWith(
      "公开文档缓存失效成功: docId=doc_36_abcd1234, slug=10-abcd1234, status=200",
    );
  });

  it("前端缓存失效失败时不影响发布成功", async () => {
    process.env.PUBLIC_SITE_REVALIDATE_URL =
      "http://frontend.test/api/revalidate-doc";
    process.env.PUBLIC_SITE_REVALIDATE_SECRET = "top-secret";
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("network")) as typeof fetch;

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
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
        snapshotId: "doc_36_abcd1234@snap@5",
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

    await expect(
      service.publish("doc_36_abcd1234", "user_1"),
    ).resolves.toMatchObject({
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
    process.env.PUBLIC_SITE_REVALIDATE_URL =
      "http://frontend.test/api/revalidate-doc";
    process.env.PUBLIC_SITE_REVALIDATE_SECRET = "top-secret";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: jest
        .fn()
        .mockResolvedValue(
          JSON.stringify({ success: false, error: "Unauthorized" }),
        ),
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
    (service as any).checkDocumentEditPermission = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).findOne = jest.fn().mockResolvedValue({
      ...document,
      publishedHead: 5,
      publishedSnapshotId: "doc_36_abcd1234@snap@5",
    });
    jest
      .mocked((documentSnapshotService as any).createSnapshotForRevision)
      .mockResolvedValue({
        snapshotId: "doc_36_abcd1234@snap@5",
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

    await expect(
      service.publish("doc_36_abcd1234", "user_1"),
    ).resolves.toMatchObject({
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
    jest
      .mocked((documentSnapshotService as any).getSnapshotMapForVersion)
      .mockResolvedValue({
        map: { root_1: 1, b_1: 1 },
        rootBlockId: "root_1",
        snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
      });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest
      .fn()
      .mockResolvedValue([{ blockId: "b_1" }]);
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
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "hello" }],
        },
      },
    ] as BlockVersion[]);
    documentRenderService.renderTree.mockRejectedValue(
      new Error("renderer unavailable"),
    );

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
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "hello" }],
      },
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
    jest
      .mocked((documentSnapshotService as any).getSnapshotMapForVersion)
      .mockResolvedValue({
        map: { root_1: 1, b_1: 1 },
        rootBlockId: "root_1",
        snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
      });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest
      .fn()
      .mockResolvedValue([{ blockId: "b_1" }]);
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
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "hello" }],
        },
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
            payload: {
              type: "paragraph",
              content: [{ type: "text", text: "hello" }],
            },
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
    jest
      .mocked((documentSnapshotService as any).getSnapshotMapForVersion)
      .mockResolvedValue({
        map: { root_1: 1, b_1: 1 },
        rootBlockId: "root_1",
        snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
      });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest
      .fn()
      .mockResolvedValue([{ blockId: "b_1" }]);
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
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "hello" }],
        },
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
            payload: {
              type: "paragraph",
              content: [{ type: "text", text: "hello" }],
            },
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
    jest
      .mocked((documentSnapshotService as any).getSnapshotMapForVersion)
      .mockResolvedValue({
        map: { root_1: 1, code_1: 1 },
        rootBlockId: "root_1",
        snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
      });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest
      .fn()
      .mockResolvedValue([{ blockId: "code_1" }]);
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
        payload: {
          type: "codeBlock",
          content: [{ type: "text", text: "const x = 1" }],
        },
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
            payload: {
              type: "codeBlock",
              content: [{ type: "text", text: "const x = 1" }],
            },
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
      payload: {
        type: "codeBlock",
        content: [{ type: "text", text: "const x = 1" }],
      },
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
    jest
      .mocked((documentSnapshotService as any).getSnapshotMapForVersion)
      .mockResolvedValue({
        map: { root_1: 1, b_1: 1 },
        rootBlockId: "root_1",
        snapshot: { snapshotId: "doc_1@snap@2", createdAt: 1000 },
      });
    (blockRepository as any).findOne = jest.fn().mockResolvedValue({
      blockId: "root_1",
      isDeleted: false,
    });
    (blockRepository as any).find = jest
      .fn()
      .mockResolvedValue([{ blockId: "b_1" }]);
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
        payload: {
          type: "paragraph",
          content: [{ type: "text", text: "hello" }],
        },
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
            payload: {
              type: "paragraph",
              content: [{ type: "text", text: "hello" }],
            },
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
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("pending versions endpoint does not increment view count", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      status: "draft",
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked((versionControlService as any).getPendingVersionCount)
      .mockReturnValue(3);

    const result = await service.getPendingVersions("doc_1", "user_1");

    expect(result).toEqual({
      docId: "doc_1",
      pendingCount: 3,
      hasPending: true,
    });
    expect(documentRepository.save).not.toHaveBeenCalled();
  });

  it("export source uses the latest committed head without view count side effects", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      status: "draft",
      head: 4,
    } as Document;
    jest.mocked(documentRepository.findOne).mockResolvedValue(document);
    const getContentByDocument = jest
      .spyOn(service as any, "getContentByDocument")
      .mockResolvedValue({
        docId: "doc_1",
        docVer: 4,
        title: "Doc",
        tree: { blockId: "root", type: "root", payload: {}, children: [] },
      });

    const result = await service.getExportSource("doc_1", "user_1");

    expect(getContentByDocument).toHaveBeenCalledWith(
      document,
      4,
      undefined,
      undefined,
      undefined,
      "all",
    );
    expect(result.document).toBe(document);
    expect(result.content.docVer).toBe(4);
    expect(documentRepository.save).not.toHaveBeenCalled();
  });

  it("supports diffing a saved revision against the current draft", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 5,
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
      draftId: "doc_1@draft",
      updatedAt: 1700000000000,
      blockVersionMap: { root_1: 1, block_1: 3 },
    });

    jest
      .spyOn(service as any, "getBlockVersionMapForVersion")
      .mockResolvedValue({
        map: { root_1: 1, block_1: 2 },
        createdAt: 1690000000000,
      });
    jest
      .spyOn(service as any, "buildContentTreeFromVersionMap")
      .mockResolvedValue({
        tree: { blockId: "root_1" },
        totalBlocks: 1,
        returnedBlocks: 1,
        hasMore: false,
      });
    jest.spyOn(service as any, "buildDiff").mockResolvedValue({
      summary: {
        added: 0,
        deleted: 0,
        modified: 1,
        moved: 0,
        reordered: 0,
        indentChanged: 0,
        unchanged: 1,
      },
      changes: [{ type: "modified", blockId: "block_1" }],
    });

    const result = await service.getDiff(
      "doc_1",
      { fromKind: "revision", fromVer: 4, toKind: "draft" },
      "user_1",
    );

    expect(result.fromVer).toBe(4);
    expect(result.toVer).toBeNull();
    expect(result.fromRef).toEqual({
      kind: "revision",
      label: "v4",
      version: 4,
    });
    expect(result.toRef).toEqual({
      kind: "draft",
      label: "draft",
      version: null,
    });
    expect((documentDraftService as any).findByDocId).toHaveBeenCalledWith(
      "doc_1",
    );
  });

  it("supports diffing the current draft against a saved revision", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 5,
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
      draftId: "doc_1@draft",
      updatedAt: 1700000000000,
      blockVersionMap: { root_1: 1, block_1: 3 },
    });

    const getBlockVersionMapForVersion = jest
      .spyOn(service as any, "getBlockVersionMapForVersion")
      .mockResolvedValue({
        map: { root_1: 1, block_1: 2 },
        createdAt: 1690000000000,
      });
    jest
      .spyOn(service as any, "buildContentTreeFromVersionMap")
      .mockResolvedValue({
        tree: { blockId: "root_1" },
        totalBlocks: 1,
        returnedBlocks: 1,
        hasMore: false,
      });
    jest.spyOn(service as any, "buildDiff").mockResolvedValue({
      summary: {
        added: 0,
        deleted: 0,
        modified: 1,
        moved: 0,
        reordered: 0,
        indentChanged: 0,
        unchanged: 1,
      },
      changes: [{ type: "modified", blockId: "block_1" }],
    });

    const result = await service.getDiff(
      "doc_1",
      { fromKind: "draft", toKind: "revision", toVer: 5 },
      "user_1",
    );

    expect(result.fromVer).toBeNull();
    expect(result.toVer).toBe(5);
    expect(result.fromRef).toEqual({
      kind: "draft",
      label: "draft",
      version: null,
    });
    expect(result.toRef).toEqual({ kind: "revision", label: "v5", version: 5 });
    expect(getBlockVersionMapForVersion).toHaveBeenCalledWith("doc_1", 5);
  });

  it("rejects draft diff requests when no draft exists", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 5,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest
      .mocked((documentDraftService as any).findByDocId)
      .mockResolvedValue(null);

    await expect(
      service.getDiff(
        "doc_1",
        { fromKind: "revision", fromVer: 4, toKind: "draft" },
        "user_1",
      ),
    ).rejects.toThrow("draft not found");
  });

  it("ignores draft-only tombstone blocks when diffing visible content", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 5,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).findByDocId).mockResolvedValue({
      draftId: "doc_1@draft",
      updatedAt: 1700000000000,
      blockVersionMap: { root_1: 1, block_a: 2, block_deleted: 9 },
    });

    jest
      .spyOn(service as any, "getBlockVersionMapForVersion")
      .mockResolvedValue({
        map: { root_1: 1, block_a: 2 },
        createdAt: 1690000000000,
      });
    jest
      .spyOn(service as any, "buildContentTreeFromVersionMap")
      .mockResolvedValue({
        tree: { blockId: "root_1" },
        totalBlocks: 2,
        returnedBlocks: 2,
        hasMore: false,
      });
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        indent: 0,
        payload: { type: "root", children: [] },
        hash: "root",
      },
      {
        blockId: "block_a",
        ver: 2,
        parentId: "root_1",
        sortKey: "001000",
        indent: 0,
        payload: {
          type: "paragraph",
          attrs: {},
          content: [{ type: "text", text: "hello" }],
        },
        hash: "same",
      },
      {
        blockId: "block_deleted",
        ver: 9,
        parentId: "root_1",
        sortKey: "002000",
        indent: 0,
        payload: {
          type: "paragraph",
          attrs: { deleted: true },
          content: [{ type: "text", text: "ghost" }],
        },
        hash: "deleted",
      },
    ] as BlockVersion[]);

    const result = await service.getDiff(
      "doc_1",
      { fromKind: "revision", fromVer: 4, toKind: "draft" },
      "user_1",
    );

    expect(result.summary).toEqual({
      added: 0,
      deleted: 0,
      modified: 0,
      moved: 0,
      reordered: 0,
      indentChanged: 0,
      unchanged: 2,
    });
    expect(result.changes).toEqual([]);
  });

  it("treats draft tombstone of an existing block as a deletion", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 5,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([] as User[]);
    jest.mocked((documentDraftService as any).findByDocId).mockResolvedValue({
      draftId: "doc_1@draft",
      updatedAt: 1700000000000,
      blockVersionMap: { root_1: 1, block_a: 5 },
    });

    jest
      .spyOn(service as any, "getBlockVersionMapForVersion")
      .mockResolvedValue({
        map: { root_1: 1, block_a: 2 },
        createdAt: 1690000000000,
      });
    jest
      .spyOn(service as any, "buildContentTreeFromVersionMap")
      .mockResolvedValue({
        tree: { blockId: "root_1" },
        totalBlocks: 2,
        returnedBlocks: 2,
        hasMore: false,
      });
    jest.mocked(blockVersionRepository.find).mockResolvedValue([
      {
        blockId: "root_1",
        ver: 1,
        parentId: "",
        sortKey: "0",
        indent: 0,
        payload: { type: "root", children: [] },
        hash: "root",
      },
      {
        blockId: "block_a",
        ver: 2,
        parentId: "root_1",
        sortKey: "001000",
        indent: 0,
        payload: {
          type: "paragraph",
          attrs: {},
          content: [{ type: "text", text: "hello" }],
        },
        hash: "same",
      },
      {
        blockId: "block_a",
        ver: 5,
        parentId: "root_1",
        sortKey: "001000",
        indent: 0,
        payload: {
          type: "paragraph",
          attrs: { deleted: true },
          content: [{ type: "text", text: "hello" }],
        },
        hash: "deleted",
      },
    ] as BlockVersion[]);

    const result = await service.getDiff(
      "doc_1",
      { fromKind: "revision", fromVer: 4, toKind: "draft" },
      "user_1",
    );

    expect(result.summary.deleted).toBe(1);
    expect(result.changes).toEqual([
      expect.objectContaining({
        type: "deleted",
        blockId: "block_a",
      }),
    ]);
  });

  it("reconciles idle manifest by tombstoning missing sync-created draft blocks", async () => {
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;
    const now = Date.now();
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_1",
      sessionEpoch: 1,
      holderUserId: "user_1",
      leaseExpiresAt: now + 60_000,
      updatedAt: now,
    });
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 7,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);

    const docInTx = {
      docId: "doc_1",
      rootBlockId: "root_1",
      draftRevision: 7,
      updatedBy: "user_1",
    } as Document;
    jest
      .mocked((documentDraftService as any).lockDocumentForDraftMutation)
      .mockResolvedValue(docInTx);
    jest
      .mocked((documentDraftService as any).pointBlockToDeletedVersion)
      .mockResolvedValue({
        draftId: "draft_1",
      });

    const draftRepo = {
      findOne: jest.fn().mockResolvedValue({
        docId: "doc_1",
        rootBlockId: "root_1",
        blockVersionMap: {
          root_1: 1,
          block_live: 1,
          block_orphan: 1,
        },
      }),
    };
    const blockVersionRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ maxVer: 1 }),
      })),
    };
    const tombstoneRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const reconcileReceiptRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity: { name?: string }) => {
        if (entity?.name === "DocDraft") return draftRepo;
        if (entity?.name === "BlockVersion") return blockVersionRepo;
        if (entity?.name === "SyncCreateTombstone") return tombstoneRepo;
        if (entity?.name === "SyncReconcileReceipt")
          return reconcileReceiptRepo;
        return {};
      }),
      find: jest.fn().mockResolvedValue([
        {
          docId: "doc_1",
          blockId: "block_orphan",
          ver: 1,
          parentId: "root_1",
          sortKey: "001000",
          indent: 0,
          collapsed: false,
          payload: {
            type: "paragraph",
            attrs: {
              clientId: "client_orphan",
              syncCreateId: "sync-create:client_orphan",
            },
            content: [{ type: "text", text: "orphan" }],
          },
          plainText: "orphan",
          refs: [],
        },
      ]),
      findOne: jest.fn().mockResolvedValue({
        docId: "doc_1",
        blockId: "block_orphan",
        latestVer: 1,
      }),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (_entity, value) => value),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));

    const result = await service.reconcileSyncManifest("doc_1", "user_1", {
      draftRevision: 7,
      sessionId: "session_1",
      sessionEpoch: 1,
      clientBatchId: "reconcile_1",
      manifest: [{ blockId: "block_live", clientId: "client_live" }],
    });

    expect(result).toMatchObject({
      docId: "doc_1",
      draftRevision: 8,
      needsReload: false,
      tombstoned: [
        {
          blockId: "block_orphan",
          version: 2,
          clientId: "client_orphan",
          syncCreateId: "sync-create:client_orphan",
        },
      ],
    });
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        blockId: "block_orphan",
        ver: 2,
        payload: expect.objectContaining({
          attrs: expect.objectContaining({ deleted: true }),
        }),
      }),
    );
    expect(
      documentDraftService.pointBlockToDeletedVersion,
    ).toHaveBeenCalledWith("doc_1", "block_orphan", 2, "user_1", manager);
    expect(tombstoneRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "doc_1",
        clientId: "client_orphan",
        syncCreateId: "sync-create:client_orphan",
        deleteClientBatchId: "reconcile_1",
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        docId: "doc_1",
        draftRevision: 8,
      }),
    );
    expect(reconcileReceiptRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "doc_1",
        clientBatchId: "reconcile_1",
        draftRevision: 8,
        needsReload: false,
      }),
    );
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("同步 manifest reconcile applied:"),
    );
  });

  it("does not reconcile an idle manifest built on a stale draft revision", async () => {
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;
    const now = Date.now();
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_1",
      sessionEpoch: 1,
      holderUserId: "user_1",
      leaseExpiresAt: now + 60_000,
      updatedAt: now,
    });
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 8,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    const docInTx = { docId: "doc_1", draftRevision: 8 } as Document;
    jest
      .mocked((documentDraftService as any).lockDocumentForDraftMutation)
      .mockResolvedValue(docInTx);
    const manager = {
      getRepository: jest.fn((entity: { name?: string }) => {
        if (entity?.name === "SyncReconcileReceipt") {
          return {
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn(async (value) => value),
          };
        }
        return {};
      }),
      save: jest.fn(),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));

    const result = await service.reconcileSyncManifest("doc_1", "user_1", {
      draftRevision: 7,
      sessionId: "session_1",
      sessionEpoch: 1,
      clientBatchId: "reconcile_stale",
      manifest: [],
    });

    expect(result).toMatchObject({
      docId: "doc_1",
      draftRevision: 8,
      needsReload: true,
      conflicts: [{ code: "DRAFT_REVISION_MISMATCH" }],
      tombstoned: [],
    });
    expect(manager.save).not.toHaveBeenCalled();
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "同步 manifest reconcile draft-revision-mismatch:",
      ),
    );
  });

  it("replays an existing sync-reconcile receipt for the same request fingerprint", async () => {
    const loggerLog = jest.fn();
    (service as any).logger.log = loggerLog;
    const now = Date.now();
    syncSessions.push({
      docId: "doc_1",
      sessionId: "session_1",
      sessionEpoch: 1,
      holderUserId: "user_1",
      leaseExpiresAt: now + 60_000,
      updatedAt: now,
    });
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 7,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest
      .mocked((documentDraftService as any).lockDocumentForDraftMutation)
      .mockResolvedValue({
        docId: "doc_1",
        draftRevision: 7,
      } as Document);
    const manifest = [{ blockId: "block_live", clientId: "client_live" }];
    const request = {
      draftRevision: 7,
      sessionId: "session_1",
      sessionEpoch: 1,
      clientBatchId: "reconcile_replay",
      manifest,
    };
    const requestFingerprint = JSON.stringify(request);
    const receiptRepo = {
      findOne: jest.fn().mockResolvedValue({
        docId: "doc_1",
        clientBatchId: "reconcile_replay",
        requestFingerprint,
        checkedAt: now,
        draftRevision: 9,
        needsReload: false,
        conflicts: [],
        tombstoned: [{ blockId: "block_old", version: 2 }],
      }),
      save: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity: { name?: string }) =>
        entity?.name === "SyncReconcileReceipt" ? receiptRepo : {},
      ),
      save: jest.fn(),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));

    const result = await service.reconcileSyncManifest(
      "doc_1",
      "user_1",
      request,
    );

    expect(result).toMatchObject({
      docId: "doc_1",
      checkedAt: now,
      draftRevision: 9,
      needsReload: false,
      tombstoned: [{ blockId: "block_old", version: 2 }],
    });
    expect(receiptRepo.save).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("同步 manifest reconcile replay:"),
    );
  });

  it("checks edit permission before applying a draft checkpoint", async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 7,
      createdBy: "user_1",
      updatedBy: "user_1",
      visibility: "workspace",
      status: "draft",
      viewCount: 0,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest
      .mocked(workspacesService.checkEditPermission as any)
      .mockResolvedValue(undefined);
    jest
      .mocked((draftCheckpointService as any).applyDraftCheckpoint)
      .mockResolvedValue({
        acceptedCheckpointId: "checkpoint_1",
        needsReload: false,
      });

    await service.applyDraftCheckpoint("doc_1", "user_1", {
      mode: "checkpoint",
      coverage: "full",
      clientCheckpointId: "checkpoint_1",
      clientId: "client_1",
      baseVersion: 3,
      draftRevision: 7,
      sessionId: "session_1",
      sessionEpoch: 1,
      contentHash: "sha256:test",
      generatedAt: Date.now(),
      rootBlockId: "root_1",
      blocks: [],
    });

    expect(workspacesService.checkAccess).toHaveBeenCalledWith(
      "ws_1",
      "user_1",
    );
    expect(workspacesService.checkEditPermission).toHaveBeenCalledWith(
      "ws_1",
      "user_1",
    );
    expect(draftCheckpointService.applyDraftCheckpoint).toHaveBeenCalled();
  });
});
