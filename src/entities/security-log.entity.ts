import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('security_logs')
@Index(['timestamp'])
@Index(['eventType'])
@Index(['userId'])
@Index(['ipAddress'])
@Index(['severity'])
export class SecurityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  logId: string;

  @CreateDateColumn()
  timestamp: Date;

  @Column({ length: 50 })
  eventType: string;

  @Column({ length: 20 })
  severity: string;

  @Column({ nullable: true, length: 50 })
  userId: string;

  @Column({ nullable: true, length: 100 })
  email: string;

  @Column({ length: 45 })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  details: object;

  @Column({ nullable: true, length: 20 })
  threatLevel: string;

  @Column({ default: false })
  blocked: boolean;
}
