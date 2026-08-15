/**
 * User Profile Field Mapping
 *
 * **命名规范设计决策**:
 *
 * 项目采用统一的 snake_case 命名规范（数据库层、Repository 层、应用层），
 * 简化了数据流，无需字段名转换。
 *
 * **优势**:
 * - 简化数据流，无需字段名转换，减少映射错误
 * - 与 PostgreSQL JSONB 字段自然对齐
 * - 降低 mapper 维护成本
 * - 实践验证（162+ 处代码使用 snake_case）
 *
 * **说明**:
 * - 当前 API 类型（contracts/index.js）使用 snake_case 字段名
 * - 与数据库格式保持一致，无需字段名转换
 * - 此 mapper 提供类型断言，确保类型兼容性
 * - 如果前端发送 camelCase 数据，需要在应用层进行转换
 */

import type {
  ProfileStatic
} from '../index.js';
import type {
  ProfileStaticDatabase
} from '../database/user-profile.schema.js';

/**
 * Convert ProfileStatic from API format to Database format
 *
 * Currently both formats use snake_case field names, so this is
 * primarily a type assertion. If the API format changes to camelCase,
 * this function should be updated to perform the conversion.
 */
export function toDatabaseFormat(data: ProfileStatic): ProfileStaticDatabase {
  // Direct mapping since both use snake_case
  return data as unknown as ProfileStaticDatabase;
}

/**
 * Convert ProfileStatic from Database format to API format
 *
 * Currently both formats use snake_case field names, so this is
 * primarily a type assertion.
 */
export function toApiFormat(data: ProfileStaticDatabase): ProfileStatic {
  // Direct mapping since both use snake_case
  return data as unknown as ProfileStatic;
}

// Re-export for convenience
export { toDatabaseFormat as profileStaticToDatabase };
export { toApiFormat as profileStaticToApi };
