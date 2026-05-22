import { MigrationInterface, QueryRunner } from "typeorm";

export class StrengthenDocSnapshotsForGc1779400000000 implements MigrationInterface {
  name = "StrengthenDocSnapshotsForGc1779400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isSqlite = queryRunner.connection.options.type === "better-sqlite3";
    const metadataType = isSqlite ? "text" : "jsonb";

    if (!(await queryRunner.hasColumn("documents", "publishedSnapshotId"))) {
      await queryRunner.query(`ALTER TABLE "documents" ADD COLUMN "publishedSnapshotId" varchar`);
    }

    if (!(await queryRunner.hasColumn("doc_snapshots", "kind"))) {
      await queryRunner.query(
        `ALTER TABLE "doc_snapshots" ADD COLUMN "kind" varchar NOT NULL DEFAULT 'revision'`,
      );
    }

    if (!(await queryRunner.hasColumn("doc_snapshots", "pinned"))) {
      await queryRunner.query(
        `ALTER TABLE "doc_snapshots" ADD COLUMN "pinned" boolean NOT NULL DEFAULT false`,
      );
    }

    if (!(await queryRunner.hasColumn("doc_snapshots", "retainUntil"))) {
      await queryRunner.query(`ALTER TABLE "doc_snapshots" ADD COLUMN "retainUntil" bigint`);
    }

    if (!(await queryRunner.hasColumn("doc_snapshots", "metadata"))) {
      await queryRunner.query(
        `ALTER TABLE "doc_snapshots" ADD COLUMN "metadata" ${metadataType} NOT NULL DEFAULT '{}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn("doc_snapshots", "metadata")) {
      await queryRunner.query(`ALTER TABLE "doc_snapshots" DROP COLUMN "metadata"`);
    }
    if (await queryRunner.hasColumn("doc_snapshots", "retainUntil")) {
      await queryRunner.query(`ALTER TABLE "doc_snapshots" DROP COLUMN "retainUntil"`);
    }
    if (await queryRunner.hasColumn("doc_snapshots", "pinned")) {
      await queryRunner.query(`ALTER TABLE "doc_snapshots" DROP COLUMN "pinned"`);
    }
    if (await queryRunner.hasColumn("doc_snapshots", "kind")) {
      await queryRunner.query(`ALTER TABLE "doc_snapshots" DROP COLUMN "kind"`);
    }
    if (await queryRunner.hasColumn("documents", "publishedSnapshotId")) {
      await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "publishedSnapshotId"`);
    }
  }
}
