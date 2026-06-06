import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSyncReconcileReceipts1783000000000 implements MigrationInterface {
  name = "CreateSyncReconcileReceipts1783000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const jsonType = sqlite ? "text" : "jsonb";
    const boolType = sqlite ? "integer" : "boolean";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;

    await queryRunner.query(
      `
        CREATE TABLE IF NOT EXISTS "sync_reconcile_receipts" (
          ${idColumn},
          "docId" varchar NOT NULL,
          "clientBatchId" varchar(120) NOT NULL,
          "requestFingerprint" text NOT NULL,
          "checkedAt" bigint NOT NULL,
          "draftRevision" integer NOT NULL,
          "needsReload" ${boolType} NOT NULL DEFAULT ${sqlite ? 0 : "false"},
          "conflicts" ${jsonType} NOT NULL,
          "tombstoned" ${jsonType} NOT NULL,
          "createdBy" varchar NOT NULL,
          "createdAt" bigint NOT NULL,
          "updatedAt" bigint NOT NULL,
          CONSTRAINT "UQ_sync_reconcile_receipts_doc_clientBatchId" UNIQUE ("docId", "clientBatchId")
        )
      `,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_reconcile_receipts_docId" ON "sync_reconcile_receipts" ("docId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_reconcile_receipts_checkedAt" ON "sync_reconcile_receipts" ("checkedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_sync_reconcile_receipts_checkedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_sync_reconcile_receipts_docId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_reconcile_receipts"`);
  }
}
