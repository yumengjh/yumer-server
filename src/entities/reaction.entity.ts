import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Emoji } from './emoji.entity';

@Entity('reactions')
@Unique(['targetType', 'targetId', 'emojiId', 'ip'])
@Index(['targetType', 'targetId'])
export class Reaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  targetType: string;

  @Column({ length: 100 })
  targetId: string;

  @Column()
  emojiId: number;

  @ManyToOne(() => Emoji)
  @JoinColumn({ name: 'emojiId' })
  emoji: Emoji;

  @Column({ default: '' })
  ip: string;

  @Column({ default: '' })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
