/**
 * Exercise Suggestion Contracts - 动作建议值契约（单一真理源）
 *
 * 「动作设置界面-应用建议」的数据契约与科学计算纯函数。
 * 前后端共用：后端 SuggestionService 用其计算/校验，前端 SuggestionService
 * 用 deriveSuggestion 在本地从缓存的能力剖面确定性导出任意 RPE 的建议值。
 *
 * 红线约束（CLAUDE.md）：
 * - AI 绝对禁止介入算术计算 → Agent 唯一合法输出是 AdjustmentIntent
 *   （有界的 multiply/delta 调整意图 + 理由文本），数值始终由本文件的
 *   纯函数计算与钳制，最终结果必须过 ExerciseSuggestionSchema 校验。
 * - 单位约定：weight=kg, duration=秒, distance=米, snake_case。
 *
 * @version 1.0.0
 */

import { z } from 'zod';

// ============================================================================
// 版本常量（进入 context_fingerprint，改公式/表值请 +1 以失效前端缓存）
// ============================================================================

export const SUGGESTION_FORMULA_VERSION = 1;

// ============================================================================
// 动作类型（白名单 string，兼容三处词表漂移，统一经 normalize 收敛）
// ============================================================================

export const SUGGESTION_EXERCISE_TYPES = [
  'resistance',
  'unilateral',
  'bodyweight',
  'assisted',
  'isometric',
  'cardio',
  'outdoor',
  'heavy_weight',
  'rep_training',
  'flexibility',
  'unknown',
] as const;

export type SuggestionExerciseType = (typeof SUGGESTION_EXERCISE_TYPES)[number];

/**
 * 收敛各处漂移的动作类型词表：
 * - protocol.ts 的 weight_only / reps_only 笔误 → heavy_weight / rep_training
 * - contracts ExerciseAction 的 5 枚举小写子集 → 原样保留
 * - 未知值 → 'unknown'
 */
export function normalizeSuggestionExerciseType(raw: string): SuggestionExerciseType {
  const mapped: Record<string, SuggestionExerciseType> = {
    weight_only: 'heavy_weight',
    reps_only: 'rep_training',
    strength: 'resistance',
    hiit: 'cardio',
    stretch: 'flexibility',
  };
  const lower = String(raw || '').toLowerCase().trim();
  if ((SUGGESTION_EXERCISE_TYPES as readonly string[]).includes(lower)) {
    return lower as SuggestionExerciseType;
  }
  return mapped[lower] ?? 'unknown';
}

// ============================================================================
// 数值载荷与能力剖面
// ============================================================================

/** 单动作建议数值（每组均值基准 + 组数 + Agent 可建议的目标 RPE） */
export const SuggestionValuesSchema = z.object({
  weight: z.number().min(0).optional(),
  reps: z.number().int().min(0).optional(),
  duration_sec: z.number().min(0).optional(),
  distance_m: z.number().min(0).optional(),
  set_count: z.number().int().min(1).max(10).optional(),
  target_rpe: z.number().min(1).max(10).optional(),
});
export type SuggestionValues = z.infer<typeof SuggestionValuesSchema>;

/** 画像调制因子（后端算好存入剖面，前端 derive 时复用，保证离线一致） */
export const SuggestionModifiersSchema = z.object({
  /** 伤病降载（active_limitations 未过期 → 0.5-0.7） */
  injury_scale: z.number().min(0.5).max(1),
  /** 新手/无历史上限（首次试探 0.7） */
  novice_cap: z.number().min(0.5).max(1),
  /** 恢复状态降载（recovery_state 差 → 0.85） */
  recovery_scale: z.number().min(0.5).max(1),
});
export type SuggestionModifiers = z.infer<typeof SuggestionModifiersSchema>;

/**
 * 能力剖面：RPE 无关的用户单动作能力快照（缓存的核心）。
 * data_basis 四级降级：anchor > history > bodyweight_estimate > type_default
 */
