import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { isSqlite } from "../common/db-type";

@Entity("ai_conversations")
@Index(["userId", "updatedAt"])
@Index(["userId", "workspaceId", "updatedAt"])
export class AiConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 64 })
  conversationId: string;

  @Column({ length: 64 })
  userId: string;

  @Column({ type: "varchar", nullable: true })
  workspaceId: string | null;

  @Column({ length: 200 })
  title: string;

  @Column({ default: "active", length: 32 })
  status: string;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
