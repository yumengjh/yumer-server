import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { isSqlite } from '../common/db-type';

export type SettingsScopeType = 'user' | 'workspace';

@Entity('settings_profiles')
@Index(['scopeType'])
@Index(['scopeId'])
@Index(['scopeType', 'scopeId'], { unique: true })
export class SettingsProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'profile_id', unique: true, length: 64 })
  profileId: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 20 })
  scopeType: SettingsScopeType;

  @Column({ name: 'scope_id', length: 64 })
  scopeId: string;

  @Column({
    type: isSqlite() ? 'simple-json' : 'jsonb',
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  settings: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