export const CapabilityProfileSchema = z.object({
  exercise_name: z.string().min(1),
  exercise_type: z.string().min(1),
  data_basis: z.enum(['anchor', 'history', 'bodyweight_estimate', 'type_default']),
  est_1rm: z.number().positive().optional(),
  best_set: SuggestionValuesSchema.optional(),
  best_pace_sec_per_km: z.number().positive().optional(),
  progression_level: z.number().min(1).optional(),
  bodyweight_kg: z.number().positive().optional(),
  anchor_confidence: z.number().min(0).max(1).optional(),
  modifiers: SuggestionModifiersSchema,
});
export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;

// ============================================================================
// Agent 调整意图（LLM 唯一允许输出的数值形态，非绝对值）
// ============================================================================

export const ADJUSTMENT_BOUNDS = {
  /** multiply 模式上下限（重量/时长/距离） */
  multiply: { min: 0.7, max: 1.15 },
  /** delta 模式上下限（次数） */
  delta: { min: -3, max: 3 },
  /** 组数只允许 delta */
  set_count_delta: { min: -2, max: 1 },
  /** 目标 RPE 只允许 delta */
  target_rpe_delta: { min: -1, max: 1 },
} as const;

export const AdjustmentActionSchema = z.object({
  field: z.enum(['weight', 'reps', 'duration_sec', 'distance_m', 'set_count', 'target_rpe']),
  mode: z.enum(['multiply', 'delta']),
  value: z.number(),
});
export type AdjustmentAction = z.infer<typeof AdjustmentActionSchema>;

export const AdjustmentIntentSchema = z.object({
  exercise_name: z.string().min(1),
  actions: z.array(AdjustmentActionSchema).max(6).default([]),
  /** 中文理由 ≤80 字（modal 解释窗口展示） */
  reason: z.string().min(1).max(80),
  safety_note: z.string().max(80).optional(),
});
export type AdjustmentIntent = z.infer<typeof AdjustmentIntentSchema>;

/** Agent 围栏卡（仅后端内部解析，不进 /api/chat 的 uiHint 联合契约） */
export const SuggestionAdjustmentCardSchema = z.object({
  type: z.literal('suggestion_adjustment'),
  adjustments: z.array(AdjustmentIntentSchema),
});
export type SuggestionAdjustmentCard = z.infer<typeof SuggestionAdjustmentCardSchema>;

// ============================================================================
// 请求 / 响应 / 缓存条目
// ============================================================================

export const SuggestionRequestSchema = z.object({
  exercises: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string().min(1),
        /** 用户当前配置（只读参考，供 Agent 感知已手调） */
        current: SuggestionValuesSchema.optional(),
      })
    )
    .min(1)
    .max(20),
  target_rpe: z.number().min(1).max(10).default(7),
});
export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;

/** 响应单项 = 前端缓存条目（同一 schema 复用，缓存零转换） */
export const ExerciseSuggestionSchema = z.object({
  exercise_name: z.string().min(1),
  exercise_type: z.string().min(1),
  /** 生成时的 RPE；滑块换 RPE 后前端用 deriveSuggestion 本地导出 */
  baseline_rpe: z.number().min(1).max(10),
  values: SuggestionValuesSchema,
  profile: CapabilityProfileSchema,
  /** 意图随缓存走，derive 时在新 RPE 的 baseline 上重放 */
  adjustment: AdjustmentIntentSchema.optional(),
  /** 后端只产 formula|hybrid；cache|heuristic 是前端态 */
  source: z.enum(['formula', 'hybrid']),
  generated_at: z.number(),
  context_fingerprint: z.string(),
});
export type ExerciseSuggestion = z.infer<typeof ExerciseSuggestionSchema>;

export const SuggestionResponseSchema = z.object({
  suggestions: z.array(ExerciseSuggestionSchema),
  meta: z.object({
    context_fingerprint: z.string(),
    agent_mode: z.enum(['off', 'hybrid']),
    /** Agent 降级原因（必须记日志 — 契约红线） */
    degraded_reason: z.string().optional(),
  }),
});
export type SuggestionResponse = z.infer<typeof SuggestionResponseSchema>;

// ============================================================================
// 科学计算表（单测钉死；依据 plan-generation/strength-training-designer 知识
// + RTS RPE chart 标准值交叉校准）
// ============================================================================

