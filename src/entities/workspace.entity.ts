import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  workspaceId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 10, nullable: true })
  icon: string;

  @ManyToOne('User', 'ownedWorkspaces')
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'userId' })
  owner: any;

  @Column()
  ownerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ default: 'active' })
  status: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  settings: object;

  // 关联
  @OneToMany('Document', 'workspace')
  documents: any[];

  @OneToMany('WorkspaceMember', 'workspace')
  members: any[];

  @OneToMany('Asset', 'workspace')
  assets: any[];

  @OneToMany('Tag', 'workspace')
  tags: any[];

  @OneToMany('Activity', 'workspace')
  activities: any[];
}
