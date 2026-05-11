import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('audit_logs')
@Index(['timestamp'])
@Index(['userId', 'timestamp'])
@Index(['resourceType', 'resourceId'])
@Index(['action'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  logId: string;

  @CreateDateColumn()
  timestamp: Date;

  @Column({ nullable: true, length: 50 })
  userId: string;

  @Column({ nullable: true, length: 50 })
  username: string;

  @Column({ length: 50 })
  action: string;

  @Column({ length: 50 })
  resourceType: string;

  @Column({ length: 50 })
  resourceId: string;

  @Column({ type: isSqlite() ? 'simple-json' : 'jsonb', nullable: true })
  changes: object;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  metadata: object;

  @Column({ nullable: true, length: 45 })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @Column({ nullable: true, length: 50 })
  requestId: string;

  @Column({ nullable: true, length: 20 })
  status: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;
}
