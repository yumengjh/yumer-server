// cspell:words freelist
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { stat } from "fs/promises";
import { resolve } from "path";
import { DataSource } from "typeorm";

export type CreateStorageCompactInput = {
  dryRun?: boolean;
  mode?: "vacuum";
  confirm?: string;
};

type SqliteStorageStats = {
  databasePath: string | null;
  databaseFileBytes: number;
  walFileBytes: number;
  shmFileBytes: number;
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  estimatedFreeBytes: number;
  freeRatio: number;
  journalMode: string | null;
  autoVacuum: number | string | null;
  busyTimeoutMs: number | null;
  totalFileBytes: number;
};

@Injectable()
export class GcStorageMaintenanceService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async compact(input: CreateStorageCompactInput, triggeredBy: string) {
    const driver = this.resolveDriver();
    const dryRun = input.dryRun !== false;
    const mode = input.mode ?? "vacuum";

    if (driver !== "sqlite") {
      return {
        driver,
        dryRun,
        mode,
        status: "unsupported",
        triggeredBy,
        reason: "postgres_storage_maintenance_managed_by_database",
      };
    }

    if (mode !== "vacuum") {
      throw new BadRequestException(`Unsupported SQLite storage compact mode: ${mode}`);
    }

    const before = await this.readSqliteStats();
    const warnings = ["vacuum_may_block_writes", "vacuum_requires_temporary_disk_space"];

    if (dryRun) {
      return {
        driver,
        dryRun,
        mode,
        status: "planned",
        supported: true,
        wouldRun: true,
        triggeredBy,
        before,
        warnings,
      };
    }

    if (input.confirm !== "VACUUM_SQLITE_DATABASE") {
      throw new BadRequestException("confirm must be VACUUM_SQLITE_DATABASE to run SQLite VACUUM");
    }

    const startedAt = new Date();
    await this.dataSource.query("VACUUM");
    const checkpoint = await this.truncateWalIfNeeded(before.journalMode);
    const finishedAt = new Date();
    const after = await this.readSqliteStats();
    const delta = this.buildDelta(before, after);

    return {
      driver,
      dryRun,
      mode,
      status: "completed",
      supported: true,
      triggeredBy,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      before,
      after,
      delta,
      checkpoint,
      unchangedReasons: this.describeUnchangedReasons(before, after, checkpoint),
      warnings,
    };
  }

  private resolveDriver(): "sqlite" | "postgres" {
    return this.dataSource.options.type === "better-sqlite3" ||
      this.dataSource.options.type === "sqlite"
      ? "sqlite"
      : "postgres";
  }

  private async readSqliteStats(): Promise<SqliteStorageStats> {
    const databasePath = this.resolveSqliteDatabasePath();
    const pageSize = await this.readNumericPragma("page_size");
    const pageCount = await this.readNumericPragma("page_count");
    const freelistCount = await this.readNumericPragma("freelist_count");
    const journalMode = await this.readStringPragma("journal_mode");
    const autoVacuum = this.normalizePragmaScalar(await this.readAnyPragma("auto_vacuum"));
    const busyTimeoutMs = await this.readNumericPragma("busy_timeout");
    const estimatedFreeBytes = pageSize * freelistCount;
    const databaseFileBytes = await this.statFileBytes(databasePath);
    const walFileBytes = await this.statFileBytes(databasePath ? `${databasePath}-wal` : null);
    const shmFileBytes = await this.statFileBytes(databasePath ? `${databasePath}-shm` : null);

    return {
      databasePath,
      databaseFileBytes,
      walFileBytes,
      shmFileBytes,
      pageSize,
      pageCount,
      freelistCount,
      estimatedFreeBytes,
      freeRatio: pageCount > 0 ? freelistCount / pageCount : 0,
      journalMode,
      autoVacuum,
      busyTimeoutMs,
      totalFileBytes: databaseFileBytes + walFileBytes + shmFileBytes,
    };
  }

  private async truncateWalIfNeeded(journalMode: string | null) {
    if (journalMode?.toLowerCase() !== "wal") {
      return {
        attempted: false,
        reason: "journal_mode_not_wal",
      };
    }

    const rows = (await this.dataSource.query("PRAGMA wal_checkpoint(TRUNCATE)")) as Array<
      Record<string, unknown>
    >;
    const first = rows[0] ?? {};

    return {
      attempted: true,
      result: first,
    };
  }

  private buildDelta(before: SqliteStorageStats, after: SqliteStorageStats) {
    return {
      databaseFileBytes: after.databaseFileBytes - before.databaseFileBytes,
      walFileBytes: after.walFileBytes - before.walFileBytes,
      shmFileBytes: after.shmFileBytes - before.shmFileBytes,
      totalFileBytes: after.totalFileBytes - before.totalFileBytes,
      pageCount: after.pageCount - before.pageCount,
      freelistCount: after.freelistCount - before.freelistCount,
      estimatedFreeBytes: after.estimatedFreeBytes - before.estimatedFreeBytes,
    };
  }

  private describeUnchangedReasons(
    before: SqliteStorageStats,
    after: SqliteStorageStats,
    checkpoint: { attempted: boolean; reason?: string },
  ): string[] {
    if (before.totalFileBytes !== after.totalFileBytes) {
      return [];
    }

    const reasons = ["total_file_bytes_unchanged"];

    if (before.freelistCount === 0) {
      reasons.push("no_freelist_pages_before_vacuum");
    }

    if (!checkpoint.attempted) {
      reasons.push(checkpoint.reason ?? "wal_checkpoint_not_attempted");
    }

    return reasons;
  }

  private resolveSqliteDatabasePath(): string | null {
    const database = this.dataSource.options.database;
    if (typeof database !== "string" || database === ":memory:") {
      return null;
    }

    return resolve(database);
  }

  private async readNumericPragma(name: string): Promise<number> {
    const value = await this.readAnyPragma(name);
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value) || 0;
    return 0;
  }

  private async readStringPragma(name: string): Promise<string | null> {
    const value = await this.readAnyPragma(name);
    return typeof value === "string" ? value : value == null ? null : String(value);
  }

  private async readAnyPragma(name: string): Promise<unknown> {
    const rows = (await this.dataSource.query(`PRAGMA ${name}`)) as Array<Record<string, unknown>>;
    const first = rows[0];
    if (!first) return null;

    if (name in first) {
      return first[name];
    }

    return Object.values(first)[0] ?? null;
  }

  private normalizePragmaScalar(value: unknown): string | number | null {
    return typeof value === "string" || typeof value === "number" ? value : null;
  }

  private async statFileBytes(path: string | null): Promise<number> {
    if (!path) return 0;

    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  }
}
