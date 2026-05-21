import type { DataSource, Repository } from 'typeorm';
import type { Document } from '../../entities/document.entity';
import type { Block } from '../../entities/block.entity';
import type { BlockVersion } from '../../entities/block-version.entity';
import type { DocRevision } from '../../entities/doc-revision.entity';
import type { DocSnapshot } from '../../entities/doc-snapshot.entity';
import type { Tag } from '../../entities/tag.entity';
import type { User } from '../../entities/user.entity';
import { DocumentsService } from './documents.service';
import { VersionControlService } from './services/version-control.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ActivitiesService } from '../activities/activities.service';

describe('DocumentsService', () => {
  const documentRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as Repository<Document>;
  const userRepository = {
    find: jest.fn(),
  } as unknown as Repository<User>;
  const versionControlService = {} as VersionControlService;
  const blockRepository = {} as Repository<Block>;
  const blockVersionRepository = {} as Repository<BlockVersion>;
  const docRevisionRepository = {} as Repository<DocRevision>;
  const docSnapshotRepository = {} as Repository<DocSnapshot>;
  const tagRepository = {} as Repository<Tag>;
  const dataSource = {} as DataSource;
  const workspacesService = {
    checkAccess: jest.fn(),
    findOne: jest.fn(),
  } as unknown as WorkspacesService;
  const activitiesService = {} as ActivitiesService;

  let service: DocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new (DocumentsService as any)(
      documentRepository,
      versionControlService,
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

  it('返回登录态文档详情时补充 creator 和 updater 公开信息', async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: 'doc_123',
      workspaceId: 'ws_123',
      title: 'Test document',
      createdBy: 'u_creator',
      updatedBy: 'u_updater',
      visibility: 'workspace',
      status: 'draft',
      viewCount: 4,
    } as Document);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([
      {
        userId: 'u_creator',
        displayName: 'Alice',
        avatar: 'https://cdn.example.com/alice.png',
      },
      {
        userId: 'u_updater',
        displayName: 'Bob',
        avatar: 'https://cdn.example.com/bob.png',
      },
    ] as User[]);

    const result = await service.findOne('doc_123', 'u_viewer');

    expect(result).toMatchObject({
      docId: 'doc_123',
      creator: {
        userId: 'u_creator',
        displayName: 'Alice',
        avatar: 'https://cdn.example.com/alice.png',
      },
      updater: {
        userId: 'u_updater',
        displayName: 'Bob',
        avatar: 'https://cdn.example.com/bob.png',
      },
    });
  });

  it('返回站点公开文档详情时补充 creator 和 updater 公开信息', async () => {
    jest.mocked(documentRepository.findOne).mockResolvedValue({
      docId: 'doc_public',
      workspaceId: 'ws_public',
      title: 'Public document',
      createdBy: 'u_creator',
      updatedBy: 'u_creator',
      visibility: 'public',
      status: 'draft',
      publishedHead: 3,
      viewCount: 9,
      favoriteCount: 1,
      tags: [],
      category: null,
      createdAt: new Date('2026-05-20T11:04:48.000Z'),
      updatedAt: new Date('2026-05-20T15:00:44.000Z'),
    } as unknown as Document);
    jest.mocked(documentRepository.save).mockResolvedValue(undefined as never);
    jest.mocked(userRepository.find).mockResolvedValue([
      {
        userId: 'u_creator',
        displayName: 'Alice',
        avatar: 'https://cdn.example.com/alice.png',
      },
    ] as User[]);

    const result = await service.findOneSitePublic('doc_public');

    expect(result).toMatchObject({
      docId: 'doc_public',
      createdBy: 'u_creator',
      creator: {
        userId: 'u_creator',
        displayName: 'Alice',
        avatar: 'https://cdn.example.com/alice.png',
      },
      updater: {
        userId: 'u_creator',
        displayName: 'Alice',
        avatar: 'https://cdn.example.com/alice.png',
      },
    });
  });
});
