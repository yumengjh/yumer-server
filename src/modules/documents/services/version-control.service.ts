import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Document } from '../../../entities/document.entity';
import { DocRevision } from '../../../entities/doc-revision.entity';

/**
 * 文档版本控制服务
 * 用于管理文档版本的延迟创建机制，确保不同文档之间的隔离
 */
@Injectable()
export class VersionControlService implements OnModuleDestroy {
  private readonly logger = new Logger(VersionControlService.name);

  // 按文档隔离的待创建版本计数器
  // key: docId, value: { count: number, lastUpdate: number }
  private readonly pendingVersions = new Map<string, { count: number; lastUpdate: number }>();

  // 清理过期数据的间隔（30分钟）
  private readonly CLEANUP_INTERVAL = 30 * 60 * 1000;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocRevision)
    private readonly docRevisionRepository: Repository<DocRevision>,
    private readonly dataSource: DataSource,
  ) {
    // 启动定期清理任务
    this.startCleanupTask();
  }

  /**
   * 记录一次待创建的版本（不立即创建）
   * @param docId 文档ID
   */
  recordPendingVersion(docId: string): void {
    const existing = this.pendingVersions.get(docId);
    if (existing) {
      existing.count += 1;
      existing.lastUpdate = Date.now();
    } else {
      this.pendingVersions.set(docId, {
        count: 1,
        lastUpdate: Date.now(),
      });
    }
  }

  /**
   * 获取待创建版本的数量
   * @param docId 文档ID
   * @returns 待创建版本的数量
   */
  getPendingVersionCount(docId: string): number {
    const pending = this.pendingVersions.get(docId);
    return pending ? pending.count : 0;
  }

  /**
   * 创建文档版本（立即创建）
   * @param docId 文档ID
   * @param userId 用户ID
   * @param message 版本消息（可选）
   * @returns 创建的版本号
   */
  async createVersion(docId: string, userId: string, message?: string): Promise<number> {
    // 获取待创建版本的数量（在事务外获取，避免事务问题）
    const pendingCount = this.getPendingVersionCount(docId);

    const newVersion = await this.dataSource.transaction(async (manager) => {
      const document = await manager.findOne(Document, { where: { docId } });
      if (!document) {
        throw new NotFoundException(`文档 ${docId} 不存在`);
      }

      // 创建版本
      document.head += 1;
      document.updatedBy = userId;
      await manager.save(Document, document);

      // 创建文档修订记录
      const docRevisionRepo = manager.getRepository(DocRevision);
      const revision = docRevisionRepo.create({
        revisionId: `${docId}@${document.head}`,
        docId,
        docVer: document.head,
        createdAt: Date.now(),
        createdBy: userId,
        message: message || `Document updated (${pendingCount} pending operations)`,
        branch: 'draft',
        patches: [],
        rootBlockId: document.rootBlockId,
        source: 'api',
        opSummary: {
          pendingOperations: pendingCount,
        },
      });
      await docRevisionRepo.save(revision);

      return document.head;
    });

    // 清除该文档的待创建版本计数（在事务成功后清除）
    this.pendingVersions.delete(docId);

    this.logger.log(`文档 ${docId} 创建版本 ${newVersion}，包含 ${pendingCount} 个待处理操作`);

    return newVersion;
  }

  /**
   * 清除文档的待创建版本计数
   * @param docId 文档ID
   */
  clearPendingVersions(docId: string): void {
    this.pendingVersions.delete(docId);
  }

  /**
   * 启动定期清理任务，清理过期的待创建版本记录
   */
  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const toDelete: string[] = [];

      for (const [docId, data] of this.pendingVersions.entries()) {
        // 如果超过 1 小时没有更新，清除记录
        if (now - data.lastUpdate > 60 * 60 * 1000) {
          toDelete.push(docId);
        }
      }

      for (const docId of toDelete) {
        this.pendingVersions.delete(docId);
        this.logger.warn(`清除文档 ${docId} 的过期待创建版本记录`);
      }
    }, this.CLEANUP_INTERVAL);

    this.cleanupTimer.unref?.();
  }

  /**
   * 获取所有文档的待创建版本统计（用于调试）
   */
  getPendingVersionsStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [docId, data] of this.pendingVersions.entries()) {
      stats[docId] = data.count;
    }
    return stats;
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}
