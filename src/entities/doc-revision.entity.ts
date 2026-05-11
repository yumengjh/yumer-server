import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('doc_revisions')
@Index(['docId', 'docVer'])
@Index(['createdAt'])
export class DocRevision {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  revisionId: string;

  @ManyToOne('Document', 'revisions')
  @JoinColumn({ name: 'doc_id', referencedColumnName: 'docId' })
  document: any;

  @Column()
  docId: string;

  @Column()
  docVer: number;

  @Column({ type: 'bigint' })
  createdAt: number;

  @ManyToOne('User')
  @JoinColumn({ name: 'created_by', referencedColumnName: 'userId' })
  createdByUser: any;

  @Column()
  createdBy: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ default: 'draft' })
  branch: string;

  @Column({ type: isSqlite() ? 'simple-json' : 'jsonb' })
  patches: object[];

  @Column()
  rootBlockId: string;

  @Column({ default: 'editor' })
  source: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  opSummary: object;
}
