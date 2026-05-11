import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { isSqlite } from '../common/db-type';

@Entity('runtime_configs')
export class RuntimeConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'config_key', type: 'varchar', length: 100, unique: true })
  configKey: string;

  @Column({
    name: 'config_value',
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  configValue: Record<string, unknown>;

  @Column({ name: 'updated_by', type: 'varchar', length: 64, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
