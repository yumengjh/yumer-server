import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDocumentDrafts1781200000000 implements MigrationInterface {
  name = "CreateDocumentDrafts1781200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const jsonType = sqlite ? "text" : "jsonb";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;

    await queryRunner.query(
      `
        CREATE TABLE IF NOT EXISTS "document_drafts" (
          ${idColumn},
          "draftId" varchar(100) NOT NULL,
          "docId" varchar NOT NULL,
          "workspaceId" varchar NOT NULL,
          "rootBlockId" varchar NOT NULL,
          "baseDocVer" integer NOT NULL,
          "baseSnapshotId" varchar(150),
          "blockVersionMap" ${jsonType} NOT NULL,
          "changedBlocksCount" integer NOT NULL DEFAULT (0),
          "createdBy" varchar NOT NULL,
          "updatedBy" varchar NOT NULL,
          "createdAt" bigint NOT NULL,
          "updatedAt" bigint NOT NULL,
          "lockOwnerUserId" varchar,
          "lockAcquiredAt" bigint,
          "lockHeartbeatAt" bigint,
          "lockExpiresAt" bigint,
          "lockToken" varchar(100),
          CONSTRAINT "UQ_document_drafts_draftId" UNIQUE ("draftId"),
          CONSTRAINT "UQ_document_drafts_docId" UNIQUE ("docId")
        )
      `,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_drafts_workspaceId" ON "document_drafts" ("workspaceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_drafts_updatedAt" ON "document_drafts" ("updatedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_document_drafts_updatedAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_document_drafts_workspaceId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_drafts"`);
  }
}
