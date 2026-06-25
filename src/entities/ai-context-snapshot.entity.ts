import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";
import { isSqlite } from "../common/db-type";
import type { AiPromptMessage } from "../modules/ai/types/ai-message-role";

@Entity("ai_context_snapshots")
@Index(["conversationId", "createdAt"])
@Index(["userId", "createdAt"])
export class AiContextSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 64 })
  snapshotId: string;

  @Column({ length: 64 })
  conversationId: string;

  @Column({ length: 64 })
  requestMessageId: string;

  @Column({ length: 64 })
  userId: string;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  messages: AiPromptMessage[];

  @Column({ length: 100 })
  model: string;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
