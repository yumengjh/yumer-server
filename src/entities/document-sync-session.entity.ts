import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("document_sync_sessions")
@Index(["docId"], { unique: true })
export class DocumentSyncSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  docId: string;

  @Column({ length: 120 })
  sessionId: string;

  @Column()
  sessionEpoch: number;

  @Column()
  holderUserId: string;

  @Column({ type: "bigint" })
  leaseExpiresAt: number;

  @Column({ type: "bigint", nullable: true })
  lastAckedOpSeq: number | null;

  @Column({ type: "bigint" })
  createdAt: number;

  @Column({ type: "bigint" })
  updatedAt: number;
}
