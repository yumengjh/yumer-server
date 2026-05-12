import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Block } from '../../entities/block.entity';
import { BlockVersion } from '../../entities/block-version.entity';
import { Document } from '../../entities/document.entity';
import { DocRevision } from '../../entities/doc-revision.entity';
import { DocumentsService } from '../documents/documents.service';
import { VersionControlService } from '../documents/services/version-control.service';
import { generateBlockId, generateVersionId } from '../../common/utils/id-generator.util';
import { generateSortKey as generateSortKeyUtil } from '../../common/utils/sort-key.util';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { MoveBlockDto } from './dto/move-block.dto';
import { BatchBlockDto } from './dto/batch-block.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ActivitiesService } from '../activities/activities.service';
import { BLOCK_ACTIONS } from '../activities/constants/activity-actions';

@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name);

  constructor(
    @InjectRepository(Block)
    private blockRepository: Repository<Block>,
    @InjectRepository(BlockVersion)
    private blockVersionRepository: Repository<BlockVersion>,
    @Inject(forwardRef(() => VersionControlService))
    private versionControlService: VersionControlService,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectDataSource()
    private dataSource: DataSource,
    private documentsService: DocumentsService,
    private activitiesService: ActivitiesService,
  ) {}

  /**
   * 创建块
   */
  async create(createBlockDto: CreateBlockDto, userId: string) {
    // 检查文档权限并获取文档信息（包含根块ID）
    await this.documentsService.findOne(createBlockDto.docId, userId);

    // 确定父块ID：如果未提供 parentId，则使用文档的根块ID
    let parentId = createBlockDto.parentId;
    if (!parentId || typeof parentId !== 'string' || parentId.trim() === '') {
      // 获取文档的根块ID
      const docEntity = await this.documentRepository.findOne({
        where: { docId: createBlockDto.docId },
        select: ['rootBlockId'],
      });
      if (!docEntity || !docEntity.rootBlockId) {
        throw new NotFoundException('文档根块不存在');
      }
      parentId = docEntity.rootBlockId;
    } else {
      // 如果指定了父块，验证父块存在
      const parentBlock = await this.blockRepository.findOne({
        where: { blockId: parentId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException('父块不存在');
      }
      if (parentBlock.docId !== createBlockDto.docId) {
        throw new BadRequestException('父块必须属于同一文档');
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
      }
      // 如果 shouldCreateVersion 为 false，在事务外记录待创建版本

      return {
        blockId,
        docId: createBlockDto.docId,
        type: createBlockDto.type,
        version: 1,
        payload: createBlockDto.payload,
      };
    });

    // 事务成功后，如果 createVersion 为 false，记录待创建版本
    if (createBlockDto.createVersion === false) {
      this.versionControlService.recordPendingVersion(createBlockDto.docId);
    }
    const doc = await this.documentRepository.findOne({
      where: { docId: createBlockDto.docId },
      select: ['workspaceId'],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.CREATE,
        'block',
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
    await this.documentsService.findOne(block.docId, userId);
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
            .createQueryBuilder('b')
            .setLock('pessimistic_write')
            .where('b.blockId = :blockId', { blockId })
            .andWhere('b.isDeleted = :isDeleted', { isDeleted: false })
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
            throw new NotFoundException('块的最新版本不存在');
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
            latestVersionInfo.sortKey && latestVersionInfo.sortKey.trim() !== ''
              ? latestVersionInfo.sortKey
              : '500000';

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
          }

          return {
            blockId,
            version: newVer,
            payload: updateBlockDto.payload,
          };
        }),
      { blockId, userId },
    );

    // 事务成功后，如果 createVersion 为 false，记录待创建版本
    if (updateBlockDto.createVersion === false) {
      this.versionControlService.recordPendingVersion(docId);
    }
    const doc = await this.documentRepository.findOne({
      where: { docId },
      select: ['workspaceId'],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.UPDATE,
        'block',
        blockId,
        userId,
        { docId },
      );
    return result;
  }

  private isRetryableConflict(error: unknown): boolean {
    const dbCode = (error as any)?.driverError?.code as string | undefined;
    // 23505: unique_violation, 40001: serialization_failure, 40P01: deadlock_detected
    return dbCode === '23505' || dbCode === '40001' || dbCode === '40P01';
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
          `updateContent 并发冲突重试: blockId=${context.blockId}, userId=${context.userId}, attempt=${attempt}/${maxAttempts}, dbCode=${dbCode ?? 'unknown'}, constraint=${constraint ?? 'unknown'}, backoffMs=${backoff}`,
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
    if (typeof payload === 'string') {
      return payload;
    }
    if (payload?.text) {
      return payload.text;
    }
    if (payload?.content) {
      return Array.isArray(payload.content)
        ? payload.content.map((c: any) => this.extractPlainText(c)).join(' ')
        : String(payload.content);
    }
    return JSON.stringify(payload);
  }

  /**
   * 生成排序键（异步方法，基于同级块的位置）
   */
  private async generateSortKey(docId: string, parentId: string, manager: any): Promise<string> {
    // 查询同级块的最新版本
    const siblings = await manager
      .createQueryBuilder(BlockVersion, 'bv')
      .innerJoin(Block, 'b', 'bv.blockId = b.blockId AND b.isDeleted = false')
      .where('bv.docId = :docId', { docId })
      .andWhere('bv.parentId = :parentId', { parentId })
      .andWhere('bv.ver = b.latestVer') // 只获取最新版本
      .getMany();

    if (siblings.length === 0) {
      // 没有同级块，返回中间值
      return generateSortKeyUtil();
    }

    // 在 JavaScript 中按 sortKey 排序（数字比较）
    siblings.sort((a, b) => {
      const sortKeyA = a.sortKey && a.sortKey.trim() !== '' ? parseInt(a.sortKey, 10) || 0 : 0;
      const sortKeyB = b.sortKey && b.sortKey.trim() !== '' ? parseInt(b.sortKey, 10) || 0 : 0;
      if (sortKeyA !== sortKeyB) {
        return sortKeyA - sortKeyB;
      }
      // 如果 sortKey 相同，按 blockId 排序
      return a.blockId.localeCompare(b.blockId);
    });

    // 获取最后一个同级块的 sortKey
    const lastSibling = siblings[siblings.length - 1];
    const lastSortKey =
      lastSibling.sortKey && lastSibling.sortKey.trim() !== '' ? lastSibling.sortKey : '500000';

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
        message: 'Document updated',
        branch: 'draft',
        patches: [],
        rootBlockId: document.rootBlockId,
        source: 'editor',
        opSummary: {},
      });
      await docRevisionRepo.save(revision);
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
      throw new NotFoundException('块不存在');
    }

    // 检查文档权限
    await this.documentsService.findOne(block.docId, userId);

    // 验证父块
    if (moveBlockDto.parentId) {
      const parentBlock = await this.blockRepository.findOne({
        where: { blockId: moveBlockDto.parentId, isDeleted: false },
      });
      if (!parentBlock) {
        throw new NotFoundException('父块不存在');
      }
      if (parentBlock.docId !== block.docId) {
        throw new BadRequestException('父块必须属于同一文档');
      }
      // 防止循环引用
      if (await this.wouldCreateCycle(blockId, moveBlockDto.parentId)) {
        throw new BadRequestException('移动操作会导致循环引用');
      }
    }

    // 使用事务更新块位置
    const result = await this.dataSource.transaction(async (manager) => {
      const now = Date.now();
      const latestVersion = await manager.findOne(BlockVersion, {
        where: { blockId, ver: block.latestVer },
      });

      if (!latestVersion) {
        throw new NotFoundException('块版本不存在');
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
        parentId: moveBlockDto.parentId || '',
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
      }
      // 如果 shouldCreateVersion 为 false，在事务外记录待创建版本

      return {
        blockId,
        version: newVer,
        parentId: moveBlockDto.parentId,
        sortKey: moveBlockDto.sortKey,
      };
    });

    // 事务成功后，如果 createVersion 为 false，记录待创建版本
    if (moveBlockDto.createVersion === false) {
      this.versionControlService.recordPendingVersion(block.docId);
    }
    const doc = await this.documentRepository.findOne({
      where: { docId: block.docId },
      select: ['workspaceId'],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.MOVE,
        'block',
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
      throw new NotFoundException('块不存在');
    }

    // 检查文档权限
    await this.documentsService.findOne(block.docId, userId);

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

      return { message: '块已删除' };
    });
    const doc = await this.documentRepository.findOne({
      where: { docId: block.docId },
      select: ['workspaceId'],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.DELETE,
        'block',
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
      throw new NotFoundException('块不存在');
    }

    // 检查块是否已被删除
    if (block.isDeleted) {
      throw new NotFoundException('块已被删除，无法查看历史记录');
    }

    // 检查文档权限
    await this.documentsService.findOne(block.docId, userId);

    const { page = 1, pageSize = 20 } = paginationDto;
    const skip = (page - 1) * pageSize;

    const [versions, total] = await this.blockVersionRepository.findAndCount({
      where: { blockId },
      order: { ver: 'DESC' },
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

  /**
   * 批量操作块
   */
  async batch(batchBlockDto: BatchBlockDto, userId: string) {
    // 检查文档权限
    await this.documentsService.findOne(batchBlockDto.docId, userId);

    // 使用事务执行批量操作
    const result = await this.dataSource.transaction(async (manager) => {
      const results: Array<{
        success: boolean;
        operation: string;
        blockId?: string;
        version?: number;
        error?: string;
      }> = [];
      const now = Date.now();

      for (const operation of batchBlockDto.operations) {
        try {
          if (operation.type === 'create') {
            const result = await this.handleBatchCreate(
              operation,
              batchBlockDto.docId,
              userId,
              now,
              manager,
            );
            results.push({ success: true, operation: 'create', ...result });
          } else if (operation.type === 'update') {
            const result = await this.handleBatchUpdate(operation, userId, now, manager);
            results.push({ success: true, operation: 'update', ...result });
          } else if (operation.type === 'delete') {
            const result = await this.handleBatchDelete(operation, userId, now, manager);
            results.push({ success: true, operation: 'delete', ...result });
          } else if (operation.type === 'move') {
            const result = await this.handleBatchMove(operation, userId, now, manager);
            results.push({ success: true, operation: 'move', ...result });
          }
        } catch (error) {
          results.push({
            success: false,
            operation: operation.type,
            error: (error as Error).message,
          });
        }
      }

      // 根据 createVersion 参数决定是否立即创建文档版本
      const shouldCreateVersion = batchBlockDto.createVersion !== false; // 默认为 true
      if (shouldCreateVersion) {
        await this.incrementDocumentHead(batchBlockDto.docId, userId, manager);
      }
      // 如果 shouldCreateVersion 为 false，在事务外记录待创建版本

      return {
        total: batchBlockDto.operations.length,
        success: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      };
    });

    // 事务成功后，如果 createVersion 为 false，记录待创建版本
    if (batchBlockDto.createVersion === false) {
      this.versionControlService.recordPendingVersion(batchBlockDto.docId);
    }
    const doc = await this.documentRepository.findOne({
      where: { docId: batchBlockDto.docId },
      select: ['workspaceId'],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        BLOCK_ACTIONS.BATCH,
        'block',
        batchBlockDto.docId,
        userId,
        { count: batchBlockDto.operations.length },
      );
    return result;
  }

  /**
   * 处理批量创建操作
   */
  private async handleBatchCreate(
    operation: any,
    docId: string,
    userId: string,
    now: number,
    manager: any,
  ) {
    // 确定父块ID：如果未提供 parentId，则使用文档的根块ID
    let parentId = operation.data.parentId;
    if (!parentId || typeof parentId !== 'string' || parentId.trim() === '') {
      // 获取文档的根块ID
      const docEntity = await manager.findOne(Document, {
        where: { docId },
        select: ['rootBlockId'],
      });
      if (!docEntity || !docEntity.rootBlockId) {
        throw new NotFoundException('文档根块不存在');
      }
      parentId = docEntity.rootBlockId;
    }

    const blockId = generateBlockId();
    const sortKey =
      operation.data.sortKey || (await this.generateSortKey(docId, parentId, manager));

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

    const hash = this.calculateHash(operation.data.payload);
    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(blockId, 1),
      docId,
      blockId,
      ver: 1,
      createdAt: now,
      createdBy: userId,
      parentId: parentId, // 使用确定的父块ID（根块ID或指定的parentId）
      sortKey,
      indent: operation.data.indent || 0,
      collapsed: operation.data.collapsed || false,
      payload: operation.data.payload,
      hash,
      plainText: this.extractPlainText(operation.data.payload),
      refs: [],
    });

    await manager.save(BlockVersion, blockVersion);

    return { blockId };
  }

  /**
   * 处理批量更新操作
   */
  private async handleBatchUpdate(operation: any, userId: string, now: number, manager: any) {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`块 ${operation.blockId} 不存在`);
    }

    const newVer = block.latestVer + 1;
    const hash = this.calculateHash(operation.data.payload);

    const latestVersion = await manager.findOne(BlockVersion, {
      where: { blockId: operation.blockId, ver: block.latestVer },
    });

    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(operation.blockId, newVer),
      docId: block.docId,
      blockId: operation.blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: latestVersion?.parentId || '',
      sortKey: latestVersion?.sortKey || '0',
      indent: latestVersion?.indent || 0,
      collapsed: latestVersion?.collapsed || false,
      payload: operation.data.payload,
      hash,
      plainText: operation.data.plainText || this.extractPlainText(operation.data.payload),
      refs: [],
    });

    await manager.save(BlockVersion, blockVersion);

    block.latestVer = newVer;
    block.latestAt = now;
    block.latestBy = userId;
    await manager.save(Block, block);

    return { blockId: operation.blockId, version: newVer };
  }

  /**
   * 处理批量删除操作
   */
  private async handleBatchDelete(operation: any, userId: string, now: number, manager: any) {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`块 ${operation.blockId} 不存在`);
    }

    block.isDeleted = true;
    block.deletedAt = now;
    block.deletedBy = userId;
    await manager.save(Block, block);

    return { blockId: operation.blockId };
  }

  /**
   * 处理批量移动操作
   */
  private async handleBatchMove(operation: any, userId: string, now: number, manager: any) {
    const block = await manager.findOne(Block, {
      where: { blockId: operation.blockId, isDeleted: false },
    });

    if (!block) {
      throw new NotFoundException(`块 ${operation.blockId} 不存在`);
    }

    const latestVersion = await manager.findOne(BlockVersion, {
      where: { blockId: operation.blockId, ver: block.latestVer },
    });

    if (!latestVersion) {
      throw new NotFoundException(`块版本不存在`);
    }

    const newVer = block.latestVer + 1;
    const blockVersion = manager.create(BlockVersion, {
      versionId: generateVersionId(operation.blockId, newVer),
      docId: block.docId,
      blockId: operation.blockId,
      ver: newVer,
      createdAt: now,
      createdBy: userId,
      parentId: operation.parentId || '',
      sortKey: operation.sortKey,
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

    return { blockId: operation.blockId, version: newVer };
  }
}
