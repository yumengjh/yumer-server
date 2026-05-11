import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSettingsProfilesTable1760000000000 implements MigrationInterface {
  name = 'CreateSettingsProfilesTable1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'settings_profiles',
        columns: [
          {
            name: 'id',
            type: 'bigserial',
            isPrimary: true,
          },
          {
            name: 'profile_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'scope_type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'scope_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'settings',
            type: 'jsonb',
            isNullable: false,
            default: "'{}'::jsonb",
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
        ],
        uniques: [
          {
            name: 'UQ_settings_profiles_scope_type_scope_id',
            columnNames: ['scope_type', 'scope_id'],
          },
        ],
      }),
      true,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_settings_profiles_scope_type" ON "settings_profiles" ("scope_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_settings_profiles_scope_id" ON "settings_profiles" ("scope_id")`,
    );

    // 迁移 users.settings -> settings_profiles(scope_type=user)
    await queryRunner.query(`
      INSERT INTO "settings_profiles" ("profile_id", "scope_type", "scope_id", "settings", "created_at", "updated_at")
      SELECT CONCAT('spu_', u."userId"), 'user', u."userId", u."settings", NOW(), NOW()
      FROM "users" u
      WHERE u."settings" IS NOT NULL
        AND u."settings"::text <> '{}'::text
      ON CONFLICT ("scope_type", "scope_id")
      DO UPDATE SET
        "settings" = EXCLUDED."settings",
        "updated_at" = NOW()
    `);

    // 迁移 workspaces.settings -> settings_profiles(scope_type=workspace)
    await queryRunner.query(`
      INSERT INTO "settings_profiles" ("profile_id", "scope_type", "scope_id", "settings", "created_at", "updated_at")
      SELECT CONCAT('spw_', w."workspaceId"), 'workspace', w."workspaceId", w."settings", NOW(), NOW()
      FROM "workspaces" w
      WHERE w."settings" IS NOT NULL
        AND w."settings"::text <> '{}'::text
      ON CONFLICT ("scope_type", "scope_id")
      DO UPDATE SET
        "settings" = EXCLUDED."settings",
        "updated_at" = NOW()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_settings_profiles_scope_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_settings_profiles_scope_type"`);
    await queryRunner.dropTable('settings_profiles', true);
  }
}
