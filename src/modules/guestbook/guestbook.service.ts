import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Guestbook } from '../../entities/guestbook.entity';
import { SensitiveWordService } from './sensitive-word.service';
import { CreateGuestbookDto } from './dto/create-guestbook.dto';
import { UpdateGuestbookAdminDto } from './dto/update-guestbook-admin.dto';

@Injectable()
export class GuestbookService {
  constructor(
    @InjectRepository(Guestbook)
    private guestbookRepository: Repository<Guestbook>,
    private sensitiveWordService: SensitiveWordService,
  ) {}

  // ─── 公开接口 ───

  async findAll(page = 1, pageSize = 20) {
    const qb = this.guestbookRepository
      .createQueryBuilder('g')
      .where('g.status = :status', { status: 1 })
      .orderBy('g.isPinned', 'DESC')
      .addOrderBy('g.createdAt', 'DESC');

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return { items, total, page, pageSize };
  }

  async findReplies(parentId: number) {
    return this.guestbookRepository.find({
      where: { parentId, status: 1 },
      order: { createdAt: 'ASC' },
    });
  }

  async create(dto: CreateGuestbookDto, ip: string, userAgent: string) {
    const { hasSensitive, content } = this.sensitiveWordService.filter(dto.content);

    const guestbook = this.guestbookRepository.create({
      ...dto,
      content,
      ip,
      userAgent,
      status: hasSensitive ? 0 : 1,
    });

    const saved = await this.guestbookRepository.save(guestbook);

    if (dto.parentId) {
      await this.guestbookRepository
        .createQueryBuilder()
        .update(Guestbook)
        .set({ replyCount: () => 'replyCount + 1' })
        .where('id = :id', { id: dto.parentId })
        .execute();
    }

    return saved;
  }

  // ─── 管理接口 ───

  async findAllAdmin(page = 1, pageSize = 20, status?: number) {
    const qb = this.guestbookRepository.createQueryBuilder('g');

    if (status !== undefined && status !== -1) {
      qb.where('g.status = :status', { status });
    }

    qb.orderBy('g.isPinned', 'DESC').addOrderBy('g.createdAt', 'DESC');

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return { items, total, page, pageSize };
  }

  async updateAdmin(id: number, dto: UpdateGuestbookAdminDto) {
    const item = await this.guestbookRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException('留言不存在');
    Object.assign(item, dto);
    return this.guestbookRepository.save(item);
  }

  async remove(id: number) {
    const item = await this.guestbookRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException('留言不存在');
    return this.guestbookRepository.remove(item);
  }

  async batchUpdateStatus(ids: number[], status: number) {
    await this.guestbookRepository.update({ id: In(ids) }, { status });
    return { updated: ids.length };
  }
}
