import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSyncCreateTombstones1782800000000 implements MigrationInterface {
  name = "CreateSyncCreateTombstones1782800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;

    await queryRunner.query(
      `
        CREATE TABLE IF NOT EXISTS "sync_create_tombstones" (
          ${idColumn},
          "docId" varchar NOT NULL,
          "sessionId" varchar(120) NULL,
          "sessionEpoch" integer NULL,
          "clientId" varchar(160) NULL,
          "syncCreateId" varchar(200) NULL,
          "deleteClientBatchId" varchar(120) NOT NULL,
          "deletedAt" bigint NOT NULL,
          "expiresAt" bigint NOT NULL,
          "createdBy" varchar NOT NULL
        )
      `,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_create_tombstones_doc_syncCreateId" ON "sync_create_tombstones" ("docId", "syncCreateId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_create_tombstones_doc_clientId" ON "sync_create_tombstones" ("docId", "clientId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_create_tombstones_expiresAt" ON "sync_create_tombstones" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sync_create_tombstones_expiresAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sync_create_tombstones_doc_clientId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sync_create_tombstones_doc_syncCreateId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_create_tombstones"`);
  }
}
