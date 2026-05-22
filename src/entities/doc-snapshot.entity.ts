import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { isSqlite } from "../common/db-type";

@Entity("doc_snapshots")
@Index(["docId", "docVer"])
export class DocSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 150 })
  snapshotId: string;

  @ManyToOne("Document")
  @JoinColumn({ name: "doc_id", referencedColumnName: "docId" })
  document: any;

  @Column()
  docId: string;

  @Column()
  docVer: number;

  @Column({ type: "bigint" })
  createdAt: number;

  @Column()
  rootBlockId: string;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  blockVersionMap: object;

  @Column({ default: "revision" })
  kind: string;

  @Column({ default: false })
  pinned: boolean;

  @Column({ type: "bigint", nullable: true })
  retainUntil: number | null;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  metadata: object;
}
