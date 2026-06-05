import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("sync_create_tombstones")
@Index(["docId", "syncCreateId"])
@Index(["docId", "clientId"])
@Index(["expiresAt"])
export class SyncCreateTombstone {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  docId: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  sessionId: string | null;

  @Column({ type: "integer", nullable: true })
  sessionEpoch: number | null;

  @Column({ type: "varchar", length: 160, nullable: true })
  clientId: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  syncCreateId: string | null;

  @Column({ length: 120 })
  deleteClientBatchId: string;

  @Column({ type: "bigint" })
  deletedAt: number;

  @Column({ type: "bigint" })
  expiresAt: number;

  @Column()
  createdBy: string;
}
