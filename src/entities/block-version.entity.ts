import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { isSqlite } from '../common/db-type';

export type BlockVersionPayloadKind = 'full' | 'delta';

@Entity('block_versions')
@Index(['blockId', 'ver'])
@Index(['docId'])
export class BlockVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  versionId: string;

  @Column()
  docId: string;

  @ManyToOne('Block', 'versions')
  @JoinColumn({ name: 'block_id', referencedColumnName: 'blockId' })
  block: any;

  @Column()
  blockId: string;

  @Column()
  ver: number;

  @Column({ type: 'bigint' })
  createdAt: number;

  @Column()
  createdBy: string;

  @Column()
  parentId: string;

  @Column()
  sortKey: string;

  @Column({ default: 0 })
  indent: number;

  @Column({ default: false })
  collapsed: boolean;

  @Column({ type: 'varchar', length: 16, default: 'full' })
  payloadKind: BlockVersionPayloadKind;

  @Column({ type: 'integer', nullable: true })
  baseVer: number | null;

  @Column({ type: 'text', nullable: true })
  delta: string | null;

  @Column({ type: isSqlite() ? 'simple-json' : 'jsonb', nullable: true })
  payload: object | null;

  @Column()
  hash: string;

  @Column({ type: 'text', nullable: true })
  plainText: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'[]'" : "'[]'"),
  })
  refs: object[];

  @Column({ type: isSqlite() ? 'simple-json' : 'tsvector', nullable: true })
  searchVector: any;
}
