import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from '../../entities/comment.entity';
import { Document } from '../../entities/document.entity';
import { Block } from '../../entities/block.entity';
import { DocumentsService } from '../documents/documents.service';
import { ActivitiesService } from '../activities/activities.service';
import { generateCommentId } from '../../common/utils/id-generator.util';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { QueryCommentsDto } from './dto/query-comments.dto';
import { COMMENT_ACTIONS } from '../activities/constants/activity-actions';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private commentRepository: Repository<Comment>,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(Block)
    private blockRepository: Repository<Block>,
    private documentsService: DocumentsService,
    private activitiesService: ActivitiesService,
  ) {}

  async create(dto: CreateCommentDto, userId: string) {
    await this.documentsService.findOne(dto.docId, userId);

    // 如果提供了 blockId，验证块是否存在且属于该文档
    if (dto.blockId) {
      const block = await this.blockRepository.findOne({
        where: { blockId: dto.blockId },
      });
      if (!block) {
        throw new NotFoundException('块不存在');
      }
      if (block.docId !== dto.docId) {
        throw new BadRequestException('块不属于该文档');
      }
      if (block.isDeleted) {
        throw new BadRequestException('块已被删除，无法添加评论');
      }
    }

    if (dto.parentCommentId) {
      const parent = await this.commentRepository.findOne({
        where: { commentId: dto.parentCommentId, isDeleted: false },
      });
      if (!parent) throw new NotFoundException('父评论不存在');
      if (parent.docId !== dto.docId) throw new BadRequestException('父评论须属于同一文档');
    }

    const comment = this.commentRepository.create({
      commentId: generateCommentId(),
      docId: dto.docId,
      blockId: dto.blockId || undefined,
      userId,
      content: dto.content.trim(),
      mentions: dto.mentions ?? [],
      parentCommentId: dto.parentCommentId || undefined,
      isDeleted: false,
    } as Partial<Comment>);
    const saved = await this.commentRepository.save(comment);
    const doc = await this.documentRepository.findOne({
      where: { docId: dto.docId },
      select: ['workspaceId'],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        COMMENT_ACTIONS.CREATE,
        'comment',
        saved.commentId,
        userId,
        { docId: dto.docId, blockId: dto.blockId },
      );
    return saved;
  }

  async findAll(queryDto: QueryCommentsDto, userId: string) {
    const { docId, blockId, page = 1, pageSize = 20 } = queryDto;
    if (!docId) throw new BadRequestException('docId 为必填');

    await this.documentsService.findOne(docId, userId);

    const qb = this.commentRepository
      .createQueryBuilder('c')
      .where('c.docId = :docId', { docId })
      .andWhere('c.isDeleted = :isDeleted', { isDeleted: false });

    if (blockId) qb.andWhere('c.blockId = :blockId', { blockId });

    qb.orderBy('c.createdAt', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async findOne(commentId: string, userId: string) {
    const c = await this.commentRepository.findOne({
      where: { commentId, isDeleted: false },
    });
    if (!c) throw new NotFoundException('评论不存在');
    await this.documentsService.findOne(c.docId, userId);
    return c;
  }

  async update(commentId: string, dto: UpdateCommentDto, userId: string) {
    const c = await this.findOne(commentId, userId);
    if (c.userId !== userId) throw new ForbiddenException('只能修改自己的评论');

    c.content = dto.content.trim();
    return await this.commentRepository.save(c);
  }

  async remove(commentId: string, userId: string) {
    const c = await this.findOne(commentId, userId);
    if (c.userId !== userId) throw new ForbiddenException('只能删除自己的评论');

    c.isDeleted = true;
    await this.commentRepository.save(c);
    const doc = await this.documentRepository.findOne({
      where: { docId: c.docId },
      select: ['workspaceId'],
    });
    if (doc)
      await this.activitiesService.record(
        doc.workspaceId,
        COMMENT_ACTIONS.DELETE,
        'comment',
        commentId,
        userId,
        { docId: c.docId },
      );
    return { message: '评论已删除' };
  }
}
