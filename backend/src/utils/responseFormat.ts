/**
 * 格式化 API 响应中的时间戳字段
 * 将 Date 对象转换为 ISO 8601 字符串
 *
 * @param obj - 待格式化的对象
 * @param timestampFields - 需要格式化的时间戳字段名
 * @returns 格式化后的对象
 *
 * @example
 * const session = formatTimestamps(latestSession, ['start_time', 'end_time', 'created_at', 'updated_at']);
 */
export function formatTimestamps<T extends Record<string, any>>(
  obj: T,
  timestampFields: (keyof T)[]
): T {
  const result = { ...obj };
  for (const field of timestampFields) {
    const value: any = result[field];
    if (value && value instanceof Date) {
      (result as any)[field] = value.toISOString();
    }
  }
  return result;
}

/**
 * 批量格式化多个对象的时间戳字段
 *
 * @param objects - 待格式化的对象数组
 * @param timestampFields - 需要格式化的时间戳字段名
 * @returns 格式化后的对象数组
 *
 * @example
 * const sessions = formatTimestampsArray(allSessions, ['start_time', 'end_time', 'created_at', 'updated_at']);
 */
export function formatTimestampsArray<T extends Record<string, any>>(
  objects: T[],
  timestampFields: (keyof T)[]
): T[] {
  return objects.map(obj => formatTimestamps(obj, timestampFields));
}
