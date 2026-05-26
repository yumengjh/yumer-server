import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { isSqlite } from "../common/db-type";

@Entity("document_drafts")
@Index(["docId"], { unique: true })
export class DocDraft {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  draftId: string;

  @ManyToOne("Document")
  @JoinColumn({ name: "doc_id", referencedColumnName: "docId" })
  document: unknown;

  @Column()
  docId: string;

  @Column()
  workspaceId: string;

  @Column()
  rootBlockId: string;

  @Column()
  baseDocVer: number;

  @Column({ type: "varchar", nullable: true, length: 150 })
  baseSnapshotId: string | null;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  blockVersionMap: Record<string, number>;

  @Column({ default: 0 })
  changedBlocksCount: number;

  @Column()
  createdBy: string;

  @Column()
  updatedBy: string;

  @Column({ type: "bigint" })
  createdAt: number;

  @Column({ type: "bigint" })
  updatedAt: number;

  @Column({ type: "varchar", nullable: true })
  lockOwnerUserId: string | null;

  @Column({ type: "bigint", nullable: true })
  lockAcquiredAt: number | null;

  @Column({ type: "bigint", nullable: true })
  lockHeartbeatAt: number | null;

  @Column({ type: "bigint", nullable: true })
  lockExpiresAt: number | null;

  @Column({ type: "varchar", nullable: true, length: 100 })
  lockToken: string | null;
}
