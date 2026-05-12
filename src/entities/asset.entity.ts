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

@Entity('assets')
@Index(['workspaceId'])
export class Asset {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  assetId: string;

  @ManyToOne('Workspace', 'assets')
  @JoinColumn({ name: 'workspace_id', referencedColumnName: 'workspaceId' })
  workspace: any;

  @Column()
  workspaceId: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'uploaded_by', referencedColumnName: 'userId' })
  uploadedByUser: any;

  @Column()
  uploadedBy: string;

  @Column()
  filename: string;

  @Column()
  mimeType: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column()
  storageProvider: string;

  @Column()
  storagePath: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  width: number;

  @Column({ nullable: true })
  height: number;

  @Column({ nullable: true })
  thumbnail: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: 'active' })
  status: string;

  @Column({ default: 0 })
  refCount: number;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'[]'" : "'[]'"),
  })
  refs: object[];
}
