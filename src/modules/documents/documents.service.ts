import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Optional,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  Repository,
  DataSource,
  EntityManager,
  In,
  Or,
  MoreThan,
  IsNull,
} from "typeorm";
import { Document } from "../../entities/document.entity";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { BlockRenderCache } from "../../entities/block-render-cache.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { DocumentSyncSession } from "../../entities/document-sync-session.entity";
import { SyncCreateTombstone } from "../../entities/sync-create-tombstone.entity";
import { SyncBatchReceipt } from "../../entities/sync-batch-receipt.entity";
import { SyncCheckpointReceipt } from "../../entities/sync-checkpoint-receipt.entity";
import { SyncReconcileReceipt } from "../../entities/sync-reconcile-receipt.entity";
import { Comment } from "../../entities/comment.entity";
import { Favorite } from "../../entities/favorite.entity";
import { Tag } from "../../entities/tag.entity";
import { User } from "../../entities/user.entity";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DocumentSnapshotService } from "./services/document-snapshot.service";
import { DocumentDraftService } from "./services/document-draft.service";
import { VersionControlService } from "./services/version-control.service";
import {
  generateDocId,
  generateBlockId,
  generateVersionId,
} from "../../common/utils/id-generator.util";
import { compareSortKey } from "../../common/utils/sort-key.util";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { UpdateEditorStateDto } from "./dto/update-editor-state.dto";
import type {
  DiffResponse,
  DiffChangeItem,
  DiffSummary,
  BlockSnapshot,
} from "./dto/diff-response.dto";
import { MoveDocumentDto } from "./dto/move-document.dto";
import { QueryDocumentsDto } from "./dto/query-documents.dto";
import { QueryRevisionsDto } from "./dto/query-revisions.dto";
import type { RevertDraftStrategy } from "./dto/revert-version.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { SyncStateResponseDto } from "./dto/sync-state-response.dto";
import type { SyncReconcileDto } from "./dto/sync-reconcile.dto";
import type {
  DraftCheckpointDto,
  DraftCheckpointResponseDto,
} from "./dto/draft-checkpoint.dto";
import type {
  DocumentActorSummaryResponse,
  DocumentDetailResponse,
  DocumentListItemResponse,
  DocumentRevisionListItemResponse,
  DocumentSnapshotResponse,
  PublicDocumentDetailResponse,
} from "./dto/document-response.dto";
import type { DiffRefKind } from "./dto/diff-versions.dto";
import { DiffVersionsDto } from "./dto/diff-versions.dto";
import { ActivitiesService } from "../activities/activities.service";
import { DOC_ACTIONS } from "../activities/constants/activity-actions";
import { SITE_PUBLIC_ANONYMOUS_USER_ID } from "../../common/decorators/public.decorator";
import {
  DocumentRenderService,
  type DocumentRenderDiagnostics,
} from "./services/document-render.service";
import { DraftCheckpointService } from "./draft-checkpoint.service";
import { GcRenderCacheService } from "../gc/modules/render-cache/gc-render-cache.service";

type DocumentActorSummary = {
  userId: string;
  displayName: string | null;
  avatar: string | null;
};

type DocumentMetaProjection = DocumentListItemResponse &
  Partial<
    Pick<DocumentDetailResponse, "rootBlockId" | "head" | "draftRevision">
  >;

type ResolvedDiffRef = {
  kind: DiffRefKind;
  label: string;
  version: number | null;
  createdAt: number;
  map: Record<string, number>;
};

export type ContentRenderDiagnostics = DocumentRenderDiagnostics & {
  requestedMode: "json" | "html" | "all";
};

export type PublicDocumentRevalidationResult = {
  attempted: boolean;
  success: boolean;
  skippedReason?: "not_public" | "missing_config" | "invalid_slug";
  slug?: string;
  status?: number;
  responseBody?: string;
  error?: string;
};

type PublishRestoreState = {
  kind?: string;
  pinned?: boolean;
  source?: unknown;
};

type SyncSessionInput = {
  sessionId?: string;
  sessionEpoch?: number;
  ackedThroughOpSeq?: number;
};

type SyncManifestIdentity = {
  blockId?: string | null;
  clientId?: string | null;
  syncCreateId?: string | null;
};

type SyncReconcileTombstone = {
  blockId: string;
  version: number;
  clientId: string | null;
  syncCreateId: string | null;
};

type SyncReconcileResponse = {
  draftRevision: number;
  needsReload: boolean;
  conflicts: Array<Record<string, unknown>>;
  tombstoned: SyncReconcileTombstone[];
};

const DOCUMENT_STATUS_DELETED = "deleted";
const DEFAULT_RESTORED_DOCUMENT_STATUS = "normal";
const DEFAULT_TRASH_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type TrashLifecycleFields = {
  trashRetentionDays: number;
  trashExpiresAt: string | null;
  trashDaysRemaining: number | null;
};

