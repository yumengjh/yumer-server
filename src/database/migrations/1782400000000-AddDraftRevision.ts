import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDraftRevision1782400000000 implements MigrationInterface {
  name = "AddDraftRevision1782400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "draftRevision" integer NOT NULL DEFAULT (0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "draftRevision"`);
  }
}