/**
 * RPE×次数 → %1RM 对照表（RTS RPE chart 惯用值）。
 * 行 = 次数 1-12；列 = RPE 10/9/8/7/6（半档 RPE 线性内插）。
 * 与项目知识交叉校准：增肌 8-12 次 RPE7-8 → 71-80%（知识表 65-80% ✓）；
 * 力量 3-6 次 RPE8-9 → 83.5-90.5%（知识表 85-95%，宁轻勿重取下沿）。
 */
export const RPE_PERCENT_1RM: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  1: { 10: 100, 9: 96, 8: 92, 7: 89, 6: 86 },
  2: { 10: 95.5, 9: 92, 8: 89, 7: 86, 6: 82.5 },
  3: { 10: 94, 9: 90.5, 8: 87.5, 7: 84.5, 6: 81 },
  4: { 10: 92.5, 9: 89, 8: 86, 7: 83, 6: 80 },
  5: { 10: 91, 9: 87.5, 8: 84.5, 7: 81.5, 6: 78.5 },
  6: { 10: 89.5, 9: 86.5, 8: 83.5, 7: 80.5, 6: 77.5 },
  7: { 10: 88, 9: 85, 8: 82, 7: 79.5, 6: 76.5 },
  8: { 10: 86.5, 9: 83, 8: 80, 7: 77.5, 6: 74.5 },
  9: { 10: 85, 9: 81.5, 8: 78.5, 7: 76, 6: 73 },
  10: { 10: 83.5, 9: 80, 8: 77, 7: 74.5, 6: 71.5 },
  11: { 10: 82, 9: 78.5, 8: 75.5, 7: 72.5, 6: 69.5 },
  12: { 10: 80.5, 9: 77, 8: 74, 7: 71, 6: 68 },
};

/** 训练目标 → 目标次数区间（plan-generation knowledge §2.3/§7.2） */
export const GOAL_REP_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  strength: [3, 6],
  muscle_gain: [8, 12],
  fat_loss: [12, 20],
  endurance: [15, 20],
  health: [10, 15],
  general_fitness: [10, 15],
};

/**
 * 体重系数表（plan-generation knowledge §3.2，无历史时的初始推算）。
 * 关键词匹配动作名；[min,max]：初学者/女性取下限，高级取上限。
 */
export const BODYWEIGHT_COEFFICIENTS: ReadonlyArray<{
  keywords: readonly string[];
  range: readonly [number, number];
}> = [
  { keywords: ['硬拉'], range: [0.5, 0.7] },
  { keywords: ['深蹲'], range: [0.4, 0.6] },
  { keywords: ['卧推'], range: [0.4, 0.6] },
  { keywords: ['弯举', '侧平举', '飞鸟', '屈伸', '提拉', '耸肩', '弯举'], range: [0.1, 0.2] },
  { keywords: ['腿屈伸', '腿弯举', '腿举', '提踵'], range: [0.2, 0.3] },
];

/** 无锚点且无匹配系数时的兜底基数（kg，沿用旧 predictMetrics 量级） */
export const TYPE_DEFAULT_WEIGHT: Readonly<Record<string, number>> = {
  resistance: 40,
  unilateral: 20,
  heavy_weight: 60,
  assisted: 20,
};

/** 默认组数（non-big-three-guide：复合 3-4 / 自重 3 / 孤立 3 / 有氧 1） */
export const DEFAULT_SET_COUNT: Readonly<Record<string, number>> = {
  resistance: 4,
  unilateral: 3,
  heavy_weight: 4,
  bodyweight: 3,
  rep_training: 3,
  assisted: 3,
  isometric: 3,
  cardio: 1,
  outdoor: 1,
  flexibility: 2,
  unknown: 3,
};

/** 各类型裁剪后保留的字段（语义对齐前端 EXERCISE_TYPES_CONFIG.fields） */
export const FIELDS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  resistance: ['weight', 'reps', 'set_count', 'target_rpe'],
  unilateral: ['weight', 'reps', 'set_count', 'target_rpe'],
  heavy_weight: ['weight', 'reps', 'set_count', 'target_rpe'],
  assisted: ['weight', 'reps', 'set_count', 'target_rpe'],
  bodyweight: ['reps', 'set_count', 'target_rpe'],
  rep_training: ['reps', 'set_count', 'target_rpe'],
  isometric: ['duration_sec', 'set_count', 'target_rpe'],
  cardio: ['duration_sec', 'distance_m', 'set_count', 'target_rpe'],
  outdoor: ['duration_sec', 'distance_m', 'set_count', 'target_rpe'],
  flexibility: ['duration_sec', 'set_count'],
  unknown: ['weight', 'reps', 'duration_sec', 'distance_m', 'set_count', 'target_rpe'],
};

