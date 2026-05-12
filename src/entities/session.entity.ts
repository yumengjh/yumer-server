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

@Entity('sessions')
@Index(['sessionId'])
@Index(['userId'])
@Index(['expiresAt'])
export class Session {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  sessionId: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  user: any;

  @Column()
  userId: string;

  @Column({ type: 'text' })
  token: string;

  @Column({ type: 'text' })
  refreshToken: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  expiresAt: Date;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  lastActivityAt: Date;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  deviceInfo: object;
}
