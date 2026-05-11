/**
 * 生成排序键（分数排序系统）
 * 使用分数字符串，支持在任意位置插入新元素
 *
 * @param prevKey 前一个元素的排序键（可选）
 * @param nextKey 后一个元素的排序键（可选）
 * @returns 新的排序键
 */
export function generateSortKey(prevKey?: string, nextKey?: string): string {
  // 如果没有前后元素，返回中间值
  if (!prevKey && !nextKey) {
    return '500000';
  }

  // 如果只有前一个元素，返回比它大的值
  if (prevKey && !nextKey) {
    const prevNum = parseInt(prevKey, 10) || 0;
    return String(prevNum + 100000);
  }

  // 如果只有后一个元素，返回比它小的值
  if (!prevKey && nextKey) {
    const nextNum = parseInt(nextKey, 10) || 1000000;
    return String(Math.max(0, nextNum - 100000));
  }

  // 如果前后都有，计算中间值
  const prevNum = parseInt(prevKey!, 10) || 0;
  const nextNum = parseInt(nextKey!, 10) || 1000000;

  if (nextNum - prevNum <= 1) {
    // 如果空间不足，需要重新分配（这里简化处理，实际应该触发重新排序）
    return String(Math.floor((prevNum + nextNum) / 2));
  }

  return String(Math.floor((prevNum + nextNum) / 2));
}

/**
 * 比较两个排序键
 * @returns 负数表示 a < b, 0 表示 a === b, 正数表示 a > b
 */
export function compareSortKey(a: string, b: string): number {
  const numA = parseInt(a, 10) || 0;
  const numB = parseInt(b, 10) || 0;
  return numA - numB;
}