// ============================================================================
// 纯函数（前后端单一算术来源）
// ============================================================================

/**
 * RPE×次数 → %1RM（1-12 查表 + 半档线性内插；>12 次按每多 1 次 −2% 外推，下限 40%）。
 */
export function rpeToPercent1RM(reps: number, rpe: number): number {
  const clampedRpe = Math.min(10, Math.max(6, rpe));
  const whole = Math.min(10, Math.max(6, Math.floor(clampedRpe)));
  const frac = clampedRpe - whole;
  const next = Math.min(10, whole + 1);
  const rowFor = (r: number): number => {
    const n = Math.min(12, Math.max(1, Math.round(r)));
    const row = RPE_PERCENT_1RM[n];
    if (r > 12) {
      // 外推：12 次表值 − 每多 1 次 2%
      return row[whole] - (r - 12) * 2;
    }
    return row[whole];
  };
  const base = rowFor(reps);
  if (frac === 0 || next === whole) return Math.max(40, base);
  const rowN = Math.min(12, Math.max(1, Math.round(reps)));
  const interpolated =
    reps > 12
      ? base
      : base + frac * (RPE_PERCENT_1RM[rowN][next] - RPE_PERCENT_1RM[rowN][whole]);
  return Math.max(40, Math.min(100, interpolated));
}

/** 目标次数：goal 定区间，RPE 在区间内定位（低 RPE→高次数端，floor 保守） */
export function repsForRpe(rpe: number, goal?: string): number {
  const [min, max] = GOAL_REP_RANGES[goal ?? 'muscle_gain'] ?? GOAL_REP_RANGES.muscle_gain;
  const t = Math.min(1, Math.max(0, (10 - rpe) / 4));
  return Math.floor(min + t * (max - min));
}

/**
 * e1RM 估算：reps≤12 用 Brzycki（w×36/(37−reps)），reps>12 用 Epley（w×(1+reps/30)）。
 */
export function estimate1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps < 1) return 0;
  if (reps === 1) return weight;
  if (reps <= 12) return (weight * 36) / (37 - reps);
  return weight * (1 + reps / 30);
}

/** 有氧配速（秒/公里）→ 时长（秒）下的距离（米） */
export function distanceFromPace(paceSecPerKm: number, durationSec: number): number {
  if (paceSecPerKm <= 0 || durationSec <= 0) return 0;
  return (durationSec / paceSecPerKm) * 1000;
}

/** 安全乘子：画像调制因子相乘（每项 ≤1，复合只会更保守） */
function safetyMultiplier(mods: SuggestionModifiers): number {
  return mods.injury_scale * mods.novice_cap * mods.recovery_scale;
}

/**
 * 剖面 + 类型 + RPE → baseline 建议数值（Service 算术核心）。
 * 纯确定性：同一输入永远同一输出（前端离线 derive 与后端一致）。
 */
