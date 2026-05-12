import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from '../../entities/favorite.entity';
import { Document } from '../../entities/document.entity';
import { DocumentsService } from '../documents/documents.service';
import { ActivitiesService } from '../activities/activities.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { QueryFavoritesDto } from './dto/query-favorites.dto';
import { FAVORITE_ACTIONS } from '../activities/constants/activity-actions';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private favoriteRepository: Repository<Favorite>,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private documentsService: DocumentsService,
    private activitiesService: ActivitiesService,
  ) {}

  /** 收藏文档 */
  async create(dto: CreateFavoriteDto, userId: string) {
    await this.documentsService.findOne(dto.docId, userId);

    const existing = await this.favoriteRepository.findOne({
      where: { userId, docId: dto.docId },
    });
    if (existing) {
      throw new ConflictException('已经收藏过该文档');
    }

    const favorite = await this.favoriteRepository.save(
      this.favoriteRepository.create({ userId, docId: dto.docId }),
    );

    const doc = await this.documentRepository.findOne({ where: { docId: dto.docId } });
    if (doc) {
      doc.favoriteCount = (doc.favoriteCount || 0) + 1;
      await this.documentRepository.save(doc);
      await this.activitiesService.record(
        doc.workspaceId,
        FAVORITE_ACTIONS.CREATE,
        'favorite',
        dto.docId,
        userId,
        { docId: dto.docId },
      );
    }

    return favorite;
  }

  /** 取消收藏 */
  async remove(docId: string, userId: string) {
    const fav = await this.favoriteRepository.findOne({
      where: { userId, docId },
    });
    if (!fav) throw new NotFoundException('未收藏该文档');

    await this.favoriteRepository.remove(fav);

    const doc = await this.documentRepository.findOne({ where: { docId } });
    if (doc) {
      doc.favoriteCount = Math.max(0, (doc.favoriteCount || 0) - 1);
      await this.documentRepository.save(doc);
      await this.activitiesService.record(
        doc.workspaceId,
        FAVORITE_ACTIONS.REMOVE,
        'favorite',
        docId,
        userId,
        { docId },
      );
    }

    return { message: '已取消收藏', docId };
  }

  /** 获取当前用户的收藏列表（只返回收藏记录，不包含文档详情） */
  async findAll(queryDto: QueryFavoritesDto, userId: string) {
    const { page = 1, pageSize = 20 } = queryDto;
    const skip = (page - 1) * pageSize;

    const [favorites, total] = await this.favoriteRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
    });

    // 移除 userId 字段，用户已经知道自己的身份
    const items = favorites.map(({ userId: _, ...rest }) => rest);

    return { items, total, page, pageSize };
  }
}
