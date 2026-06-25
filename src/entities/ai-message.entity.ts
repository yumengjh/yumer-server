import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";
import { isSqlite } from "../common/db-type";

@Entity("ai_messages")
@Index(["conversationId", "createdAt"])
@Index(["userId", "createdAt"])
export class AiMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 64 })
  messageId: string;

  @Column({ length: 64 })
  conversationId: string;

  @Column({ length: 64 })
  userId: string;

  @Column({ length: 20 })
  role: "system" | "user" | "assistant";

  @Column({ type: "text" })
  content: string;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
