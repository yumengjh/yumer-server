import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Emoji } from '../../entities/emoji.entity';
import { Reaction } from '../../entities/reaction.entity';
import { CreateEmojiDto } from './dto/create-emoji.dto';
import { UpdateEmojiDto } from './dto/update-emoji.dto';

@Injectable()
export class ReactionsService {
  constructor(
    @InjectRepository(Emoji)
    private emojiRepository: Repository<Emoji>,
    @InjectRepository(Reaction)
    private reactionRepository: Repository<Reaction>,
  ) {}

  // ─── Emoji CRUD ───

  async findAllEmojis(includeInactive = false) {
    const where = includeInactive ? {} : { isActive: true as const };
    return this.emojiRepository.find({ where, order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async createEmoji(dto: CreateEmojiDto) {
    const emoji = this.emojiRepository.create(dto);
    return this.emojiRepository.save(emoji);
  }

  async updateEmoji(id: number, dto: UpdateEmojiDto) {
    const emoji = await this.emojiRepository.findOne({ where: { id } });
    if (!emoji) throw new NotFoundException('表情不存在');
    Object.assign(emoji, dto);
    return this.emojiRepository.save(emoji);
  }

  async removeEmoji(id: number) {
    const emoji = await this.emojiRepository.findOne({ where: { id } });
    if (!emoji) throw new NotFoundException('表情不存在');
    return this.emojiRepository.remove(emoji);
  }

  // ─── Reactions ───

  async getReactions(targetType: string, targetId: string) {
    const results = await this.reactionRepository
      .createQueryBuilder('r')
      .select('r.emojiId', 'emojiId')
      .addSelect('e.code', 'code')
      .addSelect('e.name', 'name')
      .addSelect('e.icon', 'icon')
      .addSelect('COUNT(*)', 'count')
      .innerJoin('r.emoji', 'e')
      .where('r.targetType = :targetType', { targetType })
      .andWhere('r.targetId = :targetId', { targetId })
      .andWhere('e.isActive = true')
      .groupBy('r.emojiId')
      .addGroupBy('e.code')
      .addGroupBy('e.name')
      .addGroupBy('e.icon')
      .getRawMany();

    return results.map((r) => ({
      emojiId: r.emojiId,
      code: r.code,
      name: r.name,
      icon: r.icon,
      count: parseInt(r.count, 10),
    }));
  }

  async addReaction(targetType: string, targetId: string, emojiId: number, ip: string, userAgent: string) {
    const emoji = await this.emojiRepository.findOne({ where: { id: emojiId, isActive: true } });
    if (!emoji) throw new NotFoundException('表情不存在或已禁用');

    const existing = await this.reactionRepository.findOne({
      where: { targetType, targetId, emojiId, ip },
    });
    if (existing) throw new ConflictException('已回应过该表情');

    const reaction = this.reactionRepository.create({ targetType, targetId, emojiId, ip, userAgent });
    await this.reactionRepository.save(reaction);
    return this.getReactions(targetType, targetId);
  }

  async removeReaction(targetType: string, targetId: string, emojiCode: string, ip: string) {
    const emoji = await this.emojiRepository.findOne({ where: { code: emojiCode } });
    if (!emoji) throw new NotFoundException('表情不存在');

    const existing = await this.reactionRepository.findOne({
      where: { targetType, targetId, emojiId: emoji.id, ip },
    });
    if (!existing) throw new NotFoundException('未找到该回应');

    await this.reactionRepository.remove(existing);
    return this.getReactions(targetType, targetId);
  }

  // ─── Admin: Reaction Records ───

  async findAllRecords(page = 1, pageSize = 20, targetType?: string, targetId?: string) {
    const qb = this.reactionRepository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.emoji', 'emoji')
      .orderBy('r.createdAt', 'DESC');

    if (targetType) qb.andWhere('r.targetType = :targetType', { targetType });
    if (targetId) qb.andWhere('r.targetId = :targetId', { targetId });

    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items, total, page, pageSize };
  }

  async removeRecord(id: number) {
    const record = await this.reactionRepository.findOne({ where: { id } });
    if (!record) throw new NotFoundException('记录不存在');
    return this.reactionRepository.remove(record);
  }
}
