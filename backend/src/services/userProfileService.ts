/**
 * UserProfileService - PostgreSQL Migration
 *
 * Migrated from SQLite (getDb()) to PostgreSQL client
 *
 * Changes:
 * - Replaced getDb() with getPostgresClient()
 * - Converted all SQL queries from SQLite to PostgreSQL syntax
 * - Used parameterized queries ($1, $2) instead of (?)
 * - Leveraged JSONB operations for profile fields
 * - Maintained transaction support with postgresClient.transaction()
 * - Updated timestamp handling to use TIMESTAMPTZ
 *
 * @version 3.0.0 - PostgreSQL Migration
 */

import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";
import type { PostgresClient } from "../db/postgresql/client/postgres-client.js";
import { getNowISO } from "../utils/timestamp.js";
import { ValidationError } from "../utils/errorHandler.js";
import { z } from "zod";

// Import data contracts from shared/types (bridge to shared)
import {
  BasicInfoSchema,
  PreferencesSchema,
  PhysiologicalSchema,
  PsychologicalSchema,
  ActiveLimitationSchema,
  RecoveryStateSchema,
  LoadAnchorsSchema,
  type LoadAnchor,
  type LoadAnchors,
  type BasicInfo,
  type Preferences,
  type Physiological,
  type Psychological,
  type ActiveLimitation,
} from "../types/contracts.js";
import { parseJSONSafe, validateWithLogging } from "../types/validation.js";

// Re-export types for backward compatibility
export type {
  LoadAnchor,
  LoadAnchors,
  BasicInfo,
  Preferences,
  Physiological,
  Psychological,
};

export interface UserInsight {
  id: string; // UUID from users table
  user_id: string;
  created_at: string; // ISO 8601 UTC timestamp when user was created

  // 核心字段（列存储）
  updated_at: string; // ISO 8601 UTC timestamp
  modified_by: "mas" | "admin" | "user" | "system";

  // 扩展字段（JSON 存储 - PostgreSQL stores as TEXT, migrated from SQLite)
  basic_info: string | null; // JSON: { age, weight, body_fat, training_age }
  preferences: string | null; // JSON: { method, avoided, time_constraint, equipment }
  physiological: string | null; // JSON: { sleep_hours, stress_level, cycle_focus }
  load_anchors: string | null; // JSON: { exercise_id: { 1rm, current, last_updated } }
  psychological: string | null; // JSON: { neurotype, accountability, risk_preference }

  // Dynamic state（user_insights 视图从 profile_dynamic JSONB 提取，可能是 JSON 字符串或已解析值）
  active_limitations?: unknown; // JSON: ActiveLimitation[]
  recovery_state?: unknown; // JSON: 恢复状态对象

  // Legacy fields (deprecated, 保留兼容)
  tags_json?: string;
  summary?: string;
  protocol_version?: string;
  version?: number;
  metadata_json?: string;
}

export interface UserProfileUpdate {
  userId: string;
  basic_info?: BasicInfo;
  preferences?: Preferences;
  physiological?: Physiological;
  load_anchors?: LoadAnchors;
  psychological?: Psychological;
  active_limitations?: ActiveLimitation[];
  recovery_state?: unknown;
  // 审计字段
  modifiedBy: "mas" | "admin" | "user" | "system";
  changeReason?: string;
  replaceAnchors?: boolean; // 如果为 true，完全替换 load_anchors 而不是合并
}

// ============================================
// 画像字段清洗 schema（Zod 白名单）
// ============================================
// 写入前统一 parse 清洗：未知键丢弃（zod 对象默认 strip），枚举/约束校验失败抛错
// （项目红线：Zod 校验失败必须抛错，违规数据绝不静默入库）。全部派生自
// shared/contracts 契约（经 ../types/contracts.js 再导出），不私造 schema。
const BasicInfoCleanSchema = BasicInfoSchema;
const PreferencesCleanSchema = PreferencesSchema;
const PhysiologicalCleanSchema = PhysiologicalSchema;
const PsychologicalCleanSchema = PsychologicalSchema;
const LoadAnchorsCleanSchema = LoadAnchorsSchema;

