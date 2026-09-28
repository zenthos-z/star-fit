/**
 * Suggestion Plan Context - 计划上下文疲劳降载（issue #39 B6，纯确定性）
 *
 * 新增调制因子：当日已排容量 → 肌群疲劳叠加降载。设计依据（不推翻既有
 * computeBaseline 调制链，只在其输出之上追加一段有界乘法调制）：
 *   - 数据源：weekly_plans / plan_entries 当日条目（planned/adjusted/completed
 *     计入；skipped = 未排量不计），按 primary_muscles 聚合去重动作数与组数
 *   - 因子：factor = max(floor, 1 - per_exercise_deload × prior_count)
 *     其中 prior_count = 当日同主肌群、按 (sort_order, 动作名) 排序后排在
 *     本动作之前的去重动作数；动作不在当日计划内时取该肌群全部已排数
 *   - 应用：weight/duration/distance 直接乘因子；reps 线性缩放取整；
 *     set_count 是结构参数不动（容量 = weight×reps×sets，缩放前两者已降容量）
 *
 * 有界可配置（env，见 resolvePlanContextConfig）：默认每动作降 5%、下限 0.70
 * ——与 ADJUSTMENT_BOUNDS.multiply.min=0.7 同一保守口径。
 *
 * 红线：本模块只做确定性算术，不涉及任何 LLM。
 */

import type { SuggestionValues } from "shared/contracts";

// ---------------------------------------------------------------------------
// 配置（env 可调，钳制在有界区间）
// ---------------------------------------------------------------------------

/** 计划上下文调制链版本（进入缓存指纹；改因子语义请 +1 失效存量缓存） */
export const PLAN_CONTEXT_VERSION = 1;

export interface PlanContextConfig {
  /** 每个同肌群已排动作的降载比例（0.05 = 5%） */
  perExerciseDeload: number;
  /** 降载下限（factor 最小值；与 ADJUSTMENT_BOUNDS.multiply.min 同口径） */
  floor: number;
}

const DEFAULT_CONFIG: PlanContextConfig = {
  perExerciseDeload: 0.05,
  floor: 0.7,
};

const clampNumber = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/**
 * 解析计划上下文配置（env 覆盖 + 有界钳制，防误配出安全区）：
 * - SUGGESTION_PLAN_DELOAD_PER_EXERCISE：[0, 0.2]
 * - SUGGESTION_PLAN_DELOAD_FLOOR：[0.5, 1]
 */
export function resolvePlanContextConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlanContextConfig {
  const config: PlanContextConfig = { ...DEFAULT_CONFIG };
  const perRaw = Number(env.SUGGESTION_PLAN_DELOAD_PER_EXERCISE);
  if (Number.isFinite(perRaw)) {
    config.perExerciseDeload = clampNumber(perRaw, 0, 0.2);
  }
  const floorRaw = Number(env.SUGGESTION_PLAN_DELOAD_FLOOR);
  if (Number.isFinite(floorRaw)) {
    config.floor = clampNumber(floorRaw, 0.5, 1);
  }
  // floor 永远 ≤ 1 - perExerciseDeload（保证第 1 个已排动作也至少有微降空间语义一致）
  if (config.floor > 1 - config.perExerciseDeload) {
    config.floor = clampNumber(1 - config.perExerciseDeload, 0.5, 1);
  }
  return config;
}

// ---------------------------------------------------------------------------
// 当日已排条目（Repository 形状）
// ---------------------------------------------------------------------------

/** 当日计划条目（计划上下文聚合输入；来自 WeeklyPlanRepository） */
export interface PlanContextEntry {
  exercise_id: string;
  exercise_name: string;
  exercise_type: string;
  primary_muscles: readonly string[];
  target_sets: number;
  sort_order: number;
}

/** 单肌群当日已排聚合 */
export interface MuscleDailyLoad {
  muscle: string;
  /** 去重动作列表（保持传入顺序 = 计划内 sort_order 序） */
  exercises: readonly { exercise_id: string; exercise_name: string }[];
  /** 当日该肌群总组数（跨动作求和） */
  totalSets: number;
}

