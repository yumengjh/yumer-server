import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sensitive_words')
export class SensitiveWord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  word: string;

  @Column({ length: 100, default: '***' })
  replacement: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