/**
 * active_limitations 清洗：在共享 ActiveLimitationSchema 基础上把 expire_at /
 * logged_at 放宽为普通字符串——admin 控制台新增限制时以空串占位（由前端/后续流程
 * 填充，见 UserProfilePanel.handleLimitationAdd），强制 datetime 格式会打崩该在跑流。
 * part / severity(1-10) 等其余约束仍严格校验。
 */
const ActiveLimitationCleanSchema = ActiveLimitationSchema.extend({
  expire_at: z.string(),
  logged_at: z.string(),
});

/** active_limitations 是数组：对每个元素做上述清洗 */
const ActiveLimitationsCleanSchema = z.array(ActiveLimitationCleanSchema);

const RecoveryStateCleanSchema = RecoveryStateSchema;

/** 白名单清洗：校验失败抛 ValidationError（controller 层转 400），成功返回清洗后数据 */
function cleanWith<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    throw new ValidationError(
      `[UserProfileService] ${field} validation failed: ${details}`,
      field,
    );
  }
  return result.data;
}

/**
 * body_fat / body_fat_percentage 归一为一个名字（以 shared/contracts BasicInfoSchema
 * 的 body_fat 为准）：body_fat_percentage 有值时并入 body_fat，随后删除旧键，杜绝双键并存。
 */
function normalizeBasicInfo(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const obj: Record<string, unknown> = {
    ...(input as Record<string, unknown>),
  };
  if (obj.body_fat_percentage !== undefined && obj.body_fat === undefined) {
    obj.body_fat = obj.body_fat_percentage;
  }
  delete obj.body_fat_percentage;
  return obj;
}

// ============================================
// UserProfileService - PostgreSQL Implementation
// ============================================

