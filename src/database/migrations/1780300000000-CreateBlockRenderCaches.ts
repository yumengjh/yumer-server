import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateBlockRenderCaches1780300000000 implements MigrationInterface {
  name = "CreateBlockRenderCaches1780300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("block_render_caches")) {
      return;
    }

    const isSqlite = queryRunner.connection.options.type === "better-sqlite3";
    await queryRunner.createTable(
      new Table({
        name: "block_render_caches",
        columns: [
          {
            name: "id",
            type: isSqlite ? "integer" : "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          { name: "blockVersionId", type: "int" },
          { name: "docId", type: "varchar" },
          { name: "blockId", type: "varchar" },
          { name: "blockVer", type: "int" },
          { name: "renderVersion", type: "varchar", length: "80" },
          { name: "html", type: "text", isNullable: true },
          { name: "status", type: "varchar", default: "'success'" },
          { name: "error", type: "text", isNullable: true },
          { name: "renderedAt", type: "bigint" },
          {
            name: "createdAt",
            type: isSqlite ? "datetime" : "timestamp",
            default: isSqlite ? "CURRENT_TIMESTAMP" : "now()",
          },
          {
            name: "updatedAt",
            type: isSqlite ? "datetime" : "timestamp",
            default: isSqlite ? "CURRENT_TIMESTAMP" : "now()",
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      "block_render_caches",
      new TableIndex({
        name: "IDX_block_render_caches_block_version_render_version",
        columnNames: ["blockVersionId", "renderVersion"],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      "block_render_caches",
      new TableIndex({
        name: "IDX_block_render_caches_doc_id",
        columnNames: ["docId"],
      }),
    );
    await queryRunner.createIndex(
      "block_render_caches",
      new TableIndex({
        name: "IDX_block_render_caches_block_id_ver",
        columnNames: ["blockId", "blockVer"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("block_render_caches")) {
      await queryRunner.dropTable("block_render_caches");
    }
  }
}
