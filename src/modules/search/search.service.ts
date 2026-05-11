import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../../entities/document.entity';
import { Block } from '../../entities/block.entity';
import { BlockVersion } from '../../entities/block-version.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { AdvancedSearchDto } from './dto/advanced-search.dto';
import { isSqlite } from '../../common/db-type';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(BlockVersion)
    private blockVersionRepository: Repository<BlockVersion>,
    private workspacesService: WorkspacesService,
  ) {}

  private async getUserWorkspaceIds(userId: string): Promise<string[]> {
    const { items } = await this.workspacesService.findAll(userId, {
      page: 1,
      pageSize: 1000,
    });
    return (items as { workspaceId: string }[]).map((ws) => ws.workspaceId);
  }

  /**
   * 全局搜索：文档标题 + 块内容
   */
  async globalSearch(dto: SearchQueryDto, userId: string) {
    const { query, workspaceId, type = 'all', page = 1, pageSize = 20 } = dto;
    const skip = (page - 1) * pageSize;
    const titleLike = `%${query}%`;

    let workspaceIds: string[];
    if (workspaceId) {
      await this.workspacesService.checkAccess(workspaceId, userId);
      workspaceIds = [workspaceId];
    } else {
      workspaceIds = await this.getUserWorkspaceIds(userId);
      if (workspaceIds.length === 0) {
        return {
          documents: { items: [], total: 0, page, pageSize },
          blocks: { items: [], total: 0, page, pageSize },
        };
      }
    }

    const params = { query, titleLike, workspaceIds, deleted: 'deleted' };
    const baseDocWhere = 'd.workspaceId IN (:...workspaceIds) AND d.status != :deleted';

    const result: {
      documents: { items: any[]; total: number; page: number; pageSize: number };
      blocks: { items: any[]; total: number; page: number; pageSize: number };
    } = {
      documents: { items: [], total: 0, page, pageSize },
      blocks: { items: [], total: 0, page, pageSize },
    };

    if (type === 'doc' || type === 'all') {
      const docMatch = isSqlite()
        ? 'd.title LIKE :titleLike'
        : '(d.searchVector @@ plainto_tsquery(:query) OR d.title ILIKE :titleLike)';

      const qb = this.documentRepository
        .createQueryBuilder('d')
        .where(baseDocWhere)
        .andWhere(docMatch)
        .setParameters(params)
        .select(['d.docId', 'd.title', 'd.workspaceId', 'd.updatedAt', 'd.createdAt']);

      const docOrder = isSqlite()
        ? 'd.updatedAt'
        : 'COALESCE(ts_rank(d.searchVector, plainto_tsquery(:query)), 0)';

      const [items, total] = await qb
        .orderBy(docOrder, 'DESC')
        .addOrderBy('d.updatedAt', 'DESC')
        .skip(skip)
        .take(pageSize)
        .getManyAndCount();

      result.documents = { items, total, page, pageSize };
    }

    if (type === 'block' || type === 'all') {
      const blockMatch = isSqlite()
        ? 'bv.plainText LIKE :titleLike'
        : '(bv.searchVector @@ plainto_tsquery(:query) OR bv.plainText ILIKE :titleLike)';

      const blockParams = { ...params, isDeleted: false };
      const qb = this.blockVersionRepository
        .createQueryBuilder('bv')
        .innerJoin(Block, 'b', 'bv.blockId = b.blockId AND b.latestVer = bv.ver')
        .innerJoin(Document, 'd', 'd.docId = b.docId')
        .where('b.isDeleted = :isDeleted')
        .andWhere(baseDocWhere)
        .andWhere(blockMatch)
        .setParameters(blockParams)
        .select([
          'bv.blockId AS "blockId"',
          'bv.plainText AS "plainText"',
          'bv.ver AS "ver"',
          'bv.docId AS "docId"',
          'd.title AS "docTitle"',
          'd.updatedAt AS "docUpdatedAt"',
        ]);

      const blockOrder = isSqlite()
        ? 'd.updatedAt'
        : 'COALESCE(ts_rank(bv.searchVector, plainto_tsquery(:query)), 0)';

      const total = await qb.getCount();
      const rawItems = await qb
        .orderBy(blockOrder, 'DESC')
        .addOrderBy('d.updatedAt', 'DESC')
        .skip(skip)
        .take(pageSize)
        .getRawMany();

      result.blocks = {
        items: (rawItems as any[]).map((r: any) => ({
          blockId: r.blockId,
          docId: r.docId,
          plainText: r.plainText,
          ver: Number(r.ver),
          docTitle: r.docTitle,
          docUpdatedAt: r.docUpdatedAt,
        })),
        total,
        page,
        pageSize,
      };
    }

    return result;
  }

  /**
   * 高级搜索：标签、时间范围、创建者、排序
   */
  async advancedSearch(dto: AdvancedSearchDto, userId: string) {
    const {
      query,
      workspaceId,
      type = 'all',
      tags,
      startDate,
      endDate,
      createdBy,
      sortBy = 'rank',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = dto;
    const skip = (page - 1) * pageSize;
    const titleLike = `%${query}%`;

    let workspaceIds: string[];
    if (workspaceId) {
      await this.workspacesService.checkAccess(workspaceId, userId);
      workspaceIds = [workspaceId];
    } else {
      workspaceIds = await this.getUserWorkspaceIds(userId);
      if (workspaceIds.length === 0) {
        return {
          documents: { items: [], total: 0, page, pageSize },
          blocks: { items: [], total: 0, page, pageSize },
        };
      }
    }

    const params: Record<string, unknown> = {
      query,
      titleLike,
      workspaceIds,
      deleted: 'deleted',
    };
    if (tags?.length) params.tags = tags;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (createdBy) params.createdBy = createdBy;

    const baseDocWhere = 'd.workspaceId IN (:...workspaceIds) AND d.status != :deleted';

    const docMatch = isSqlite()
      ? 'd.title LIKE :titleLike'
      : '(d.searchVector @@ plainto_tsquery(:query) OR d.title ILIKE :titleLike)';
    const blockMatch = isSqlite()
      ? 'bv.plainText LIKE :titleLike'
      : '(bv.searchVector @@ plainto_tsquery(:query) OR bv.plainText ILIKE :titleLike)';

    const result: {
      documents: { items: any[]; total: number; page: number; pageSize: number };
      blocks: { items: any[]; total: number; page: number; pageSize: number };
    } = {
      documents: { items: [], total: 0, page, pageSize },
      blocks: { items: [], total: 0, page, pageSize },
    };

    const docOrder =
      sortBy === 'rank'
        ? isSqlite()
          ? 'd.updatedAt'
          : `COALESCE(ts_rank(d.searchVector, plainto_tsquery(:query)), 0)`
        : sortBy === 'createdAt'
          ? 'd.createdAt'
          : 'd.updatedAt';
    const blockOrder =
      sortBy === 'rank'
        ? isSqlite()
          ? 'd.updatedAt'
          : `COALESCE(ts_rank(bv.searchVector, plainto_tsquery(:query)), 0)`
        : 'd.updatedAt';

    if (type === 'doc' || type === 'all') {
      const qb = this.documentRepository
        .createQueryBuilder('d')
        .where(baseDocWhere)
        .andWhere(docMatch)
        .setParameters(params)
        .select([
          'd.docId',
          'd.title',
          'd.workspaceId',
          'd.updatedAt',
          'd.createdAt',
          'd.createdBy',
        ]);

      if (tags?.length) {
        if (isSqlite()) {
          qb.andWhere('d.tags LIKE :tagLike', { tagLike: `%"${tags[0]}%"` });
        } else {
          qb.andWhere('d.tags && :tags');
        }
      }
      if (startDate) qb.andWhere('d.updatedAt >= :startDate');
      if (endDate) qb.andWhere('d.updatedAt <= :endDate');
      if (createdBy) qb.andWhere('d.createdBy = :createdBy');

      const [items, total] = await qb
        .orderBy(docOrder, sortOrder.toUpperCase() as 'ASC' | 'DESC')
        .skip(skip)
        .take(pageSize)
        .getManyAndCount();

      result.documents = { items, total, page, pageSize };
    }

    if (type === 'block' || type === 'all') {
      const blockParams = { ...params, isDeleted: false };
      const qb = this.blockVersionRepository
        .createQueryBuilder('bv')
        .innerJoin(Block, 'b', 'bv.blockId = b.blockId AND b.latestVer = bv.ver')
        .innerJoin(Document, 'd', 'd.docId = b.docId')
        .where('b.isDeleted = :isDeleted')
        .andWhere(baseDocWhere)
        .andWhere(blockMatch)
        .setParameters(blockParams)
        .select([
          'bv.blockId AS "blockId"',
          'bv.plainText AS "plainText"',
          'bv.ver AS "ver"',
          'bv.docId AS "docId"',
          'd.title AS "docTitle"',
          'd.updatedAt AS "docUpdatedAt"',
        ]);

      if (tags?.length) {
        if (isSqlite()) {
          qb.andWhere('d.tags LIKE :tagLike', { tagLike: `%"${tags[0]}%"` });
        } else {
          qb.andWhere('d.tags && :tags');
        }
      }
      if (startDate) qb.andWhere('d.updatedAt >= :startDate');
      if (endDate) qb.andWhere('d.updatedAt <= :endDate');
      if (createdBy) qb.andWhere('d.createdBy = :createdBy');

      const total = await qb.getCount();
      const rawItems = await qb
        .orderBy(blockOrder, sortOrder.toUpperCase() as 'ASC' | 'DESC')
        .skip(skip)
        .take(pageSize)
        .getRawMany();

      result.blocks = {
        items: (rawItems as any[]).map((r: any) => ({
          blockId: r.blockId,
          docId: r.docId,
          plainText: r.plainText,
          ver: Number(r.ver),
          docTitle: r.docTitle,
          docUpdatedAt: r.docUpdatedAt,
        })),
        total,
        page,
        pageSize,
      };
    }

    return result;
  }
}
