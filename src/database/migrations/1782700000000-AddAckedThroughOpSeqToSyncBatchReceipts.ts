import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAckedThroughOpSeqToSyncBatchReceipts1782700000000
  implements MigrationInterface
{
  name = "AddAckedThroughOpSeqToSyncBatchReceipts1782700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable("sync_batch_receipts"))) return;
    if (await queryRunner.hasColumn("sync_batch_receipts", "ackedThroughOpSeq")) return;
    await queryRunner.query(
      `ALTER TABLE "sync_batch_receipts" ADD COLUMN "ackedThroughOpSeq" bigint NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable("sync_batch_receipts"))) return;
    if (!(await queryRunner.hasColumn("sync_batch_receipts", "ackedThroughOpSeq"))) return;
    await queryRunner.query(
      `ALTER TABLE "sync_batch_receipts" DROP COLUMN "ackedThroughOpSeq"`,
    );
  }
}
