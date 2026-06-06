import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { isSqlite } from "../common/db-type";

@Entity("sync_reconcile_receipts")
@Index(["docId", "clientBatchId"], { unique: true })
export class SyncReconcileReceipt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  docId: string;

  @Column({ length: 120 })
  clientBatchId: string;

  @Column({ type: "text" })
  requestFingerprint: string;

  @Column({ type: "bigint" })
  checkedAt: number;

  @Column()
  draftRevision: number;

  @Column({ default: false })
  needsReload: boolean;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  conflicts: Array<Record<string, unknown>>;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  tombstoned: Array<Record<string, unknown>>;

  @Column()
  createdBy: string;

  @Column({ type: "bigint" })
  createdAt: number;

  @Column({ type: "bigint" })
  updatedAt: number;
}
