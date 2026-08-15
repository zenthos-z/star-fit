/**
 * 获取当前 ISO 8601 UTC 时间戳
 *
 * @returns ISO 8601 UTC 字符串，如 "2025-02-27T00:25:00.000Z"
 *
 * @example
 * const now = getNowISO(); // "2025-02-27T00:25:00.000Z"
 */
export function getNowISO(): string {
  return new Date().toISOString();
}

/**
 * 将日期对象或毫秒数字转换为 ISO 8601 UTC 字符串
 *
 * @param date - Date 对象、毫秒数字或 ISO 字符串
 * @returns ISO 8601 UTC 字符串
 *
 * @example
 * toISO(new Date())           // "2025-02-27T00:25:00.000Z"
 * toISO(Date.now())           // "2025-02-27T00:25:00.000Z"
 * toISO("2025-02-27")        // "2025-02-27T00:00:00.000Z"
 */
export function toISO(date: Date | number | string | undefined | null): string {
  if (!date) return getNowISO();
  if (typeof date === 'string') return date; // 假设已经是 ISO 格式
  if (typeof date === 'number') return new Date(date).toISOString();
  return date.toISOString();
}

/**
 * 验证字符串是否为有效的 ISO 8601 UTC 格式
 *
 * @param timestamp - 待验证的时间戳字符串
 * @returns 是否为有效的 ISO 8601 UTC 格式
 *
 * @example
 * isValidISO("2025-02-27T00:25:00.000Z")  // true
 * isValidISO("2025-02-27")                // false
 * isValidISO("1740607200000")             // false
 */
export function isValidISO(timestamp: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp);
}
