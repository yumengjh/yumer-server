import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('activities')
@Index(['workspaceId', 'createdAt'])
@Index(['userId', 'createdAt'])
export class Activity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  activityId: string;

  @ManyToOne('Workspace', 'activities')
  @JoinColumn({ name: 'workspace_id', referencedColumnName: 'workspaceId' })
  workspace: any;

  @Column()
  workspaceId: string;

  @Column()
  action: string;

  @Column()
  entityType: string;

  @Column()
  entityId: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  user: any;

  @Column()
  userId: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  details: object;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  metadata: object;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;
}
