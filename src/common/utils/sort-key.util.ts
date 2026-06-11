import {
  compareSortKeys,
  generateKeyBetween,
  isValidSortKey,
} from './fractional-key';
import { isSqlite } from '../db-type';

export {
  compareSortKeys,
  generateKeyBetween,
  generateNKeysBetween,
  integerToSortKey,
  isValidSortKey,
} from './fractional-key';

function sanitize(value?: string | null): string | null {
  return isValidSortKey(value) ? value : null;
}

/**
 * 生成排序键（fractional indexing，base62 字符串，纯字典序比较）。
 * 任意两个 key 之间永远可以再插入，不存在空间耗尽或溢出。
 *
 * 防御性处理：非法 key 视为缺失；prevKey >= nextKey 时退化为「排在 prevKey 之后」。
 *
 * @param prevKey 前一个元素的排序键（可选）
 * @param nextKey 后一个元素的排序键（可选）
 * @returns 新的排序键
 */
export function generateSortKey(prevKey?: string, nextKey?: string): string {
  const left = sanitize(prevKey);
  let right = sanitize(nextKey);
  if (left != null && right != null && compareSortKeys(left, right) >= 0) {
    right = null;
  }
  return generateKeyBetween(left, right);
}

/**
 * 比较两个排序键（纯字节序）
 * @returns 负数表示 a < b, 0 表示 a === b, 正数表示 a > b
 */
export function compareSortKey(a: string, b: string): number {
  return compareSortKeys(a, b);
}

/**
 * SQL ORDER BY 表达式：fractional key 必须按字节序比较。
 * PostgreSQL 的默认 locale collation 可能大小写混排，需显式 "C" collation；
 * SQLite 默认 BINARY collation 即字节序。
 */
export function sortKeyOrderByExpression(column: string): string {
  return isSqlite() ? column : `${column} COLLATE "C"`;
}
