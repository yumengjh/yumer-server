import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { generateLogId } from '../../common/utils/id-generator.util';

export interface CreateAuditLogDto {
  userId?: string;
  username?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: object;
  metadata?: object;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  status: 'success' | 'failed';
  errorMessage?: string;
}

export interface QueryAuditOptions {
  page?: number;
  pageSize?: number;
  offset?: number;
  limit?: number;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * 写入一条审计日志
   */
  async record(dto: CreateAuditLogDto): Promise<AuditLog> {
    const log = this.auditLogRepository.create({
      logId: generateLogId(),
      userId: dto.userId,
      username: dto.username,
      action: dto.action,
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      changes: dto.changes,
      metadata: dto.metadata ?? {},
      ipAddress: dto.ipAddress,
      userAgent: dto.userAgent,
      requestId: dto.requestId,
      status: dto.status,
      errorMessage: dto.errorMessage,
    });
    return await this.auditLogRepository.save(log);
  }

  /**
   * 查询用户操作历史
   */
  async findUserActivities(userId: string, options: QueryAuditOptions = {}) {
    const { page = 1, pageSize = 20 } = options;
    const skip = options.offset ?? (page - 1) * pageSize;
    const take = options.limit ?? pageSize;

    const [items, total] = await this.auditLogRepository.findAndCount({
      where: { userId },
      order: { timestamp: 'DESC' },
      skip,
      take,
    });
    return { items, total, page, pageSize };
  }

  /**
   * 查询某资源的操作历史
   */
  async findResourceHistory(
    resourceType: string,
    resourceId: string,
    options: QueryAuditOptions = {},
  ) {
    const { page = 1, pageSize = 50 } = options;
    const skip = options.offset ?? (page - 1) * pageSize;
    const take = options.limit ?? pageSize;

    const [items, total] = await this.auditLogRepository.findAndCount({
      where: { resourceType, resourceId },
      order: { timestamp: 'DESC' },
      skip,
      take,
    });
    return { items, total, page, pageSize };
  }

  /**
   * 查询敏感操作（DELETE、UPDATE_PERMISSION、REMOVE_MEMBER 等）
   */
  async findSensitiveActions(startDate: Date, endDate: Date, options: QueryAuditOptions = {}) {
    const sensitiveActions = ['DELETE', 'UPDATE_PERMISSION', 'REMOVE_MEMBER', 'PUBLISH'];
    const { page = 1, pageSize = 50 } = options;
    const skip = options.offset ?? (page - 1) * pageSize;
    const take = options.limit ?? pageSize;

    const [items, total] = await this.auditLogRepository.findAndCount({
      where: {
        action: In(sensitiveActions),
        timestamp: Between(startDate, endDate),
      },
      order: { timestamp: 'DESC' },
      skip,
      take,
    });
    return { items, total, page, pageSize };
  }

  /**
   * 按条件分页查询审计日志
   */
  async findFiltered(filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const {
      userId,
      action,
      resourceType,
      resourceId,
      startDate,
      endDate,
      page = 1,
      pageSize = 20,
    } = filters;
    const qb = this.auditLogRepository.createQueryBuilder('a');
    if (userId) qb.andWhere('a.userId = :userId', { userId });
    if (action) qb.andWhere('a.action = :action', { action });
    if (resourceType) qb.andWhere('a.resourceType = :resourceType', { resourceType });
    if (resourceId) qb.andWhere('a.resourceId = :resourceId', { resourceId });
    if (startDate) qb.andWhere('a.timestamp >= :startDate', { startDate });
    if (endDate) qb.andWhere('a.timestamp <= :endDate', { endDate });
    qb.orderBy('a.timestamp', 'DESC');
    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  /**
   * 通用分页查询
   */
  async findAll(where: Partial<AuditLog>, options: QueryAuditOptions = {}) {
    const { page = 1, pageSize = 20 } = options;
    const skip = options.offset ?? (page - 1) * pageSize;
    const take = options.limit ?? pageSize;

    const [items, total] = await this.auditLogRepository.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      skip,
      take,
    });
    return { items, total, page, pageSize };
  }
}