export const UserProfileService = {
  /**
   * Get PostgreSQL client instance
   */
  getClient(): PostgresClient {
    return getPostgresClient();
  },

  /**
   * 获取用户画像
   */
  async getProfile(userId: string): Promise<UserInsight | null> {
    const client = this.getClient();

    const row = await client.queryOne<UserInsight>(
      `SELECT * FROM user_insights WHERE user_id = $userId`,
      { userId },
    );

    return row || null;
  },

  /**
   * 更新用户画像（MAS 和 Admin 共用）
   */
  async updateProfile(update: UserProfileUpdate): Promise<void> {
    const client = this.getClient();

    // 验证数据（Zod 白名单清洗：未知键丢弃，枚举/约束失败抛错）
    const validated = this.validateProfile(update);

    // 使用事务进行更新
    await client.transaction(
      async (tx) => {
        // 获取旧数据用于审计 - 从 VIEW 读取是 OK 的
        const oldProfile = await tx.queryOne<UserInsight>(
          `SELECT * FROM user_insights WHERE user_id = $userId`,
          { userId: update.userId },
        );

        // 构建更新语句 - 直接更新 users 表的 JSONB 字段
        // user_insights 是 VIEW，不能直接 INSERT/UPDATE
        const values: Record<string, any> = { userId: update.userId };
        const setClauses: string[] = ["updated_at = NOW()"];

        // 构建 profile_static 更新 (使用 jsonb_set 或合并)
        const staticUpdates: Record<string, any> = {};
        if (validated.basic_info !== undefined)
          staticUpdates.basic_info = validated.basic_info;
        if (validated.preferences !== undefined)
          staticUpdates.preferences = validated.preferences;
        if (validated.physiological !== undefined)
          staticUpdates.physiological = validated.physiological;
        if (validated.psychological !== undefined)
          staticUpdates.psychological = validated.psychological;

        if (Object.keys(staticUpdates).length > 0) {
          values.staticUpdates = JSON.stringify(staticUpdates);
          // 使用 COALESCE 处理 NULL 值，然后合并
          setClauses.push(
            `profile_static = COALESCE(profile_static, '{}'::jsonb) || $staticUpdates::jsonb`,
          );
        }

        // 构建 profile_dynamic 更新
        const dynamicUpdates: Record<string, any> = {};
        if (validated.load_anchors !== undefined) {
          if (update.replaceAnchors) {
            dynamicUpdates.load_anchors = validated.load_anchors;
          } else {
            // 合并负荷锚点
            const existingAnchors = oldProfile?.load_anchors
              ? typeof oldProfile.load_anchors === "string"
                ? JSON.parse(oldProfile.load_anchors)
                : oldProfile.load_anchors
              : {};
            const mergedAnchors = {
              ...existingAnchors,
              ...validated.load_anchors,
            };
            dynamicUpdates.load_anchors = mergedAnchors;
          }
        }
        if (validated.active_limitations !== undefined) {
          dynamicUpdates.active_limitations = validated.active_limitations;
        }
        if (validated.recovery_state !== undefined) {
          dynamicUpdates.recovery_state = validated.recovery_state;
        }

        if (Object.keys(dynamicUpdates).length > 0) {
          values.dynamicUpdates = JSON.stringify(dynamicUpdates);
          setClauses.push(
            `profile_dynamic = COALESCE(profile_dynamic, '{}'::jsonb) || $dynamicUpdates::jsonb`,
          );
        }

        if (setClauses.length === 1) {
          // 只有 updated_at，无实际字段更新
          return;
        }

        const sql = `
        UPDATE users
        SET ${setClauses.join(", ")}
        WHERE id = $userId
      `;

        await tx.query(sql, values);

        // 记录审计日志
        await this._auditChangesTx(
          tx,
          update.userId,
          update.modifiedBy,
          validated,
          update.changeReason,
        );
      },
      {
        operation: "updateProfile",
        userId: update.userId,
      },
    );
  },

  /**
   * 更新负荷锚点（训练后自动调用）
   */
  async updateLoadAnchors(
    userId: string,
    anchors: LoadAnchors,
    modifiedBy: "mas" | "admin" | "user",
  ): Promise<void> {
    await this.updateProfile({
      userId,
      load_anchors: anchors,
      modifiedBy,
      changeReason: "Load anchors updated after workout",
    });
  },

  /**
   * 数据验证（Zod 白名单清洗）
   * - 未知键丢弃（zod 对象默认 strip）
   * - 枚举/约束校验失败抛 ValidationError（controller 层转 400）
   * - body_fat / body_fat_percentage 归一名（以 body_fat 为准）
   */
  validateProfile(update: UserProfileUpdate): Partial<UserProfileUpdate> {
    const validated: Partial<UserProfileUpdate> = {};

    if (update.basic_info !== undefined) {
      validated.basic_info = cleanWith(
        BasicInfoCleanSchema,
        normalizeBasicInfo(update.basic_info),
        "basic_info",
      );
    }

    if (update.preferences !== undefined) {
      validated.preferences = cleanWith(
        PreferencesCleanSchema,
        update.preferences,
        "preferences",
      );
    }

    if (update.physiological !== undefined) {
      validated.physiological = cleanWith(
        PhysiologicalCleanSchema,
        update.physiological,
        "physiological",
      );
    }

    if (update.load_anchors !== undefined) {
      validated.load_anchors = cleanWith(
        LoadAnchorsCleanSchema,
        update.load_anchors,
        "load_anchors",
      );
    }

    if (update.active_limitations !== undefined) {
      validated.active_limitations = cleanWith(
        ActiveLimitationsCleanSchema,
        update.active_limitations,
        "active_limitations",
      );
    }

    if (update.recovery_state !== undefined) {
      validated.recovery_state = cleanWith(
        RecoveryStateCleanSchema,
        update.recovery_state,
        "recovery_state",
      );
    }

    if (update.psychological !== undefined) {
      validated.psychological = cleanWith(
        PsychologicalCleanSchema,
        update.psychological,
        "psychological",
      );
    }

    return validated;
  },

  /**
   * 审计日志记录
   */
  async _auditChanges(
    userId: string,
    modifiedBy: string,
    changes: Partial<UserProfileUpdate>,
    reason?: string,
  ): Promise<void> {
    const client = this.getClient();

    // 记录每个修改的字段
    for (const [fieldName, newValue] of Object.entries(changes)) {
      await client.query(
        `INSERT INTO audit_logs (user_id, modified_by, field_name, new_value, change_reason, created_at)
         VALUES ($userId, $modifiedBy, $fieldName, $newValue, $changeReason, $createdAt)`,
        {
          userId,
          modifiedBy,
          fieldName,
          newValue: JSON.stringify(newValue),
          changeReason: reason || "Profile updated",
          createdAt: getNowISO(),
        },
      );
    }
  },

  /**
   * 审计日志记录（事务版本）
   */
  async _auditChangesTx(
    tx: any,
    userId: string,
    modifiedBy: string,
    changes: Partial<UserProfileUpdate>,
    reason?: string,
  ): Promise<void> {
    // 记录每个修改的字段
    for (const [fieldName, newValue] of Object.entries(changes)) {
      await tx.query(
        `INSERT INTO audit_logs (user_id, modified_by, field_name, new_value, change_reason, created_at)
         VALUES ($userId, $modifiedBy, $fieldName, $newValue, $changeReason, $createdAt)`,
        {
          userId,
          modifiedBy,
          fieldName,
          newValue: JSON.stringify(newValue),
          changeReason: reason || "Profile updated",
          createdAt: getNowISO(),
        },
      );
    }
  },

  /**
   * 获取用户审计日志
   */
  async getAuditLogs(userId: string, limit = 50): Promise<any[]> {
    const client = this.getClient();

    const logs = await client.queryMany(
      `SELECT * FROM audit_logs
       WHERE user_id = $userId
       ORDER BY created_at DESC
       LIMIT $limit`,
      { userId, limit },
    );

    return logs;
  },
};