function toSafeISOString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    date = new Date(Number(value));
  } else {
    date = new Date(value as string);
  }

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDocumentEditorState(
  editorState: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    ...(editorState ?? {}),
    mode: editorState?.mode === "edit" ? "edit" : "view",
  };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly syncSessionLeaseMs = 5 * 60 * 1000;
  private readonly syncCreateTombstoneTtlMs = 30 * 60 * 1000;

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private versionControlService: VersionControlService,
    private documentSnapshotService: DocumentSnapshotService,
    private documentDraftService: DocumentDraftService,
    @InjectRepository(Block)
    private blockRepository: Repository<Block>,
    @InjectRepository(BlockVersion)
    private blockVersionRepository: Repository<BlockVersion>,
    @InjectRepository(DocRevision)
    private docRevisionRepository: Repository<DocRevision>,
    @InjectRepository(DocSnapshot)
    private docSnapshotRepository: Repository<DocSnapshot>,
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectDataSource()
    private dataSource: DataSource,
    private workspacesService: WorkspacesService,
    private activitiesService: ActivitiesService,
    private draftCheckpointService: DraftCheckpointService,
    private documentRenderService?: DocumentRenderService,
    @Optional()
    private renderCacheGcService?: GcRenderCacheService,
  ) {}

  private getDocumentSyncSessionRepository() {
    return this.dataSource.getRepository(DocumentSyncSession);
  }

  private buildSyncSessionResponse(session: DocumentSyncSession) {
    return {
      sessionId: session.sessionId,
      sessionEpoch: session.sessionEpoch,
      leaseExpiresAt: new Date(session.leaseExpiresAt).toISOString(),
      lastAckedOpSeq: session.lastAckedOpSeq ?? null,
    };
  }

  private buildSyncSessionRenewResponse(session: DocumentSyncSession) {
    return {
      leaseExpiresAt: new Date(session.leaseExpiresAt).toISOString(),
      lastAckedOpSeq: session.lastAckedOpSeq ?? null,
    };
  }

  private async acquireDocumentSyncSession(docId: string, userId: string) {
    const repo = this.getDocumentSyncSessionRepository();
    const existing = await repo.findOne({ where: { docId } });
    const now = Date.now();
    if (
      existing &&
      existing.holderUserId === userId &&
      existing.leaseExpiresAt >= now
    ) {
      existing.leaseExpiresAt = now + this.syncSessionLeaseMs;
      existing.updatedAt = now;
      const renewed = await repo.save(existing);
      this.logSyncSessionEvent("reused", {
        docId,
        userId,
        sessionId: renewed.sessionId,
        sessionEpoch: renewed.sessionEpoch,
        lastAckedOpSeq: renewed.lastAckedOpSeq ?? null,
      });
      return renewed as DocumentSyncSession;
    }
    const nextSession = repo.create({
      ...(existing
        ? { id: existing.id, createdAt: existing.createdAt }
        : { createdAt: now }),
      docId,
      sessionId: `sync_${randomBytes(12).toString("hex")}`,
      sessionEpoch: (existing?.sessionEpoch ?? 0) + 1,
      holderUserId: userId,
      leaseExpiresAt: now + this.syncSessionLeaseMs,
      lastAckedOpSeq: existing?.lastAckedOpSeq ?? null,
      updatedAt: now,
    });
    const saved = await repo.save(nextSession);
    this.logSyncSessionEvent(existing ? "reacquired" : "acquired", {
      docId,
      userId,
      sessionId: saved.sessionId,
      sessionEpoch: saved.sessionEpoch,
      lastAckedOpSeq: saved.lastAckedOpSeq ?? null,
    });
    return saved as DocumentSyncSession;
  }

  private getTrashRetentionDays(): number {
    const raw = process.env.DOCUMENT_TRASH_RETENTION_DAYS;
    const parsed = raw ? Number(raw) : DEFAULT_TRASH_RETENTION_DAYS;
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_TRASH_RETENTION_DAYS;
    }
    return Math.floor(parsed);
  }

  private getTrashLifecycleFields(
    document: Pick<Document, "status" | "deletedAt">,
    now: Date = new Date(),
  ): TrashLifecycleFields | null {
    if (
      document.status !== DOCUMENT_STATUS_DELETED ||
      document.deletedAt === null ||
      document.deletedAt === undefined
    ) {
      return null;
    }

    const deletedAtTime =
      document.deletedAt instanceof Date
        ? document.deletedAt.getTime()
        : new Date(document.deletedAt).getTime();
    if (Number.isNaN(deletedAtTime)) {
      return {
        trashRetentionDays: this.getTrashRetentionDays(),
        trashExpiresAt: null,
        trashDaysRemaining: null,
      };
    }

    const retentionDays = this.getTrashRetentionDays();
    const expiresAtTime = deletedAtTime + retentionDays * MS_PER_DAY;
    return {
      trashRetentionDays: retentionDays,
      trashExpiresAt: new Date(expiresAtTime).toISOString(),
      trashDaysRemaining: Math.max(
        0,
        Math.ceil((expiresAtTime - now.getTime()) / MS_PER_DAY),
      ),
    };
  }

  private withTrashLifecycle<T extends Document>(
    document: T,
  ): T & Partial<TrashLifecycleFields> {
    const lifecycle = this.getTrashLifecycleFields(document);
    return lifecycle ? { ...document, ...lifecycle } : document;
  }

  private toPublicActorSummary(
    actor: DocumentActorSummary | null,
  ): DocumentActorSummaryResponse | null {
    if (!actor) {
      return null;
    }

    return {
      displayName: actor.displayName,
      avatar: actor.avatar,
    };
  }

  private toDocumentMeta(
    document: Document & Partial<TrashLifecycleFields>,
    options?: {
      includeWorkspaceId?: boolean;
      includeHead?: boolean;
      includeDraftRevision?: boolean;
    },
  ): DocumentMetaProjection {
    return {
      docId: document.docId,
      ...(options?.includeWorkspaceId
        ? { workspaceId: document.workspaceId }
        : {}),
      title: document.title,
      icon: document.icon ?? null,
      cover: document.cover ?? null,
      status: document.status,
      visibility: document.visibility,
      parentId: document.parentId ?? null,
      ...(options?.includeHead ? { rootBlockId: document.rootBlockId } : {}),
      sortOrder: document.sortOrder ?? 0,
      tags: Array.isArray(document.tags) ? document.tags : [],
      category: document.category ?? null,
      ...(options?.includeHead ? { head: document.head } : {}),
      ...(options?.includeDraftRevision
        ? { draftRevision: document.draftRevision ?? 0 }
        : {}),
      publishedHead: document.publishedHead ?? 0,
      viewCount: document.viewCount ?? 0,
      favoriteCount: document.favoriteCount ?? 0,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      ...(document.trashRetentionDays !== undefined
        ? {
            trashRetentionDays: document.trashRetentionDays,
            trashExpiresAt: document.trashExpiresAt ?? null,
            trashDaysRemaining: document.trashDaysRemaining ?? null,
          }
        : {}),
    };
  }

  async presentDocumentDetail(
    document: Document & Partial<TrashLifecycleFields>,
  ): Promise<DocumentDetailResponse> {
    const { creator, updater } =
      await this.resolveDocumentActorProfiles(document);
    const meta = this.toDocumentMeta(document, {
      includeWorkspaceId: true,
      includeHead: true,
      includeDraftRevision: true,
    });

    return {
      ...meta,
      workspaceId: document.workspaceId,
      rootBlockId: document.rootBlockId,
      head: document.head,
      draftRevision: document.draftRevision ?? 0,
      creator: this.toPublicActorSummary(creator),
      updater: this.toPublicActorSummary(updater),
    };
  }

  async presentPublicDocumentDetail(
    document: Document & Partial<TrashLifecycleFields>,
  ): Promise<PublicDocumentDetailResponse> {
    const { creator, updater } =
      await this.resolveDocumentActorProfiles(document);

    return {
      ...this.toDocumentMeta(document),
      creator: this.toPublicActorSummary(creator),
      updater: this.toPublicActorSummary(updater),
    };
  }

  presentDocumentList(
    items: Array<Document & Partial<TrashLifecycleFields>>,
  ): DocumentListItemResponse[] {
    return items.map((item) =>
      this.toDocumentMeta(item, {
        includeWorkspaceId: true,
      }),
    );
  }

  presentPublicDocumentList(items: Document[]): DocumentListItemResponse[] {
    return items.map((item) => this.toDocumentMeta(item));
  }

  async presentRevisionList(
    items: DocRevision[],
  ): Promise<DocumentRevisionListItemResponse[]> {
    const actorIds = Array.from(
      new Set(
        items
          .map((item) => item.createdBy)
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
      ),
    );
    const userMap = new Map<string, DocumentActorSummaryResponse | null>();

    if (actorIds.length > 0) {
      const users = await this.userRepository.find({
        where: { userId: In(actorIds) },
        select: ["userId", "username", "displayName", "avatar"],
      });

      for (const user of users) {
        userMap.set(user.userId, {
          displayName: user.displayName || user.username || null,
          avatar: user.avatar || null,
        });
      }
    }

    return items.map((item) => ({
      docVer: item.docVer,
      message: item.message,
      createdAt: item.createdAt,
      branch: item.branch,
      creator: userMap.get(item.createdBy) ?? null,
    }));
  }

  presentDocumentSnapshot(snapshot: DocSnapshot): DocumentSnapshotResponse {
    return {
      docId: snapshot.docId,
      docVer: snapshot.docVer,
      createdAt: snapshot.createdAt,
      kind: snapshot.kind,
      pinned: snapshot.pinned,
      retainUntil: snapshot.retainUntil,
    };
  }

  private async validateDocumentSyncSession(
    docId: string,
    syncSession?: SyncSessionInput,
  ): Promise<DocumentSyncSession | null> {
    const repo = this.getDocumentSyncSessionRepository();
    const current = await repo.findOne({ where: { docId } });
    if (!current) {
      if (
        !syncSession?.sessionId &&
        typeof syncSession?.sessionEpoch !== "number"
      ) {
        return null;
      }
      this.logSyncSessionEvent("mismatch", {
        docId,
        userId: null,
        sessionId: syncSession?.sessionId ?? null,
        sessionEpoch:
          typeof syncSession?.sessionEpoch === "number"
            ? syncSession.sessionEpoch
            : null,
        lastAckedOpSeq: null,
      });
      throw new BadRequestException("SYNC_SESSION_MISMATCH");
    }
    if (
      !syncSession?.sessionId ||
      typeof syncSession.sessionEpoch !== "number"
    ) {
      this.logSyncSessionEvent("required", {
        docId,
        userId: current.holderUserId ?? null,
        sessionId: null,
        sessionEpoch: null,
        lastAckedOpSeq: current.lastAckedOpSeq ?? null,
      });
      throw new BadRequestException("SYNC_SESSION_REQUIRED");
    }
    if (
      current.sessionId !== syncSession.sessionId ||
      current.sessionEpoch !== syncSession.sessionEpoch
    ) {
      this.logSyncSessionEvent("mismatch", {
        docId,
        userId: current.holderUserId ?? null,
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        lastAckedOpSeq: current.lastAckedOpSeq ?? null,
      });
      throw new BadRequestException("SYNC_SESSION_MISMATCH");
    }

    const now = Date.now();
    if (current.leaseExpiresAt < now) {
      this.logSyncSessionEvent("expired", {
        docId,
        userId: current.holderUserId ?? null,
        sessionId: current.sessionId,
        sessionEpoch: current.sessionEpoch,
        lastAckedOpSeq: current.lastAckedOpSeq ?? null,
      });
      throw new BadRequestException("SYNC_SESSION_EXPIRED");
    }
    current.leaseExpiresAt = now + this.syncSessionLeaseMs;
    current.updatedAt = now;
    await repo.save(current);
    this.logSyncSessionEvent("renewed", {
      docId,
      userId: current.holderUserId ?? null,
      sessionId: current.sessionId,
      sessionEpoch: current.sessionEpoch,
      lastAckedOpSeq: current.lastAckedOpSeq ?? null,
    });
    return current;
  }

  async renewSyncSession(
    docId: string,
    userId: string,
    syncSession: { sessionId?: string; sessionEpoch?: number },
  ) {
    await this.assertAccessWithoutViewIncrement(docId, userId);
    const renewed = await this.validateDocumentSyncSession(docId, syncSession);
    if (!renewed) {
      throw new BadRequestException("SYNC_SESSION_REQUIRED");
    }
    return this.buildSyncSessionRenewResponse(renewed);
  }

  async acquireSyncSession(docId: string, userId: string) {
    const document = await this.assertAccessWithoutViewIncrement(docId, userId);
    await this.checkDocumentEditPermission(document, userId);
    const session = await this.acquireDocumentSyncSession(docId, userId);
    return this.buildSyncSessionResponse(session);
  }

  private logSyncSessionEvent(
    phase:
      | "acquired"
      | "expired"
      | "mismatch"
      | "reacquired"
      | "renewed"
      | "required"
      | "reused",
    params: {
      docId: string;
      userId: string | null;
      sessionId: string | null;
      sessionEpoch: number | null;
      lastAckedOpSeq: number | null;
    },
  ) {
    const suffix = [
      `docId=${params.docId}`,
      `userId=${params.userId ?? "-"}`,
      `sessionId=${params.sessionId ?? "-"}`,
      `sessionEpoch=${params.sessionEpoch ?? "-"}`,
      `lastAckedOpSeq=${params.lastAckedOpSeq ?? "-"}`,
    ].join(", ");
    this.logger.log(`同步 session ${phase}: ${suffix}`);
  }

  /**
   * 创建文档
   */
  async create(createDocumentDto: CreateDocumentDto, userId: string) {
    // 检查工作空间权限
    await this.workspacesService.checkAccess(
      createDocumentDto.workspaceId,
      userId,
    );

    // 如果指定了父文档，验证父文档存在且在同一工作空间
    // 只有当 parentId 是有效的非空字符串时才检查
    if (
      createDocumentDto.parentId &&
      typeof createDocumentDto.parentId === "string" &&
      createDocumentDto.parentId.trim() !== ""
    ) {
      const parentDoc = await this.documentRepository.findOne({
        where: { docId: createDocumentDto.parentId },
      });
      if (!parentDoc) {
        throw new NotFoundException("父文档不存在");
      }
      // 不能使用已删除的文档作为父文档
      if (parentDoc.status === "deleted") {
        throw new NotFoundException("父文档不存在");
      }
      if (parentDoc.workspaceId !== createDocumentDto.workspaceId) {
        throw new BadRequestException("父文档必须属于同一工作空间");
      }
    }

    // 使用事务创建文档和根块
    const result = await this.dataSource.transaction(async (manager) => {
      const now = Date.now();
      const docId = generateDocId();
      const rootBlockId = generateBlockId();

      // 创建文档
      const document = manager.create(Document, {
        docId,
        workspaceId: createDocumentDto.workspaceId,
        title: createDocumentDto.title,
        icon: createDocumentDto.icon,
        cover: createDocumentDto.cover,
        visibility: createDocumentDto.visibility || "private",
        parentId: createDocumentDto.parentId,
        tags: createDocumentDto.tags || [],
        category: createDocumentDto.category,
        rootBlockId,
        head: 1,
        publishedHead: 0,
        status: "draft",
        createdBy: userId,
        updatedBy: userId,
        viewCount: 0,
        favoriteCount: 0,
        sortOrder: 0,
      });

      const savedDocument = await manager.save(Document, document);

      // 校验并处理标签（需要在保存文档后，以便获取docId）
      if (createDocumentDto.tags && createDocumentDto.tags.length > 0) {
        await this.validateAndUpdateTags(
          createDocumentDto.workspaceId,
          createDocumentDto.tags,
          manager,
          "add",
          savedDocument.docId,
        );
      }

      // 创建根块
      const rootBlock = manager.create(Block, {
        blockId: rootBlockId,
        docId,
        type: "root",
        createdAt: now,
        createdBy: userId,
        latestVer: 1,
        latestAt: now,
        latestBy: userId,
        isDeleted: false,
      });

      await manager.save(Block, rootBlock);

      // 创建根块的初始版本
      const rootBlockVersion = manager.create(BlockVersion, {
        versionId: generateVersionId(rootBlockId, 1),
        docId,
        blockId: rootBlockId,
        ver: 1,
        createdAt: now,
        createdBy: userId,
        parentId: "",
        sortKey: "0",
        indent: 0,
        collapsed: false,
        payload: { type: "root", children: [] },
        hash: this.calculateHash({ type: "root", children: [] }),
        plainText: "",
        refs: [],
      });

      await manager.save(BlockVersion, rootBlockVersion);

      // 创建初始修订记录 (head=1)
      const docRevisionRepo = manager.getRepository(DocRevision);
      const initialRevision = docRevisionRepo.create({
        revisionId: `${docId}@1`,
        docId,
        docVer: 1,
        createdAt: now,
        createdBy: userId,
        message: "Initial version",
        branch: "draft",
        patches: [],
        rootBlockId,
        source: "api",
        opSummary: {},
      });
      await docRevisionRepo.save(initialRevision);
      await this.documentSnapshotService.createSnapshotForRevision(
        docId,
        1,
        manager,
        {
          kind: "revision",
          pinned: false,
          metadata: { source: "initial" },
        },
      );

      // 在事务内查询完整文档信息
      const savedDocumentWithDetails = await manager.findOne(Document, {
        where: { docId },
      });

      if (!savedDocumentWithDetails) {
        throw new NotFoundException("文档不存在");
      }

      // 注意：在事务内不增加浏览次数，避免副作用
      // 返回创建的文档信息
      return savedDocumentWithDetails;
    });
    await this.activitiesService.record(
      result.workspaceId,
      DOC_ACTIONS.CREATE,
      "document",
      result.docId,
      userId,
      {
        title: result.title,
      },
    );
    return result;
  }

  /**
   * 获取文档列表
   */
  async findAll(queryDto: QueryDocumentsDto, userId: string) {
    const {
      page = 1,
      pageSize = 20,
      workspaceId,
      status,
      visibility,
      parentId,
      tags,
      category,
      sortBy = "updatedAt",
      sortOrder = "DESC",
    } = queryDto;
    const skip = (page - 1) * pageSize;

    // 如果指定了工作空间，检查权限
    if (workspaceId) {
      await this.workspacesService.checkAccess(workspaceId, userId);
    }

    // 构建查询
    const queryBuilder = this.documentRepository.createQueryBuilder("document");

    // 工作空间过滤
    if (workspaceId) {
      queryBuilder.andWhere("document.workspaceId = :workspaceId", {
        workspaceId,
      });
    } else {
      // 如果没有指定工作空间，查询用户有权限的所有工作空间的文档
      const userWorkspaces = await this.getUserWorkspaceIds(userId);
      if (userWorkspaces.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
      queryBuilder.andWhere("document.workspaceId IN (:...workspaceIds)", {
        workspaceIds: userWorkspaces,
      });
    }

    // 状态过滤
    if (status) {
      queryBuilder.andWhere("document.status = :status", { status });
    } else {
      // 默认不显示已删除的文档
      queryBuilder.andWhere("document.status != :deleted", {
        deleted: "deleted",
      });
    }

    // 可见性过滤
    if (visibility) {
      queryBuilder.andWhere("document.visibility = :visibility", {
        visibility,
      });
    }

    // 父文档过滤
    if (parentId !== undefined) {
      if (parentId === null) {
        queryBuilder.andWhere("document.parentId IS NULL");
      } else {
        queryBuilder.andWhere("document.parentId = :parentId", { parentId });
      }
    }

    // 标签过滤
    if (tags && tags.length > 0) {
      queryBuilder.andWhere("document.tags && :tags", { tags });
    }

    // 分类过滤
    if (category) {
      queryBuilder.andWhere("document.category = :category", { category });
    }

    // 排序
    queryBuilder.orderBy(`document.${sortBy}`, sortOrder as "ASC" | "DESC");

    // 分页
    queryBuilder.skip(skip).take(pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items: items.map((item) => this.withTrashLifecycle(item)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取文档详情
   */
  async findOne(docId: string, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("文档不存在");
    }

    // 已删除的文档不应该返回
    if (document.status === "deleted") {
      throw new NotFoundException("文档不存在");
    }

    // 检查权限
    await this.checkDocumentAccess(document, userId);

    // 增加浏览次数
    document.viewCount += 1;
    await this.documentRepository.save(document);

    const { creator, updater } =
      await this.resolveDocumentActorProfiles(document);
    return {
      ...document,
      creator,
      updater,
    };
  }

  /**
   * 无副作用的文档访问校验（不递增 viewCount）
   */
  async assertAccessWithoutViewIncrement(
    docId: string,
    userId: string,
  ): Promise<Document> {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("文档不存在");
    }

    if (document.status === "deleted") {
      throw new NotFoundException("文档不存在");
    }

    await this.checkDocumentAccess(document, userId);
    return document;
  }

  /**
   * 获取用户有权限的工作空间ID列表
   */
  private async getUserWorkspaceIds(userId: string): Promise<string[]> {
    // 这里可以优化，使用工作空间服务的方法
    const workspaces = await this.workspacesService.findAll(userId, {
      page: 1,
      pageSize: 1000,
    });
    return workspaces.items.map((ws: any) => ws.workspaceId);
  }

  /**
   * 检查文档访问权限
   */
  private async checkDocumentAccess(
    document: Document,
    userId: string,
  ): Promise<void> {
    // 检查工作空间权限
    await this.workspacesService.checkAccess(document.workspaceId, userId);

    // 检查文档可见性
    if (document.visibility === "private") {
      // 私有文档：只有创建者可以访问
      if (document.createdBy !== userId) {
        throw new ForbiddenException("您没有权限访问此文档");
      }
    } else if (document.visibility === "workspace") {
      // 工作空间可见：工作空间成员可以访问（已在上面检查）
      // 无需额外检查
    }
    // public 文档：任何人都可以访问（如果工作空间允许）
  }

  /**
   * 更新文档元数据
   */
  async update(
    docId: string,
    updateDocumentDto: UpdateDocumentDto,
    userId: string,
  ) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("文档不存在");
    }

    // 已删除的文档不能更新
    if (document.status === "deleted") {
      throw new NotFoundException("文档不存在");
    }

    // 检查编辑权限
    await this.checkDocumentEditPermission(document, userId);

    // 更新字段
    if (updateDocumentDto.title !== undefined) {
      document.title = updateDocumentDto.title;
    }
    if (updateDocumentDto.icon !== undefined) {
      document.icon = updateDocumentDto.icon;
    }
    if (updateDocumentDto.cover !== undefined) {
      document.cover = updateDocumentDto.cover;
    }
    if (updateDocumentDto.visibility !== undefined) {
      document.visibility = updateDocumentDto.visibility;
    }
    if (updateDocumentDto.tags !== undefined) {
      // 处理标签变化：更新标签的 usageCount
      const oldTags = document.tags || [];
      const newTags = updateDocumentDto.tags || [];

      // 找出新增和删除的标签
      const addedTags = newTags.filter((tagId) => !oldTags.includes(tagId));
      const removedTags = oldTags.filter((tagId) => !newTags.includes(tagId));

      // 更新标签的 usageCount 和 documentIds
      if (addedTags.length > 0) {
        await this.validateAndUpdateTags(
          document.workspaceId,
          addedTags,
          null,
          "add",
          document.docId,
        );
      }
      if (removedTags.length > 0) {
        await this.validateAndUpdateTags(
          document.workspaceId,
          removedTags,
          null,
          "remove",
          document.docId,
        );
      }

      document.tags = updateDocumentDto.tags;
    }
    if (updateDocumentDto.category !== undefined) {
      document.category = updateDocumentDto.category;
    }
    if (updateDocumentDto.status !== undefined) {
      if (updateDocumentDto.status === DOCUMENT_STATUS_DELETED) {
        throw new BadRequestException(
          "Use the document trash endpoint to delete documents",
        );
      }
      document.status = updateDocumentDto.status;
    }

    document.updatedBy = userId;
    await this.documentRepository.save(document);
    await this.activitiesService.record(
      document.workspaceId,
      DOC_ACTIONS.UPDATE,
      "document",
      docId,
      userId,
      updateDocumentDto as object,
    );
    return this.findOne(docId, userId);
  }

  async permanentlyDelete(docId: string, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("Document not found in trash");
    }

    if (document.status !== DOCUMENT_STATUS_DELETED) {
      throw new BadRequestException(
        "Document must be moved to trash before permanent deletion",
      );
    }

    await this.checkDocumentDeletePermission(document, userId);

    const permanentlyDeletedAt = new Date();
    const result = await this.dataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(Document);
      const lockedDocument = await docRepo.findOne({
        where: { docId },
      });

      if (
        !lockedDocument ||
        lockedDocument.status !== DOCUMENT_STATUS_DELETED
      ) {
        throw new NotFoundException("Document not found in trash");
      }

      await this.checkDocumentDeletePermission(lockedDocument, userId);

      const documentsToDelete = await this.collectDeletedDocumentSubtree(
        lockedDocument,
        docRepo,
      );
      const docIds = documentsToDelete.map((item) => item.docId);
      const criteria = { docId: In(docIds) };

      const deleteByDocIds = async (entity: new () => unknown) => {
        const deleteResult = await manager
          .getRepository(entity)
          .delete(criteria as object);
        return deleteResult.affected ?? 0;
      };

      const deletedCounts = {
        renderCaches: await deleteByDocIds(BlockRenderCache),
        comments: await deleteByDocIds(Comment),
        favorites: await deleteByDocIds(Favorite),
        drafts: await deleteByDocIds(DocDraft),
        syncSessions: await deleteByDocIds(DocumentSyncSession),
        syncCreateTombstones: await deleteByDocIds(SyncCreateTombstone),
        syncBatchReceipts: await deleteByDocIds(SyncBatchReceipt),
        syncCheckpointReceipts: await deleteByDocIds(SyncCheckpointReceipt),
        syncReconcileReceipts: await deleteByDocIds(SyncReconcileReceipt),
        snapshots: await deleteByDocIds(DocSnapshot),
        revisions: await deleteByDocIds(DocRevision),
        blockVersions: await deleteByDocIds(BlockVersion),
        blocks: await deleteByDocIds(Block),
        documents: await deleteByDocIds(Document),
      };

      return {
        workspaceId: lockedDocument.workspaceId,
        affectedCount: documentsToDelete.length,
        deletedDocIds: docIds,
        deletedCounts,
      };
    });

    await this.activitiesService.record(
      result.workspaceId,
      DOC_ACTIONS.PURGE,
      "document",
      docId,
      userId,
      {
        permanentlyDeletedAt: permanentlyDeletedAt.toISOString(),
        affectedCount: result.affectedCount,
        deletedDocIds: result.deletedDocIds,
        deletedCounts: result.deletedCounts,
      },
    );

    return {
      message: "Document permanently deleted",
      docId,
      status: "purged",
      permanentlyDeletedAt: permanentlyDeletedAt.toISOString(),
      affectedCount: result.affectedCount,
      deletedDocIds: result.deletedDocIds,
      deletedCounts: result.deletedCounts,
    };
  }

  /**
   * 发布文档
   */
  async publish(docId: string, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return this.publishVersion(docId, document.head, userId);
  }

  async publishVersion(docId: string, version: number, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    // Deleted documents cannot be published.
    if (document.status === "deleted") {
      throw new NotFoundException("Document not found");
    }

    // Check edit permission.
    await this.checkDocumentEditPermission(document, userId);

    // Update published pointers and snapshot state.
    await this.dataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(Document);
      const snapshotRepo = manager.getRepository(DocSnapshot);
      const lockedDocument = await docRepo.findOne({ where: { docId } });
      if (!lockedDocument) {
        throw new NotFoundException("Document not found");
      }

      let ensuredSnapshot: DocSnapshot;
      if (lockedDocument.head === version) {
        ensuredSnapshot =
          await this.documentSnapshotService.createSnapshotForRevision(
            docId,
            lockedDocument.head,
            manager,
            {
              kind: "publish",
              pinned: true,
              metadata: { source: "publish" },
            },
          );
        ensuredSnapshot.metadata = this.buildPublishMetadata(ensuredSnapshot);
        await snapshotRepo.save(ensuredSnapshot);
      } else {
        const targetSnapshot = await snapshotRepo.findOne({
          where: { docId, docVer: version },
        });
        if (!targetSnapshot) {
          throw new NotFoundException(
            `Version snapshot ${docId}@${version} not found`,
          );
        }
        targetSnapshot.metadata = this.buildPublishMetadata(targetSnapshot);
        targetSnapshot.kind = "publish";
        targetSnapshot.pinned = true;
        ensuredSnapshot = await snapshotRepo.save(targetSnapshot);
      }

      if (
        lockedDocument.publishedSnapshotId &&
        lockedDocument.publishedSnapshotId !== ensuredSnapshot.snapshotId
      ) {
        await this.restorePublishedSnapshotState(
          snapshotRepo,
          lockedDocument.publishedSnapshotId,
        );
      }

      lockedDocument.publishedHead = version;
      lockedDocument.publishedSnapshotId = ensuredSnapshot.snapshotId;
      lockedDocument.updatedBy = userId;
      await docRepo.save(lockedDocument);
    });
    await this.activitiesService.record(
      document.workspaceId,
      DOC_ACTIONS.PUBLISH,
      "document",
      docId,
      userId,
    );
    await this.sweepPublishedRenderCachesBestEffort(docId, userId);
    const revalidation = await this.revalidatePublicDocumentPath(document);
    const publishedDocument = await this.findOne(docId, userId);
    return {
      document: publishedDocument,
      revalidation,
    };
  }

  async unpublish(docId: string, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    if (document.status === "deleted") {
      throw new NotFoundException("Document not found");
    }

    await this.checkDocumentEditPermission(document, userId);

    if (document.publishedHead <= 0 || !document.publishedSnapshotId) {
      throw new BadRequestException("Document is not currently published");
    }

    await this.dataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(Document);
      const snapshotRepo = manager.getRepository(DocSnapshot);
      const lockedDocument = await docRepo.findOne({ where: { docId } });
      if (!lockedDocument) {
        throw new NotFoundException("Document not found");
      }
      if (
        lockedDocument.publishedHead <= 0 ||
        !lockedDocument.publishedSnapshotId
      ) {
        throw new BadRequestException("Document is not currently published");
      }

      await this.restorePublishedSnapshotState(
        snapshotRepo,
        lockedDocument.publishedSnapshotId,
      );
      lockedDocument.publishedHead = 0;
      lockedDocument.publishedSnapshotId = null;
      lockedDocument.updatedBy = userId;
      await docRepo.save(lockedDocument);
    });

    await this.activitiesService.record(
      document.workspaceId,
      DOC_ACTIONS.UNPUBLISH,
      "document",
      docId,
      userId,
    );
    await this.clearPublishedRenderCachesBestEffort(docId, userId);
    const revalidation = await this.revalidatePublicDocumentPath(document);
    const unpublishedDocument = await this.findOne(docId, userId);
    return {
      document: unpublishedDocument,
      revalidation,
    };
  }

  private buildPublishMetadata(snapshot: DocSnapshot): Record<string, unknown> {
    const metadata =
      (snapshot.metadata as Record<string, unknown> | null) ?? {};
    return {
      ...metadata,
      source: "publish",
      publishRestore: {
        kind: snapshot.kind,
        pinned: snapshot.pinned,
        source: metadata.source,
      },
    };
  }

  private async sweepPublishedRenderCachesBestEffort(
    docId: string,
    userId: string,
  ) {
    if (!this.renderCacheGcService) {
      return;
    }

    try {
      await this.renderCacheGcService.sweepDocumentPublishedReachability(
        docId,
        userId,
      );
    } catch (error) {
      this.logger.warn(
        `发布后渲染缓存清理失败: docId=${docId}, error=${(error as Error).message}`,
      );
    }
  }

  private async clearPublishedRenderCachesBestEffort(
    docId: string,
    userId: string,
  ) {
    if (!this.renderCacheGcService) {
      return;
    }

    try {
      await this.renderCacheGcService.clearDocumentRenderCaches(docId, userId);
    } catch (error) {
      this.logger.warn(
        `取消发布后渲染缓存清理失败: docId=${docId}, error=${(error as Error).message}`,
      );
    }
  }

  private async restorePublishedSnapshotState(
    snapshotRepository: Repository<DocSnapshot>,
    snapshotId: string,
  ) {
    const snapshot = await snapshotRepository.findOne({
      where: { snapshotId },
    });
    if (!snapshot) {
      return;
    }

    const metadata = {
      ...((snapshot.metadata as Record<string, unknown> | null) ?? {}),
    };
    const restore = (metadata.publishRestore ?? {}) as PublishRestoreState;
    delete metadata.publishRestore;

    if (restore.source !== undefined) {
      metadata.source = restore.source;
    } else if (metadata.source === "publish") {
      delete metadata.source;
    }

    snapshot.kind = restore.kind ?? "revision";
    snapshot.pinned = restore.pinned ?? false;
    snapshot.metadata = metadata;
    await snapshotRepository.save(snapshot);
  }

  private async revalidatePublicDocumentPath(
    document: Document,
  ): Promise<PublicDocumentRevalidationResult> {
    if (document.visibility !== "public") {
      this.logger.log(
        `公开文档缓存失效跳过：文档非公开 docId=${document.docId}, visibility=${document.visibility}`,
      );
      return {
        attempted: false,
        success: false,
        skippedReason: "not_public",
      };
    }

    let slug: string;
    try {
      slug = this.encodePublicDocSlug(document.docId);
    } catch (error) {
      this.logger.warn(
        `公开文档缓存失效跳过：slug 编码失败 docId=${document.docId}, error=${(error as Error).message}`,
      );
      return {
        attempted: false,
        success: false,
        skippedReason: "invalid_slug",
        error: (error as Error).message,
      };
    }

    const url = process.env.PUBLIC_SITE_REVALIDATE_URL;
    const secret = process.env.PUBLIC_SITE_REVALIDATE_SECRET;
    if (!url || !secret) {
      this.logger.log(
        `公开文档缓存失效跳过：未配置回调 docId=${document.docId}, hasUrl=${Boolean(url)}, hasSecret=${Boolean(secret)}`,
      );
      return {
        attempted: false,
        success: false,
        skippedReason: "missing_config",
        slug,
      };
    }

    try {
      this.logger.log(
        `公开文档缓存失效请求: docId=${document.docId}, slug=${slug}, url=${url}`,
      );
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revalidate-secret": secret,
        },
        body: JSON.stringify({ slug }),
        signal: AbortSignal.timeout(2000),
      });

      if (!response.ok) {
        const responseBody = await this.readRevalidateResponseBody(response);
        this.logger.warn(
          `公开文档缓存失效失败: docId=${document.docId}, slug=${slug}, status=${response.status}, body=${responseBody}`,
        );
        return {
          attempted: true,
          success: false,
          slug,
          status: response.status,
          responseBody,
        };
      }

      const responseBody = await this.readRevalidateResponseBody(response);
      this.logger.log(
        `公开文档缓存失效成功: docId=${document.docId}, slug=${slug}, status=${response.status || "unknown"}`,
      );
      return {
        attempted: true,
        success: true,
        slug,
        status: response.status,
        responseBody,
      };
    } catch (error) {
      this.logger.warn(
        `公开文档缓存失效失败: docId=${document.docId}, slug=${slug}, url=${url}, error=${(error as Error).message}`,
      );
      return {
        attempted: true,
        success: false,
        slug,
        error: (error as Error).message,
      };
    }
  }

  private async readRevalidateResponseBody(
    response: Response,
  ): Promise<string> {
    if (typeof response.text !== "function") {
      return "<unavailable>";
    }

    try {
      const body = await response.text();
      return body ? body.slice(0, 500) : "<empty>";
    } catch (error) {
      return `<unreadable: ${(error as Error).message}>`;
    }
  }

  private encodePublicDocSlug(docId: string): string {
    if (!docId.startsWith("doc_")) {
      throw new Error("invalid document id prefix");
    }

    const rest = docId.slice(4);
    const underscoreIdx = rest.indexOf("_");
    if (underscoreIdx <= 0 || underscoreIdx === rest.length - 1) {
      throw new Error("invalid document id shape");
    }

    const timestamp = Number(rest.slice(0, underscoreIdx));
    if (!Number.isFinite(timestamp)) {
      throw new Error("invalid document timestamp");
    }

    const hex = rest.slice(underscoreIdx + 1);
    return `${this.toBase36(timestamp)}-${hex}`;
  }

  private toBase36(num: number): string {
    if (num === 0) {
      return "0";
    }

    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    let value = Math.floor(num);
    let result = "";
    while (value > 0) {
      result = chars[value % 36] + result;
      value = Math.floor(value / 36);
    }
    return result;
  }

  /**
   * 移动文档
   */
  async move(docId: string, moveDocumentDto: MoveDocumentDto, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("文档不存在");
    }

    // 已删除的文档不能移动
    if (document.status === "deleted") {
      throw new NotFoundException("文档不存在");
    }

    // 检查编辑权限
    await this.checkDocumentEditPermission(document, userId);

    // 如果指定了新的父文档，验证父文档
    if (moveDocumentDto.parentId !== undefined) {
      if (moveDocumentDto.parentId === null) {
        // 移动到根目录
        (document as any).parentId = null;
      } else {
        // 验证父文档存在且在同一工作空间
        const parentDoc = await this.documentRepository.findOne({
          where: { docId: moveDocumentDto.parentId },
        });
        if (!parentDoc) {
          throw new NotFoundException("父文档不存在");
        }
        // 不能使用已删除的文档作为父文档
        if (parentDoc.status === "deleted") {
          throw new NotFoundException("父文档不存在");
        }
        if (parentDoc.workspaceId !== document.workspaceId) {
          throw new BadRequestException("父文档必须属于同一工作空间");
        }
        // 防止循环引用
        if (parentDoc.docId === docId) {
          throw new BadRequestException("不能将文档移动到自身");
        }
        // 检查是否会导致循环引用（简化检查）
        if (await this.wouldCreateCycle(docId, moveDocumentDto.parentId)) {
          throw new BadRequestException("移动操作会导致循环引用");
        }
        document.parentId = moveDocumentDto.parentId;
      }
    }

    // 更新排序
    if (moveDocumentDto.sortOrder !== undefined) {
      document.sortOrder = moveDocumentDto.sortOrder;
    }

    document.updatedBy = userId;
    await this.documentRepository.save(document);
    await this.activitiesService.record(
      document.workspaceId,
      DOC_ACTIONS.MOVE,
      "document",
      docId,
      userId,
      moveDocumentDto as object,
    );
    return this.findOne(docId, userId);
  }

  /**
   * 删除文档
   */
  async remove(docId: string, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("文档不存在");
    }

    if (document.status === DOCUMENT_STATUS_DELETED) {
      throw new NotFoundException("文档不存在");
    }

    // 检查删除权限
    await this.checkDocumentDeletePermission(document, userId);

    const { documentsToTrash, deletedAt } = await this.dataSource.transaction(
      async (manager) => {
        const docRepo = manager.getRepository(Document);
        const tagManager = manager as unknown as EntityManager;
        const lockedDocument = await docRepo.findOne({
          where: { docId },
        });

        if (
          !lockedDocument ||
          lockedDocument.status === DOCUMENT_STATUS_DELETED
        ) {
          throw new NotFoundException("文档不存在");
        }

        await this.checkDocumentDeletePermission(lockedDocument, userId);

        const docsToTrash = await this.collectActiveDocumentSubtree(
          lockedDocument,
          docRepo,
        );
        const deletedAtValue = new Date();

        for (const item of docsToTrash) {
          if (item.tags && item.tags.length > 0) {
            await this.validateAndUpdateTags(
              item.workspaceId,
              item.tags,
              tagManager,
              "remove",
              item.docId,
            );
          }

          const previousStatus = item.status;
          item.status = DOCUMENT_STATUS_DELETED;
          item.deletedFromStatus = previousStatus;
          item.deletedAt = deletedAtValue;
          item.deletedBy = userId;
          item.restoredAt = null;
          item.restoredBy = null;
          item.updatedBy = userId;
          await docRepo.save(item);
        }

        return { documentsToTrash: docsToTrash, deletedAt: deletedAtValue };
      },
    );

    await this.activitiesService.record(
      document.workspaceId,
      DOC_ACTIONS.DELETE,
      "document",
      docId,
      userId,
    );
    const revalidations: PublicDocumentRevalidationResult[] = [];
    for (const item of documentsToTrash) {
      await this.clearPublishedRenderCachesBestEffort(item.docId, userId);
      revalidations.push(await this.revalidatePublicDocumentPath(item));
    }
    return {
      message: "文档已删除",
      docId,
      status: documentsToTrash[0].status,
      deletedAt: deletedAt.toISOString(),
      ...this.getTrashLifecycleFields(documentsToTrash[0], deletedAt),
      affectedCount: documentsToTrash.length,
      revalidation: revalidations[0],
    };
  }

  private async collectActiveDocumentSubtree(
    root: Document,
    documentRepository: Pick<Repository<Document>, "find">,
  ): Promise<Document[]> {
    const result: Document[] = [root];
    const seen = new Set<string>([root.docId]);
    let frontier = [root.docId];

    while (frontier.length > 0) {
      const children = await documentRepository.find({
        where: {
          workspaceId: root.workspaceId,
          parentId: In(frontier),
        },
      });
      const nextFrontier: string[] = [];

      for (const child of children) {
        if (seen.has(child.docId) || child.status === DOCUMENT_STATUS_DELETED) {
          continue;
        }
        seen.add(child.docId);
        result.push(child);
        nextFrontier.push(child.docId);
      }

      frontier = nextFrontier;
    }

    return result;
  }

  private async collectDeletedDocumentSubtree(
    root: Document,
    documentRepository: Pick<Repository<Document>, "find">,
  ): Promise<Document[]> {
    const result: Document[] = [root];
    const seen = new Set<string>([root.docId]);
    let frontier = [root.docId];

    while (frontier.length > 0) {
      const children = await documentRepository.find({
        where: {
          workspaceId: root.workspaceId,
          parentId: In(frontier),
          status: DOCUMENT_STATUS_DELETED,
        },
      });
      const nextFrontier: string[] = [];

      for (const child of children) {
        if (seen.has(child.docId)) {
          continue;
        }
        seen.add(child.docId);
        result.push(child);
        nextFrontier.push(child.docId);
      }

      frontier = nextFrontier;
    }

    return result;
  }

  async restore(docId: string, userId: string) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document || document.status !== DOCUMENT_STATUS_DELETED) {
      throw new NotFoundException("Document not found in trash");
    }

    await this.checkDocumentDeletePermission(document, userId);

    const { documentsToRestore, restoredAt } =
      await this.dataSource.transaction(async (manager) => {
        const docRepo = manager.getRepository(Document);
        const tagManager = manager as unknown as EntityManager;
        const lockedDocument = await docRepo.findOne({
          where: { docId },
        });

        if (
          !lockedDocument ||
          lockedDocument.status !== DOCUMENT_STATUS_DELETED
        ) {
          throw new NotFoundException("Document not found in trash");
        }

        await this.checkDocumentDeletePermission(lockedDocument, userId);

        const docsToRestore = await this.collectDeletedDocumentSubtree(
          lockedDocument,
          docRepo,
        );
        const restoringDocIds = new Set(
          docsToRestore.map((item) => item.docId),
        );
        const restoredAtValue = new Date();

        for (const item of docsToRestore) {
          if (item.parentId && !restoringDocIds.has(item.parentId)) {
            const parentDoc = await docRepo.findOne({
              where: { docId: item.parentId },
              select: ["docId", "workspaceId", "status"],
            });
            if (
              !parentDoc ||
              parentDoc.workspaceId !== item.workspaceId ||
              parentDoc.status === DOCUMENT_STATUS_DELETED
            ) {
              item.parentId = null;
            }
          }

          if (item.tags && item.tags.length > 0) {
            await this.validateAndUpdateTags(
              item.workspaceId,
              item.tags,
              tagManager,
              "add",
              item.docId,
            );
          }

          const restoredStatus =
            item.deletedFromStatus &&
            item.deletedFromStatus !== DOCUMENT_STATUS_DELETED
              ? item.deletedFromStatus
              : DEFAULT_RESTORED_DOCUMENT_STATUS;
          item.status = restoredStatus;
          item.deletedFromStatus = null;
          item.deletedAt = null;
          item.deletedBy = null;
          item.restoredAt = restoredAtValue;
          item.restoredBy = userId;
          item.updatedBy = userId;
          await docRepo.save(item);
        }

        return {
          documentsToRestore: docsToRestore,
          restoredAt: restoredAtValue,
        };
      });

    const restoredRoot = documentsToRestore[0];

    await this.activitiesService.record(
      document.workspaceId,
      DOC_ACTIONS.RESTORE,
      "document",
      docId,
      userId,
      {
        restoredAt: restoredAt.toISOString(),
        parentId: restoredRoot.parentId,
        status: restoredRoot.status,
        affectedCount: documentsToRestore.length,
      },
    );

    return this.findOne(docId, userId);
  }

  /**
   * 检查文档编辑权限
   */
  private async checkDocumentEditPermission(
    document: Document,
    userId: string,
  ): Promise<void> {
    // 检查工作空间编辑权限
    await this.workspacesService.checkEditPermission(
      document.workspaceId,
      userId,
    );
  }

  /**
   * 检查文档删除权限
   */
  private async checkDocumentDeletePermission(
    document: Document,
    userId: string,
  ): Promise<void> {
    // 检查工作空间管理权限
    await this.workspacesService.checkAdminPermission(
      document.workspaceId,
      userId,
    );
  }

  /**
   * 检查移动操作是否会导致循环引用
   */
  private async wouldCreateCycle(
    docId: string,
    newParentId: string,
  ): Promise<boolean> {
    let currentParentId = newParentId;
    const visited = new Set<string>([docId]);

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        return true; // 发现循环
      }
      visited.add(currentParentId);

      const parent = await this.documentRepository.findOne({
        where: { docId: currentParentId },
        select: ["parentId", "status"],
      });

      // 如果父文档不存在或已删除，停止检查
      if (!parent || parent.status === "deleted" || !parent.parentId) {
        break;
      }
      currentParentId = parent.parentId;
    }

    return false;
  }

  /**
   * 获取文档内容（渲染树，支持分页）
   */
  async getContent(
    docId: string,
    version: number | undefined,
    userId: string,
    maxDepth?: number,
    startBlockId?: string,
    limit?: number,
    mode: "json" | "html" | "all" = "json",
  ) {
    const document = await this.findOne(docId, userId);
    const docVer = version || document.head;
    return this.getContentByDocument(
      document,
      docVer,
      maxDepth,
      startBlockId,
      limit,
      mode,
    );
  }

  async getEditContent(
    docId: string,
    userId: string,
    maxDepth?: number,
    startBlockId?: string,
    limit?: number,
  ) {
    const document = await this.assertAccessWithoutViewIncrement(docId, userId);
    const draft = await this.documentDraftService.findByDocId(docId);
    const syncSession = await this.acquireDocumentSyncSession(docId, userId);

    if (draft) {
      const result = await this.buildContentTreeFromVersionMap(
        docId,
        document.rootBlockId,
        draft.blockVersionMap,
        maxDepth,
        startBlockId,
        limit || 1000,
      );

      const { node: patchedTree, updates } = this.ensureHeadingAnchorIds(
        result.tree,
      );
      this.persistAnchorIds(updates).catch(() => {});
      result.tree = patchedTree;

      return {
        docId,
        source: "draft" as const,
        head: document.head,
        publishedHead: document.publishedHead,
        syncSession: this.buildSyncSessionResponse(syncSession),
        editorState: normalizeDocumentEditorState(document.editorState),
        draft: {
          exists: true,
          draftId: draft.draftId,
          baseDocVer: draft.baseDocVer,
          draftRevision: document.draftRevision ?? 0,
          updatedAt: toSafeISOString(draft.updatedAt),
          updatedBy: draft.updatedBy,
        },
        lock: {
          locked: Boolean(draft.lockOwnerUserId),
          lockOwnerUserId: draft.lockOwnerUserId,
          lockExpiresAt: toSafeISOString(draft.lockExpiresAt),
        },
        tree: result.tree,
        pagination: {
          totalBlocks: result.totalBlocks,
          returnedBlocks: result.returnedBlocks,
          hasMore: result.hasMore,
          ...(result.nextStartBlockId
            ? { nextStartBlockId: result.nextStartBlockId }
            : {}),
        },
      };
    }

    const headContent = await this.getContentByDocument(
      document,
      document.head,
      maxDepth,
      startBlockId,
      limit,
      "json",
    );

    return {
      docId,
      source: "head" as const,
      head: document.head,
      publishedHead: document.publishedHead,
      syncSession: this.buildSyncSessionResponse(syncSession),
      editorState: normalizeDocumentEditorState(document.editorState),
      draft: {
        exists: false,
        draftId: null,
        baseDocVer: null,
        draftRevision: document.draftRevision ?? 0,
        updatedAt: null,
        updatedBy: null,
      },
      lock: {
        locked: false,
        lockOwnerUserId: null,
        lockExpiresAt: null,
      },
      tree: headContent.tree,
      pagination: headContent.pagination,
    };
  }

  async discardDraft(
    docId: string,
    userId: string,
    syncSession?: { sessionId?: string; sessionEpoch?: number },
  ) {
    const document = await this.assertAccessWithoutViewIncrement(docId, userId);
    await this.checkDocumentEditPermission(document, userId);
    await this.validateDocumentSyncSession(docId, syncSession);
    return this.documentDraftService.discardDraft(docId);
  }

  async updateEditorState(
    docId: string,
    updateEditorStateDto: UpdateEditorStateDto,
    userId: string,
  ) {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (!document) {
      throw new NotFoundException("文档不存在");
    }

    if (document.status === "deleted") {
      throw new NotFoundException("文档不存在");
    }

    await this.checkDocumentEditPermission(document, userId);

    document.editorState = {
      ...(document.editorState ?? {}),
      ...((updateEditorStateDto?.editorState as
        | Record<string, unknown>
        | undefined) ?? {}),
    };
    document.editorState = normalizeDocumentEditorState(document.editorState);
    document.updatedBy = userId;
    await this.documentRepository.save(document);

    return {
      docId: document.docId,
      editorState: document.editorState,
    };
  }

  async findAllSitePublic(queryDto: QueryDocumentsDto) {
    return this.findAllForSitePublic(queryDto);
  }

  async findOneSitePublic(docId: string) {
    return this.findPublicOne(docId);
  }

  async getContentSitePublic(
    docId: string,
    version?: number,
    maxDepth?: number,
    startBlockId?: string,
    limit?: number,
    mode: "json" | "html" | "all" = "json",
  ) {
    const publicDocument = await this.getPublicDocumentEntity(docId);
    const docVer = publicDocument.publishedHead;
    return this.getContentByDocument(
      publicDocument,
      docVer,
      maxDepth,
      startBlockId,
      limit,
      mode,
    );
  }

  private async findAllForSitePublic(queryDto: QueryDocumentsDto) {
    const {
      page = 1,
      pageSize = 20,
      workspaceId,
      visibility,
      parentId,
      tags,
      category,
      sortBy = "updatedAt",
      sortOrder = "DESC",
    } = queryDto;

    if (!workspaceId) {
      throw new BadRequestException(
        "workspaceId is required for site public document queries",
      );
    }

    await this.workspacesService.findOne(
      workspaceId,
      SITE_PUBLIC_ANONYMOUS_USER_ID,
    );

    const skip = (page - 1) * pageSize;
    const queryBuilder = this.documentRepository
      .createQueryBuilder("document")
      .where("document.workspaceId = :workspaceId", { workspaceId })
      .andWhere("document.status != :deleted", { deleted: "deleted" })
      .andWhere("document.publishedHead > 0");

    if (visibility) {
      queryBuilder.andWhere("document.visibility = :visibility", {
        visibility,
      });
    }

    if (parentId !== undefined) {
      if (parentId === null) {
        queryBuilder.andWhere("document.parentId IS NULL");
      } else {
        queryBuilder.andWhere("document.parentId = :parentId", { parentId });
      }
    }

    if (tags && tags.length > 0) {
      queryBuilder.andWhere("document.tags && :tags", { tags });
    }

    if (category) {
      queryBuilder.andWhere("document.category = :category", { category });
    }

    queryBuilder.orderBy(`document.${sortBy}`, sortOrder as "ASC" | "DESC");
    queryBuilder.skip(skip).take(pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items: this.presentPublicDocumentList(items),
      total,
      page,
      pageSize,
    };
  }

  private async findPublicOne(docId: string) {
    const document = await this.getPublicDocumentEntity(docId);
    document.viewCount += 1;
    await this.documentRepository.save(document);
    return this.presentPublicDocumentDetail(document);
  }

  private async getPublicDocumentEntity(docId: string): Promise<Document> {
    const document = await this.documentRepository.findOne({
      where: { docId },
    });

    if (
      !document ||
      document.status === "deleted" ||
      document.publishedHead <= 0 ||
      document.visibility !== "public"
    ) {
      throw new NotFoundException("Public document not found or not published");
    }

    return document;
  }

  private async resolveDocumentActorProfiles(
    document: Pick<Document, "createdBy" | "updatedBy">,
  ) {
    const actorIds = Array.from(
      new Set(
        [document.createdBy, document.updatedBy].filter(
          (value): value is string => !!value,
        ),
      ),
    );

    if (actorIds.length === 0) {
      return {
        creator: null,
        updater: null,
      };
    }

    const users = await this.userRepository.find({
      where: {
        userId: In(actorIds),
      },
      select: ["userId", "displayName", "avatar"],
    });

    const userMap = new Map<string, DocumentActorSummary>(
      users.map((user) => [
        user.userId,
        {
          userId: user.userId,
          displayName: user.displayName ?? null,
          avatar: user.avatar ?? null,
        },
      ]),
    );

    return {
      creator: userMap.get(document.createdBy) ?? null,
      updater: userMap.get(document.updatedBy) ?? null,
    };
  }

  private async getContentByDocument(
    document: Document,
    docVer: number,
    maxDepth?: number,
    startBlockId?: string,
    limit?: number,
    mode: "json" | "html" | "all" = "json",
  ) {
    const revision = await this.docRevisionRepository.findOne({
      where: { docId: document.docId, docVer },
    });

    if (!revision) {
      throw new NotFoundException("文档版本不存在");
    }

    if (startBlockId) {
      const result = await this.buildContentTreeFromStartBlock(
        document.docId,
        document.rootBlockId,
        startBlockId,
        revision.createdAt,
        maxDepth,
        limit || 1000,
      );

      if (!result || !result.tree) {
        throw new NotFoundException("文档版本不存在");
      }

      if (
        result.tree &&
        typeof result.tree === "object" &&
        "__rootBlockDeleted" in result.tree
      ) {
        throw new BadRequestException(
          "根块已被删除，无法获取文档内容。请恢复根块或重新创建文档。",
        );
      }

      if (
        result.tree &&
        typeof result.tree === "object" &&
        "__rootBlockMissing" in result.tree
      ) {
        throw new NotFoundException("根块不存在，无法获取文档内容。");
      }

      const { node: patchedTreeA, updates: updatesA } =
        this.ensureHeadingAnchorIds(result.tree);
      this.persistAnchorIds(updatesA).catch(() => {});
      result.tree = patchedTreeA;

      return this.withOptionalRenderedHtml(
        {
          docId: document.docId,
          docVer,
          title: document.title,
          tree: result.tree,
          pagination: {
            totalBlocks: result.totalBlocks,
            returnedBlocks: result.returnedBlocks,
            hasMore: result.hasMore,
            nextStartBlockId: result.nextStartBlockId,
          },
        },
        mode,
      );
    }

    const { map: blockVersionMap } = await this.getBlockVersionMapForVersion(
      document.docId,
      docVer,
    );
    const result = await this.buildContentTreeFromVersionMap(
      document.docId,
      document.rootBlockId,
      blockVersionMap,
      maxDepth,
      startBlockId,
      limit || 1000,
      revision.createdAt,
    );

    if (!result || !result.tree) {
      console.error("buildContentTreeFromVersionMap returned null");
      console.error("blockVersionMap:", blockVersionMap);
      throw new NotFoundException("文档版本不存在");
    }

    if (
      result.tree &&
      typeof result.tree === "object" &&
      "__rootBlockDeleted" in result.tree
    ) {
      throw new BadRequestException(
        "根块已被删除，无法获取文档内容。请恢复根块或重新创建文档。",
      );
    }

    if (
      result.tree &&
      typeof result.tree === "object" &&
      "__rootBlockMissing" in result.tree
    ) {
      throw new NotFoundException("根块不存在，无法获取文档内容。");
    }

    const { node: patchedTree, updates } = this.ensureHeadingAnchorIds(
      result.tree,
    );
    this.persistAnchorIds(updates).catch(() => {});
    result.tree = patchedTree;

    return this.withOptionalRenderedHtml(
      {
        docId: document.docId,
        docVer,
        title: document.title,
        tree: result.tree,
        pagination: {
          totalBlocks: result.totalBlocks,
          returnedBlocks: result.returnedBlocks,
          hasMore: result.hasMore,
          nextStartBlockId: result.nextStartBlockId,
        },
      },
      mode,
    );
  }

  private async withOptionalRenderedHtml<
    T extends { docId: string; tree: any },
  >(
    response: T,
    mode: "json" | "html" | "all",
  ): Promise<
    T & {
      renderMode?: "html" | "all";
      renderFailures?: unknown[];
      renderDiagnostics?: ContentRenderDiagnostics;
    }
  > {
    if (mode === "json") {
      return {
        ...this.toPublicContentResponse(response),
        renderDiagnostics: this.createFallbackRenderDiagnostics(mode, "json"),
      };
    }

    if (!this.documentRenderService) {
      return {
        ...this.toPublicContentResponse(response),
        renderDiagnostics: this.createFallbackRenderDiagnostics(mode, "json"),
      };
    }

    try {
      const rendered = await this.documentRenderService.renderTree(
        response.tree,
      );
      const publicTree = this.stripRenderMetadata(rendered.tree);
      const tree =
        mode === "html"
          ? this.stripRenderedPayloadForHtmlMode(publicTree)
          : publicTree;

      return {
        ...response,
        tree,
        renderMode: mode,
        renderDiagnostics: {
          requestedMode: mode,
          ...rendered.diagnostics,
        },
        ...(rendered.failures.length > 0
          ? { renderFailures: rendered.failures }
          : {}),
      };
    } catch (error) {
      this.logger.warn(
        `文档 HTML 渲染失败，已回退 JSON: docId=${response.docId}, mode=${mode}, error=${(error as Error).message}`,
      );
      return {
        ...this.toPublicContentResponse(response),
        renderDiagnostics: this.createFallbackRenderDiagnostics(mode, "json"),
      };
    }
  }

  private createFallbackRenderDiagnostics(
    requestedMode: "json" | "html" | "all",
    renderMode: "json",
  ): ContentRenderDiagnostics {
    return {
      requestedMode,
      renderVersion: "none",
      renderMode,
      cache: "none",
      totalBlocks: 0,
      renderableBlocks: 0,
      cachedBlocks: 0,
      freshBlocks: 0,
      clientBlocks: 0,
      failedBlocks: 0,
    };
  }

  private toPublicContentResponse<T extends { tree: any }>(response: T): T {
    return {
      ...response,
      tree: this.stripRenderMetadata(response.tree),
    };
  }

  private stripRenderedPayloadForHtmlMode(node: any): any {
    if (!node || typeof node !== "object") {
      return node;
    }

    const nextNode = { ...node };
    if (Array.isArray(nextNode.children)) {
      nextNode.children = nextNode.children.map((child: any) =>
        this.stripRenderedPayloadForHtmlMode(child),
      );
    }

    if (typeof nextNode.html === "string") {
      delete nextNode.payload;
    }

    return nextNode;
  }

  private generateAnchorId(): string {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const bytes = randomBytes(6);
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += letters[bytes[i] % 52];
    }
    return result;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private ensureHeadingAnchorIds(node: any): {
    node: any;
    updates: Array<{ blockId: string; payload: Record<string, unknown> }>;
  } {
    const updates: Array<{
      blockId: string;
      payload: Record<string, unknown>;
    }> = [];

    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;

      if (
        n.type === "heading" &&
        n.payload?.attrs &&
        !n.payload.attrs.anchorId
      ) {
        const anchorId = this.generateAnchorId();
        n.payload = {
          ...n.payload,
          attrs: { ...n.payload.attrs, anchorId },
        };
        if (n.blockId) {
          updates.push({ blockId: n.blockId, payload: n.payload });
        }
      }

      if (Array.isArray(n.children)) {
        n.children.forEach(walk);
      }
    };

    walk(node);
    return { node, updates };
  }

  private async persistAnchorIds(
    updates: Array<{ blockId: string; payload: Record<string, unknown> }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    for (const { blockId, payload } of updates) {
      try {
        const latest = await this.blockVersionRepository.findOne({
          where: { blockId },
          order: { ver: "DESC" },
        });
        if (latest) {
          latest.payload = payload;
          await this.blockVersionRepository.save(latest);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to persist anchorId for ${blockId}: ${(err as Error).message}`,
        );
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  private stripRenderMetadata(node: any): any {
    if (!node || typeof node !== "object") {
      return node;
    }

    const { blockVersionId, docId, ver, children, ...publicNode } = node;
    if (Array.isArray(children)) {
      return {
        ...publicNode,
        children: children.map((child) => this.stripRenderMetadata(child)),
      };
    }
    return publicNode;
  }

  /**
   * 构建块树（简化实现）
   */
  private async buildBlockTree(
    rootBlockId: string,
    version: number,
  ): Promise<any> {
    // 获取根块版本
    const rootVersion = await this.blockVersionRepository.findOne({
      where: { blockId: rootBlockId, ver: version },
    });

    if (!rootVersion) {
      return null;
    }

    // 简化实现：只返回根块，实际应该递归加载子块
    return {
      blockId: rootBlockId,
      blockVersionId: rootVersion.id,
      docId: rootVersion.docId,
      ver: rootVersion.ver,
      type: rootVersion.payload["type"] || "root",
      payload: rootVersion.payload,
      children: [], // 实际应该递归加载
    };
  }

  /**
   * 搜索文档
   */
  async search(searchQueryDto: SearchQueryDto, userId: string) {
    const {
      query,
      workspaceId,
      status,
      tags,
      page = 1,
      pageSize = 20,
    } = searchQueryDto;
    const skip = (page - 1) * pageSize;

    // 如果指定了工作空间，检查权限
    if (workspaceId) {
      await this.workspacesService.checkAccess(workspaceId, userId);
    }

    // 构建查询
    const queryBuilder = this.documentRepository
      .createQueryBuilder("document")
      .where("document.searchVector @@ plainto_tsquery(:query)", { query })
      .orWhere("document.title ILIKE :titleQuery", {
        titleQuery: `%${query}%`,
      });

    // 工作空间过滤
    if (workspaceId) {
      queryBuilder.andWhere("document.workspaceId = :workspaceId", {
        workspaceId,
      });
    } else {
      // 查询用户有权限的所有工作空间的文档
      const userWorkspaces = await this.getUserWorkspaceIds(userId);
      if (userWorkspaces.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
      queryBuilder.andWhere("document.workspaceId IN (:...workspaceIds)", {
        workspaceIds: userWorkspaces,
      });
    }

    // 状态过滤
    if (status) {
      queryBuilder.andWhere("document.status = :status", { status });
    } else {
      queryBuilder.andWhere("document.status != :deleted", {
        deleted: "deleted",
      });
    }

    // 标签过滤
    if (tags && tags.length > 0) {
      queryBuilder.andWhere("document.tags && :tags", { tags });
    }

    // 排序（按相关性）
    queryBuilder
      .orderBy(
        "ts_rank(document.searchVector, plainto_tsquery(:query))",
        "DESC",
      )
      .addOrderBy("document.updatedAt", "DESC");

    // 分页
    queryBuilder.skip(skip).take(pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取文档修订历史
   */
  async getRevisions(
    docId: string,
    queryDto: QueryRevisionsDto,
    userId: string,
  ) {
    const document = await this.findOne(docId, userId);
    await this.checkDocumentEditPermission(document, userId);

    const { page = 1, pageSize = 20 } = queryDto;
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.docRevisionRepository.findAndCount({
      where: { docId },
      order: { docVer: "DESC" },
      skip,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  /**
   * 版本对比：返回两个版本之间的内容差异
   */
  async getDiff(
    docId: string,
    diffQuery: DiffVersionsDto,
    userId: string,
  ): Promise<DiffResponse> {
    const document = await this.findOne(docId, userId);
    await this.checkDocumentEditPermission(document, userId);

    const fromKind = diffQuery.fromKind ?? "revision";
    const toKind = diffQuery.toKind ?? "revision";
    if (fromKind === "draft" && toKind === "draft") {
      throw new BadRequestException("cannot diff draft against draft");
    }

    const [fromResult, toResult] = await Promise.all([
      this.resolveDiffRef(docId, document.head, fromKind, diffQuery.fromVer),
      this.resolveDiffRef(docId, document.head, toKind, diffQuery.toVer),
    ]);

    if (
      fromResult.kind === "revision" &&
      toResult.kind === "revision" &&
      fromResult.version !== null &&
      toResult.version !== null &&
      fromResult.version > toResult.version
    ) {
      throw new BadRequestException("fromVer cannot be greater than toVer");
    }

    const [fromTree, toTree] = await Promise.all([
      this.buildContentTreeFromVersionMap(
        docId,
        document.rootBlockId,
        fromResult.map,
        undefined,
        undefined,
        1000,
        fromResult.createdAt,
      ),
      this.buildContentTreeFromVersionMap(
        docId,
        document.rootBlockId,
        toResult.map,
        undefined,
        undefined,
        1000,
        toResult.createdAt,
      ),
    ]);

    const { changes, summary } = await this.buildDiff(
      docId,
      fromResult.map,
      toResult.map,
    );

    return {
      docId,
      fromVer: fromResult.version,
      toVer: toResult.version,
      fromRef: {
        kind: fromResult.kind,
        label: fromResult.label,
        version: fromResult.version,
      },
      toRef: {
        kind: toResult.kind,
        label: toResult.label,
        version: toResult.version,
      },
      summary,
      changes,
      fromContent: fromTree,
      toContent: toTree,
    };
  }

  private async resolveDiffRef(
    docId: string,
    head: number,
    kind: DiffRefKind,
    version?: number,
  ): Promise<ResolvedDiffRef> {
    if (kind === "draft") {
      const draft = await this.documentDraftService.findByDocId(docId);
      if (!draft) {
        throw new NotFoundException("draft not found");
      }
      return {
        kind: "draft",
        label: "draft",
        version: null,
        createdAt: draft.updatedAt ?? Date.now(),
        map: (draft.blockVersionMap ?? {}) as Record<string, number>,
      };
    }

    if (typeof version !== "number") {
      throw new BadRequestException("revision diff requires version number");
    }
    if (version > head) {
      throw new BadRequestException("version cannot exceed current head");
    }

    const result = await this.getBlockVersionMapForVersion(docId, version);
    return {
      kind: "revision",
      label: `v${version}`,
      version,
      createdAt: result.createdAt,
      map: result.map,
    };
  }

  async revert(
    docId: string,
    version: number,
    userId: string,
    draftStrategy: RevertDraftStrategy | undefined = "preserve",
  ) {
    const document = await this.findOne(docId, userId);
    await this.checkDocumentEditPermission(document, userId);

    if (version > document.head) {
      throw new BadRequestException("版本号不能超过当前文档 head");
    }
    if (version === document.head) {
      throw new BadRequestException("当前已是该版本，无需回滚");
    }

    const { map: blockVersionMap } = await this.getBlockVersionMapForVersion(
      docId,
      version,
    );
    const revision = await this.docRevisionRepository.findOne({
      where: { docId, docVer: version },
    });
    if (!revision) {
      throw new NotFoundException("保存回退前草稿");
    }
    const existingDraft = await this.documentDraftService.findByDocId(docId);
    const effectiveDraftStrategy = existingDraft
      ? (draftStrategy ?? "preserve")
      : null;

    return await this.dataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(Document);
      const blockRepo = manager.getRepository(Block);
      const revRepo = manager.getRepository(DocRevision);

      if (effectiveDraftStrategy === "preserve") {
        await this.documentDraftService.commitDraftWithManager(
          docId,
          userId,
          "保存回退前草稿",
          manager,
        );
      } else if (effectiveDraftStrategy === "discard") {
        await this.documentDraftService.discardDraftWithManager(docId, manager);
      }

      const doc = await docRepo.findOne({ where: { docId } });
      if (!doc) throw new NotFoundException("文档不存在");

      const allBlocks = await blockRepo.find({ where: { docId } });
      const targetBlockIds = new Set(Object.keys(blockVersionMap));

      for (const block of allBlocks) {
        if (targetBlockIds.has(block.blockId)) {
          block.latestVer = blockVersionMap[block.blockId];
          block.isDeleted = false;
          (block as any).deletedAt = null;
          (block as any).deletedBy = null;
        } else {
          block.isDeleted = true;
          block.deletedAt = Date.now();
          block.deletedBy = userId;
        }
        await blockRepo.save(block);
      }

      doc.head += 1;
      doc.updatedBy = userId;
      await docRepo.save(doc);

      const newRevision = revRepo.create({
        revisionId: `${docId}@${doc.head}`,
        docId,
        docVer: doc.head,
        createdAt: Date.now(),
        createdBy: userId,
        message: `回退到 v${version}`,
        branch: "draft",
        patches: [],
        rootBlockId: doc.rootBlockId,
        source: "api",
        opSummary: {
          revertedFrom: version,
          draftStrategy: effectiveDraftStrategy,
        },
      });
      await revRepo.save(newRevision);
      await this.documentSnapshotService.createSnapshotForRevision(
        docId,
        doc.head,
        manager,
        {
          kind: "revision",
          pinned: false,
          metadata: {
            source: "revert",
            revertedFrom: version,
            draftStrategy: effectiveDraftStrategy,
          },
        },
      );

      return this.findOne(docId, userId);
    });
  }

  /**
   * ??????????????????????
   */
  async createSnapshot(docId: string, userId: string) {
    const document = await this.findOne(docId, userId);
    await this.checkDocumentEditPermission(document, userId);

    return this.dataSource.transaction((manager) =>
      this.documentSnapshotService.createSnapshotForRevision(
        docId,
        document.head,
        manager,
        {
          kind: "manual",
          pinned: true,
          metadata: { source: "manual-api" },
        },
      ),
    );
  }

  /**
   * ????????????????????
   */
  async commitVersion(
    docId: string,
    message: string | undefined,
    userId: string,
    syncSession?: {
      sessionId?: string;
      sessionEpoch?: number;
      ackedThroughOpSeq?: number;
    },
  ) {
    const document = await this.assertAccessWithoutViewIncrement(docId, userId);
    await this.checkDocumentEditPermission(document, userId);
    const activeSession = await this.validateDocumentSyncSession(
      docId,
      syncSession,
    );
    if (
      typeof syncSession?.ackedThroughOpSeq === "number" &&
      syncSession.ackedThroughOpSeq > (activeSession?.lastAckedOpSeq ?? 0)
    ) {
      throw new BadRequestException("SYNC_SESSION_ACK_NOT_REACHED");
    }
    return this.documentDraftService.commitDraft(docId, userId, message);
  }

  /**
   * 获取文档待创建版本的数量
   */
  async getPendingVersions(docId: string, userId: string) {
    await this.assertAccessWithoutViewIncrement(docId, userId);
    const draft = await this.documentDraftService.findByDocId(docId);
    const legacyPendingCount =
      this.versionControlService.getPendingVersionCount(docId);
    const pendingCount =
      typeof legacyPendingCount === "number"
        ? legacyPendingCount
        : draft
          ? 1
          : 0;

    return {
      docId,
      pendingCount,
      hasPending: pendingCount > 0,
    };
  }

  async getExportSource(docId: string, userId: string) {
    const document = await this.assertAccessWithoutViewIncrement(docId, userId);
    const content = await this.getContentByDocument(
      document,
      document.head,
      undefined,
      undefined,
      undefined,
      "all",
    );

    return {
      document,
      content,
    };
  }

  /**
   * 获取文档同步状态（head + pending draft）
   */
  async getSyncState(
    docId: string,
    userId: string,
  ): Promise<SyncStateResponseDto> {
    const document = await this.documentRepository.findOne({
      where: { docId },
      select: [
        "docId",
        "workspaceId",
        "head",
        "draftRevision",
        "publishedHead",
        "updatedAt",
        "status",
        "createdBy",
        "visibility",
      ],
    });

    if (!document || document.status === "deleted") {
      throw new NotFoundException("文档不存在");
    }

    await this.checkDocumentAccess(document as Document, userId);

    const draft = await this.documentDraftService.findByDocId(docId);
    const { pendingCount, hasPendingDraft } =
      this.versionControlService.getPendingDraftStateFromDraft(Boolean(draft));

    return {
      docId: document.docId,
      head: document.head,
      publishedHead: document.publishedHead,
      pendingCount,
      hasPendingDraft,
      draftRevision: document.draftRevision ?? 0,
      updatedAt: document.updatedAt,
    };
  }

  async applyDraftCheckpoint(
    docId: string,
    userId: string,
    dto: DraftCheckpointDto,
  ): Promise<DraftCheckpointResponseDto> {
    const document = await this.assertAccessWithoutViewIncrement(docId, userId);
    await this.checkDocumentEditPermission(document, userId);
    return this.draftCheckpointService.applyDraftCheckpoint(docId, userId, dto);
  }

  async reconcileSyncManifest(
    docId: string,
    userId: string,
    dto: SyncReconcileDto,
  ): Promise<SyncReconcileResponse> {
    const document = await this.assertAccessWithoutViewIncrement(docId, userId);
    await this.checkDocumentEditPermission(document, userId);
    await this.validateDocumentSyncSession(docId, {
      sessionId: dto.sessionId,
      sessionEpoch: dto.sessionEpoch,
    });
    const clientBatchId = this.normalizeReconcileClientBatchId(
      dto.clientBatchId,
    );
    const fingerprint = this.buildSyncReconcileFingerprint({
      ...dto,
      clientBatchId,
    });

    return this.dataSource.transaction(async (manager) => {
      const docInTx =
        await this.documentDraftService.lockDocumentForDraftMutation(
          docId,
          manager,
        );
      const serverDraftRevision = docInTx.draftRevision ?? 0;
      const clientDraftRevision = dto.draftRevision ?? 0;
      const checkedAt = Date.now();
      const receiptRepository = manager.getRepository(SyncReconcileReceipt);
      const existingReceipt = await receiptRepository.findOne({
        where: { docId, clientBatchId },
      });
      if (existingReceipt) {
        if (existingReceipt.requestFingerprint === fingerprint) {
          this.logSyncReconcileEvent("replay", {
            docId,
            userId,
            clientBatchId,
            sessionId: dto.sessionId,
            sessionEpoch: dto.sessionEpoch,
            draftRevision: existingReceipt.draftRevision,
            needsReload: existingReceipt.needsReload,
            tombstonedCount: existingReceipt.tombstoned?.length ?? 0,
          });
          return this.mapSyncReconcileReceiptToResponse(existingReceipt);
        }
        this.logSyncReconcileEvent("fingerprint-conflict", {
          docId,
          userId,
          clientBatchId,
          sessionId: dto.sessionId,
          sessionEpoch: dto.sessionEpoch,
          draftRevision: serverDraftRevision,
          needsReload: true,
        });
        return this.buildSyncReconcileConflictResponse({
          draftRevision: serverDraftRevision,
          code: "RECONCILE_FINGERPRINT_CONFLICT",
          message: "Reconcile id was reused with different content",
        });
      }

      if (clientDraftRevision !== serverDraftRevision) {
        const response = {
          draftRevision: serverDraftRevision,
          needsReload: true,
          conflicts: [
            {
              code: "DRAFT_REVISION_MISMATCH",
              message: `draftRevision(${clientDraftRevision}) does not match serverDraftRevision(${serverDraftRevision})`,
              serverDraftRevision,
              clientDraftRevision,
            },
          ],
          tombstoned: [],
        };
        await this.saveSyncReconcileReceipt({
          manager,
          docId,
          userId,
          clientBatchId,
          fingerprint,
          checkedAt,
          response,
        });
        this.logSyncReconcileEvent("draft-revision-mismatch", {
          docId,
          userId,
          clientBatchId,
          sessionId: dto.sessionId,
          sessionEpoch: dto.sessionEpoch,
          draftRevision: serverDraftRevision,
          needsReload: true,
        });
        return response;
      }

      const draft = await manager
        .getRepository(DocDraft)
        .findOne({ where: { docId } });
      if (!draft) {
        const response = {
          draftRevision: serverDraftRevision,
          needsReload: false,
          conflicts: [],
          tombstoned: [],
        };
        await this.saveSyncReconcileReceipt({
          manager,
          docId,
          userId,
          clientBatchId,
          fingerprint,
          checkedAt,
          response,
        });
        this.logSyncReconcileEvent("no-draft", {
          docId,
          userId,
          clientBatchId,
          sessionId: dto.sessionId,
          sessionEpoch: dto.sessionEpoch,
          draftRevision: serverDraftRevision,
          needsReload: false,
        });
        return response;
      }

      const tombstoned = await this.tombstoneMissingSyncManifestBlocks({
        manager,
        docId,
        userId,
        draft,
        manifest: dto.manifest ?? [],
        clientBatchId: dto.clientBatchId,
        sessionId: dto.sessionId,
        sessionEpoch: dto.sessionEpoch,
        now: checkedAt,
      });

      let nextDraftRevision = serverDraftRevision;
      if (tombstoned.length > 0) {
        docInTx.draftRevision = serverDraftRevision + 1;
        docInTx.updatedBy = userId;
        await manager.save(Document, docInTx);
        nextDraftRevision = docInTx.draftRevision;
      }

      const response = {
        draftRevision: nextDraftRevision,
        needsReload: false,
        conflicts: [],
        tombstoned,
      };
      await this.saveSyncReconcileReceipt({
        manager,
        docId,
        userId,
        clientBatchId,
        fingerprint,
        checkedAt,
        response,
      });
      this.logSyncReconcileEvent("applied", {
        docId,
        userId,
        clientBatchId,
        sessionId: dto.sessionId,
        sessionEpoch: dto.sessionEpoch,
        draftRevision: nextDraftRevision,
        needsReload: false,
        tombstonedCount: tombstoned.length,
      });
      return response;
    });
  }

  private logSyncReconcileEvent(
    phase:
      | "applied"
      | "draft-revision-mismatch"
      | "fingerprint-conflict"
      | "no-draft"
      | "replay",
    params: {
      docId: string;
      userId: string;
      clientBatchId: string;
      sessionId?: string;
      sessionEpoch?: number;
      draftRevision: number;
      needsReload: boolean;
      tombstonedCount?: number;
    },
  ) {
    const suffix = [
      `docId=${params.docId}`,
      `userId=${params.userId}`,
      `clientBatchId=${params.clientBatchId}`,
      `sessionId=${params.sessionId ?? "-"}`,
      `sessionEpoch=${typeof params.sessionEpoch === "number" ? params.sessionEpoch : "-"}`,
      `draftRevision=${params.draftRevision}`,
      `needsReload=${params.needsReload}`,
      `tombstoned=${params.tombstonedCount ?? 0}`,
    ].join(", ");
    this.logger.log(`同步 manifest reconcile ${phase}: ${suffix}`);
  }

  private normalizeReconcileClientBatchId(clientBatchId?: string): string {
    const normalized = clientBatchId?.trim();
    if (!normalized) {
      throw new BadRequestException("RECONCILE_CLIENT_BATCH_ID_REQUIRED");
    }
    return normalized;
  }

  private buildSyncReconcileFingerprint(dto: SyncReconcileDto): string {
    return JSON.stringify({
      draftRevision: dto.draftRevision,
      sessionId: dto.sessionId ?? null,
      sessionEpoch: dto.sessionEpoch ?? null,
      clientBatchId: dto.clientBatchId,
      manifest: dto.manifest ?? [],
    });
  }

  private mapSyncReconcileReceiptToResponse(receipt: SyncReconcileReceipt): SyncReconcileResponse {
    return {
      draftRevision: receipt.draftRevision,
      needsReload: receipt.needsReload,
      conflicts: receipt.conflicts,
      tombstoned: receipt.tombstoned as SyncReconcileTombstone[],
    };
  }

  private buildSyncReconcileConflictResponse(params: {
    draftRevision: number;
    code: string;
    message: string;
  }): SyncReconcileResponse {
    return {
      draftRevision: params.draftRevision,
      needsReload: true,
      conflicts: [{ code: params.code, message: params.message }],
      tombstoned: [],
    };
  }

  private async saveSyncReconcileReceipt(params: {
    manager: EntityManager;
    docId: string;
    userId: string;
    clientBatchId: string;
    fingerprint: string;
    checkedAt: number;
    response: SyncReconcileResponse;
  }): Promise<void> {
    await params.manager.getRepository(SyncReconcileReceipt).save({
      docId: params.docId,
      clientBatchId: params.clientBatchId,
      requestFingerprint: params.fingerprint,
      checkedAt: params.checkedAt,
      draftRevision: params.response.draftRevision,
      needsReload: params.response.needsReload,
      conflicts: params.response.conflicts,
      tombstoned: params.response.tombstoned,
      createdBy: params.userId,
      createdAt: params.checkedAt,
      updatedAt: params.checkedAt,
    });
  }

  private async tombstoneMissingSyncManifestBlocks(params: {
    manager: EntityManager;
    docId: string;
    userId: string;
    draft: DocDraft;
    manifest: SyncManifestIdentity[];
    clientBatchId?: string;
    sessionId?: string;
    sessionEpoch?: number;
    now: number;
  }): Promise<SyncReconcileTombstone[]> {
    const liveBlockIds = new Set<string>();
    const liveClientIds = new Set<string>();
    const liveSyncCreateIds = new Set<string>();
    for (const item of params.manifest) {
      const blockId = this.cleanSyncIdentity(item.blockId);
      const clientId = this.cleanSyncIdentity(item.clientId);
      const syncCreateId = this.cleanSyncIdentity(item.syncCreateId);
      if (blockId) liveBlockIds.add(blockId);
      if (clientId) liveClientIds.add(clientId);
      if (syncCreateId) liveSyncCreateIds.add(syncCreateId);
    }

    const draftMap = (params.draft.blockVersionMap ?? {}) as Record<
      string,
      number
    >;
    const candidates = Object.entries(draftMap)
      .filter(
        ([blockId]) =>
          blockId !== params.draft.rootBlockId && !liveBlockIds.has(blockId),
      )
      .map(([blockId, ver]) => ({ blockId, ver }));
    if (candidates.length === 0) return [];

    const versions = await params.manager.find(BlockVersion, {
      where: candidates.map((candidate) => ({
        docId: params.docId,
        blockId: candidate.blockId,
        ver: candidate.ver,
      })),
    });
    const byBlock = new Map(
      versions.map((version) => [version.blockId, version]),
    );
    const tombstoned: SyncReconcileTombstone[] = [];

    for (const candidate of candidates) {
      const latestVersion = byBlock.get(candidate.blockId);
      if (!latestVersion || this.isDeletedSnapshotVersion(latestVersion))
        continue;

      const attrs = this.getPayloadAttrs(latestVersion.payload);
      const clientId = this.cleanSyncIdentity(attrs.clientId);
      const syncCreateId = this.cleanSyncIdentity(attrs.syncCreateId);
      if (!clientId && !syncCreateId) continue;
      if (
        (clientId && liveClientIds.has(clientId)) ||
        (syncCreateId && liveSyncCreateIds.has(syncCreateId))
      ) {
        continue;
      }

      const block = await params.manager.findOne(Block, {
        where: { docId: params.docId, blockId: candidate.blockId },
      });
      if (!block) continue;

      const newVer = await this.getNextBlockVersionNumber(
        params.manager,
        params.docId,
        candidate.blockId,
        block.latestVer,
      );
      const deletedPayload = {
        ...(latestVersion.payload as Record<string, unknown>),
        attrs: {
          ...attrs,
          deleted: true,
        },
      };
      const blockVersion = params.manager.create(BlockVersion, {
        versionId: generateVersionId(candidate.blockId, newVer),
        docId: params.docId,
        blockId: candidate.blockId,
        ver: newVer,
        createdAt: params.now,
        createdBy: params.userId,
        parentId: latestVersion.parentId,
        sortKey: latestVersion.sortKey,
        indent: latestVersion.indent,
        collapsed: latestVersion.collapsed,
        payload: deletedPayload,
        hash: this.calculateHash(deletedPayload),
        plainText: latestVersion.plainText,
        refs: latestVersion.refs,
      });
      await params.manager.save(BlockVersion, blockVersion);

      block.latestVer = newVer;
      block.latestAt = params.now;
      block.latestBy = params.userId;
      await params.manager.save(Block, block);

      await this.documentDraftService.pointBlockToDeletedVersion(
        params.docId,
        candidate.blockId,
        newVer,
        params.userId,
        params.manager,
      );
      await this.saveSyncCreateTombstoneForReconcile({
        manager: params.manager,
        docId: params.docId,
        userId: params.userId,
        clientId,
        syncCreateId,
        clientBatchId: params.clientBatchId,
        sessionId: params.sessionId,
        sessionEpoch: params.sessionEpoch,
        now: params.now,
      });

      tombstoned.push({
        blockId: candidate.blockId,
        version: newVer,
        clientId: clientId ?? null,
        syncCreateId: syncCreateId ?? null,
      });
    }

    return tombstoned;
  }

  private async saveSyncCreateTombstoneForReconcile(params: {
    manager: EntityManager;
    docId: string;
    userId: string;
    clientId: string | null;
    syncCreateId: string | null;
    clientBatchId?: string;
    sessionId?: string;
    sessionEpoch?: number;
    now: number;
  }): Promise<void> {
    if (!params.clientId && !params.syncCreateId) return;

    const query = params.manager
      .getRepository(SyncCreateTombstone)
      .createQueryBuilder("t")
      .where("t.docId = :docId", { docId: params.docId })
      .andWhere("t.expiresAt > :now", { now: params.now });
    if (params.clientId && params.syncCreateId) {
      query.andWhere(
        "(t.clientId = :clientId OR t.syncCreateId = :syncCreateId)",
        {
          clientId: params.clientId,
          syncCreateId: params.syncCreateId,
        },
      );
    } else if (params.clientId) {
      query.andWhere("t.clientId = :clientId", { clientId: params.clientId });
    } else if (params.syncCreateId) {
      query.andWhere("t.syncCreateId = :syncCreateId", {
        syncCreateId: params.syncCreateId,
      });
    }
    const existing = await query.getOne();
    if (existing) return;

    const repository = params.manager.getRepository(SyncCreateTombstone);
    await repository.save(
      repository.create({
        docId: params.docId,
        sessionId: params.sessionId ?? null,
        sessionEpoch:
          typeof params.sessionEpoch === "number" ? params.sessionEpoch : null,
        clientId: params.clientId,
        syncCreateId: params.syncCreateId,
        deleteClientBatchId:
          params.clientBatchId ?? `manifest-reconcile:${params.now}`,
        deletedAt: params.now,
        expiresAt: params.now + this.syncCreateTombstoneTtlMs,
        createdBy: params.userId,
      }),
    );
  }

  /**
   * 根据两个版本的块映射计算差异
   */
  private async buildDiff(
    docId: string,
    fromMap: Record<string, number>,
    toMap: Record<string, number>,
  ): Promise<{ changes: DiffChangeItem[]; summary: DiffSummary }> {
    // 收集所有 (blockId, ver) 对，去重
    const conditionMap = new Map<string, { blockId: string; ver: number }>();
    for (const [blockId, ver] of Object.entries(fromMap)) {
      conditionMap.set(`${blockId}:${ver}`, { blockId, ver });
    }
    for (const [blockId, ver] of Object.entries(toMap)) {
      conditionMap.set(`${blockId}:${ver}`, { blockId, ver });
    }
    const conditions = [...conditionMap.values()];

    if (conditions.length === 0) {
      return {
        changes: [],
        summary: {
          added: 0,
          deleted: 0,
          modified: 0,
          moved: 0,
          reordered: 0,
          indentChanged: 0,
          unchanged: 0,
        },
      };
    }

    // 一次查询获取所有需要的 BlockVersion 记录
    const versions = await this.blockVersionRepository.find({
      where: conditions.map((c) => ({ docId, blockId: c.blockId, ver: c.ver })),
      select: [
        "blockId",
        "ver",
        "parentId",
        "sortKey",
        "indent",
        "payload",
        "hash",
      ],
    });

    // 按 blockId:ver 建索引
    const bvIndex = new Map<string, (typeof versions)[0]>();
    for (const v of versions) {
      bvIndex.set(`${v.blockId}:${v.ver}`, v);
    }

    // 遍历两个 map 的 blockId 并集，分类变更
    const allBlockIds = new Set([
      ...Object.keys(fromMap),
      ...Object.keys(toMap),
    ]);
    const changes: DiffChangeItem[] = [];
    const summary: DiffSummary = {
      added: 0,
      deleted: 0,
      modified: 0,
      moved: 0,
      reordered: 0,
      indentChanged: 0,
      unchanged: 0,
    };

    for (const blockId of allBlockIds) {
      const fromVer = fromMap[blockId];
      const toVer = toMap[blockId];
      const fromBv =
        fromVer === undefined
          ? undefined
          : bvIndex.get(`${blockId}:${fromVer}`);
      const toBv =
        toVer === undefined ? undefined : bvIndex.get(`${blockId}:${toVer}`);
      const fromVisible =
        Boolean(fromBv) && !this.isDeletedSnapshotVersion(fromBv!);
      const toVisible = Boolean(toBv) && !this.isDeletedSnapshotVersion(toBv!);

      if (!fromVisible && !toVisible) {
        continue;
      }

      if (!fromVisible && toVisible) {
        // 新增块
        summary.added++;
        changes.push({
          type: "added",
          blockId,
          to: this.extractSnapshot(toBv!),
        });
      } else if (fromVisible && !toVisible) {
        // 删除块
        summary.deleted++;
        changes.push({
          type: "deleted",
          blockId,
          from: this.extractSnapshot(fromBv!),
        });
      } else {
        // 两边都存在，比较差异
        if (!fromBv || !toBv) continue;

        const hashChanged = fromBv.hash !== toBv.hash;
        const parentChanged = fromBv.parentId !== toBv.parentId;
        const sortKeyChanged = fromBv.sortKey !== toBv.sortKey;
        const indentChanged = fromBv.indent !== toBv.indent;

        if (
          !hashChanged &&
          !parentChanged &&
          !sortKeyChanged &&
          !indentChanged
        ) {
          summary.unchanged++;
          continue;
        }

        // 优先级：moved > modified > reordered > indent-changed
        let changeType: DiffChangeItem["type"];
        if (parentChanged) {
          changeType = "moved";
          summary.moved++;
        } else if (hashChanged) {
          changeType = "modified";
          summary.modified++;
        } else if (sortKeyChanged) {
          changeType = "reordered";
          summary.reordered++;
        } else {
          changeType = "indent-changed";
          summary.indentChanged++;
        }

        changes.push({
          type: changeType,
          blockId,
          from: this.extractSnapshot(fromBv),
          to: this.extractSnapshot(toBv),
        });
      }
    }

    return { changes, summary };
  }

  private isDeletedSnapshotVersion(bv: Pick<BlockVersion, "payload">): boolean {
    const payload = bv.payload;
    if (!payload || typeof payload !== "object" || !("attrs" in payload)) {
      return false;
    }
    const attrs = (payload as { attrs?: unknown }).attrs;
    if (!attrs || typeof attrs !== "object") {
      return false;
    }
    return (attrs as Record<string, unknown>).deleted === true;
  }

  private getPayloadAttrs(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || !("attrs" in payload)) {
      return {};
    }
    const attrs = (payload as { attrs?: unknown }).attrs;
    return attrs && typeof attrs === "object"
      ? (attrs as Record<string, unknown>)
      : {};
  }

  private cleanSyncIdentity(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
  }

  private async getNextBlockVersionNumber(
    manager: EntityManager,
    docId: string,
    blockId: string,
    currentLatestVer: number,
  ): Promise<number> {
    const raw = await manager
      .getRepository(BlockVersion)
      .createQueryBuilder("bv")
      .select("MAX(bv.ver)", "maxVer")
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.blockId = :blockId", { blockId })
      .getRawOne<{ maxVer?: number | string | null }>();
    const maxHistoricalVer = Math.max(
      currentLatestVer,
      Number.isFinite(Number(raw?.maxVer))
        ? Number(raw?.maxVer)
        : currentLatestVer,
    );
    return maxHistoricalVer + 1;
  }

  private extractSnapshot(bv: BlockVersion): BlockSnapshot {
    return {
      ver: bv.ver,
      type: (bv.payload as any)?.type || "paragraph",
      payload: bv.payload,
      parentId: bv.parentId,
      sortKey: bv.sortKey,
      indent: bv.indent,
      hash: bv.hash,
    };
  }

  /**
   * 根据 DocRevision 的 createdAt 计算某文档版本对应的块版本映射
   */
  private async getBlockVersionMapForVersion(
    docId: string,
    docVer: number,
  ): Promise<{ map: Record<string, number>; createdAt: number }> {
    const snapshotResult =
      await this.documentSnapshotService.getSnapshotMapForVersion(
        docId,
        docVer,
      );
    if (snapshotResult.snapshot) {
      const revision = await this.docRevisionRepository.findOne({
        where: { docId, docVer },
      });
      return {
        map: snapshotResult.map,
        createdAt: revision?.createdAt ?? snapshotResult.snapshot.createdAt,
      };
    }

    const revision = await this.docRevisionRepository.findOne({
      where: { docId, docVer },
    });
    if (!revision) {
      throw new NotFoundException(`修订版本 ${docVer} 不存在`);
    }

    // 获取文档信息，包含根块ID
    const document = await this.documentRepository.findOne({
      where: { docId },
      select: ["rootBlockId"],
    });
    if (!document) {
      throw new NotFoundException(`文档 ${docId} 不存在`);
    }

    // 查询块版本映射，使用时间感知过滤（只排除在目标版本之前就已删除的块）
    const rows = await this.blockVersionRepository
      .createQueryBuilder("bv")
      .innerJoin(
        Block,
        "b",
        'bv.blockId = b.blockId AND (b."deletedAt" IS NULL OR b."deletedAt" > :delCutoff)',
        {
          delCutoff: revision.createdAt,
        },
      )
      .select("bv.blockId", "blockId")
      .addSelect("MAX(bv.ver)", "maxVer")
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.createdAt <= :createdAt", { createdAt: revision.createdAt })
      .groupBy("bv.blockId")
      .getRawMany();

    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.blockId] =
        typeof r.maxVer === "string" ? parseInt(r.maxVer, 10) : r.maxVer;
    }

    // 确保根块在版本映射中（根块不应该被删除）
    if (document.rootBlockId && !(document.rootBlockId in map)) {
      console.log(
        "根块不在版本映射中，尝试添加，rootBlockId:",
        document.rootBlockId,
      );

      // 查询根块的最新版本
      const rootBlock = await this.blockRepository.findOne({
        where: { docId, blockId: document.rootBlockId },
      });

      console.log(
        "根块查询结果:",
        rootBlock
          ? {
              blockId: rootBlock.blockId,
              isDeleted: rootBlock.isDeleted,
              latestVer: rootBlock.latestVer,
            }
          : "null",
      );

      if (
        rootBlock &&
        (!rootBlock.isDeleted ||
          (rootBlock.deletedAt != null &&
            rootBlock.deletedAt > revision.createdAt))
      ) {
        // 查找根块在该时间点之前的版本
        const rootVersion = await this.blockVersionRepository
          .createQueryBuilder("bv")
          .where("bv.docId = :docId", { docId })
          .andWhere("bv.blockId = :blockId", { blockId: document.rootBlockId })
          .andWhere("bv.createdAt <= :createdAt", {
            createdAt: revision.createdAt,
          })
          .orderBy("bv.ver", "DESC")
          .limit(1)
          .getOne();

        console.log(
          "根块版本查询结果:",
          rootVersion
            ? {
                blockId: rootVersion.blockId,
                ver: rootVersion.ver,
                createdAt: rootVersion.createdAt,
              }
            : "null",
        );
        console.log("revision.createdAt:", revision.createdAt);

        if (rootVersion) {
          map[document.rootBlockId] = rootVersion.ver;
          console.log(
            "已添加根块到版本映射:",
            document.rootBlockId,
            "ver:",
            rootVersion.ver,
          );
        } else {
          // 如果根块没有版本记录，使用 latestVer（这种情况不应该发生，但作为后备）
          map[document.rootBlockId] = rootBlock.latestVer;
          console.log("根块没有版本记录，使用 latestVer:", rootBlock.latestVer);
        }
      } else {
        console.error("根块不存在或已被删除");
      }
    } else {
      console.log("根块已在版本映射中:", document.rootBlockId in map);
    }

    return { map, createdAt: revision.createdAt };
  }

  /**
   * 从起始块开始按需构建内容树（优化版本，只查询需要的块）
   */
  private async buildContentTreeFromStartBlock(
    docId: string,
    rootBlockId: string,
    startBlockId: string,
    revisionCreatedAt: number,
    maxDepth?: number,
    limit: number = 1000,
  ): Promise<{
    tree: any;
    totalBlocks: number;
    returnedBlocks: number;
    hasMore: boolean;
    nextStartBlockId?: string;
  }> {
    // 先找到起始块及其版本
    const startBlockVersion = await this.blockVersionRepository
      .createQueryBuilder("bv")
      .innerJoin(
        Block,
        "b",
        'bv.blockId = b.blockId AND (b."deletedAt" IS NULL OR b."deletedAt" > :delCutoff)',
        {
          delCutoff: revisionCreatedAt,
        },
      )
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.blockId = :blockId", { blockId: startBlockId })
      .andWhere("bv.createdAt <= :createdAt", { createdAt: revisionCreatedAt })
      .orderBy("bv.ver", "DESC")
      .limit(1)
      .getOne();

    if (!startBlockVersion) {
      throw new NotFoundException(`起始块 ${startBlockId} 不存在或已被删除`);
    }

    // 获取起始块的父块ID
    const startBlockParentId = startBlockVersion.parentId;

    // 如果起始块是根块，直接返回根块
    if (startBlockId === rootBlockId) {
      const rootVersion = await this.getBlockVersionAtTime(
        docId,
        rootBlockId,
        revisionCreatedAt,
      );
      if (!rootVersion) {
        return {
          tree: { __rootBlockMissing: true },
          totalBlocks: 0,
          returnedBlocks: 0,
          hasMore: false,
        };
      }

      const children = await this.getChildrenBlocks(
        docId,
        rootBlockId,
        revisionCreatedAt,
        maxDepth,
        0,
        limit,
      );

      return {
        tree: {
          blockId: rootVersion.blockId,
          blockVersionId: rootVersion.id,
          docId: rootVersion.docId,
          ver: rootVersion.ver,
          type: (rootVersion.payload as any)?.type || "root",
          payload: rootVersion.payload,
          parentId: rootVersion.parentId,
          sortKey: rootVersion.sortKey || "0",
          indent: rootVersion.indent || 0,
          collapsed: rootVersion.collapsed || false,
          children,
        },
        totalBlocks: 0, // 按需查询时无法准确统计总数
        returnedBlocks: 1 + children.length,
        hasMore: false, // 简化处理，实际应该根据 limit 判断
        nextStartBlockId: undefined,
      };
    }

    // 如果起始块不是根块，需要找到起始块及其后续兄弟块

    // 优化：只查询起始块及其后续的兄弟块（在数据库层面过滤）
    // 注意：由于 sortKey 是字符串且使用分数排序，我们需要查询所有兄弟块然后在内存中筛选
    // 但可以通过限制查询数量来减少数据库压力
    const siblingsQuery = await this.blockVersionRepository
      .createQueryBuilder("bv")
      .innerJoin(
        Block,
        "b",
        'bv.blockId = b.blockId AND (b."deletedAt" IS NULL OR b."deletedAt" > :delCutoff)',
        {
          delCutoff: revisionCreatedAt,
        },
      )
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.parentId = :parentId", { parentId: startBlockParentId })
      .andWhere("bv.createdAt <= :createdAt", { createdAt: revisionCreatedAt })
      .select("bv.blockId", "blockId")
      .addSelect("MAX(bv.ver)", "maxVer")
      .addSelect("MAX(bv.sortKey)", "sortKey")
      .groupBy("bv.blockId")
      .orderBy("CAST(MAX(bv.sortKey) AS INTEGER)", "ASC") // 按数字排序
      .addOrderBy("bv.blockId", "ASC")
      .getRawMany();

    // 在内存中按 sortKey 精确排序（使用 compareSortKey 函数）
    const sortedSiblings = siblingsQuery
      .map((row) => ({
        blockId: row.blockId,
        maxVer:
          typeof row.maxVer === "string"
            ? parseInt(row.maxVer, 10)
            : row.maxVer,
        sortKey: row.sortKey || "500000",
      }))
      .sort((a, b) => {
        const sortKeyA =
          a.sortKey && a.sortKey.trim() !== "" ? a.sortKey : "500000";
        const sortKeyB =
          b.sortKey && b.sortKey.trim() !== "" ? b.sortKey : "500000";
        const result = compareSortKey(sortKeyA, sortKeyB);
        if (result === 0) {
          return a.blockId.localeCompare(b.blockId);
        }
        return result;
      });

    // 找到起始块在兄弟块中的位置
    const startIndex = sortedSiblings.findIndex(
      (s) => s.blockId === startBlockId,
    );
    if (startIndex < 0) {
      throw new NotFoundException(
        `起始块 ${startBlockId} 不在其父块的子块列表中`,
      );
    }

    // 只获取起始块及其后续的兄弟块（限制数量，避免查询过多）
    const maxSiblingsToReturn = Math.min(
      limit,
      sortedSiblings.length - startIndex,
    );
    const blocksToReturn = sortedSiblings.slice(
      startIndex,
      startIndex + maxSiblingsToReturn,
    );

    // 按需查询这些块的完整版本信息
    const versions = await this.blockVersionRepository.find({
      where: blocksToReturn.map((s) => ({
        docId,
        blockId: s.blockId,
        ver: s.maxVer,
      })),
    });

    const byBlock = new Map<string, (typeof versions)[0]>();
    for (const v of versions) byBlock.set(v.blockId, v);

    // 构建树结构
    let returnedBlocks = 0;
    let hasMore = false;
    let nextStartBlockId: string | undefined;

    const buildNode = async (
      blockId: string,
      depth: number = 0,
    ): Promise<any> => {
      if (maxDepth !== undefined && depth > maxDepth) {
        return null;
      }

      if (returnedBlocks >= limit) {
        hasMore = true;
        if (!nextStartBlockId) {
          nextStartBlockId = blockId;
        }
        return null;
      }

      const bv = byBlock.get(blockId);
      if (!bv) return null;

      returnedBlocks++;

      // 按需查询子块
      const childVersions = await this.getChildrenBlocks(
        docId,
        blockId,
        revisionCreatedAt,
        maxDepth,
        depth + 1,
        limit - returnedBlocks,
      );

      return {
        blockId: bv.blockId,
        blockVersionId: bv.id,
        docId: bv.docId,
        ver: bv.ver,
        type: (bv.payload as any)?.type || "paragraph",
        payload: bv.payload,
        parentId: bv.parentId,
        sortKey: bv.sortKey || "500000",
        indent: bv.indent || 0,
        collapsed: bv.collapsed || false,
        children: childVersions,
      };
    };

    // 构建起始块及其后续兄弟块的树
    const children = await Promise.all(
      blocksToReturn.map((s) => buildNode(s.blockId, 0)),
    );
    const validChildren = children.filter(Boolean);

    // 如果起始块的父块是根块，返回根块（但只包含起始块及其后续兄弟块）
    if (startBlockParentId === rootBlockId) {
      const rootVersion = await this.getBlockVersionAtTime(
        docId,
        rootBlockId,
        revisionCreatedAt,
      );
      if (!rootVersion) {
        return {
          tree: { __rootBlockMissing: true },
          totalBlocks: 0,
          returnedBlocks: 0,
          hasMore: false,
        };
      }

      return {
        tree: {
          blockId: rootVersion.blockId,
          blockVersionId: rootVersion.id,
          docId: rootVersion.docId,
          ver: rootVersion.ver,
          type: (rootVersion.payload as any)?.type || "root",
          payload: rootVersion.payload,
          parentId: rootVersion.parentId,
          sortKey: rootVersion.sortKey || "0",
          indent: rootVersion.indent || 0,
          collapsed: rootVersion.collapsed || false,
          children: validChildren,
        },
        totalBlocks: 0,
        returnedBlocks: 1 + validChildren.length,
        hasMore,
        nextStartBlockId,
      };
    } else {
      // 如果起始块的父块不是根块，返回父块（但只包含起始块及其后续兄弟块）
      const parentVersion = await this.getBlockVersionAtTime(
        docId,
        startBlockParentId,
        revisionCreatedAt,
      );
      if (!parentVersion) {
        throw new NotFoundException(`父块 ${startBlockParentId} 不存在`);
      }

      return {
        tree: {
          blockId: parentVersion.blockId,
          blockVersionId: parentVersion.id,
          docId: parentVersion.docId,
          ver: parentVersion.ver,
          type: (parentVersion.payload as any)?.type || "paragraph",
          payload: parentVersion.payload,
          parentId: parentVersion.parentId,
          sortKey: parentVersion.sortKey || "500000",
          indent: parentVersion.indent || 0,
          collapsed: parentVersion.collapsed || false,
          children: validChildren,
        },
        totalBlocks: 0,
        returnedBlocks: 1 + validChildren.length,
        hasMore,
        nextStartBlockId,
      };
    }
  }

  /**
   * 获取块在指定时间点的版本
   */
  private async getBlockVersionAtTime(
    docId: string,
    blockId: string,
    createdAt: number,
  ): Promise<BlockVersion | null> {
    return await this.blockVersionRepository
      .createQueryBuilder("bv")
      .innerJoin(
        Block,
        "b",
        'bv.blockId = b.blockId AND (b."deletedAt" IS NULL OR b."deletedAt" > :delCutoff)',
        {
          delCutoff: createdAt,
        },
      )
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.blockId = :blockId", { blockId })
      .andWhere("bv.createdAt <= :createdAt", { createdAt })
      .orderBy("bv.ver", "DESC")
      .limit(1)
      .getOne();
  }

  /**
   * 按需获取子块（递归查询，只查询需要的块）
   */
  private async getChildrenBlocks(
    docId: string,
    parentId: string,
    revisionCreatedAt: number,
    maxDepth?: number,
    currentDepth: number = 0,
    remainingLimit: number = 1000,
  ): Promise<any[]> {
    if (maxDepth !== undefined && currentDepth > maxDepth) {
      return [];
    }

    if (remainingLimit <= 0) {
      return [];
    }

    // 优化：一次性查询该父块的所有子块及其在该时间点的最大版本号，按 sortKey 排序
    const childRows = await this.blockVersionRepository
      .createQueryBuilder("bv")
      .innerJoin(
        Block,
        "b",
        'bv.blockId = b.blockId AND (b."deletedAt" IS NULL OR b."deletedAt" > :delCutoff)',
        {
          delCutoff: revisionCreatedAt,
        },
      )
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.parentId = :parentId", { parentId })
      .andWhere("bv.createdAt <= :createdAt", { createdAt: revisionCreatedAt })
      .select("bv.blockId", "blockId")
      .addSelect("MAX(bv.ver)", "maxVer")
      .addSelect("MAX(bv.sortKey)", "sortKey")
      .groupBy("bv.blockId")
      .orderBy("MAX(bv.sortKey)", "ASC")
      .addOrderBy("bv.blockId", "ASC")
      .limit(remainingLimit) // 限制查询数量
      .getRawMany();

    if (childRows.length === 0) {
      return [];
    }

    // 按需查询这些子块的完整版本信息
    const childVersions = await this.blockVersionRepository.find({
      where: childRows.map((row) => ({
        docId,
        blockId: row.blockId,
        ver:
          typeof row.maxVer === "string"
            ? parseInt(row.maxVer, 10)
            : row.maxVer,
      })),
    });

    const children: any[] = [];
    let usedLimit = 0;

    for (const childVersion of childVersions) {
      if (usedLimit >= remainingLimit) {
        break;
      }

      usedLimit++;

      // 递归获取子块的子块（按需查询）
      const grandchildren = await this.getChildrenBlocks(
        docId,
        childVersion.blockId,
        revisionCreatedAt,
        maxDepth,
        currentDepth + 1,
        remainingLimit - usedLimit,
      );

      children.push({
        blockId: childVersion.blockId,
        blockVersionId: childVersion.id,
        docId: childVersion.docId,
        ver: childVersion.ver,
        type: (childVersion.payload as any)?.type || "paragraph",
        payload: childVersion.payload,
        parentId: childVersion.parentId,
        sortKey: childVersion.sortKey || "500000",
        indent: childVersion.indent || 0,
        collapsed: childVersion.collapsed || false,
        children: grandchildren,
      });

      usedLimit += grandchildren.length;
    }

    return children;
  }

  /**
   * 根据块版本映射构建内容树（支持分页）
   */
  private async buildContentTreeFromVersionMap(
    docId: string,
    rootBlockId: string,
    blockVersionMap: Record<string, number>,
    maxDepth?: number,
    startBlockId?: string,
    limit: number = 1000,
    revisionCreatedAt?: number,
  ): Promise<{
    tree: any;
    totalBlocks: number;
    returnedBlocks: number;
    hasMore: boolean;
    nextStartBlockId?: string;
  }> {
    if (!(rootBlockId in blockVersionMap)) {
      // 检查根块是否存在以及是否被删除
      const rootBlock = await this.blockRepository.findOne({
        where: { docId, blockId: rootBlockId },
      });
      if (!rootBlock) {
        return {
          tree: { __rootBlockMissing: true },
          totalBlocks: 0,
          returnedBlocks: 0,
          hasMore: false,
        };
      }
      if (
        rootBlock.isDeleted &&
        (!revisionCreatedAt ||
          (rootBlock.deletedAt != null &&
            rootBlock.deletedAt <= revisionCreatedAt))
      ) {
        return {
          tree: { __rootBlockDeleted: true },
          totalBlocks: 0,
          returnedBlocks: 0,
          hasMore: false,
        };
      }
      // 根块存在但不在版本映射中，返回 null（这种情况不应该发生）
      return { tree: null, totalBlocks: 0, returnedBlocks: 0, hasMore: false };
    }

    const entries = Object.entries(blockVersionMap).map(([blockId, ver]) => ({
      blockId,
      ver,
    }));
    if (entries.length === 0) {
      return { tree: null, totalBlocks: 0, returnedBlocks: 0, hasMore: false };
    }

    // 查询块版本，同时过滤已删除的块
    // 先单独检查根块（根块不应该被删除）
    const rootBlock = await this.blockRepository.findOne({
      where: { docId, blockId: rootBlockId },
    });

    if (!rootBlock) {
      console.error("根块不存在，rootBlockId:", rootBlockId);
      return {
        tree: { __rootBlockMissing: true },
        totalBlocks: 0,
        returnedBlocks: 0,
        hasMore: false,
      };
    }

    if (
      rootBlock.isDeleted &&
      (!revisionCreatedAt ||
        (rootBlock.deletedAt != null &&
          rootBlock.deletedAt <= revisionCreatedAt))
    ) {
      console.error("根块在目标版本前已被删除，rootBlockId:", rootBlockId);
      return {
        tree: { __rootBlockDeleted: true },
        totalBlocks: 0,
        returnedBlocks: 0,
        hasMore: false,
      };
    }

    // 查询非根块的有效块ID列表
    const nonRootEntries = entries.filter((e) => e.blockId !== rootBlockId);
    const nonRootBlockIds = nonRootEntries.map((e) => e.blockId);

    let validBlockIds = new Set<string>([rootBlockId]); // 根块始终有效

    if (nonRootBlockIds.length > 0) {
      // SQLite expression tree depth limit is 1000; chunk In() to stay safe
      const CHUNK_SIZE = 400;
      for (let i = 0; i < nonRootBlockIds.length; i += CHUNK_SIZE) {
        const chunk = nonRootBlockIds.slice(i, i + CHUNK_SIZE);
        const validBlocks = await this.blockRepository.find({
          where: {
            docId,
            blockId: In(chunk) as any,
            deletedAt: revisionCreatedAt
              ? Or(IsNull(), MoreThan(revisionCreatedAt))
              : IsNull(),
          },
          select: ["blockId"],
        });
        for (const b of validBlocks) {
          validBlockIds.add(b.blockId);
        }
      }
    }

    // 只查询有效块的版本（包括根块）
    const validEntries = entries.filter((e) => validBlockIds.has(e.blockId));

    // 确保根块在查询列表中
    if (!validEntries.find((e) => e.blockId === rootBlockId)) {
      const rootVer = blockVersionMap[rootBlockId];
      if (rootVer) {
        validEntries.unshift({ blockId: rootBlockId, ver: rootVer });
      }
    }

    if (validEntries.length === 0) {
      console.error("validEntries 为空，但根块应该存在");
      return { tree: null, totalBlocks: 0, returnedBlocks: 0, hasMore: false };
    }

    // Chunk the OR-based query to avoid SQLite "Expression tree is too large (maximum depth 1000)"
    const VERSION_QUERY_CHUNK = 200;
    const versions: BlockVersion[] = [];
    for (let i = 0; i < validEntries.length; i += VERSION_QUERY_CHUNK) {
      const chunk = validEntries.slice(i, i + VERSION_QUERY_CHUNK);
      const chunkVersions = await this.blockVersionRepository.find({
        where: chunk.map((e) => ({
          docId,
          blockId: e.blockId,
          ver: e.ver,
        })),
      });
      versions.push(...chunkVersions);
    }

    const byBlock = new Map<string, (typeof versions)[0]>();
    for (const v of versions) byBlock.set(v.blockId, v);

    const root = byBlock.get(rootBlockId);
    if (!root) {
      return { tree: null, totalBlocks: 0, returnedBlocks: 0, hasMore: false };
    }

    // 统计总块数
    const totalBlocks = validBlockIds.size;

    // 分页控制
    let returnedBlocks = 0;
    let hasMore = false;
    let nextStartBlockId: string | undefined;
    const visitedBlocks = new Set<string>();
    let shouldStart = !startBlockId; // 如果没有指定 startBlockId，从根块开始

    // 如果指定了 startBlockId，先找到该块及其父块信息
    let startBlockParentId: string | undefined;
    if (startBlockId) {
      const startBlock = byBlock.get(startBlockId);
      if (!startBlock) {
        throw new NotFoundException(`起始块 ${startBlockId} 不存在`);
      }
      startBlockParentId = startBlock.parentId;
    }

    const buildNode = (blockId: string, depth: number = 0): any => {
      // 检查是否超过最大深度
      if (maxDepth !== undefined && depth > maxDepth) {
        return null;
      }

      // 检查是否达到数量限制
      if (returnedBlocks >= limit) {
        hasMore = true;
        if (!nextStartBlockId) {
          nextStartBlockId = blockId;
        }
        return null;
      }

      // 检查是否已访问（避免循环）
      if (visitedBlocks.has(blockId)) {
        return null;
      }

      const bv = byBlock.get(blockId);
      if (!bv) return null;

      const payloadAttrs =
        bv.payload &&
        typeof bv.payload === "object" &&
        "attrs" in bv.payload &&
        typeof (bv.payload as { attrs?: unknown }).attrs === "object"
          ? ((bv.payload as { attrs?: Record<string, unknown> }).attrs ?? {})
          : {};
      if (payloadAttrs.deleted === true) {
        return null;
      }

      // 如果指定了 startBlockId，检查是否应该开始返回
      if (startBlockId && !shouldStart) {
        if (blockId === startBlockId) {
          shouldStart = true; // 找到起始块，开始返回
        } else {
          // 还没找到起始块，继续查找但不返回当前块
          visitedBlocks.add(blockId);
          // 递归查找子块
          const childVersions = versions
            .filter((v) => v.parentId === blockId)
            .sort((a, b) => {
              const sortKeyA =
                a.sortKey && a.sortKey.trim() !== "" ? a.sortKey : "500000";
              const sortKeyB =
                b.sortKey && b.sortKey.trim() !== "" ? b.sortKey : "500000";
              const result = compareSortKey(sortKeyA, sortKeyB);
              if (result === 0) {
                return a.blockId.localeCompare(b.blockId);
              }
              return result;
            });

          for (const child of childVersions) {
            const result = buildNode(child.blockId, depth + 1);
            if (result) {
              return result; // 找到起始块，返回结果
            }
          }
          return null; // 在当前分支没找到起始块
        }
      }

      // 如果指定了 startBlockId 但还没找到起始块，不应该返回当前块
      if (startBlockId && !shouldStart) {
        return null;
      }

      // 如果指定了 startBlockId 且已经找到起始块，检查当前块是否应该返回
      // 如果当前块是起始块之前的兄弟块，不应该返回
      if (startBlockId && shouldStart && blockId !== startBlockId) {
        // 检查当前块是否是起始块的兄弟块，且排在起始块之前
        if (bv.parentId === startBlockParentId) {
          const startBlock = byBlock.get(startBlockId);
          if (startBlock) {
            const startSortKey =
              startBlock.sortKey && startBlock.sortKey.trim() !== ""
                ? startBlock.sortKey
                : "500000";
            const currentSortKey =
              bv.sortKey && bv.sortKey.trim() !== "" ? bv.sortKey : "500000";
            // 如果当前块的 sortKey 小于起始块的 sortKey，跳过
            if (compareSortKey(currentSortKey, startSortKey) < 0) {
              visitedBlocks.add(blockId);
              return null;
            }
          }
        }
      }

      visitedBlocks.add(blockId);
      returnedBlocks++;

      // 获取所有子块并排序
      const childVersions = versions
        .filter((v) => v.parentId === blockId)
        .sort((a, b) => {
          const sortKeyA =
            a.sortKey && a.sortKey.trim() !== "" ? a.sortKey : "500000";
          const sortKeyB =
            b.sortKey && b.sortKey.trim() !== "" ? b.sortKey : "500000";
          const result = compareSortKey(sortKeyA, sortKeyB);
          if (result === 0) {
            return a.blockId.localeCompare(b.blockId);
          }
          return result;
        });

      // 如果指定了 startBlockId 且当前块是起始块的父块，只返回起始块及其后续兄弟块
      let childrenToProcess = childVersions;
      if (startBlockId && shouldStart && blockId === startBlockParentId) {
        const startIndex = childVersions.findIndex(
          (v) => v.blockId === startBlockId,
        );
        if (startIndex >= 0) {
          // 只返回起始块及其后续的兄弟块
          childrenToProcess = childVersions.slice(startIndex);
        }
      }

      const children = childrenToProcess
        .map((v) => buildNode(v.blockId, depth + 1))
        .filter(Boolean);

      // 如果达到限制，记录下一个块的ID
      if (returnedBlocks >= limit && !nextStartBlockId) {
        // 找到第一个未返回的子块作为下一个起始点
        for (const child of childVersions) {
          if (!visitedBlocks.has(child.blockId)) {
            nextStartBlockId = child.blockId;
            break;
          }
        }
        // 如果没有未返回的子块，尝试找下一个兄弟块
        if (!nextStartBlockId && blockId !== rootBlockId && bv.parentId) {
          const siblings = versions
            .filter((v) => v.parentId === bv.parentId)
            .sort((a, b) => {
              const sortKeyA =
                a.sortKey && a.sortKey.trim() !== "" ? a.sortKey : "500000";
              const sortKeyB =
                b.sortKey && b.sortKey.trim() !== "" ? b.sortKey : "500000";
              const result = compareSortKey(sortKeyA, sortKeyB);
              if (result === 0) {
                return a.blockId.localeCompare(b.blockId);
              }
              return result;
            });
          const currentIndex = siblings.findIndex((s) => s.blockId === blockId);
          if (currentIndex >= 0 && currentIndex < siblings.length - 1) {
            nextStartBlockId = siblings[currentIndex + 1].blockId;
          }
        }
      }

      return {
        blockId: bv.blockId,
        blockVersionId: bv.id,
        docId: bv.docId,
        ver: bv.ver,
        type: (bv.payload as any)?.type || "paragraph",
        payload: bv.payload,
        parentId: bv.parentId,
        sortKey: bv.sortKey || "500000",
        indent: bv.indent || 0,
        collapsed: bv.collapsed || false,
        children,
      };
    };

    // 如果指定了 startBlockId，从起始块开始构建树
    // 无论起始块在哪一层，都从根块开始查找，但只返回起始块及其后续内容
    let tree = buildNode(rootBlockId, 0);

    // 如果返回的树只是起始块本身，说明需要返回后续兄弟块
    // 但是后续兄弟块应该在父块级别处理，所以这里需要特殊处理
    if (
      startBlockId &&
      tree &&
      tree.blockId === startBlockId &&
      startBlockParentId
    ) {
      // 获取起始块的所有兄弟块
      const siblings = versions
        .filter((v) => v.parentId === startBlockParentId)
        .sort((a, b) => {
          const sortKeyA =
            a.sortKey && a.sortKey.trim() !== "" ? a.sortKey : "500000";
          const sortKeyB =
            b.sortKey && b.sortKey.trim() !== "" ? b.sortKey : "500000";
          const result = compareSortKey(sortKeyA, sortKeyB);
          if (result === 0) {
            return a.blockId.localeCompare(b.blockId);
          }
          return result;
        });

      const startIndex = siblings.findIndex((s) => s.blockId === startBlockId);
      if (startIndex >= 0 && startIndex < siblings.length - 1) {
        // 重置 shouldStart，重新构建后续兄弟块
        shouldStart = true;

        // 将后续兄弟块添加到起始块的 children 中（作为同级节点）
        // 但为了保持树结构，我们需要创建一个包含起始块及其后续兄弟块的列表
        // 实际上，更好的方式是返回起始块的父块，但只包含起始块及其后续兄弟块
        // 重新构建包含起始块及其后续兄弟块的树
        const parentBlock = byBlock.get(startBlockParentId);
        if (parentBlock) {
          // 重置状态，重新构建
          shouldStart = true;
          visitedBlocks.clear();
          returnedBlocks = 0;
          hasMore = false;
          nextStartBlockId = undefined;

          // 构建起始块及其后续兄弟块
          const allSiblingsFromStart = siblings
            .slice(startIndex)
            .map((s) => buildNode(s.blockId, 0))
            .filter(Boolean);

          // 如果父块是根块，直接返回根块（但只包含起始块及其后续兄弟块）
          if (startBlockParentId === rootBlockId) {
            return {
              tree: {
                blockId: root.blockId,
                blockVersionId: root.id,
                docId: root.docId,
                ver: root.ver,
                type: (root.payload as any)?.type || "root",
                payload: root.payload,
                parentId: "",
                sortKey: root.sortKey || "0",
                indent: 0,
                collapsed: false,
                children: allSiblingsFromStart,
              },
              totalBlocks,
              returnedBlocks,
              hasMore,
              nextStartBlockId: hasMore ? nextStartBlockId : undefined,
            };
          } else {
            // 如果父块不是根块，返回父块（但只包含起始块及其后续兄弟块）
            return {
              tree: {
                blockId: parentBlock.blockId,
                blockVersionId: parentBlock.id,
                docId: parentBlock.docId,
                ver: parentBlock.ver,
                type: (parentBlock.payload as any)?.type || "paragraph",
                payload: parentBlock.payload,
                parentId: parentBlock.parentId,
                sortKey: parentBlock.sortKey || "500000",
                indent: parentBlock.indent || 0,
                collapsed: parentBlock.collapsed || false,
                children: allSiblingsFromStart,
              },
              totalBlocks,
              returnedBlocks,
              hasMore,
              nextStartBlockId: hasMore ? nextStartBlockId : undefined,
            };
          }
        }
      }
    }

    return {
      tree,
      totalBlocks,
      returnedBlocks,
      hasMore,
      nextStartBlockId: hasMore ? nextStartBlockId : undefined,
    };
  }

  /**
   * 计算内容的哈希值（简化版）
   */
  private calculateHash(content: any): string {
    // 简化实现，实际应该使用更安全的哈希算法
    const str = JSON.stringify(content);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * 校验标签ID并更新标签的使用统计
   * @param workspaceId 工作空间ID
   * @param tagIds 标签ID数组
   * @param manager 事务管理器（可选，如果提供则在事务中执行）
   * @param operation 'add' 增加使用次数，'remove' 减少使用次数
   */
  private async validateAndUpdateTags(
    workspaceId: string,
    tagIds: string[],
    manager: any = null,
    operation: "add" | "remove" = "add",
    docId?: string,
  ): Promise<void> {
    if (!tagIds || tagIds.length === 0) {
      return;
    }

    const tagRepo = manager ? manager.getRepository(Tag) : this.tagRepository;

    // 校验所有标签ID是否存在且属于同一工作空间（排除已删除的标签）
    const tags = await tagRepo.find({
      where: {
        tagId: In(tagIds),
        workspaceId,
        isDeleted: false,
      },
    });

    if (tags.length !== tagIds.length) {
      const foundTagIds = tags.map((t) => t.tagId);
      const missingTagIds = tagIds.filter((id) => !foundTagIds.includes(id));
      throw new BadRequestException(
        `以下标签不存在、已删除或不属于该工作空间: ${missingTagIds.join(", ")}`,
      );
    }

    // 更新标签的使用统计和文档ID列表
    for (const tag of tags) {
      if (operation === "add") {
        tag.usageCount = (tag.usageCount || 0) + 1;
        // 添加文档ID到列表（如果提供了docId且不在列表中）
        if (docId) {
          const documentIds = tag.documentIds || [];
          if (!documentIds.includes(docId)) {
            tag.documentIds = [...documentIds, docId];
          }
        }
      } else {
        tag.usageCount = Math.max(0, (tag.usageCount || 0) - 1);
        // 从文档ID列表中移除（如果提供了docId）
        if (docId) {
          const documentIds = tag.documentIds || [];
          tag.documentIds = documentIds.filter((id) => id !== docId);
        }
      }
      await tagRepo.save(tag);
    }
  }
}
