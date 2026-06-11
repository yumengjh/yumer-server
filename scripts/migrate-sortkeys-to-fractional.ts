/**
 * 一次性迁移：把遗留整数 sortKey（如 "001000"、"500000"）就地重写为
 * fractional indexing key（base62 字符串，纯字典序）。
 *
 * - 保序映射：integerToSortKey(parseInt(legacy))，m < n 蕴含 key(m) < key(n)
 * - 覆盖 block_versions 全表（含历史版本行），同时重写 payload.attrs 内的
 *   sortKey / data-sort-key 副本
 * - 幂等：已是合法 fractional key 且 payload 无遗留副本的行直接跳过
 *
 * 运行：pnpm sortkeys:migrate
 */
import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import databaseConfig from "../src/config/database.config";
import { BlockVersion } from "../src/entities/block-version.entity";
import {
  integerToSortKey,
  isValidSortKey,
} from "../src/common/utils/fractional-key";

const BATCH_SIZE = 500;

function migrateKey(value: string | null | undefined): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (isValidSortKey(raw)) return null; // 已迁移
  if (/^\d+$/.test(raw)) {
    return integerToSortKey(Number.parseInt(raw, 10));
  }
  // 空/非法值统一落到最小 canonical key
  return integerToSortKey(0);
}

function migratePayloadAttrs(payload: unknown): {
  changed: boolean;
  payload: unknown;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { changed: false, payload };
  }
  const record = payload as Record<string, unknown>;
  const attrs = record.attrs;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) {
    return { changed: false, payload };
  }
  const attrsRecord = attrs as Record<string, unknown>;
  let changed = false;
  const nextAttrs = { ...attrsRecord };
  for (const key of ["sortKey", "data-sort-key"]) {
    const current = nextAttrs[key];
    if (typeof current !== "string" || current === "") continue;
    if (isValidSortKey(current)) continue;
    const migrated = migrateKey(current);
    if (migrated != null) {
      nextAttrs[key] = migrated;
      changed = true;
    }
  }
  if (!changed) return { changed: false, payload };
  return { changed: true, payload: { ...record, attrs: nextAttrs } };
}

async function main() {
  const config = databaseConfig() as any;
  const dataSource = new DataSource({
    ...config,
    synchronize: false,
    migrationsRun: false,
  });

  await dataSource.initialize();
  const repository = dataSource.getRepository(BlockVersion);

  let scanned = 0;
  let updated = 0;
  let lastId = 0;

  for (;;) {
    const rows = await repository
      .createQueryBuilder("bv")
      .select(["bv.id", "bv.sortKey", "bv.payload"])
      .where("bv.id > :lastId", { lastId })
      .orderBy("bv.id", "ASC")
      .take(BATCH_SIZE)
      .getMany();

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const nextSortKey = migrateKey(row.sortKey);
      const payloadResult = migratePayloadAttrs(row.payload);
      if (nextSortKey == null && !payloadResult.changed) continue;

      const patch: Partial<BlockVersion> = {};
      if (nextSortKey != null) patch.sortKey = nextSortKey;
      if (payloadResult.changed) patch.payload = payloadResult.payload as object;
      await repository.update({ id: row.id }, patch);
      updated += 1;
    }

    lastId = rows[rows.length - 1].id;
    console.log(
      JSON.stringify({ progress: { scanned, updated, lastId } }),
    );
  }

  console.log(JSON.stringify({ done: { scanned, updated } }, null, 2));
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
