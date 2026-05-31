// cspell:words timestamptz
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { isSqlite } from "../common/db-type";
import type { GcCandidateRiskLevel } from "./gc-run-candidate.entity";
import type { GcResourceType } from "./gc-run.entity";

export type GcCandidatePoolState =
  | "pending"
  | "eligible"
  | "sweeping"
  | "swept"
  | "resurrected"
  | "blocked";

@Entity("gc_candidate_pool")
@Index(["candidateKey"], { unique: true })
@Index(["state", "action", "lastSeenAt"])
@Index(["workspaceId", "state"])
@Index(["docId", "state"])
@Index(["resourceType", "resourceKey"])
export class GcCandidatePool {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 180 })
  candidateKey: string;

  @Column({ type: "varchar", length: 40 })
  resourceType: GcResourceType;

  @Column({ type: "varchar", length: 40 })
  action: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  source: string | null;

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
  firstSeenRunId: string;

  @Column({ length: 80 })
  lastSeenRunId: string;

  @Column({
    type: isSqlite() ? "datetime" : "timestamptz",
  })
  firstSeenAt: Date;

  @Column({
    type: isSqlite() ? "datetime" : "timestamptz",
  })
  lastSeenAt: Date;

  @Column({ default: 1 })
  seenCount: number;

  @Column({ default: 1 })
  stableSeenCount: number;

  @Column({ type: "varchar", length: 20, default: "pending" })
  state: GcCandidatePoolState;

  @Column({
    type: isSqlite() ? "datetime" : "timestamptz",
    nullable: true,
  })
  eligibleAfter: Date | null;

  @Column({
    type: isSqlite() ? "datetime" : "timestamptz",
    nullable: true,
  })
  lastSweepAt: Date | null;

  @Column({
    type: isSqlite() ? "datetime" : "timestamptz",
    nullable: true,
  })
  lastValidationAt: Date | null;

  @Column({ length: 80 })
  reasonCode: string;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  reasonDetail: Record<string, unknown>;

  @Column({ type: "varchar", length: 20, default: "medium" })
  riskLevel: GcCandidateRiskLevel;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  policySnapshot: Record<string, unknown>;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'[]'" : "'[]'"),
  })
  lastBlockers: string[];

  @CreateDateColumn({
    type: isSqlite() ? "datetime" : "timestamptz",
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: isSqlite() ? "datetime" : "timestamptz",
  })
  updatedAt: Date;
}
