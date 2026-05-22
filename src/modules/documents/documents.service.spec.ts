import type { DataSource, Repository } from "typeorm";
import type { Document } from "../../entities/document.entity";
import type { Block } from "../../entities/block.entity";
import type { BlockVersion } from "../../entities/block-version.entity";
import type { DocRevision } from "../../entities/doc-revision.entity";
import type { DocSnapshot } from "../../entities/doc-snapshot.entity";
import type { Tag } from "../../entities/tag.entity";
import type { User } from "../../entities/user.entity";
import { DocumentsService } from "./documents.service";
import type { DocumentSnapshotService } from "./services/document-snapshot.service";
import { VersionControlService } from "./services/version-control.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ActivitiesService } from "../activities/activities.service";

describe("DocumentsService", () => {
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
  const blockRepository = {} as Repository<Block>;
  const blockVersionRepository = {} as Repository<BlockVersion>;
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
  } as unknown as WorkspacesService;
  const activitiesService = {
    record: jest.fn(),
  } as unknown as ActivitiesService;

  let service: DocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new (DocumentsService as any)(
      documentRepository,
      versionControlService,
      documentSnapshotService,
      blockRepository,
      blockVersionRepository,
      docRevisionRepository,
      docSnapshotRepository,
      tagRepository,
      userRepository,
      dataSource,
      workspacesService,
      activitiesService,
    );
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
});
