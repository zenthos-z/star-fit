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

// Import data contracts from shared/types (bridge to shared)
import {
  LoadAnchorsSchema,
  LoadAnchorSchema,
  type LoadAnchor,
  type LoadAnchors,
  type LoadAnchorLegacy,
  type LoadAnchorsLegacy,
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
   * 获取或创建用户画像
   */
  async getOrCreateProfile(userId: string): Promise<UserInsight> {
    const existing = await this.getProfile(userId);
    if (existing) {
      return existing;
    }

    // 创建新画像
    const client = this.getClient();

    await client.query(
      `INSERT INTO user_insights (user_id, updated_at, modified_by)
       VALUES ($userId, $updatedAt, $modifiedBy)`,
      {
        userId,
        updatedAt: getNowISO(),
        modifiedBy: "system",
      },
    );

    return {
      id: userId,
      user_id: userId,
      created_at: getNowISO(),
      updated_at: getNowISO(),
      modified_by: "system",
      basic_info: null,
      preferences: null,
      physiological: null,
      load_anchors: null,
      psychological: null,
    };
  },

  /**
   * 更新用户画像（MAS 和 Admin 共用）
   */
  async updateProfile(update: UserProfileUpdate): Promise<void> {
    const client = this.getClient();

    console.log("[UserProfileService] updateProfile called with:", update);

    // 验证数据
    const validated = this.validateProfile(update);
    console.log("[UserProfileService] Validated data:", validated);

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
          console.log(
            "[UserProfileService] Updating profile_static:",
            values.staticUpdates,
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
          console.log(
            "[UserProfileService] Updating profile_dynamic:",
            values.dynamicUpdates,
          );
        }

        if (setClauses.length === 1) {
          // 只有 updated_at
          console.log("[UserProfileService] No updates to apply");
          return;
        }

        const sql = `
        UPDATE users
        SET ${setClauses.join(", ")}
        WHERE id = $userId
      `;
        console.log("[UserProfileService] SQL:", sql);
        console.log("[UserProfileService] Values:", {
          ...values,
          staticUpdates: "...",
          dynamicUpdates: "...",
        });

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
   * 数据验证
   */
  validateProfile(update: UserProfileUpdate): Partial<UserProfileUpdate> {
    const validated: Partial<UserProfileUpdate> = {};

    console.log("[UserProfileService] Validating update:", update);

    // 验证 basic_info
    if (update.basic_info !== undefined) {
      if (typeof update.basic_info !== "object") {
        throw new Error("basic_info must be an object");
      }
      validated.basic_info = update.basic_info;
      console.log(
        "[UserProfileService] Validated basic_info:",
        update.basic_info,
      );
    }

    // 验证 preferences
    if (update.preferences !== undefined) {
      if (typeof update.preferences !== "object") {
        throw new Error("preferences must be an object");
      }
      validated.preferences = update.preferences;
      console.log(
        "[UserProfileService] Validated preferences:",
        update.preferences,
      );
    }

    // 验证 physiological
    if (update.physiological !== undefined) {
      if (typeof update.physiological !== "object") {
        throw new Error("physiological must be an object");
      }
      validated.physiological = update.physiological;
    }

    // 验证 load_anchors
    if (update.load_anchors !== undefined) {
      if (typeof update.load_anchors !== "object") {
        throw new Error("load_anchors must be an object");
      }
      validated.load_anchors = update.load_anchors;
    }

    // 验证 active_limitations
    if (update.active_limitations !== undefined) {
      if (!Array.isArray(update.active_limitations)) {
        throw new Error("active_limitations must be an array");
      }
      validated.active_limitations = update.active_limitations;
    }

    // recovery_state 为可选的任意动态状态对象，直接透传
    if (update.recovery_state !== undefined) {
      validated.recovery_state = update.recovery_state;
    }

    // 验证 psychological
    if (update.psychological !== undefined) {
      if (typeof update.psychological !== "object") {
        throw new Error("psychological must be an object");
      }
      validated.psychological = update.psychological;
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
