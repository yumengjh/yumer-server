import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { isSqlite } from "../common/db-type";

@Entity("sync_checkpoint_receipts")
@Index(["docId", "clientCheckpointId"], { unique: true })
export class SyncCheckpointReceipt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  docId: string;

  @Column({ length: 120 })
  clientCheckpointId: string;

  @Column({ type: "text" })
  requestFingerprint: string;

  @Column({ length: 120 })
  acceptedCheckpointId: string;

  @Column({ type: "bigint" })
  appliedAt: number;

  @Column()
  serverHead: number;

  @Column()
  draftRevision: number;

  @Column({ default: false })
  needsReload: boolean;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  conflicts: Array<Record<string, unknown>>;

  @Column({ type: "text" })
  contentHash: string;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  mappings: Array<Record<string, unknown>>;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  tombstoned: Array<Record<string, unknown>>;

  @Column()
  createdBy: string;

  @Column({ type: "bigint" })
  createdAt: number;

  @Column({ type: "bigint" })
  updatedAt: number;
}
