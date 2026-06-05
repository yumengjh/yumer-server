import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSyncCheckpointReceipts1782900000000 implements MigrationInterface {
  name = "CreateSyncCheckpointReceipts1782900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const jsonType = sqlite ? "text" : "jsonb";
    const boolType = sqlite ? "integer" : "boolean";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;

    await queryRunner.query(
      `
        CREATE TABLE IF NOT EXISTS "sync_checkpoint_receipts" (
          ${idColumn},
          "docId" varchar NOT NULL,
          "clientCheckpointId" varchar(120) NOT NULL,
          "requestFingerprint" text NOT NULL,
          "acceptedCheckpointId" varchar(120) NOT NULL,
          "appliedAt" bigint NOT NULL,
          "serverHead" integer NOT NULL,
          "draftRevision" integer NOT NULL,
          "needsReload" ${boolType} NOT NULL DEFAULT ${sqlite ? 0 : "false"},
          "conflicts" ${jsonType} NOT NULL,
          "contentHash" text NOT NULL,
          "mappings" ${jsonType} NOT NULL,
          "tombstoned" ${jsonType} NOT NULL,
          "createdBy" varchar NOT NULL,
          "createdAt" bigint NOT NULL,
          "updatedAt" bigint NOT NULL,
          CONSTRAINT "UQ_sync_checkpoint_receipts_doc_clientCheckpointId" UNIQUE ("docId", "clientCheckpointId")
        )
      `,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_checkpoint_receipts_docId" ON "sync_checkpoint_receipts" ("docId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_checkpoint_receipts_appliedAt" ON "sync_checkpoint_receipts" ("appliedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sync_checkpoint_receipts_appliedAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sync_checkpoint_receipts_docId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_checkpoint_receipts"`);
  }
}
