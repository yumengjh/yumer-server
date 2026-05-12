import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Tag } from '../../entities/tag.entity';
import { Document } from '../../entities/document.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ActivitiesService } from '../activities/activities.service';
import { generateTagId } from '../../common/utils/id-generator.util';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { QueryTagsDto } from './dto/query-tags.dto';
import { TAG_ACTIONS } from '../activities/constants/activity-actions';
import { isSitePublicAnonymousUserId } from '../../common/decorators/public.decorator';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectDataSource()
    private dataSource: DataSource,
    private workspacesService: WorkspacesService,
    private activitiesService: ActivitiesService,
  ) {}

  async create(createTagDto: CreateTagDto, userId: string) {
    await this.workspacesService.checkAccess(createTagDto.workspaceId, userId);

    const existing = await this.tagRepository.findOne({
      where: {
        workspaceId: createTagDto.workspaceId,
        name: createTagDto.name.trim(),
        isDeleted: false,
      },
    });
    if (existing) {
      throw new ConflictException('该工作空间下已存在同名标签');
    }

    const tag = this.tagRepository.create({
      tagId: generateTagId(),
      workspaceId: createTagDto.workspaceId,
      name: createTagDto.name.trim(),
      color: createTagDto.color?.trim(),
      createdBy: userId,
      usageCount: 0,
      documentIds: [],
      isDeleted: false,
    });
    const saved = await this.tagRepository.save(tag);
    await this.activitiesService.record(
      createTagDto.workspaceId,
      TAG_ACTIONS.CREATE,
      'tag',
      saved.tagId,
      userId,
      { name: saved.name },
    );
    return saved;
  }

  async findAll(queryDto: QueryTagsDto, userId: string) {
    const { workspaceId, page = 1, pageSize = 20 } = queryDto;
    if (!workspaceId) {
      throw new BadRequestException('workspaceId 为必填');
    }
    if (isSitePublicAnonymousUserId(userId)) {
      await this.workspacesService.findOne(workspaceId, userId);
    } else {
      await this.workspacesService.checkAccess(workspaceId, userId);
    }

    const skip = (page - 1) * pageSize;
    const [items, total] = await this.tagRepository.findAndCount({
      where: { workspaceId, isDeleted: false },
      order: { name: 'ASC' },
      skip,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async findOne(tagId: string, userId: string) {
    const tag = await this.tagRepository.findOne({ where: { tagId } });
    if (!tag) throw new NotFoundException('标签不存在');
    if (tag.isDeleted) throw new NotFoundException('标签不存在');
    await this.workspacesService.checkAccess(tag.workspaceId, userId);
    return tag;
  }

  /** 统计标签被多少文档使用（未删除且 tags 数组包含该标签ID） */
  async getUsage(tagId: string, userId: string) {
    const tag = await this.findOne(tagId, userId);
    // 直接返回标签的 usageCount（已自动维护）
    return { tagId: tag.tagId, name: tag.name, usage: tag.usageCount || 0 };
  }

  async update(tagId: string, updateTagDto: UpdateTagDto, userId: string) {
    const tag = await this.findOne(tagId, userId);

    // 已删除的标签不能更新
    if (tag.isDeleted) {
      throw new NotFoundException('标签不存在');
    }

    if (updateTagDto.name !== undefined && updateTagDto.name.trim() !== tag.name) {
      const newName = updateTagDto.name.trim();
      const existing = await this.tagRepository.findOne({
        where: { workspaceId: tag.workspaceId, name: newName, isDeleted: false },
      });
      if (existing) throw new ConflictException('该工作空间下已存在同名标签');
      // 注意：文档中存储的是 tagId，不是标签名称，所以更新标签名称不需要同步文档
      tag.name = newName;
    }
    if (updateTagDto.color !== undefined) {
      const v = updateTagDto.color.trim();
      (tag as { color: string | null }).color = v || null;
    }

    const saved = await this.tagRepository.save(tag);
    await this.activitiesService.record(
      tag.workspaceId,
      TAG_ACTIONS.UPDATE,
      'tag',
      tagId,
      userId,
      updateTagDto as object,
    );
    return saved;
  }

  async remove(tagId: string, userId: string) {
    const tag = await this.findOne(tagId, userId);

    // 使用事务确保数据一致性
    const result = await this.dataSource.transaction(async (manager) => {
      // 1. 从 tag.documentIds 中获取所有使用该标签的文档ID
      let documentIds = tag.documentIds || [];

      // 回退机制：如果 documentIds 为空但 usageCount > 0，说明可能是旧数据，需要查询
      if (documentIds.length === 0 && tag.usageCount > 0) {
        console.log(`标签 ${tag.tagId} 的 documentIds 为空但 usageCount > 0，回退到查询方式`);
        const documents = await manager
          .createQueryBuilder(Document, 'doc')
          .where('doc.workspaceId = :workspaceId', { workspaceId: tag.workspaceId })
          .andWhere('doc.status != :status', { status: 'deleted' })
          .andWhere('doc.tags @> :tagId', { tagId: [tag.tagId] })
          .select('doc.docId')
          .getMany();
        documentIds = documents.map((doc) => doc.docId);
        console.log(`通过查询找到 ${documentIds.length} 个使用该标签的文档`);
      }

      console.log(`删除标签 ${tag.tagId}，找到 ${documentIds.length} 个使用该标签的文档`);

      // 2. 从所有文档的 tags 数组中移除该标签ID（只更新未删除的文档）
      let removedCount = 0;
      if (documentIds.length > 0) {
        // 查询需要更新的文档
        const documents = await manager
          .createQueryBuilder(Document, 'doc')
          .where('doc.docId IN (:...documentIds)', { documentIds })
          .andWhere('doc.workspaceId = :workspaceId', { workspaceId: tag.workspaceId })
          .andWhere('doc.status != :status', { status: 'deleted' })
          .getMany();

        // 批量更新每个文档的 tags 数组
        for (const doc of documents) {
          if (doc.tags && doc.tags.includes(tag.tagId)) {
            doc.tags = doc.tags.filter((id: string) => id !== tag.tagId);
            await manager.save(Document, doc);
            removedCount++;
          }
        }

        console.log(`已从 ${removedCount} 个文档中移除标签 ${tag.tagId}`);
      }

      // 3. 软删除标签：更新 isDeleted 和 deletedAt 字段
      tag.isDeleted = true;
      tag.deletedAt = new Date();
      await manager.save(Tag, tag);

      return {
        message: '标签已删除',
        removedFromDocuments: removedCount,
      };
    });

    // 记录活动日志
    await this.activitiesService.record(tag.workspaceId, TAG_ACTIONS.DELETE, 'tag', tagId, userId, {
      name: tag.name,
      removedFromDocuments: result.removedFromDocuments,
    });

    return result;
  }
}
