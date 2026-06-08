import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

export class AddDocumentLifecycleFields1783100000000
  implements MigrationInterface
{
  name = "AddDocumentLifecycleFields1783100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isSqlite = queryRunner.connection.options.type === "better-sqlite3";
    const dateType = isSqlite ? "datetime" : "timestamp";

    await queryRunner.addColumns("documents", [
      new TableColumn({
        name: "deletedFromStatus",
        type: "varchar",
        isNullable: true,
      }),
      new TableColumn({
        name: "deletedAt",
        type: dateType,
        isNullable: true,
      }),
      new TableColumn({
        name: "deletedBy",
        type: "varchar",
        isNullable: true,
      }),
      new TableColumn({
        name: "restoredAt",
        type: dateType,
        isNullable: true,
      }),
      new TableColumn({
        name: "restoredBy",
        type: "varchar",
        isNullable: true,
      }),
    ]);

    await queryRunner.createIndex(
      "documents",
      new TableIndex({
        name: "IDX_documents_workspace_status_deleted_at",
        columnNames: ["workspaceId", "status", "deletedAt"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      "documents",
      "IDX_documents_workspace_status_deleted_at",
    );
    await queryRunner.dropColumns("documents", [
      "restoredBy",
      "restoredAt",
      "deletedBy",
      "deletedAt",
      "deletedFromStatus",
    ]);
  }
}
