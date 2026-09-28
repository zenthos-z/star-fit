/**
 * Suggestion Cache Repository
 *
 * 建议参数缓存表（suggestion_cache，003 迁移）的唯一数据访问层（issue #39 B6）。
 * 覆盖三组操作：
 *  - 整批替换写入（单事务 DELETE + INSERT jsonb_to_recordset，幂等）
 *  - 按用户 + 指纹整批读取（GET 对账路径）
 *  - 用户级失效清理
 *
 * 校验回路（CLAUDE.md 红线）：
 *  - 出库后：CachedSuggestionSchema 组装件经 validateOrThrow（失败即抛）
 *  - 禁止绕过本层直连 suggestion_cache 表
 */

import {
  validateOrThrow,
  AdjustmentIntentSchema,
  CapabilityProfileSchema,
  SuggestionValuesSchema,
  SuggestionPlanContextSchema,
  type AdjustmentIntent,
  type CapabilityProfile,
  type SuggestionPlanContext,
  type SuggestionValues,
  UUIDSchema,
} from "../../../../../shared/dist/contracts/index.js";

import { PostgresClient } from "../client/postgres-client.js";
import { BaseRepository } from "./base.repository.js";
import {
  ServiceError,
  ServiceErrorCode,
} from "../../../services/errors/ServiceError.js";

// ---------------------------------------------------------------------------
// 写入形状（Service 组装，Repository 只做搬运 + 校验）
// ---------------------------------------------------------------------------

/** 整批替换写入的单行输入（数值/剖面/意图已由公式层算好并校验过） */
export interface SuggestionCacheWriteRow {
  exercise_id: string;
  exercise_name: string;
  exercise_type: string;
  baseline_rpe: number;
  values: SuggestionValues;
  profile: CapabilityProfile;
  adjustment?: AdjustmentIntent | null;
  plan_context: SuggestionPlanContext;
  source: "formula" | "hybrid";
}

/** 出库行（jsonb 已由 pg 预解析） */
interface SuggestionCacheRow {
  exercise_id: string;
  exercise_name: string;
  exercise_type: string;
  context_fingerprint: string;
  baseline_rpe: number;
  values_json: unknown;
  profile_json: unknown;
  adjustment_json: unknown;
  plan_context_json: unknown;
  source: string;
  generated_at: Date;
  updated_at: Date;
}

/** 出库行 → 缓存条目组件（出库校验，失败即抛 —— 红线：禁止静默吞错） */
export interface SuggestionCacheReadEntry {
  exercise_id: string;
  exercise_name: string;
  exercise_type: string;
  context_fingerprint: string;
  baseline_rpe: number;
  values: SuggestionValues;
  profile: CapabilityProfile;
  adjustment: AdjustmentIntent | null;
  plan_context: SuggestionPlanContext;
  source: "formula" | "hybrid";
  generated_at: number;
  updated_at: number;
}

function mapRow(row: SuggestionCacheRow): SuggestionCacheReadEntry {
  const values = validateOrThrow(
    SuggestionValuesSchema,
    row.values_json,
    "SuggestionCacheRepository.mapRow.values",
  );
  const profile = validateOrThrow(
    CapabilityProfileSchema,
    row.profile_json,
    "SuggestionCacheRepository.mapRow.profile",
  );
  const planContext = validateOrThrow(
    SuggestionPlanContextSchema,
    row.plan_context_json,
    "SuggestionCacheRepository.mapRow.plan_context",
  );
  const adjustment =
    row.adjustment_json == null
      ? null
      : validateOrThrow(
          AdjustmentIntentSchema,
          row.adjustment_json,
          "SuggestionCacheRepository.mapRow.adjustment",
        );
  if (row.source !== "formula" && row.source !== "hybrid") {
    throw new ServiceError(
      ServiceErrorCode.VALIDATION_ERROR,
      `suggestion_cache.source 非法: ${row.source}`,
      { exercise_id: row.exercise_id, source: row.source },
    );
  }
  return {
    exercise_id: row.exercise_id,
    exercise_name: row.exercise_name,
    exercise_type: row.exercise_type,
    context_fingerprint: row.context_fingerprint,
    baseline_rpe: row.baseline_rpe,
    values,
    profile,
    adjustment,
    plan_context: planContext,
    source: row.source,
    generated_at: row.generated_at.getTime(),
    updated_at: row.updated_at.getTime(),
  };
}

