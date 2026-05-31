// cspell:words freelist
import { BadRequestException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { GcStorageMaintenanceService } from "./gc-storage-maintenance.service";

function createSqliteDataSource(query: jest.Mock): DataSource {
  return {
    options: {
      type: "better-sqlite3",
      database: ":memory:",
    },
    query,
  } as unknown as DataSource;
}

function mockPragmaQuery(overrides: Record<string, unknown> = {}) {
  return jest.fn(async (sql: string) => {
    const pragma = sql.replace(/^PRAGMA\s+/i, "").trim();
    const values: Record<string, unknown> = {
      page_size: 4096,
      page_count: 100,
      freelist_count: 25,
      journal_mode: "wal",
      auto_vacuum: 0,
      busy_timeout: 5000,
      ...overrides,
    };

    if (pragma === "VACUUM") return [];
    return [{ [pragma]: values[pragma] }];
  });
}

describe("GcStorageMaintenanceService", () => {
  it("plans SQLite VACUUM without executing it by default", async () => {
    const query = mockPragmaQuery();
    const service = new GcStorageMaintenanceService(createSqliteDataSource(query));

    const result = await service.compact({}, "admin_1");

    expect(result).toMatchObject({
      driver: "sqlite",
      dryRun: true,
      mode: "vacuum",
      status: "planned",
      supported: true,
      wouldRun: true,
      triggeredBy: "admin_1",
      before: {
        pageSize: 4096,
        pageCount: 100,
        freelistCount: 25,
        estimatedFreeBytes: 102400,
        freeRatio: 0.25,
        journalMode: "wal",
      },
    });
    expect(query).not.toHaveBeenCalledWith("VACUUM");
  });

  it("runs SQLite VACUUM only after explicit confirmation", async () => {
    const query = mockPragmaQuery();
    const service = new GcStorageMaintenanceService(createSqliteDataSource(query));

    const result = await service.compact(
      { dryRun: false, mode: "vacuum", confirm: "VACUUM_SQLITE_DATABASE" },
      "admin_2",
    );

    expect(result).toMatchObject({
      driver: "sqlite",
      dryRun: false,
      mode: "vacuum",
      status: "completed",
      supported: true,
      triggeredBy: "admin_2",
    });
    expect(query).toHaveBeenCalledWith("VACUUM");
  });

  it("rejects SQLite VACUUM without confirmation", async () => {
    const query = mockPragmaQuery();
    const service = new GcStorageMaintenanceService(createSqliteDataSource(query));

    await expect(service.compact({ dryRun: false, mode: "vacuum" }, "admin_3")).rejects.toThrow(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalledWith("VACUUM");
  });

  it("returns unsupported for Postgres compaction", async () => {
    const service = new GcStorageMaintenanceService({
      options: {
        type: "postgres",
      },
      query: jest.fn(),
    } as unknown as DataSource);

    await expect(service.compact({ dryRun: false }, "admin_4")).resolves.toMatchObject({
      driver: "postgres",
      dryRun: false,
      status: "unsupported",
      reason: "postgres_storage_maintenance_managed_by_database",
    });
  });
});