/**
 * 当日条目 → 每主肌群聚合（每条目只按其第一主肌群计入，确定性优先；
 * 纯有氧 primary_muscles 为空 → 不参与疲劳调度）。
 * entries 需按 plan_entries.sort_order 升序传入（Repository 保证）——
 * exercises 列表顺序即计划内顺序，决定 prior 位次。
 */
export function aggregateDailyMuscleLoads(
  entries: readonly PlanContextEntry[],
): Map<string, MuscleDailyLoad> {
  const loads = new Map<string, MuscleDailyLoad>();
  for (const entry of entries) {
    const muscle = entry.primary_muscles[0];
    if (!muscle) continue;
    let load = loads.get(muscle);
    if (!load) {
      load = { muscle, exercises: [], totalSets: 0 };
      loads.set(muscle, load);
    }
    load.totalSets += entry.target_sets;
    const seen = load.exercises.some(
      (e) => e.exercise_id === entry.exercise_id,
    );
    if (!seen) {
      load.exercises = [
        ...load.exercises,
        { exercise_id: entry.exercise_id, exercise_name: entry.exercise_name },
      ];
    }
  }
  return loads;
}

// ---------------------------------------------------------------------------
// 因子推导
// ---------------------------------------------------------------------------

export interface PlanContextFactor {
  /** 实际生效降载系数（1 = 无降载） */
  factor: number;
  /** 当日已排同主肌群、排在本动作之前的去重动作数 */
  prior_same_muscle_exercises: number;
  /** 生效肌群（第一主肌群；无肌群时 undefined = 不调制） */
  muscle?: string;
  /** 该肌群当日已排总组数 */
  today_planned_sets: number;
}

/**
 * 单动作的计划上下文因子。
 * 动作在当日计划内 → 取其在同肌群有序列表中的位次；不在计划内 → 该肌群
 * 全部已排动作都算「已在前」（如当日已排 3 个胸动作，第 4 个胸动作无论
 * 是否入计划都按 3 计）。
 */
export function planContextFactor(
  exercise: {
    exercise_id: string;
    primary_muscles: readonly string[];
  },
  loads: ReadonlyMap<string, MuscleDailyLoad>,
  config: PlanContextConfig = resolvePlanContextConfig(),
): PlanContextFactor {
  const muscle = exercise.primary_muscles[0];
  if (!muscle) {
    return {
      factor: 1,
      prior_same_muscle_exercises: 0,
      today_planned_sets: 0,
    };
  }
  const load = loads.get(muscle);
  if (!load) {
    return {
      factor: 1,
      prior_same_muscle_exercises: 0,
      muscle,
      today_planned_sets: 0,
    };
  }
  const index = load.exercises.findIndex(
    (e) => e.exercise_id === exercise.exercise_id,
  );
  const prior = index >= 0 ? index : load.exercises.length;
  const factor = Math.max(config.floor, 1 - config.perExerciseDeload * prior);
  return {
    factor,
    prior_same_muscle_exercises: prior,
    muscle,
    today_planned_sets: load.totalSets,
  };
}

// ---------------------------------------------------------------------------
// 因子应用（computeBaseline 输出之上的有界乘法调制）
// ---------------------------------------------------------------------------

/**
 * 把降载因子应用到 baseline 数值：
 * - weight / duration_sec / distance_m：直接乘（数值域本身就 ≥0）
 * - reps：线性缩放四舍五入（自重类的容量通道）
 * - set_count / target_rpe：结构参数，不动
 * 纯函数、无取整网格（取整由 finalizeValues 收尾，保持与既有调制链一致）。
 */
export function applyPlanContextFactor(
  values: SuggestionValues,
  factor: number,
): SuggestionValues {
  if (factor >= 1) return values;
  const out: SuggestionValues = { ...values };
  if (out.weight !== undefined) out.weight = out.weight * factor;
  if (out.duration_sec !== undefined)
    out.duration_sec = out.duration_sec * factor;
  if (out.distance_m !== undefined) out.distance_m = out.distance_m * factor;
  if (out.reps !== undefined) out.reps = Math.round(out.reps * factor);
  return out;
}