// ============================================
// 辅助函数
// ============================================

/**
 * 解析 basic_info JSON
 * Uses shared validation utilities for safe parsing
 */
export function parseBasicInfo(json: string | null): BasicInfo | null {
  return parseJSONSafe<BasicInfo>(json, "basic_info parsing");
}

/**
 * 解析 preferences JSON
 * Uses shared validation utilities for safe parsing
 */
export function parsePreferences(json: string | null): Preferences | null {
  return parseJSONSafe<Preferences>(json, "preferences parsing");
}

/**
 * 解析 physiological JSON
 * Uses shared validation utilities for safe parsing
 */
export function parsePhysiological(json: string | null): Physiological | null {
  return parseJSONSafe<Physiological>(json, "physiological parsing");
}

/**
 * 解析 load_anchors JSON
 * Uses shared validation utilities for safe parsing and validation
 * Logs validation errors instead of silently falling back
 */
export function parseLoadAnchors(json: string | null): LoadAnchors {
  if (!json || json.trim() === "") return {};

  // Parse and validate using shared utilities
  const validated = validateWithLogging(
    LoadAnchorsSchema,
    parseJSONSafe(json, "load_anchors parsing"),
    "load_anchors validation",
    {}, // Default to empty object on validation failure
  );

  return validated || {};
}

/**
 * 计算 1RM (Brzycki 公式)
 * weight: 重量 (kg)
 * reps: 次数
 * 返回: 估算的 1RM (kg)
 */
export function calculate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps < 1 || weight <= 0) return 0;
  // Brzycki 公式: 1RM = weight / (1.0278 - 0.0278 * reps)
  const denominator = 1.0278 - 0.0278 * reps;
  if (denominator <= 0) return weight; // 保护公式失效情况
  return Math.round((weight / denominator) * 100) / 100;
}

/**
 * 计算配速 (秒/公里)
 * duration: 时长 (秒)
 * distance: 距离 (米)
 * 返回: 配速 (秒/公里)
 */
export function calculatePace(
  durationSec: number,
  distanceMeters: number,
): number {
  if (distanceMeters <= 0) return 0;
  return Math.round((durationSec / distanceMeters) * 1000 * 100) / 100;
}

/**
 * 解析 psychological JSON
 * Uses shared validation utilities for safe parsing
 */
export function parsePsychological(json: string | null): Psychological | null {
  return parseJSONSafe<Psychological>(json, "psychological parsing");
}
