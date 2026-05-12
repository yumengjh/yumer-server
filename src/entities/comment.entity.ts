import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('comments')
@Index(['docId'])
@Index(['blockId'])
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  commentId: string;

  @ManyToOne('Document', 'comments')
  @JoinColumn({ name: 'doc_id', referencedColumnName: 'docId' })
  document: any;

  @Column()
  docId: string;

  @ManyToOne('Block')
  @JoinColumn({ name: 'block_id', referencedColumnName: 'blockId' })
  block: any;

  @Column({ nullable: true })
  blockId: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  user: any;

  @Column()
  userId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'text',
    array: !isSqlite(),
    default: () => (isSqlite() ? "'[]'" : "'{}'"),
  })
  mentions: string[];

  @ManyToOne('Comment')
  @JoinColumn({ name: 'parent_comment_id', referencedColumnName: 'commentId' })
  parentComment: any;

  @Column({ nullable: true })
  parentCommentId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ default: false })
  isDeleted: boolean;
}
