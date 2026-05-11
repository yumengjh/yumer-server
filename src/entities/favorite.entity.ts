import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

@Entity('favorites')
@Index(['userId', 'docId'], { unique: true })
export class Favorite {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  user: any;

  @Column()
  userId: string;

  @ManyToOne('Document', 'favorites')
  @JoinColumn({ name: 'doc_id', referencedColumnName: 'docId' })
  document: any;

  @Column()
  docId: string;

  @CreateDateColumn()
  createdAt: Date;
}
