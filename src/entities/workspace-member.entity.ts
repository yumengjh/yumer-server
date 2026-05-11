import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

@Entity('workspace_members')
export class WorkspaceMember {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne('Workspace', 'members')
  @JoinColumn({ name: 'workspace_id', referencedColumnName: 'workspaceId' })
  workspace: any;

  @Column()
  workspaceId: string;

  @ManyToOne('User', 'workspaceMembers')
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  user: any;

  @Column()
  userId: string;

  @Column()
  role: string;

  @CreateDateColumn()
  joinedAt: Date;

  @Column({ nullable: true })
  invitedBy: string;
}
