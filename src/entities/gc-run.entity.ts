// cspell:words timestamptz
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import { isSqlite } from "../common/db-type";

export type GcResourceType = "block_version" | "block_render_cache";
export type GcRunMode = "preview" | "sweep";
export type GcRunStatus = "running" | "completed" | "blocked" | "failed";

@Entity("gc_runs")
@Index(["runId"], { unique: true })
@Index(["resourceType", "createdAt"])
@Index(["status", "createdAt"])
export class GcRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 80 })
  runId: string;

  @Column({ type: "varchar", length: 40 })
  resourceType: GcResourceType;

  @Column({ type: "varchar", length: 20, default: "preview" })
  mode: GcRunMode;

  @Column({ type: "varchar", length: 20 })
  status: GcRunStatus;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  scope: Record<string, unknown>;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  policySnapshot: Record<string, unknown>;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  health: Record<string, unknown>;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'{}'" : "'{}'"),
  })
  summary: Record<string, unknown>;

  @Column({ default: false })
  candidateDetailsStored: boolean;

  @Column({ default: false })
  candidateDetailsTruncated: boolean;

  @Column({ type: "varchar", length: 80, nullable: true })
  triggeredBy: string | null;

  @Column({
    type: isSqlite() ? "datetime" : "timestamptz",
  })
  startedAt: Date;

  @Column({
    type: isSqlite() ? "datetime" : "timestamptz",
    nullable: true,
  })
  finishedAt: Date | null;

  @Column({ type: "text", nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({
    type: isSqlite() ? "datetime" : "timestamptz",
  })
  createdAt: Date;
}
