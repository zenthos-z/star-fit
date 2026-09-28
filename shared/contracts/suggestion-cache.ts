/**
 * Suggestion Cache Contracts - 建议参数缓存对账契约（issue #39 后端批 / B6）
 *
 * 「打开 App 即得」路径的数据契约：后端按画像+当日计划整批预计算 354 条
 * 建议值落 suggestion_cache 表，前端经 GET /api/suggestions/cache 对账拉取：
 *   - fingerprint 匹配 → 后端返回 matched=true（前端继续用本地缓存）
 *   - fingerprint 不匹配 → 后端同步重算（公式层，毫秒级）并返回
 *     matched=false + 新指纹 + 全量条目
 *
 * 红线（CLAUDE.md / suggestions.ts）：
 * - 缓存数值永远出自 shared/contracts/suggestions.ts 纯函数（公式层）；
 *   Agent 只经 AdjustmentIntent 通道叠加有界调整（source='hybrid'）
 * - 计划上下文降载因子是有界可配置的确定性调制，不是 LLM 输出
 *
 * @version 1.0.0
 */

import { z } from 'zod';

import {
  ExerciseSuggestionSchema,
} from './suggestions.js';

// ============================================================================
// 计划上下文调制元数据（随缓存行存储、随 GET 响应下发）
// ============================================================================

/**
 * 当日计划疲劳降载元数据：
 * - factor               实际生效降载系数（1.0=无降载；下限默认 0.70，env 可调）
 * - prior_same_muscle_exercises  当日已排同主肌群动作数（factor 的推导依据）
 * - muscle               生效调度的主肌群（取第一主肌群；纯有氧无肌群时缺省）
 * - today_planned_sets   该肌群当日已排总组数（planned/adjusted/completed 计入）
 */
export const SuggestionPlanContextSchema = z.object({
  factor: z.number().min(0.5).max(1),
  prior_same_muscle_exercises: z.number().int().min(0),
  muscle: z.string().optional(),
  today_planned_sets: z.number().int().min(0),
});
export type SuggestionPlanContext = z.infer<typeof SuggestionPlanContextSchema>;

// ============================================================================
// 缓存条目 / 响应
// ============================================================================

/** 缓存条目 = ExerciseSuggestion + 计划上下文元数据（前端 derive 校验因子用） */
export const CachedSuggestionSchema = ExerciseSuggestionSchema.extend({
  plan_context: SuggestionPlanContextSchema,
});
export type CachedSuggestion = z.infer<typeof CachedSuggestionSchema>;

/**
 * GET /api/suggestions/cache?fingerprint=xxx 响应。
 * matched=false 时后端已同步重算并落库，suggestions 为新指纹全量。
 */
export const SuggestionCacheResponseSchema = z.object({
  /** 当前后端权威上下文指纹（前端下次对账回传） */
  fingerprint: z.string().min(1),
  /** 请求指纹与当前指纹是否一致（一致 = 前端本地缓存仍新鲜） */
  matched: z.boolean(),
  /** 缓存批次的目标 RPE（其他 RPE 前端用 profile 本地 derive） */
  baseline_rpe: z.number().min(1).max(10),
  agent_mode: z.enum(['off', 'hybrid']),
  /** 本批整批生成时间（epoch ms） */
  generated_at: z.number(),
  suggestions: z.array(CachedSuggestionSchema),
});
export type SuggestionCacheResponse = z.infer<typeof SuggestionCacheResponseSchema>;
