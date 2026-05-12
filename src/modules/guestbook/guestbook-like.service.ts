import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GuestbookLike } from '../../entities/guestbook-like.entity';
import { Guestbook } from '../../entities/guestbook.entity';

@Injectable()
export class GuestbookLikeService {
  constructor(
    @InjectRepository(GuestbookLike)
    private likeRepository: Repository<GuestbookLike>,
    @InjectRepository(Guestbook)
    private guestbookRepository: Repository<Guestbook>,
  ) {}

  /**
   * 点赞/取消点赞（toggle）
   * @returns { liked: boolean, likeCount: number }
   */
  async toggle(guestbookId: number, ip: string, userAgent: string) {
    const guestbook = await this.guestbookRepository.findOne({ where: { id: guestbookId } });
    if (!guestbook) throw new NotFoundException('留言不存在');

    const existing = await this.likeRepository.findOne({
      where: { guestbookId, ip },
    });

    if (existing) {
      await this.likeRepository.remove(existing);
      guestbook.likeCount = Math.max(0, guestbook.likeCount - 1);
      await this.guestbookRepository.save(guestbook);
      return { liked: false, likeCount: guestbook.likeCount };
    }

    const like = this.likeRepository.create({ guestbookId, ip, userAgent });
    await this.likeRepository.save(like);
    guestbook.likeCount += 1;
    await this.guestbookRepository.save(guestbook);
    return { liked: true, likeCount: guestbook.likeCount };
  }
}
