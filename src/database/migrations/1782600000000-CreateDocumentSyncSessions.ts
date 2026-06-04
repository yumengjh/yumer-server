import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDocumentSyncSessions1782600000000 implements MigrationInterface {
  name = "CreateDocumentSyncSessions1782600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;

    await queryRunner.query(
      `
        CREATE TABLE IF NOT EXISTS "document_sync_sessions" (
          ${idColumn},
          "docId" varchar NOT NULL,
          "sessionId" varchar(120) NOT NULL,
          "sessionEpoch" integer NOT NULL,
          "holderUserId" varchar NOT NULL,
          "leaseExpiresAt" bigint NOT NULL,
          "lastAckedOpSeq" bigint,
          "createdAt" bigint NOT NULL,
          "updatedAt" bigint NOT NULL,
          CONSTRAINT "UQ_document_sync_sessions_docId" UNIQUE ("docId")
        )
      `,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_sync_sessions_docId" ON "document_sync_sessions" ("docId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_sync_sessions_leaseExpiresAt" ON "document_sync_sessions" ("leaseExpiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_document_sync_sessions_leaseExpiresAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_document_sync_sessions_docId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_sync_sessions"`);
  }
}
