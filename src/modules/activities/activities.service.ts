import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity } from '../../entities/activity.entity';
import { generateActivityId } from '../../common/utils/id-generator.util';
import { QueryActivitiesDto } from './dto/query-activities.dto';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    @InjectRepository(Activity)
    private activityRepository: Repository<Activity>,
  ) {}

  /**
   * 记录活动（失败不抛错，避免影响主流程）
   */
  async record(
    workspaceId: string,
    action: string,
    entityType: string,
    entityId: string,
    userId: string,
    details?: object,
    metadata?: object,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      const activity = this.activityRepository.create({
        activityId: generateActivityId(),
        workspaceId,
        action,
        entityType,
        entityId,
        userId,
        details: details ?? {},
        metadata: metadata ?? {},
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      } as Partial<Activity>);
      await this.activityRepository.save(activity);
    } catch (e) {
      this.logger.warn(`Activity record failed: ${(e as Error).message}`);
    }
  }

  /**
   * 分页查询活动列表（调用方需先校验 workspace 权限）
   */
  async findFiltered(dto: QueryActivitiesDto) {
    const {
      workspaceId,
      userId,
      action,
      entityType,
      startDate,
      endDate,
      page = 1,
      pageSize = 20,
    } = dto;
    const skip = (page - 1) * pageSize;

    const qb = this.activityRepository
      .createQueryBuilder('a')
      .where('a.workspaceId = :workspaceId', { workspaceId })
      .orderBy('a.createdAt', 'DESC');

    if (userId) qb.andWhere('a.userId = :userId', { userId });
    if (action) qb.andWhere('a.action = :action', { action });
    if (entityType) qb.andWhere('a.entityType = :entityType', { entityType });
    if (startDate) qb.andWhere('a.createdAt >= :startDate', { startDate });
    if (endDate) qb.andWhere('a.createdAt <= :endDate', { endDate });

    const [items, total] = await qb
      .select([
        'a.activityId',
        'a.action',
        'a.entityType',
        'a.entityId',
        'a.userId',
        'a.details',
        'a.metadata',
        'a.createdAt',
      ])
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    return { items, total, page, pageSize };
  }
}
