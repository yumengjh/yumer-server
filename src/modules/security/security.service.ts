import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityLog } from '../../entities/security-log.entity';
import { generateLogId } from '../../common/utils/id-generator.util';
import { SecurityEventType, SecuritySeverity } from './constants/security-events';

export interface SecurityLogOptions {
  userId?: string;
  email?: string;
  ipAddress: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  threatLevel?: 'none' | 'low' | 'medium' | 'high';
  blocked?: boolean;
  severity?: string;
}

@Injectable()
export class SecurityService {
  constructor(
    @InjectRepository(SecurityLog)
    private securityLogRepository: Repository<SecurityLog>,
  ) {}

  /**
   * 记录安全事件到 security_logs
   */
  async logEvent(eventType: string, options: SecurityLogOptions): Promise<SecurityLog> {
    const severity = options.severity || this.inferSeverity(eventType, options.threatLevel);
    const log = this.securityLogRepository.create({
      logId: generateLogId(),
      eventType,
      severity,
      userId: options.userId ?? undefined,
      email: options.email ?? undefined,
      ipAddress: options.ipAddress || '0.0.0.0',
      userAgent: options.userAgent ?? undefined,
      details: options.details ?? {},
      threatLevel: options.threatLevel ?? 'none',
      blocked: options.blocked ?? false,
    });
    return await this.securityLogRepository.save(log);
  }

  /** 便捷方法 */
  async logLoginSuccess(opts: SecurityLogOptions) {
    return this.logEvent(SecurityEventType.LOGIN_SUCCESS, {
      ...opts,
      severity: SecuritySeverity.LOW,
    });
  }

  async logLoginFailed(opts: SecurityLogOptions & { reason?: string; attempts?: number }) {
    return this.logEvent(SecurityEventType.LOGIN_FAILED, {
      ...opts,
      severity: SecuritySeverity.MEDIUM,
      details: { ...(opts.details || {}), reason: opts.reason, attempts: opts.attempts },
    });
  }

  async logLogout(opts: SecurityLogOptions) {
    return this.logEvent(SecurityEventType.LOGOUT, {
      ...opts,
      severity: SecuritySeverity.LOW,
    });
  }

  async logUnauthorizedAccess(opts: SecurityLogOptions) {
    return this.logEvent(SecurityEventType.UNAUTHORIZED_ACCESS, {
      ...opts,
      severity: SecuritySeverity.MEDIUM,
    });
  }

  async logPermissionDenied(opts: SecurityLogOptions) {
    return this.logEvent(SecurityEventType.PERMISSION_DENIED, {
      ...opts,
      severity: SecuritySeverity.MEDIUM,
    });
  }

  async logRateLimitExceeded(opts: SecurityLogOptions) {
    return this.logEvent(SecurityEventType.RATE_LIMIT_EXCEEDED, {
      ...opts,
      severity: SecuritySeverity.MEDIUM,
    });
  }

  /**
   * 分页查询安全日志
   */
  async findFiltered(filters: {
    eventType?: string;
    userId?: string;
    ipAddress?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { eventType, userId, ipAddress, startDate, endDate, page = 1, pageSize = 20 } = filters;
    const qb = this.securityLogRepository.createQueryBuilder('s');
    if (eventType) qb.andWhere('s.eventType = :eventType', { eventType });
    if (userId) qb.andWhere('s.userId = :userId', { userId });
    if (ipAddress) qb.andWhere('s.ipAddress = :ipAddress', { ipAddress });
    if (startDate) qb.andWhere('s.timestamp >= :startDate', { startDate });
    if (endDate) qb.andWhere('s.timestamp <= :endDate', { endDate });
    qb.orderBy('s.timestamp', 'DESC');
    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  private inferSeverity(eventType: string, threatLevel?: string): string {
    if (threatLevel === 'high' || threatLevel === 'critical') return SecuritySeverity.HIGH;
    if (
      eventType === SecurityEventType.LOGIN_FAILED ||
      eventType === SecurityEventType.UNAUTHORIZED_ACCESS
    )
      return SecuritySeverity.MEDIUM;
    return SecuritySeverity.LOW;
  }
}