export class SuggestionCacheRepository extends BaseRepository {
  constructor(client: PostgresClient) {
    super(client);
  }

  /**
   * 整批替换用户缓存：单事务内先 DELETE 该用户全部行（含陈旧指纹），
   * 再 jsonb_to_recordset 批量 INSERT（heartRate.insertBatch / plan_entries
   * 同款惯例）。原子完成 —— 读方永远看到完整一批，不会读到半批。
   */
  async replaceUserCache(
    userId: string,
    fingerprint: string,
    rows: readonly SuggestionCacheWriteRow[],
  ): Promise<number> {
    if (!UUIDSchema.safeParse(userId).success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId 必须为 UUID（当前: ${userId}）`,
        { userId },
      );
    }
    if (rows.length === 0) {
      // 空库（动作库未导入）也把旧指纹行清干净，保证读方一致
      await this.execute(
        `DELETE FROM suggestion_cache WHERE user_id = $userId::uuid`,
        { userId },
      );
      return 0;
    }

    const payload = rows.map((r) => ({
      user_id: userId,
      context_fingerprint: fingerprint,
      exercise_id: r.exercise_id,
      exercise_name: r.exercise_name,
      exercise_type: r.exercise_type,
      baseline_rpe: r.baseline_rpe,
      values_json: r.values,
      profile_json: r.profile,
      adjustment_json: r.adjustment ?? null,
      plan_context_json: r.plan_context,
      source: r.source,
    }));

    return this.client.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM suggestion_cache WHERE user_id = $userId::uuid`,
        {
          userId,
        },
      );
      const result = await tx.query(
        `INSERT INTO suggestion_cache (
           user_id, exercise_id, exercise_name, exercise_type,
           context_fingerprint, baseline_rpe,
           values_json, profile_json, adjustment_json, plan_context_json,
           source, generated_at, updated_at
         )
         SELECT t.user_id::uuid, t.exercise_id, t.exercise_name, t.exercise_type,
                t.context_fingerprint, t.baseline_rpe::int,
                t.values_json::jsonb, t.profile_json::jsonb,
                t.adjustment_json::jsonb, t.plan_context_json::jsonb,
                t.source::text, NOW(), NOW()
         FROM jsonb_to_recordset($rows::jsonb) AS t(
           user_id text, exercise_id text, exercise_name text, exercise_type text,
           context_fingerprint text, baseline_rpe int,
           values_json jsonb, profile_json jsonb, adjustment_json jsonb,
           plan_context_json jsonb, source text)`,
        { rows: JSON.stringify(payload) },
      );
      return result.rowCount ?? payload.length;
    });
  }

  /** 按用户 + 指纹整批读取（GET 对账路径；按 exercise_name 排序稳定输出） */
  async getByUserAndFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<SuggestionCacheReadEntry[]> {
    const rows = await this.queryMany<SuggestionCacheRow>(
      `SELECT exercise_id, exercise_name, exercise_type, context_fingerprint,
              baseline_rpe, values_json, profile_json, adjustment_json,
              plan_context_json, source, generated_at, updated_at
       FROM suggestion_cache
       WHERE user_id = $userId::uuid AND context_fingerprint = $fingerprint
       ORDER BY exercise_name ASC`,
      { userId, fingerprint },
    );
    return rows.map(mapRow);
  }

  /** 用户级静默失效：删除该用户全部缓存行（重算任务随后整批重写） */
  async deleteByUser(userId: string): Promise<number> {
    if (!UUIDSchema.safeParse(userId).success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId 必须为 UUID（当前: ${userId}）`,
        { userId },
      );
    }
    return this.execute(
      `DELETE FROM suggestion_cache WHERE user_id = $userId::uuid`,
      { userId },
    );
  }
}

export function createSuggestionCacheRepository(
  client: PostgresClient,
): SuggestionCacheRepository {
  return new SuggestionCacheRepository(client);
}
