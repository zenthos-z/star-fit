/**
 * Exercise Sort Contracts (picker 智能排序后端真源 — issue #31)
 *
 * 职责：
 *  1. 近期分区（region）词表与归一映射——body_part / 17 基准肌群 → 四分区，
 *     前后端共用（pickerData 旧本地映射表迁入本文件收口）。
 *  2. GET /api/exercises/smart-sort 响应契约——排序真源在后端：
 *     近期训练过的动作按分区去重后置顶（同分区多次出现只计最新），
 *     其余动作保持库序；前端仅呈现，不再自算排序。
 *
 * 去重规则（本批核心，issue #31「近期分区去重」）：
 *   按时间新→旧遍历近期训练的动作，同分区只保留首次（= 最新）出现，
 *   更早的同分区条目不计入「近期分区」，也不产生置顶加权。
 *
 * @version 1.0.0
 * @created 2026-09-29
 */

import { z } from 'zod';

// ============================================================================
// 近期分区词表 + 归一映射
// ============================================================================

/** 近期分区（picker 分区口径：上肢/下肢/核心/有氧） */
export const EXERCISE_REGIONS = ['upper', 'lower', 'core', 'cardio'] as const;

export type ExerciseRegion = (typeof EXERCISE_REGIONS)[number];

/** 身体区域（EXERCISE_BODY_PARTS 10 值）→ 近期分区（pickerData.BODY_PART_REGION 收口真源） */
export const BODY_PART_REGION: Record<string, ExerciseRegion> = {
  back: 'upper',
  shoulders: 'upper',
  chest: 'upper',
  upper_arms: 'upper',
  lower_arms: 'upper',
  upper_legs: 'lower',
  lower_legs: 'lower',
  hips: 'lower',
  waist: 'core',
  cardio: 'cardio',
};

/**
 * 17 基准肌群 → 近期分区（肌肉级归一；picker 肌肉 Sheet 分组与后端
 * bodyCategory 兜底共用。按肌群自身解剖区域归组，与条目 body_part 解耦）。
 */
export const MUSCLE_REGION: Record<string, ExerciseRegion> = {
  chest: 'upper', lats: 'upper', middle_back: 'upper', lower_back: 'upper', traps: 'upper',
  shoulders: 'upper', biceps: 'upper', triceps: 'upper', forearms: 'upper', neck: 'upper',
  quadriceps: 'lower', hamstrings: 'lower', calves: 'lower', glutes: 'lower', abductors: 'lower', adductors: 'lower',
  abdominals: 'core',
};

// ============================================================================
// 参数与响应契约
// ============================================================================

/** 近期训练窗口：参与「近期分区」判定的最近已结束训练次数 */
export const SMART_SORT_RECENT_SESSION_LIMIT = 10;

/** 近期的训练置顶动作上限（同 picker「近期的训练」分区展示口径） */
export const SMART_SORT_RECENT_EXERCISE_LIMIT = 3;

/**
 * GET /api/exercises/smart-sort 响应。
 *
 * - ranked_ids：全库动作 id 的展示排序（后端真源）。近期置顶动作在前
 *   （按分区最新→更早），其余动作保持库序；不含库外 id。
 * - recent_exercise_ids：「近期的训练」分区动作（每分区仅计最新一条，
 *   去重后 ≤ limit；均为 ranked_ids 头部子集）。
 * - recent_regions：去重后的近期分区序列（新→旧，同分区唯一）。
 * - 用户无训练历史时：recent_* 为空数组，ranked_ids 即纯库序（新手态由
 *   前端另行降级 hotRank，不在本契约内）。
 */
export const SmartSortResponseSchema = z.object({
  sort_version: z.number().int().positive().default(1),
  ranked_ids: z.array(z.string().min(1)),
  recent_exercise_ids: z
    .array(z.string().min(1))
    .max(SMART_SORT_RECENT_EXERCISE_LIMIT),
  recent_regions: z.array(z.enum(EXERCISE_REGIONS)),
});

export type SmartSortResponse = z.infer<typeof SmartSortResponseSchema>;

// ============================================================================
// 纯函数（前后端共用语义；后端为执行真源，前端仅做离线兜底推导）
// ============================================================================

/** 近期训练条目（去重判定的最小输入形态；按时间新→旧排序由调用方保证） */
export interface RecentTrainedEntry {
  exerciseId: string;
  region: ExerciseRegion;
}

export interface DedupedRecent {
  /** 去重后的近期分区序列（新→旧，同分区唯一） */
  regions: ExerciseRegion[];
  /** 每分区最新一条动作 id（与 regions 同序；同动作跨分区不重复计） */
  exerciseIds: string[];
}

/**
 * 近期分区去重（issue #31：同分区多次出现只计最新）。
 * 输入必须按时间新→旧排序；同分区保留首次（最新）出现，其余丢弃；
 * 同一动作 id 只保留其最新一次出现。
 */
export function dedupeRecentRegions(
  entries: readonly RecentTrainedEntry[],
  limit: number = SMART_SORT_RECENT_EXERCISE_LIMIT,
): DedupedRecent {
  const regions: ExerciseRegion[] = [];
  const exerciseIds: string[] = [];
  const seenRegions = new Set<ExerciseRegion>();
  const seenExercises = new Set<string>();
  for (const e of entries) {
    if (seenRegions.has(e.region) || seenExercises.has(e.exerciseId)) continue;
    seenRegions.add(e.region);
    seenExercises.add(e.exerciseId);
    regions.push(e.region);
    exerciseIds.push(e.exerciseId);
    if (exerciseIds.length >= limit) break;
  }
  return { regions, exerciseIds };
}

/**
 * 全库排序合成：近期置顶动作（去重后）按新→旧排头部，其余保持库序。
 * rankedIds 仅含 libIds 中存在的 id（库外近期 id 自动忽略）。
 */
export function rankWithRecent(libIds: readonly string[], recentExerciseIds: readonly string[]): string[] {
  const libSet = new Set(libIds);
  const head = recentExerciseIds.filter((id) => libSet.has(id));
  const headSet = new Set(head);
  return [...head, ...libIds.filter((id) => !headSet.has(id))];
}
