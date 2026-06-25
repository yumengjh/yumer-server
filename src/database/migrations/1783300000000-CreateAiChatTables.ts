import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAiChatTables1783300000000 implements MigrationInterface {
  name = "CreateAiChatTables1783300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sqlite = queryRunner.connection.options.type === "better-sqlite3";
    const jsonType = sqlite ? "text" : "jsonb";
    const dateType = sqlite ? "datetime" : "timestamp";
    const idColumn = sqlite
      ? `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL`
      : `"id" SERIAL NOT NULL PRIMARY KEY`;
    const jsonDefault = sqlite ? "'{}'" : "'{}'::jsonb";

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_conversations" (
        ${idColumn},
        "conversationId" varchar(64) NOT NULL,
        "userId" varchar(64) NOT NULL,
        "workspaceId" varchar,
        "title" varchar(200) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'active',
        "metadata" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "createdAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_ai_conversations_conversationId" UNIQUE ("conversationId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_user_updated"
      ON "ai_conversations" ("userId", "updatedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_user_workspace_updated"
      ON "ai_conversations" ("userId", "workspaceId", "updatedAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_messages" (
        ${idColumn},
        "messageId" varchar(64) NOT NULL,
        "conversationId" varchar(64) NOT NULL,
        "userId" varchar(64) NOT NULL,
        "role" varchar(20) NOT NULL,
        "content" text NOT NULL,
        "metadata" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "createdAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_ai_messages_messageId" UNIQUE ("messageId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_messages_conversation_created"
      ON "ai_messages" ("conversationId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_messages_user_created"
      ON "ai_messages" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_context_snapshots" (
        ${idColumn},
        "snapshotId" varchar(64) NOT NULL,
        "conversationId" varchar(64) NOT NULL,
        "requestMessageId" varchar(64) NOT NULL,
        "userId" varchar(64) NOT NULL,
        "messages" ${jsonType} NOT NULL,
        "model" varchar(100) NOT NULL,
        "metadata" ${jsonType} NOT NULL DEFAULT ${jsonDefault},
        "createdAt" ${dateType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_ai_context_snapshots_snapshotId" UNIQUE ("snapshotId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_context_snapshots_conversation_created"
      ON "ai_context_snapshots" ("conversationId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_context_snapshots_user_created"
      ON "ai_context_snapshots" ("userId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_context_snapshots_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_context_snapshots_conversation_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_context_snapshots"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_messages_user_created"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_messages_conversation_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_messages"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_user_workspace_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_user_updated"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_conversations"`);
  }
}
