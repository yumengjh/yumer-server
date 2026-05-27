import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGcTables1782200000000 implements MigrationInterface {
  name = "CreateGcTables1782200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;
    const jsonType = sqlite ? "text" : "jsonb";
    const dateType = sqlite ? "datetime" : "timestamptz";
    const jsonDefault = sqlite ? "'{}'" : "'{}'::jsonb";

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gc_runs" (
        ${idColumn},
        "runId" varchar(80) NOT NULL,
        "resourceType" varchar(40) NOT NULL,
        "mode" varchar(20) NOT NULL DEFAULT 'preview',
        "status" varchar(20) NOT NULL,
        "scope" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "policySnapshot" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "health" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "summary" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "candidateDetailsStored" boolean NOT NULL DEFAULT false,
        "candidateDetailsTruncated" boolean NOT NULL DEFAULT false,
        "triggeredBy" varchar(80),
        "startedAt" ${dateType} NOT NULL,
        "finishedAt" ${dateType},
        "errorMessage" text,
        "createdAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_gc_runs_runId" UNIQUE ("runId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gc_run_candidates" (
        ${idColumn},
        "runId" varchar(80) NOT NULL,
        "resourceType" varchar(40) NOT NULL,
        "resourceKey" varchar(120) NOT NULL,
        "resourceRowId" integer NOT NULL,
        "docId" varchar,
        "workspaceId" varchar,
        "blockId" varchar NOT NULL,
        "blockVer" integer NOT NULL,
        "versionCreatedAt" bigint NOT NULL,
        "reasonCode" varchar(80) NOT NULL,
        "reasonDetail" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "riskLevel" varchar(20) NOT NULL DEFAULT 'medium',
        "createdAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_runs_resource_created" ON "gc_runs" ("resourceType", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_runs_status_created" ON "gc_runs" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_run_candidates_runId" ON "gc_run_candidates" ("runId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_run_candidates_resource" ON "gc_run_candidates" ("resourceType", "resourceKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_run_candidates_workspaceId" ON "gc_run_candidates" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_run_candidates_docId" ON "gc_run_candidates" ("docId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_run_candidates_docId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_run_candidates_workspaceId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_run_candidates_resource"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_run_candidates_runId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_runs_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_runs_resource_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gc_run_candidates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gc_runs"`);
  }
}
