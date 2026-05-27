import {
  Injectable,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectDataSource } from "@nestjs/typeorm";
import { Repository, DataSource, EntityManager } from "typeorm";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { Document } from "../../entities/document.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { DocumentsService } from "../documents/documents.service";
import { DocumentDraftService } from "../documents/services/document-draft.service";
import { DocumentSnapshotService } from "../documents/services/document-snapshot.service";
import { generateBlockId, generateVersionId } from "../../common/utils/id-generator.util";
import { generateSortKey as generateSortKeyUtil } from "../../common/utils/sort-key.util";
import { CreateBlockDto } from "./dto/create-block.dto";
import { UpdateBlockDto } from "./dto/update-block.dto";
import { MoveBlockDto } from "./dto/move-block.dto";
import {
  BatchBlockDto,
  BatchCreateOperation,
  BatchDeleteOperation,
  BatchMoveOperation,
  BatchOperationType,
  BatchUpdateOperation,
} from "./dto/batch-block.dto";
import { SyncBatchResponseDto, SyncOperationResultDto } from "./dto/sync-batch-response.dto";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { ActivitiesService } from "../activities/activities.service";
import { BLOCK_ACTIONS } from "../activities/constants/activity-actions";

@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name);

  constructor(
    @InjectRepository(Block)
    private blockRepository: Repository<Block>,
    @InjectRepository(BlockVersion)
    private blockVersionRepository: Repository<BlockVersion>,
    private documentSnapshotService: DocumentSnapshotService,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectDataSource()
    private dataSource: DataSource,
    private documentsService: DocumentsService,
    private documentDraftService: DocumentDraftService,
    private activitiesService: ActivitiesService,
  ) {}

  /**
   * 创建块
   */
  async create(createBlockDto: CreateBlockDto, userId: string) {
    // 检查文档权限并获取文档信息（包含根块ID）
    await this.documentsService.assertAccessWithoutViewIncrement(createBlockDto.docId, userId);

    // 确定父块ID：如果未提供 parentId，则使用文档的根块ID
    let parentId = createBlockDto.parentId;
    if (!parentId || typeof parentId !== "string" || parentId.trim() === "") {
      // 获取文档的根块ID
      const docEntity = await this.documentRepository.findOne({
        where: { docId: createBlockDto.docId },
        select: ["rootBlockId"],
      });
      if (!docEntity || !docEntity.rootBlockId) {
        throw new NotFoundException("文档根块不存在");
      }
      parentId = docEntity.rootBlockId;
    } else {
      // 如果指定了父块，验证父块存在
      const parentBlock = await this.blockRepository.findOne({
        where: { blockId: parentId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException("父块不存在");
      }
      if (parentBlock.docId !== createBlockDto.docId) {
        throw new BadRequestException("父块必须属于同一文档");
      }
    }

    // 使用事务创建块和初始版本
    const result = await this.dataSource.transaction(async (manager) => {
      const now = Date.now();
      const blockId = generateBlockId();
      const sortKey =
        createBlockDto.sortKey ||
        (await this.generateSortKey(createBlockDto.docId, parentId, manager));

      // 创建块
      const block = manager.create(Block, {
        blockId,
        docId: createBlockDto.docId,
        type: createBlockDto.type,
        createdAt: now,
        createdBy: userId,
        latestVer: 1,
        latestAt: now,
        latestBy: userId,
        isDeleted: false,
      });

      await manager.save(Block, block);

      // 创建初始版本
      const hash = this.calculateHash(createBlockDto.payload);
      const blockVersion = manager.create(BlockVersion, {
        versionId: generateVersionId(blockId, 1),
        docId: createBlockDto.docId,
        blockId,
        ver: 1,
        createdAt: now,
        createdBy: userId,
        parentId: parentId, // 使用确定的父块ID（根块ID或指定的parentId）
        sortKey,
        indent: createBlockDto.indent || 0,
        collapsed: createBlockDto.collapsed || false,
        payload: createBlockDto.payload,
        hash,
        plainText: this.extractPlainText(createBlockDto.payload),
        refs: [],
      });

      await manager.save(BlockVersion, blockVersion);

      // 根据 createVersion 参数决定是否立即创建文档版本
      const shouldCreateVersion = createBlockDto.createVersion !== false; // 默认为 true
      if (shouldCreateVersion) {
        await this.incrementDocumentHead(createBlockDto.docId, userId, manager);
      } else {
        await this.documentDraftService.ensureDraftForMutation(createBlockDto.docId, userId, manager);
        await this.documentDraftService.pointBlockToVersion(
          createBlockDto.docId,
          blockId,
          1,
          userId,
          manager,
        );
      }

      return {
        blockId,
        docId: createBlockDto.docId,
        type: createBlockDto.type,
        version: 1,
        payload: createBlockDto.payload,
      };
    });

    const doc = await this.documentRepository.findOne({
      where: { docId: createBlockDto.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.CREATE,
        "block",
        result.blockId,
        userId,
        { docId: createBlockDto.docId, type: createBlockDto.type },
      );
    return result;
  }

  /**
   * 更新块内容
   */
  async updateContent(blockId: string, updateBlockDto: UpdateBlockDto, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId, isDeleted: false },
    });

    if (!block) {
      // 检查是否是软删除的块
      const deletedBlock = await this.blockRepository.findOne({
        where: { blockId },
      });

      if (deletedBlock) {
        throw new NotFoundException(`块已被删除 (blockId: ${blockId})`);
      }

      throw new NotFoundException(`块不存在 (blockId: ${blockId})`);
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);
    const docId = block.docId;

    // 使用「行级锁 + 重试」保证同一 block 高频并发更新的稳定性
    const result = await this.executeWithRetry(
      async () =>
        this.dataSource.transaction(async (manager) => {
          const now = Date.now();
          const hash = this.calculateHash(updateBlockDto.payload);

          // 锁定当前 block 行，串行化同一 block 的并发写入
          const lockedBlock = await manager
            .getRepository(Block)
            .createQueryBuilder("b")
            .setLock("pessimistic_write")
            .where("b.blockId = :blockId", { blockId })
            .andWhere("b.isDeleted = :isDeleted", { isDeleted: false })
            .getOne();

          if (!lockedBlock) {
            const deletedBlock = await manager.findOne(Block, {
              where: { blockId },
            });
            if (deletedBlock) {
              throw new NotFoundException(`块已被删除 (blockId: ${blockId})`);
            }
            throw new NotFoundException(`块不存在 (blockId: ${blockId})`);
          }

          // 基于锁内最新版本读取，避免并发请求使用同一个 latestVer
          const latestVersionInfo = await manager.findOne(BlockVersion, {
            where: { blockId, ver: lockedBlock.latestVer },
          });

          if (!latestVersionInfo) {
            throw new NotFoundException("块的最新版本不存在");
          }

          // 内容无变化：直接返回当前版本
          if (latestVersionInfo.hash === hash) {
            return {
              blockId,
              version: lockedBlock.latestVer,
              payload: latestVersionInfo.payload,
            };
          }

          const newVer = lockedBlock.latestVer + 1;
          const preservedSortKey =
            latestVersionInfo.sortKey && latestVersionInfo.sortKey.trim() !== ""
              ? latestVersionInfo.sortKey
              : "500000";

          const blockVersion = manager.create(BlockVersion, {
            versionId: generateVersionId(blockId, newVer),
            docId: lockedBlock.docId,
            blockId,
            ver: newVer,
            createdAt: now,
            createdBy: userId,
            parentId: latestVersionInfo.parentId,
            sortKey: preservedSortKey,
            indent: latestVersionInfo.indent,
            collapsed: latestVersionInfo.collapsed,
            payload: updateBlockDto.payload,
            hash,
            plainText: updateBlockDto.plainText || this.extractPlainText(updateBlockDto.payload),
            refs: [],
          });

          await manager.save(BlockVersion, blockVersion);

          lockedBlock.latestVer = newVer;
          lockedBlock.latestAt = now;
          lockedBlock.latestBy = userId;
          await manager.save(Block, lockedBlock);

          const shouldCreateVersion = updateBlockDto.createVersion !== false;
          if (shouldCreateVersion) {
            await this.incrementDocumentHead(lockedBlock.docId, userId, manager);
          } else {
            await this.documentDraftService.ensureDraftForMutation(lockedBlock.docId, userId, manager);
            await this.documentDraftService.pointBlockToVersion(
              lockedBlock.docId,
              blockId,
              newVer,
              userId,
              manager,
            );
          }

          return {
            blockId,
            version: newVer,
            payload: updateBlockDto.payload,
          };
        }),
      { blockId, userId },
    );

    const doc = await this.documentRepository.findOne({
      where: { docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.UPDATE,
        "block",
        blockId,
        userId,
        { docId },
      );
    return result;
  }

  private isRetryableConflict(error: unknown): boolean {
    const dbCode = (error as any)?.driverError?.code as string | undefined;
    // 23505: unique_violation, 40001: serialization_failure, 40P01: deadlock_detected
    return dbCode === "23505" || dbCode === "40001" || dbCode === "40P01";
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: { blockId: string; userId: string },
    maxAttempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isRetryableConflict(error) || attempt >= maxAttempts) {
          throw error;
        }

        const dbCode = (error as any)?.driverError?.code;
        const constraint = (error as any)?.driverError?.constraint;
        const backoff = attempt === 1 ? 20 : 60;
        this.logger.warn(
          `updateContent 并发冲突重试: blockId=${context.blockId}, userId=${context.userId}, attempt=${attempt}/${maxAttempts}, dbCode=${dbCode ?? "unknown"}, constraint=${constraint ?? "unknown"}, backoffMs=${backoff}`,
        );
        await this.delay(backoff);
      }
    }
    throw lastError;
  }

  /**
   * 计算内容的哈希值
   */
  private calculateHash(content: any): string {
    const str = JSON.stringify(content);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * 从 payload 中提取纯文本
   */
  private extractPlainText(payload: any): string {
    if (typeof payload === "string") {
      return payload;
    }
    if (payload?.text) {
      return payload.text;
    }
    if (payload?.content) {
      return Array.isArray(payload.content)
        ? payload.content.map((c: any) => this.extractPlainText(c)).join(" ")
        : String(payload.content);
    }
    return JSON.stringify(payload);
  }

  private parseSortKey(value: string | null | undefined): number | null {
    if (!value || value.trim() === "") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatSortKey(value: number): string {
    return String(Math.max(0, Math.floor(value))).padStart(6, "0");
  }

  private createSortKeyBetween(previous: string | null, next: string | null): string {
    const previousValue = this.parseSortKey(previous);
    const nextValue = this.parseSortKey(next);

    if (previousValue == null && nextValue == null) return "001000";
    if (previousValue == null && nextValue != null) return this.formatSortKey(nextValue / 2);
    if (previousValue != null && nextValue == null) return this.formatSortKey(previousValue + 1000);

    const left = previousValue ?? 0;
    const right = nextValue ?? left + 1000;
    if (right - left <= 1) return this.formatSortKey(left + 1);
    return this.formatSortKey((left + right) / 2);
  }

  private compareSortKeys(left: string, right: string): number {
    return (this.parseSortKey(left) ?? 0) - (this.parseSortKey(right) ?? 0);
  }

  private mergePayloadPreservingSyncAttrs(
    incomingPayload: Record<string, unknown>,
    previousPayload?: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const previousAttrs = (previousPayload?.attrs as Record<string, unknown> | undefined) ?? {};
    const incomingAttrs = (incomingPayload.attrs as Record<string, unknown> | undefined) ?? {};

    return {
      ...incomingPayload,
      attrs: {
        ...previousAttrs,
        ...incomingAttrs,
        ...(previousAttrs.clientId && incomingAttrs.clientId == null ? { clientId: previousAttrs.clientId } : {}),
        ...(previousAttrs.clientBatchId && incomingAttrs.clientBatchId == null ? { clientBatchId: previousAttrs.clientBatchId } : {}),
        ...(previousAttrs.syncCreateId && incomingAttrs.syncCreateId == null ? { syncCreateId: previousAttrs.syncCreateId } : {}),
      },
    };
  }

  private async listSiblingSortKeys(
    docId: string,
    parentId: string,
    manager: EntityManager,
    excludeBlockId?: string,
  ): Promise<string[]> {
    const siblings = await manager
      .getRepository(BlockVersion)
      .createQueryBuilder("bv")
      .innerJoin(Block, "b", "bv.blockId = b.blockId AND b.isDeleted = false")
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.parentId = :parentId", { parentId })
      .andWhere("bv.ver = b.latestVer")
      .getMany();

    return siblings
      .filter((sibling) => sibling.blockId !== excludeBlockId)
      .map((sibling) => sibling.sortKey)
      .filter((sortKey): sortKey is string => typeof sortKey === "string" && sortKey.trim() !== "")
      .sort((left, right) => this.compareSortKeys(left, right));
  }

  private async reserveUniqueSortKey(input: {
    docId: string;
    parentId: string;
    requestedSortKey?: string;
    manager: EntityManager;
    reservedByParent: Map<string, Set<string>>;
    excludeBlockId?: string;
  }): Promise<string> {
    const siblingSortKeys = await this.listSiblingSortKeys(
      input.docId,
      input.parentId,
      input.manager,
      input.excludeBlockId,
    );
    const reserved = input.reservedByParent.get(input.parentId) ?? new Set<string>();
    const taken = new Set<string>([...siblingSortKeys, ...reserved]);
    const requestedSortKey = input.requestedSortKey?.trim() ? input.requestedSortKey : undefined;

    if (requestedSortKey && !taken.has(requestedSortKey)) {
      reserved.add(requestedSortKey);
      input.reservedByParent.set(input.parentId, reserved);
      return requestedSortKey;
    }

    const orderedTaken = [...taken].sort((left, right) => this.compareSortKeys(left, right));
    let previous: string | null = null;
    let next: string | null = null;

    if (requestedSortKey) {
      const nextIndex = orderedTaken.findIndex((sortKey) => this.compareSortKeys(sortKey, requestedSortKey) >= 0);
      next = nextIndex === -1 ? null : orderedTaken[nextIndex];
      previous = nextIndex <= 0 ? null : orderedTaken[nextIndex - 1];
    } else {
      previous = orderedTaken.length > 0 ? orderedTaken[orderedTaken.length - 1] : null;
      next = null;
    }

    let candidate = this.createSortKeyBetween(previous, next);
    while (taken.has(candidate)) {
      previous = candidate;
      candidate = this.createSortKeyBetween(previous, next);
    }

    reserved.add(candidate);
    input.reservedByParent.set(input.parentId, reserved);
    return candidate;
  }

  /**
   * 生成排序键（异步方法，基于同级块的位置）
   */
  private async generateSortKey(docId: string, parentId: string, manager: any): Promise<string> {
    // 查询同级块的最新版本
    const siblings = await manager
      .createQueryBuilder(BlockVersion, "bv")
      .innerJoin(Block, "b", "bv.blockId = b.blockId AND b.isDeleted = false")
      .where("bv.docId = :docId", { docId })
      .andWhere("bv.parentId = :parentId", { parentId })
      .andWhere("bv.ver = b.latestVer") // 只获取最新版本
      .getMany();

    if (siblings.length === 0) {
      // 没有同级块，返回中间值
      return generateSortKeyUtil();
    }

    // 在 JavaScript 中按 sortKey 排序（数字比较）
    siblings.sort((a, b) => {
      const sortKeyA = a.sortKey && a.sortKey.trim() !== "" ? parseInt(a.sortKey, 10) || 0 : 0;
      const sortKeyB = b.sortKey && b.sortKey.trim() !== "" ? parseInt(b.sortKey, 10) || 0 : 0;
      if (sortKeyA !== sortKeyB) {
        return sortKeyA - sortKeyB;
      }
      // 如果 sortKey 相同，按 blockId 排序
      return a.blockId.localeCompare(b.blockId);
    });

    // 获取最后一个同级块的 sortKey
    const lastSibling = siblings[siblings.length - 1];
    const lastSortKey =
      lastSibling.sortKey && lastSibling.sortKey.trim() !== "" ? lastSibling.sortKey : "500000";

    // 生成比最后一个更大的 sortKey
    return generateSortKeyUtil(lastSortKey);
  }

  /**
   * 增加文档版本号，并创建文档修订记录
   */
  private async incrementDocumentHead(docId: string, userId: string, manager: any): Promise<void> {
    const document = await manager.findOne(Document, { where: { docId } });
    if (document) {
      document.head += 1;
      document.updatedBy = userId;
      await manager.save(Document, document);

      // 创建文档修订记录 (DocRevision)
      const docRevisionRepo = manager.getRepository(DocRevision);
      const revision = docRevisionRepo.create({
        revisionId: `${docId}@${document.head}`,
        docId,
        docVer: document.head,
        createdAt: Date.now(),
        createdBy: userId,
        message: "Document updated",
        branch: "draft",
        patches: [],
        rootBlockId: document.rootBlockId,
        source: "editor",
        opSummary: {},
      });
      await docRevisionRepo.save(revision);
      await this.documentSnapshotService.createSnapshotForRevision(docId, document.head, manager, {
        kind: "revision",
        pinned: false,
        metadata: { source: "immediate-block-operation" },
      });
    }
  }

  /**
   * 移动块
   */
  async move(blockId: string, moveBlockDto: MoveBlockDto, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException("块不存在");
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);

    // 验证父块
    if (moveBlockDto.parentId) {
      const parentBlock = await this.blockRepository.findOne({
        where: { blockId: moveBlockDto.parentId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException("父块不存在");
      }
      if (parentBlock.docId !== block.docId) {
        throw new BadRequestException("父块必须属于同一文档");
      }
      // 防止循环引用
      if (await this.wouldCreateCycle(blockId, moveBlockDto.parentId)) {
        throw new BadRequestException("移动操作会导致循环引用");
      }
    }

    // 使用事务更新块位置
    const result = await this.dataSource.transaction(async (manager) => {
      const now = Date.now();
      const latestVersion = await manager.findOne(BlockVersion, {
        where: { blockId, ver: block.latestVer },
      });

      if (!latestVersion) {
        throw new NotFoundException("块版本不存在");
      }

      // 创建新版本（移动操作会创建新版本）
      const newVer = block.latestVer + 1;
      const blockVersion = manager.create(BlockVersion, {
        versionId: generateVersionId(blockId, newVer),
        docId: block.docId,
        blockId,
        ver: newVer,
        createdAt: now,
        createdBy: userId,
        parentId: moveBlockDto.parentId || "",
        sortKey: moveBlockDto.sortKey,
        indent: moveBlockDto.indent || 0,
        collapsed: latestVersion.collapsed,
        payload: latestVersion.payload,
        hash: latestVersion.hash,
        plainText: latestVersion.plainText,
        refs: latestVersion.refs,
      });

      await manager.save(BlockVersion, blockVersion);

      // 更新块的最新版本信息
      block.latestVer = newVer;
      block.latestAt = now;
      block.latestBy = userId;
      await manager.save(Block, block);

      // 根据 createVersion 参数决定是否立即创建文档版本
      const shouldCreateVersion = moveBlockDto.createVersion !== false; // 默认为 true
      if (shouldCreateVersion) {
        await this.incrementDocumentHead(block.docId, userId, manager);
      } else {
        await this.documentDraftService.ensureDraftForMutation(block.docId, userId, manager);
        await this.documentDraftService.pointBlockToVersion(
          block.docId,
          blockId,
          newVer,
          userId,
          manager,
        );
      }

      return {
        blockId,
        version: newVer,
        parentId: moveBlockDto.parentId,
        sortKey: moveBlockDto.sortKey,
      };
    });

    const doc = await this.documentRepository.findOne({
      where: { docId: block.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.MOVE,
        "block",
        blockId,
        userId,
        { docId: block.docId, parentId: moveBlockDto.parentId },
      );
    return result;
  }

  /**
   * 删除块
   */
  async remove(blockId: string, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException("块不存在");
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);

    // 使用事务软删除块
    const result = await this.dataSource.transaction(async (manager) => {
      const now = Date.now();

      // 软删除块
      block.isDeleted = true;
      block.deletedAt = now;
      block.deletedBy = userId;
      await manager.save(Block, block);

      // 删除操作默认立即创建版本（重要操作）
      await this.incrementDocumentHead(block.docId, userId, manager);

      return { message: "块已删除" };
    });
    const doc = await this.documentRepository.findOne({
      where: { docId: block.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.DELETE,
        "block",
        blockId,
        userId,
        { docId: block.docId },
      );
    return result;
  }

  /**
   * 获取块版本历史
   */
  async getVersions(blockId: string, paginationDto: PaginationDto, userId: string) {
    const block = await this.blockRepository.findOne({
      where: { blockId },
    });

    if (!block) {
      throw new NotFoundException("块不存在");
    }

    // 检查块是否已被删除
    if (block.isDeleted) {
      throw new NotFoundException("块已被删除，无法查看历史记录");
    }

    // 检查文档权限
    await this.documentsService.assertAccessWithoutViewIncrement(block.docId, userId);

    const { page = 1, pageSize = 20 } = paginationDto;
    const skip = (page - 1) * pageSize;

    const [versions, total] = await this.blockVersionRepository.findAndCount({
      where: { blockId },
      order: { ver: "DESC" },
      skip,
      take: pageSize,
    });

    return {
      items: versions,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 检查移动操作是否会导致循环引用
   */
  private async wouldCreateCycle(blockId: string, newParentId: string): Promise<boolean> {
    let currentParentId = newParentId;
    const visited = new Set<string>([blockId]);

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        return true; // 发现循环
      }
      visited.add(currentParentId);

      const parent = await this.blockRepository.findOne({
        where: { blockId: currentParentId, isDeleted: false },
      });

      if (!parent) {
        break;
      }

      // 获取父块的父块ID
      const parentVersion = await this.blockVersionRepository.findOne({
        where: { blockId: currentParentId, ver: parent.latestVer },
      });

      if (!parentVersion || !parentVersion.parentId) {
        break;
      }
      currentParentId = parentVersion.parentId;
    }

    return false;
  }

  private async wouldCreateCycleInManager(
    docId: string,
    blockId: string,
    newParentId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    let currentParentId = newParentId;
    const visited = new Set<string>([blockId]);

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        return true;
      }
      visited.add(currentParentId);

      const parent = await manager.findOne(Block, {
        where: { blockId: currentParentId, docId, isDeleted: false },
      });
      if (!parent) {
        break;
      }

      const parentVersion = await manager.findOne(BlockVersion, {
        where: { docId, blockId: currentParentId, ver: parent.latestVer },
      });
      if (!parentVersion || !parentVersion.parentId) {
        break;
      }
      currentParentId = parentVersion.parentId;
    }

    return false;
  }

  /**
   * 批量操作块
   */
  async batch(batchBlockDto: BatchBlockDto, userId: string): Promise<SyncBatchResponseDto> {
    await this.documentsService.assertAccessWithoutViewIncrement(batchBlockDto.docId, userId);

    const acceptedBatchId =
      batchBlockDto.clientBatchId?.trim() ||
      `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const txResult = await this.dataSource.transaction(
      async (
        manager,
      ): Promise<{
        results: SyncOperationResultDto[];
        serverHead: number;
        successCount: number;
        needsReload: boolean;
        conflicts: Array<{
          code: string;
          message: string;
          serverHead: number;
          clientBaseVersion?: number;
        }>;
      }> => {
        const docQuery = manager
          .getRepository(Document)
          .createQueryBuilder("doc")
          .where("doc.docId = :docId", { docId: batchBlockDto.docId });
        const dbType = this.dataSource.options.type;
        if (dbType !== "sqlite" && dbType !== "better-sqlite3") {
          docQuery.setLock("pessimistic_write");
        }
        const docInTx = await docQuery.getOne();
        if (!docInTx) {
          throw new NotFoundException("Document not found");
        }

        if (
          typeof batchBlockDto.baseVersion === "number" &&
          batchBlockDto.baseVersion !== docInTx.head
        ) {
          return {
            results: [],
            serverHead: docInTx.head,
            successCount: 0,
            needsReload: true,
            conflicts: [
              {
                code: "BASE_VERSION_MISMATCH",
                message: `baseVersion(${batchBlockDto.baseVersion}) does not match serverHead(${docInTx.head})`,
                serverHead: docInTx.head,
                clientBaseVersion: batchBlockDto.baseVersion,
              },
            ],
          };
        }

        const results: SyncOperationResultDto[] = [];
        const now = Date.now();
        const shouldCreateVersion = batchBlockDto.createVersion !== false;
        const reservedSortKeysByParent = new Map<string, Set<string>>();
        const draftMutations: Array<{
          type: "point" | "deleted";
          blockId: string;
          version: number;
        }> = [];

        for (const operation of batchBlockDto.operations) {
          try {
            if (operation.type === BatchOperationType.CREATE) {
              const created = await this.handleBatchCreate(
                operation,
                batchBlockDto.docId,
                acceptedBatchId,
                userId,
                now,
                manager,
                reservedSortKeysByParent,
              );
              if (!shouldCreateVersion) {
                draftMutations.push({
                  type: "point",
                  blockId: created.blockId,
                  version: created.version,
                });
              }
              results.push({
                operation: BatchOperationType.CREATE,
                success: true,
                clientId: operation.clientId,
                ...created,
              });
            } else if (operation.type === BatchOperationType.UPDATE) {
              const updated = await this.handleBatchUpdate(
                operation,
                batchBlockDto.docId,
                userId,
                now,
                manager,
              );
              if (!shouldCreateVersion) {
                draftMutations.push({
                  type: "point",
                  blockId: updated.blockId,
                  version: updated.version,
                });
              }
              results.push({
                operation: BatchOperationType.UPDATE,
                success: true,
                ...updated,
              });
            } else if (operation.type === BatchOperationType.DELETE) {
              const removed = await this.handleBatchDelete(
                operation,
                batchBlockDto.docId,
                userId,
                now,
                manager,
                shouldCreateVersion,
              );
              if (!shouldCreateVersion && removed.version) {
                draftMutations.push({
                  type: "deleted",
                  blockId: removed.blockId,
                  version: removed.version,
                });
              }
              results.push({
                operation: BatchOperationType.DELETE,
                success: true,
                ...removed,
              });
            } else if (operation.type === BatchOperationType.MOVE) {
              const moved = await this.handleBatchMove(
                operation,
                batchBlockDto.docId,
                userId,
                now,
                manager,
                reservedSortKeysByParent,
              );
              if (!shouldCreateVersion) {
                draftMutations.push({
                  type: "point",
                  blockId: moved.blockId,
                  version: moved.version,
                });
              }
              results.push({
                operation: BatchOperationType.MOVE,
                success: true,
                ...moved,
              });
            }
          } catch (error) {
            results.push({
              operation: operation.type,
              success: false,
              ...(operation.type === BatchOperationType.CREATE
                ? { clientId: operation.clientId }
                : {}),
              ...(operation.type !== BatchOperationType.CREATE
                ? {
                    blockId: (
                      operation as BatchUpdateOperation | BatchDeleteOperation | BatchMoveOperation
                    ).blockId,
                  }
                : {}),
              error: (error as Error).message,
            });
          }
        }

        const successCount = results.filter((item) => item.success).length;
        if (shouldCreateVersion && successCount > 0) {
          await this.incrementDocumentHead(batchBlockDto.docId, userId, manager);
        } else if (!shouldCreateVersion && draftMutations.length > 0) {
          await this.documentDraftService.ensureDraftForMutation(
            batchBlockDto.docId,
            userId,
            manager,
          );
          for (const mutation of draftMutations) {
            if (mutation.type === "deleted") {
              await this.documentDraftService.pointBlockToDeletedVersion(
                batchBlockDto.docId,
                mutation.blockId,
                mutation.version,
                userId,
                manager,
              );
            } else {
              await this.documentDraftService.pointBlockToVersion(
                batchBlockDto.docId,
                mutation.blockId,
                mutation.version,
                userId,
                manager,
              );
            }
          }
        }

        const docAfterBatch = await manager.findOne(Document, {
          where: { docId: batchBlockDto.docId },
          select: ["head"],
        });

        return {
          results,
          serverHead: docAfterBatch?.head ?? docInTx.head,
          successCount,
          needsReload: false,
          conflicts: [],
        };
      },
    );

    if (txResult.needsReload) {
      return {
        acceptedBatchId,
        appliedAt: Date.now(),
        serverHead: txResult.serverHead,
        needsReload: true,
        conflicts: txResult.conflicts,
        results: [],
      };
    }

    this.logger.log(
      `sync batch: docId=${batchBlockDto.docId}, clientBatchId=${acceptedBatchId}, source=${batchBlockDto.source ?? "unknown"}, operations=${batchBlockDto.operations.length}, serverHead=${txResult.serverHead}`,
    );

    const doc = await this.documentRepository.findOne({
      where: { docId: batchBlockDto.docId },
      select: ["workspaceId"],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.BATCH,
        "block",
        batchBlockDto.docId,
        userId,
        { count: batchBlockDto.operations.length },
      );

    return {
      acceptedBatchId,
      appliedAt: Date.now(),
      serverHead: txResult.serverHead,
      needsReload: false,
      conflicts: [],
      results: txResult.results,
    };
  }

  private async handleBatchCreate(
    operation: BatchCreateOperation,
    docId: string,
    clientBatchId: string,
    userId: string,
    now: number,
    manager: EntityManager,
    reservedSortKeysByParent: Map<string, Set<string>>,
  ): Promise<{ blockId: string; version: number; sortKey: string }> {
    if (operation.data.docId && operation.data.docId !== docId) {
      throw new BadRequestException(
        `Create operation docId mismatch: ${operation.data.docId} !== ${docId}`,
      );
    }

    let parentId = operation.data.parentId;
    if (!parentId || typeof parentId !== "string" || parentId.trim() === "") {
      const docEntity = await manager.findOne(Document, {
        where: { docId },
        select: ["rootBlockId"],
      });
      if (!docEntity || !docEntity.rootBlockId) {
        throw new NotFoundException("Document root block not found");
      }
      parentId = docEntity.rootBlockId;
    } else {
      const parentBlock = await manager.findOne(Block, {
        where: { blockId: parentId, docId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException(`Parent block ${parentId} not found in document ${docId}`);
      }
    }

    const existing = await this.findExistingCreateByClientIdentity(
      manager,
      docId,
      clientBatchId,
      operation.clientId,
      operation.syncCreateId,
    );
    if (existing) {
      return { blockId: existing.blockId, version: existing.ver, sortKey: existing.sortKey };
    }

    const payload = {
      ...(operation.data.payload as Record<string, unknown>),
      attrs: {
        ...(((operation.data.payload as Record<string, unknown>).attrs as Record<string, unknown> | undefined) ?? {}),
        clientBatchId,
        ...(operation.clientId ? { clientId: operation.clientId } : {}),
        ...(operation.syncCreateId ? { syncCreateId: operation.syncCreateId } : {}),
      },
    };

    const blockId = generateBlockId();
    const sortKey = await this.reserveUniqueSortKey({
      docId,
      parentId,
      requestedSortKey: operation.data.sortKey,
      manager,
      reservedByParent: reservedSortKeysByParent,
    });

    const block = manager.create(Block, {
      blockId,
      docId,
      type: operation.data.type,
      createdAt: now,
      createdBy: userId,
      latestVer: 1,
      latestAt: now,
      latestBy: userId,
      isDeleted: false,
    });

    await manager.save(Block, block);

    const hash = this.calculateHash(payload);
    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(blockId, 1),
      docId,
      blockId,
      ver: 1,
      createdAt: now,
      createdBy: userId,
      parentId,
      sortKey,
      indent: operation.data.indent || 0,
      collapsed: operation.data.collapsed || false,
      payload,
      hash,
      plainText: this.extractPlainText(payload),
      refs: [],
    });

    await manager.save(BlockVersion, blockVersion);

    return { blockId, version: 1, sortKey };
  }

  private async findExistingCreateByClientIdentity(
    manager: EntityManager,
    docId: string,
    clientBatchId: string | undefined,
    clientId: string | undefined,
    syncCreateId?: string,
  ): Promise<BlockVersion | null> {
    if (!syncCreateId && (!clientBatchId || !clientId)) return null;

    const latestVersions = await manager
      .getRepository(BlockVersion)
      .createQueryBuilder("bv")
      .innerJoin(Block, "b", "b.blockId = bv.blockId AND b.latestVer = bv.ver")
      .where("bv.docId = :docId", { docId })
      .andWhere("b.isDeleted = false")
      .getMany();

    return (
      latestVersions.find((version) => {
        const attrs = (version.payload as { attrs?: Record<string, unknown> } | undefined)?.attrs;
        if (syncCreateId && attrs?.syncCreateId === syncCreateId) {
          return true;
        }
        return attrs?.clientBatchId === clientBatchId && attrs?.clientId === clientId;
      }) ?? null
    );
  }

  private async handleBatchUpdate(
    operation: BatchUpdateOperation,
    docId: string,
    userId: string,
    now: number,
    manager: EntityManager,
  ): Promise<{ blockId: string; version: number }> {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, docId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`Block ${operation.blockId} not found`);
    }

    const newVer = block.latestVer + 1;
    const latestVersion = await manager.findOne(BlockVersion, {
      where: { docId, blockId: operation.blockId, ver: block.latestVer },
    });
    const payload = this.mergePayloadPreservingSyncAttrs(
      operation.data.payload as Record<string, unknown>,
      (latestVersion?.payload as Record<string, unknown> | undefined) ?? undefined,
    );
    const hash = this.calculateHash(payload);

    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(operation.blockId, newVer),
      docId: block.docId,
      blockId: operation.blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: latestVersion?.parentId || "",
      sortKey: latestVersion?.sortKey || "0",
      indent: latestVersion?.indent || 0,
      collapsed: latestVersion?.collapsed || false,
      payload,
      hash,
      plainText: operation.data.plainText || this.extractPlainText(payload),
      refs: [],
    });

    await manager.save(BlockVersion, blockVersion);

    block.latestVer = newVer;
    block.latestAt = now;
    block.latestBy = userId;
    await manager.save(Block, block);

    return { blockId: operation.blockId, version: newVer };
  }

  private async handleBatchDelete(
    operation: BatchDeleteOperation,
    docId: string,
    userId: string,
    now: number,
    manager: EntityManager,
    shouldCreateVersion: boolean,
  ): Promise<{ blockId: string; version?: number }> {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, docId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`Block ${operation.blockId} not found`);
    }

    if (shouldCreateVersion) {
      block.isDeleted = true;
      block.deletedAt = now;
      block.deletedBy = userId;
      await manager.save(Block, block);
      return { blockId: operation.blockId };
    }

    const latestVersion = await manager.findOne(BlockVersion, {
      where: { docId, blockId: operation.blockId, ver: block.latestVer },
    });

    if (!latestVersion) {
      throw new NotFoundException("Block version not found");
    }

    const newVer = block.latestVer + 1;
    const deletedPayload = {
      ...(latestVersion.payload as Record<string, unknown>),
      attrs: {
        ...(((latestVersion.payload as Record<string, unknown>).attrs as Record<string, unknown> | undefined) ?? {}),
        deleted: true,
      },
    };

    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(operation.blockId, newVer),
      docId: block.docId,
      blockId: operation.blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: latestVersion.parentId,
      sortKey: latestVersion.sortKey,
      indent: latestVersion.indent,
      collapsed: latestVersion.collapsed,
      payload: deletedPayload,
      hash: this.calculateHash(deletedPayload),
      plainText: latestVersion.plainText,
      refs: latestVersion.refs,
    });

    await manager.save(BlockVersion, blockVersion);

    block.latestVer = newVer;
    block.latestAt = now;
    block.latestBy = userId;
    await manager.save(Block, block);

    return { blockId: operation.blockId, version: newVer };
  }

  private async handleBatchMove(
    operation: BatchMoveOperation,
    docId: string,
    userId: string,
    now: number,
    manager: EntityManager,
    reservedSortKeysByParent: Map<string, Set<string>>,
  ): Promise<{ blockId: string; version: number; sortKey: string }> {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, docId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`Block ${operation.blockId} not found`);
    }

    if (operation.parentId) {
      if (operation.parentId === operation.blockId) {
        throw new BadRequestException("Cannot move block under itself");
      }
      const parentBlock = await manager.findOne(Block, {
        where: { blockId: operation.parentId, docId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException(
          `Parent block ${operation.parentId} not found in document ${docId}`,
        );
      }
      if (
        await this.wouldCreateCycleInManager(docId, operation.blockId, operation.parentId, manager)
      ) {
        throw new BadRequestException("Move operation would create a cycle");
      }
    }

    const latestVersion = await manager.findOne(BlockVersion, {
      where: { docId, blockId: operation.blockId, ver: block.latestVer },
    });

    if (!latestVersion) {
      throw new NotFoundException("Block version not found");
    }

    const resolvedSortKey = await this.reserveUniqueSortKey({
      docId,
      parentId: operation.parentId || "",
      requestedSortKey: operation.sortKey,
      manager,
      reservedByParent: reservedSortKeysByParent,
      excludeBlockId: operation.blockId,
    });

    const newVer = block.latestVer + 1;
    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(operation.blockId, newVer),
      docId: block.docId,
      blockId: operation.blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: operation.parentId || "",
      sortKey: resolvedSortKey,
      indent: operation.indent || 0,
      collapsed: latestVersion.collapsed,
      payload: latestVersion.payload,
      hash: latestVersion.hash,
      plainText: latestVersion.plainText,
      refs: latestVersion.refs,
    });

    await manager.save(BlockVersion, blockVersion);

    block.latestVer = newVer;
    block.latestAt = now;
    block.latestBy = userId;
    await manager.save(Block, block);

    return { blockId: operation.blockId, version: newVer, sortKey: resolvedSortKey };
  }
}
