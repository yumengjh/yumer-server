import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('guestbook')
@Index(['status', 'createdAt'])
export class Guestbook {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  nickname: string;

  @Column({ default: '' })
  email: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: '' })
  avatar: string;

  @Column({ default: '' })
  ip: string;

  @Column({ default: '' })
  region: string;

  @Column({ default: '' })
  userAgent: string;

  @Column({ nullable: true })
  parentId: number;

  @Column({ default: 0 })
  status: number;

  @Column({ default: false })
  isPinned: boolean;

  @Column({ default: 0 })
  likeCount: number;

  @Column({ default: 0 })
  replyCount: number;

  @Column({ type: 'text', nullable: true })
  adminReply: string;

  @Column({ nullable: true })
  adminReplyAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
