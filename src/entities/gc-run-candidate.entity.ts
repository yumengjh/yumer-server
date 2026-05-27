import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { isSqlite } from "../common/db-type";
import type { GcResourceType } from "./gc-run.entity";

export type GcCandidateRiskLevel = "low" | "medium" | "high";

@Entity("gc_run_candidates")
@Index(["runId"])
@Index(["resourceType", "resourceKey"])
@Index(["workspaceId"])
@Index(["docId"])
export class GcRunCandidate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 80 })
  runId: string;

  @Column({ type: "varchar", length: 40 })
  resourceType: GcResourceType;

  @Column({ length: 120 })
  resourceKey: string;

  @Column()
  resourceRowId: number;

  @Column({ type: "varchar", nullable: true })
  docId: string | null;

  @Column({ type: "varchar", nullable: true })
  workspaceId: string | null;

  @Column()
  blockId: string;

  @Column()
  blockVer: number;

  @Column({ type: "bigint" })
  versionCreatedAt: number;

  @Column({ length: 80 })
  reasonCode: string;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  reasonDetail: Record<string, unknown>;

  @Column({ type: "varchar", length: 20, default: "medium" })
  riskLevel: GcCandidateRiskLevel;

  @CreateDateColumn({
    type: isSqlite() ? "datetime" : "timestamptz",
  })
  createdAt: Date;
}
