// cspell:words AUTOINCREMENT timestamptz
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGcCandidatePool1782300000000 implements MigrationInterface {
  name = "CreateGcCandidatePool1782300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;
    const jsonType = sqlite ? "text" : "jsonb";
    const dateType = sqlite ? "datetime" : "timestamptz";
    const jsonDefault = sqlite ? "'{}'" : "'{}'::jsonb";
    const jsonArrayDefault = sqlite ? "'[]'" : "'[]'::jsonb";

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gc_candidate_pool" (
        ${idColumn},
        "candidateKey" varchar(180) NOT NULL,
        "resourceType" varchar(40) NOT NULL,
        "action" varchar(40) NOT NULL,
        "source" varchar(40),
        "resourceKey" varchar(120) NOT NULL,
        "resourceRowId" integer NOT NULL,
        "docId" varchar,
        "workspaceId" varchar,
        "blockId" varchar NOT NULL,
        "blockVer" integer NOT NULL,
        "versionCreatedAt" bigint NOT NULL,
        "firstSeenRunId" varchar(80) NOT NULL,
        "lastSeenRunId" varchar(80) NOT NULL,
        "firstSeenAt" ${dateType} NOT NULL,
        "lastSeenAt" ${dateType} NOT NULL,
        "seenCount" integer NOT NULL DEFAULT 1,
        "stableSeenCount" integer NOT NULL DEFAULT 1,
        "state" varchar(20) NOT NULL DEFAULT 'pending',
        "eligibleAfter" ${dateType},
        "lastSweepAt" ${dateType},
        "lastValidationAt" ${dateType},
        "reasonCode" varchar(80) NOT NULL,
        "reasonDetail" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "riskLevel" varchar(20) NOT NULL DEFAULT 'medium',
        "policySnapshot" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "lastBlockers" ${jsonType} NOT NULL DEFAULT ${jsonArrayDefault},
        "createdAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_gc_candidate_pool_candidateKey" UNIQUE ("candidateKey")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_candidate_pool_state_action_seen" ON "gc_candidate_pool" ("state", "action", "lastSeenAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_candidate_pool_workspace_state" ON "gc_candidate_pool" ("workspaceId", "state")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_candidate_pool_doc_state" ON "gc_candidate_pool" ("docId", "state")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gc_candidate_pool_resource" ON "gc_candidate_pool" ("resourceType", "resourceKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_candidate_pool_resource"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_candidate_pool_doc_state"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_candidate_pool_workspace_state"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_gc_candidate_pool_state_action_seen"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gc_candidate_pool"`);
  }
}
