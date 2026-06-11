/**
 * Fractional indexing order keys（base62，纯字典序字节比较）。
 *
 * 算法移植自 rocicorp/fractional-indexing（CC0），原型见
 * https://observablehq.com/@dgreensp/implementing-fractional-indexing
 *
 * key = 整数部分 + 可选小数部分：
 * - 整数部分首字符编码长度（'a'+1位 … 'z'+26位 为正区；'Z'+1位 … 'A'+26位 为负区）
 * - 合法 key 永不以最小数字 '0' 结尾，因此任意两个 key 之间永远可以再插入
 * - 比较规则是纯 ASCII 字节序（'0'-'9' < 'A'-'Z' < 'a'-'z'），无溢出、无用尽
 *
 * 注意：此文件在 yuediter 与 yumer-server 两个仓库各有一份，内容必须保持一致，
 * 由共享 fixture 测试（fractional-key.fixtures.json）保证两端行为相同。
 */

const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const SMALLEST_INTEGER = `A${"0".repeat(26)}`;

function getIntegerLength(head: string): number {
  if (head >= "a" && head <= "z") {
    return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  }
  if (head >= "A" && head <= "Z") {
    return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  }
  throw new Error(`invalid order key head: ${head}`);
}

function validateInteger(integer: string): void {
  if (integer.length !== getIntegerLength(integer[0])) {
    throw new Error(`invalid integer part of order key: ${integer}`);
  }
}

function incrementInteger(x: string): string | null {
  validateInteger(x);
  const [head, ...digs] = x.split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i -= 1) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) {
      digs[i] = DIGITS[0];
    } else {
      digs[i] = DIGITS[d];
      carry = false;
    }
  }
  if (carry) {
    if (head === "Z") return `a${DIGITS[0]}`;
    if (head === "z") return null;
    const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
    if (nextHead > "a") {
      digs.push(DIGITS[0]);
    } else {
      digs.pop();
    }
    return nextHead + digs.join("");
  }
  return head + digs.join("");
}

function decrementInteger(x: string): string | null {
  validateInteger(x);
  const [head, ...digs] = x.split("");
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i -= 1) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) {
      digs[i] = DIGITS.slice(-1);
    } else {
      digs[i] = DIGITS[d];
      borrow = false;
    }
  }
  if (borrow) {
    if (head === "a") return `Z${DIGITS.slice(-1)}`;
    if (head === "A") return null;
    const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
    if (nextHead < "Z") {
      digs.push(DIGITS.slice(-1));
    } else {
      digs.pop();
    }
    return nextHead + digs.join("");
  }
  return head + digs.join("");
}

/** 返回严格位于 a 与 b 之间的小数串（a < b，且均不以 '0' 结尾）。 */
function midpoint(a: string, b: string | undefined): string {
  const zero = DIGITS[0];
  if (b !== undefined && a >= b) {
    throw new Error(`midpoint: ${a} >= ${b}`);
  }
  if (a.slice(-1) === zero || (b !== undefined && b.slice(-1) === zero)) {
    throw new Error("midpoint: trailing zero");
  }
  if (b !== undefined) {
    let n = 0;
    while ((a[n] ?? zero) === b[n]) {
      n += 1;
    }
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
  }
  const digitA = a !== "" ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== undefined ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    const midDigit = Math.round(0.5 * (digitA + digitB));
    return DIGITS[midDigit];
  }
  if (b !== undefined && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS[digitA] + midpoint(a.slice(1), undefined);
}

function getIntegerPart(key: string): string {
  const integerPartLength = getIntegerLength(key[0]);
  if (integerPartLength > key.length) {
    throw new Error(`invalid order key: ${key}`);
  }
  return key.slice(0, integerPartLength);
}

function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) {
    throw new Error(`invalid order key: ${key}`);
  }
  for (const char of key) {
    if (!DIGITS.includes(char)) {
      throw new Error(`invalid order key: ${key}`);
    }
  }
  const integer = getIntegerPart(key);
  const fraction = key.slice(integer.length);
  if (fraction.slice(-1) === DIGITS[0]) {
    throw new Error(`invalid order key: ${key}`);
  }
}

/** 生成严格位于 a 与 b 之间的 key；a=null 表示开头，b=null 表示末尾。 */
export function generateKeyBetween(
  a: string | null,
  b: string | null,
): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) {
    throw new Error(`generateKeyBetween: ${a} >= ${b}`);
  }

  if (a === null) {
    if (b === null) return `a${DIGITS[0]}`;
    const ib = getIntegerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) {
      return ib + midpoint("", fb);
    }
    if (ib < b) {
      return ib;
    }
    const decremented = decrementInteger(ib);
    if (decremented === null) {
      throw new Error("generateKeyBetween: cannot decrement any more");
    }
    return decremented;
  }

  if (b === null) {
    const ia = getIntegerPart(a);
    const fa = a.slice(ia.length);
    const incremented = incrementInteger(ia);
    return incremented === null ? ia + midpoint(fa, undefined) : incremented;
  }

  const ia = getIntegerPart(a);
  const fa = a.slice(ia.length);
  const ib = getIntegerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) {
    return ia + midpoint(fa, fb);
  }
  const incremented = incrementInteger(ia);
  if (incremented === null) {
    throw new Error("generateKeyBetween: cannot increment any more");
  }
  if (incremented < b) {
    return incremented;
  }
  return ia + midpoint(fa, undefined);
}

/** 批量生成 n 个严格递增、均位于 (a, b) 区间内的 key。 */
export function generateNKeysBetween(
  a: string | null,
  b: string | null,
  n: number,
): string[] {
  if (!Number.isInteger(n) || n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];

  if (b === null) {
    let current = generateKeyBetween(a, b);
    const result = [current];
    for (let i = 0; i < n - 1; i += 1) {
      current = generateKeyBetween(current, b);
      result.push(current);
    }
    return result;
  }

  if (a === null) {
    let current = generateKeyBetween(a, b);
    const result = [current];
    for (let i = 0; i < n - 1; i += 1) {
      current = generateKeyBetween(a, current);
      result.push(current);
    }
    result.reverse();
    return result;
  }

  const mid = Math.trunc(n / 2);
  const center = generateKeyBetween(a, b);
  return [
    ...generateNKeysBetween(a, center, mid),
    center,
    ...generateNKeysBetween(center, b, n - mid - 1),
  ];
}

/**
 * 把非负整数确定性映射为 fractional key（仅整数部分，无小数）。
 * 严格保序：m < n 蕴含 integerToSortKey(m) < integerToSortKey(n)（字节序）。
 * 用于：遗留整数 sortKey 的一次性迁移、checkpoint 按位置生成 canonical key。
 */
export function integerToSortKey(value: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  let base62 = "";
  let rest = n;
  do {
    base62 = DIGITS[rest % 62] + base62;
    rest = Math.floor(rest / 62);
  } while (rest > 0);
  if (base62.length > 26) {
    throw new Error(`integerToSortKey: value too large: ${value}`);
  }
  const head = String.fromCharCode(
    "a".charCodeAt(0) + base62.length - 1,
  );
  return head + base62;
}

/** 校验字符串是否为合法 fractional key。遗留整数 key（纯数字）会返回 false。 */
export function isValidSortKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    validateOrderKey(value);
    return true;
  } catch {
    return false;
  }
}

/** 纯字节序比较（与 fractional key 的排序语义一致）。 */
export function compareSortKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
