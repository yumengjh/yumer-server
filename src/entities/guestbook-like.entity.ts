import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Guestbook } from './guestbook.entity';

@Entity('guestbook_likes')
@Unique(['guestbookId', 'ip'])
export class GuestbookLike {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  guestbookId: number;

  @ManyToOne(() => Guestbook)
  @JoinColumn({ name: 'guestbookId' })
  guestbook: Guestbook;

  @Column({ default: '' })
  ip: string;

  @Column({ default: '' })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
