import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddBlockVersionDeltaFields1783200000000
  implements MigrationInterface
{
  name = "AddBlockVersionDeltaFields1783200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns("block_versions", [
      new TableColumn({
        name: "payloadKind",
        type: "varchar",
        length: "16",
        default: "'full'",
      }),
      new TableColumn({
        name: "baseVer",
        type: "integer",
        isNullable: true,
      }),
      new TableColumn({
        name: "delta",
        type: "text",
        isNullable: true,
      }),
    ]);

    await queryRunner.changeColumn(
      "block_versions",
      "payload",
      new TableColumn({
        name: "payload",
        type: queryRunner.connection.options.type === "better-sqlite3" ? "simple-json" : "jsonb",
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      "block_versions",
      "payload",
      new TableColumn({
        name: "payload",
        type: queryRunner.connection.options.type === "better-sqlite3" ? "simple-json" : "jsonb",
        isNullable: false,
      }),
    );

    await queryRunner.dropColumns("block_versions", ["delta", "baseVer", "payloadKind"]);
  }
}