export function computeBaseline(
  profile: CapabilityProfile,
  type: string,
  rpe: number,
  goal?: string
): SuggestionValues {
  const t = normalizeSuggestionExerciseType(type);
  const mods = profile.modifiers;
  const safe = safetyMultiplier(mods);
  const values: SuggestionValues = {};

  if (t === 'cardio' || t === 'outdoor') {
    // 有氧：RPE 分区时长（对齐旧 predictMetrics 量级），距离按锚点配速或默认
    const minutes = rpe <= 6 ? 20 : rpe <= 8 ? 30 : 45;
    values.duration_sec = minutes * 60;
    values.distance_m = profile.best_pace_sec_per_km
      ? distanceFromPace(profile.best_pace_sec_per_km, values.duration_sec)
      : rpe <= 6
        ? 3000
        : rpe <= 8
          ? 5000
          : 8000;
    values.set_count = DEFAULT_SET_COUNT[t] ?? 1;
    return values;
  }

  if (t === 'isometric') {
    const base = rpe >= 9 ? 60 : rpe >= 8 ? 45 : 30;
    values.duration_sec = Math.round(base * safe);
    values.set_count = DEFAULT_SET_COUNT.isometric;
    return values;
  }

  if (t === 'bodyweight' || t === 'rep_training') {
    // 自重：次数区间 + 渐进等级加成
    let reps = Math.round(12 - (rpe - 7) * 2);
    if (profile.progression_level && profile.progression_level > 5) reps += 5;
    values.reps = Math.max(6, Math.min(20, reps));
    values.set_count = DEFAULT_SET_COUNT[t] ?? 3;
    return values;
  }

  if (t === 'flexibility') {
    values.duration_sec = 60;
    values.set_count = DEFAULT_SET_COUNT.flexibility;
    return values;
  }

  // 负重类（resistance/unilateral/heavy_weight/assisted/unknown 兜底）
  const reps = repsForRpe(rpe, goal);
  values.reps = reps;
  if (profile.est_1rm && profile.est_1rm > 0) {
    const pct = rpeToPercent1RM(reps, rpe) / 100;
    values.weight = profile.est_1rm * pct * safe;
  } else if (profile.best_set?.weight && profile.best_set.weight > 0) {
    // 历史最佳 ×85-95%（strength-training-designer non-big-three-guide）
    const factor = rpe >= 9 ? 0.95 : rpe >= 8 ? 0.9 : 0.85;
    values.weight = profile.best_set.weight * factor * safe;
  } else {
    values.weight = (TYPE_DEFAULT_WEIGHT[t] ?? TYPE_DEFAULT_WEIGHT.resistance) * safe;
  }
  values.set_count = DEFAULT_SET_COUNT[t] ?? DEFAULT_SET_COUNT.resistance;
  return values;
}

/**
 * 应用 Agent 调整意图：按 field 逐项乘/加，越界值静默钳制到 ADJUSTMENT_BOUNDS。
 * injuryLimited=true 时负重/时长/距离只许下调（伤病动作宁轻勿重）。
 */
export function applyAdjustment(
  values: SuggestionValues,
  intent: AdjustmentIntent | undefined,
  opts?: { injuryLimited?: boolean }
): SuggestionValues {
  if (!intent || intent.actions.length === 0) return values;
  const out: SuggestionValues = { ...values };
  for (const action of intent.actions) {
    const { field, mode, value } = action;
    if (field === 'target_rpe') {
      if (mode !== 'delta') continue;
      const delta = clamp(
        value,
        ADJUSTMENT_BOUNDS.target_rpe_delta.min,
        ADJUSTMENT_BOUNDS.target_rpe_delta.max
      );
      const current = out.target_rpe;
      if (current !== undefined) {
        out.target_rpe = clamp(current + delta, 1, 10);
      }
      continue;
    }
    if (field === 'set_count') {
      if (mode !== 'delta') continue;
      const delta = clamp(
        value,
        ADJUSTMENT_BOUNDS.set_count_delta.min,
        ADJUSTMENT_BOUNDS.set_count_delta.max
      );
      const current = out.set_count;
      if (current !== undefined) {
        out.set_count = Math.round(clamp(current + delta, 1, 10));
      }
      continue;
    }
    const current = out[field as 'weight' | 'reps' | 'duration_sec' | 'distance_m'];
    if (current === undefined) continue;
    let next: number;
    if (mode === 'multiply') {
      let m = clamp(value, ADJUSTMENT_BOUNDS.multiply.min, ADJUSTMENT_BOUNDS.multiply.max);
      if (opts?.injuryLimited) m = Math.min(m, 1);
      next = current * m;
    } else {
      let d = clamp(value, ADJUSTMENT_BOUNDS.delta.min, ADJUSTMENT_BOUNDS.delta.max);
      if (opts?.injuryLimited) d = Math.min(d, 0);
      next = current + d;
    }
    (out as Record<string, number | undefined>)[field] = Math.max(0, next);
  }
  return out;
}

