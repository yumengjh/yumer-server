import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SensitiveWord } from '../../entities/sensitive-word.entity';
import { CreateSensitiveWordDto } from './dto/create-sensitive-word.dto';

interface CachedWord {
  word: string;
  replacement: string;
}

@Injectable()
export class SensitiveWordService implements OnModuleInit {
  private wordCache: CachedWord[] = [];

  constructor(
    @InjectRepository(SensitiveWord)
    private sensitiveWordRepository: Repository<SensitiveWord>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache() {
    const words = await this.sensitiveWordRepository.find({ where: { isActive: true } });
    this.wordCache = words.map((w) => ({ word: w.word, replacement: w.replacement }));
  }

  /**
   * 检测并替换内容中的敏感词
   * @returns { hasSensitive: boolean, content: string }
   */
  filter(content: string): { hasSensitive: boolean; content: string } {
    if (this.wordCache.length === 0) return { hasSensitive: false, content };

    let filtered = content;
    let hasSensitive = false;

    for (const { word, replacement } of this.wordCache) {
      if (filtered.includes(word)) {
        hasSensitive = true;
        filtered = filtered.replaceAll(word, replacement);
      }
    }

    return { hasSensitive, content: filtered };
  }

  // ─── CRUD ───

  async findAll() {
    return this.sensitiveWordRepository.find({ order: { createdAt: 'DESC' } });
  }

  async create(dto: CreateSensitiveWordDto) {
    const word = this.sensitiveWordRepository.create(dto);
    const saved = await this.sensitiveWordRepository.save(word);
    await this.refreshCache();
    return saved;
  }

  async update(id: number, dto: Partial<CreateSensitiveWordDto>) {
    const word = await this.sensitiveWordRepository.findOne({ where: { id } });
    if (!word) throw new NotFoundException('敏感词不存在');
    Object.assign(word, dto);
    const saved = await this.sensitiveWordRepository.save(word);
    await this.refreshCache();
    return saved;
  }

  async remove(id: number) {
    const word = await this.sensitiveWordRepository.findOne({ where: { id } });
    if (!word) throw new NotFoundException('敏感词不存在');
    const result = await this.sensitiveWordRepository.remove(word);
    await this.refreshCache();
    return result;
  }
}
