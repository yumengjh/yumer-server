import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  userId: string;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ nullable: true, length: 100 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ default: 'active' })
  status: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  settings: object;

  // 关联
  @OneToMany('Workspace', 'owner')
  ownedWorkspaces: any[];

  @OneToMany('WorkspaceMember', 'user')
  workspaceMembers: any[];
}