/**
 * 终值整备：取整（weight 2.5kg / duration 30s / distance 100m）、reps/set_count
 * 取整钳制、按类型裁掉无关字段。computeBaseline 与 deriveSuggestion 的收尾必经。
 */
export function finalizeValues(values: SuggestionValues, exerciseType: string): SuggestionValues {
  const t = normalizeSuggestionExerciseType(exerciseType);
  const allowed = FIELDS_BY_TYPE[t] ?? FIELDS_BY_TYPE.unknown;
  const out: SuggestionValues = {};
  if (values.weight !== undefined && allowed.includes('weight')) {
    const rounded = Math.round(values.weight / 2.5) * 2.5;
    out.weight = values.weight > 0 ? Math.max(2.5, rounded) : 0;
  }
  if (values.reps !== undefined && allowed.includes('reps')) {
    out.reps = Math.round(clamp(values.reps, 0, 200));
  }
  if (values.duration_sec !== undefined && allowed.includes('duration_sec')) {
    // 15s 网格：保住等长收缩常用的 45s（30s 网格会把它吃成 60s）
    out.duration_sec = Math.round(values.duration_sec / 15) * 15;
  }
  if (values.distance_m !== undefined && allowed.includes('distance_m')) {
    out.distance_m = Math.round(values.distance_m / 100) * 100;
  }
  if (values.set_count !== undefined && allowed.includes('set_count')) {
    out.set_count = Math.round(clamp(values.set_count, 1, 10));
  }
  if (values.target_rpe !== undefined && allowed.includes('target_rpe')) {
    out.target_rpe = clamp(values.target_rpe, 1, 10);
  }
  return out;
}

/**
 * 前端离线导出（缓存核心路径）：缓存条目的 profile 在新 RPE 上重算 baseline，
 * 并重放缓存的 adjustment 意图（比例/增量语义与 RPE 无关），最后 finalize。
 */
export function deriveSuggestion(
  entry: Pick<ExerciseSuggestion, 'profile' | 'adjustment' | 'exercise_type'>,
  targetRpe: number,
  goal?: string
): SuggestionValues {
  const baseline = computeBaseline(entry.profile, entry.exercise_type, targetRpe, goal);
  const adjusted = applyAdjustment(baseline, entry.adjustment, {
    injuryLimited: entry.profile.modifiers.injury_scale < 1,
  });
  return finalizeValues(adjusted, entry.exercise_type);
}

// ============================================================================
// 上下文指纹（缓存失效判断）
// ============================================================================

export interface SuggestionFingerprintInput {
  goal?: string;
  fitness_level?: string;
  bodyweight_kg?: number;
  /** 未过期伤病签名（part:severity 排序后拼接） */
  limitations?: readonly string[];
  /** 各动作锚点 last_updated（name → epoch ms） */
  anchorUpdates?: Readonly<Record<string, number>>;
  /** 本次批量涉及的动作（name:type 排序） */
  exercises?: readonly string[];
  agent_mode: 'off' | 'hybrid';
}

/** FNV-1a 32 位哈希 → 8 位十六进制（确定性、无依赖） */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 上下文指纹：goal/等级/体重/伤病/锚点更新时间/公式版本/agent 模式/动作集合。
 * 任一变化 → 指纹变化 → 前端判定缓存过期需重拉。
 */
export function computeContextFingerprint(input: SuggestionFingerprintInput): string {
  const parts: string[] = [
    `v${SUGGESTION_FORMULA_VERSION}`,
    `mode:${input.agent_mode}`,
    `goal:${input.goal ?? '-'}`,
    `lvl:${input.fitness_level ?? '-'}`,
    `bw:${input.bodyweight_kg ?? '-'}`,
    `lim:${[...(input.limitations ?? [])].sort().join(',') || '-'}`,
  ];
  const anchorEntries = Object.entries(input.anchorUpdates ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (anchorEntries.length > 0) {
    parts.push(`anchors:${anchorEntries.map(([k, v]) => `${k}@${Math.floor(v / 1000)}`).join(',')}`);
  }
  if (input.exercises?.length) {
    parts.push(`ex:${[...input.exercises].sort().join(',')}`);
  }
  return fnv1a(parts.join('|'));
}

// ============================================================================
// 内部工具
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
