/**
 * Suggestion Profiles - 能力剖面构建（锚点推导 + 画像调制因子）
 *
 * 「应用建议」科学计算的根基：为每个动作构建 RPE 无关的能力剖面
 * （CapabilityProfile），数据源四级降级：
 *   anchor > history > bodyweight_estimate > type_default
 *
 * 现状：profile_dynamic.load_anchors 无常规写入方（仅 admin/Agent 工具），
 * 因此 history 级推导是让建议「有锚点」的关键路径。
 *
 * 红线：本模块只做确定性算术（e1RM/系数/钳制），不涉及任何 LLM。
 */

import {
  BODYWEIGHT_COEFFICIENTS,
  estimate1RM,
  normalizeSuggestionExerciseType,
  type CapabilityProfile,
  type SuggestionFingerprintInput,
  type SuggestionModifiers,
  type SuggestionValues,
  type ActiveLimitation,
  type ProfileDynamic,
  type ProfileStatic,
} from 'shared/contracts';

// ---------------------------------------------------------------------------
// 输入上下文（由 SuggestionService 经 Repository 组装，禁止在此直连库）
// ---------------------------------------------------------------------------

/** history_summary JSONB 的运行时形状（write_session 追加，typed schema 未覆盖） */
export interface HistoryExerciseRecord {
  name?: string;
  sets?: number;
  reps?: number;
  weight?: number;
  rpe?: number;
}

export interface HistorySessionRecord {
  date?: string;
  exercises?: HistoryExerciseRecord[];
}

export interface SuggestionUserContext {
  profileStatic: ProfileStatic | null;
  profileDynamic: ProfileDynamic | null;
  history: Record<string, unknown> | null;
}

/** 一次批量请求里的动作输入 */
export interface SuggestionExerciseInput {
  name: string;
  type: string;
  current?: SuggestionValues;
}

// ---------------------------------------------------------------------------
// 防御性取值（画像来自 JSONB，形状可能有历史漂移）
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseHistorySessions(history: Record<string, unknown> | null): HistorySessionRecord[] {
  const sessions = history?.sessions;
  if (!Array.isArray(sessions)) return [];
  return sessions.filter((s): s is HistorySessionRecord => !!asRecord(s));
}

function nameMatches(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_（）()]/g, '');
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------------------
// 锚点查表（flat v3 LoadAnchor）
// ---------------------------------------------------------------------------

interface FlatAnchor {
  best_weight?: number;
  best_reps?: number;
  est_1rm?: number;
  progression_level?: number;
  best_duration?: number;
  best_distance?: number;
  best_pace?: number;
  last_updated?: number;
}

function findAnchor(
  profileDynamic: ProfileDynamic | null,
  exerciseName: string,
): FlatAnchor | null {
  const anchors = asRecord((profileDynamic as unknown as Record<string, unknown> | null)?.load_anchors);
  if (!anchors) return null;
  for (const [key, value] of Object.entries(anchors)) {
    if (nameMatches(key, exerciseName)) {
      const rec = asRecord(value);
      if (!rec) continue;
      return {
        best_weight: num(rec.best_weight),
        best_reps: num(rec.best_reps),
        est_1rm: num(rec.est_1rm),
        progression_level: num(rec.progression_level),
        best_duration: num(rec.best_duration),
        best_distance: num(rec.best_distance),
        best_pace: num(rec.best_pace),
        last_updated: num(rec.last_updated),
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 历史推导（data_basis = 'history'）
// ---------------------------------------------------------------------------

export interface HistoryBest {
  bestE1RM: number;
  bestWeight: number;
  bestReps: number;
  lastDate: string | undefined;
  sessionCount: number;
}

/** 从 history sessions 里找该动作的最佳负荷记录（weight×reps → e1RM 最大者） */
export function deriveHistoryBest(
  sessions: HistorySessionRecord[],
  exerciseName: string,
): HistoryBest | null {
  let best: HistoryBest | null = null;
  let seen = 0;
  for (const session of sessions) {
    const records = Array.isArray(session.exercises) ? session.exercises : [];
    for (const record of records) {
      if (!record?.name || !nameMatches(record.name, exerciseName)) continue;
      seen += 1;
      const weight = num(record.weight) ?? 0;
      const reps = num(record.reps) ?? 0;
      if (weight <= 0 || reps < 1) continue;
      const e1rm = estimate1RM(weight, reps);
      if (!best || e1rm > best.bestE1RM) {
        best = {
          bestE1RM: e1rm,
          bestWeight: weight,
          bestReps: reps,
          lastDate: session.date,
          sessionCount: seen,
        };
      } else {
        best.sessionCount = seen;
      }
    }
  }
  return best;
}

/** 新近度置信度：14 天内 1.0，30 天内 0.8，90 天内 0.6，更早 0.4 */
export function recencyConfidence(isoDate: string | undefined, now = Date.now()): number {
  if (!isoDate) return 0.4;
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return 0.4;
  const days = (now - ts) / (24 * 60 * 60 * 1000);
  if (days <= 14) return 1;
  if (days <= 30) return 0.8;
  if (days <= 90) return 0.6;
  return 0.4;
}

// ---------------------------------------------------------------------------
// 画像调制因子（安全钳制的数据来源）
// ---------------------------------------------------------------------------

function injuryScale(profileDynamic: ProfileDynamic | null, now = Date.now()): number {
  const limitations = profileDynamic?.active_limitations ?? [];
  let scale = 1;
  for (const limitation of limitations as readonly ActiveLimitation[]) {
    if (!limitation?.part || !limitation.expire_at) continue;
    // 过期伤病忽略（自愈窗口）
    if (Date.parse(limitation.expire_at) <= now) continue;
    const severity = limitation.severity ?? 3;
    // severity 1-3 → 0.7；4-6 → 0.6；7-10 → 0.5（knowledge §3.3：伤病恢复期 50-70%）
    const s = severity >= 7 ? 0.5 : severity >= 4 ? 0.6 : 0.7;
    scale = Math.min(scale, s);
  }
  return scale;
}

function recoveryScale(profileDynamic: ProfileDynamic | null): number {
  const raw = asRecord((profileDynamic as unknown as Record<string, unknown> | null)?.recovery_state);
  if (!raw) return 1;
  const totalScore = num(raw.total_score);
  const cnsFusing = raw.cns_fusing === true;
  const fatigueLevel = typeof raw.fatigue_level === 'string' ? raw.fatigue_level : undefined;
  const poor =
    (totalScore !== undefined && totalScore < 50) ||
    cnsFusing ||
    fatigueLevel === 'high' ||
    fatigueLevel === 'very_high';
  return poor ? 0.85 : 1;
}

function noviceCap(fitnessLevel: string | undefined, hasRealHistory: boolean): number {
  if (fitnessLevel === 'beginner') return 0.7;
  if (!fitnessLevel || fitnessLevel === 'UNKNOWN') {
    // 无等级信息：有真实锚点/历史说明已在训练，取温和上限；否则按新手试探
    return hasRealHistory ? 0.85 : 0.7;
  }
  return 1;
}

export function computeModifiers(
  profileStatic: ProfileStatic | null,
  profileDynamic: ProfileDynamic | null,
  hasRealHistory: boolean,
  now = Date.now(),
): SuggestionModifiers {
  return {
    injury_scale: injuryScale(profileDynamic, now),
    novice_cap: noviceCap(profileStatic?.fitness_level, hasRealHistory),
    recovery_scale: recoveryScale(profileDynamic),
  };
}

// ---------------------------------------------------------------------------
// 体重系数（data_basis = 'bodyweight_estimate'）
// ---------------------------------------------------------------------------

/** 系数是「RPE~7.5 的工作重量/体重」，换算成 est_1rm 供统一强度公式使用 */
const COEFFICIENT_WORKING_PCT = 0.78;

function bodyweightEstimate(
  exerciseName: string,
  bodyweightKg: number | undefined,
  fitnessLevel: string | undefined,
): number | undefined {
  if (!bodyweightKg || bodyweightKg <= 0) return undefined;
  for (const entry of BODYWEIGHT_COEFFICIENTS) {
    if (entry.keywords.some((keyword) => exerciseName.includes(keyword))) {
      const [min, max] = entry.range;
      // 初学者/未知取下限，中级取中值，高级取上限（knowledge §3.2）
      const coef =
        fitnessLevel === 'advanced' ? max : fitnessLevel === 'intermediate' ? (min + max) / 2 : min;
      return (bodyweightKg * coef) / COEFFICIENT_WORKING_PCT;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 剖面构建（入口）
// ---------------------------------------------------------------------------

/**
 * 四级数据源构建单动作能力剖面：
 * 1. anchor            — profile_dynamic.load_anchors（flat v3）
 * 2. history           — history_summary.sessions 最佳负荷记录 → e1RM
 * 3. bodyweight_estimate — 体重系数表（plan-generation knowledge §3.2）
 * 4. type_default      — 类型默认基数
 */
export function buildCapabilityProfile(
  exerciseName: string,
  exerciseType: string,
  ctx: SuggestionUserContext,
  now = Date.now(),
): CapabilityProfile {
  const type = normalizeSuggestionExerciseType(exerciseType);
  const bodyweightKg = ctx.profileStatic?.weight ?? ctx.profileStatic?.basic_info?.weight;

  const anchor = findAnchor(ctx.profileDynamic, exerciseName);
  const sessions = parseHistorySessions(ctx.history);
  const historyBest = deriveHistoryBest(sessions, exerciseName);

  // 有氧类优先用锚点配速/距离
  if (type === 'cardio' || type === 'outdoor') {
    const modifiers = computeModifiers(ctx.profileStatic, ctx.profileDynamic, !!anchor || !!historyBest, now);
    return {
      exercise_name: exerciseName,
      exercise_type: type,
      data_basis: anchor || historyBest ? 'anchor' : 'type_default',
      best_pace_sec_per_km: anchor?.best_pace && anchor.best_pace > 0 ? anchor.best_pace : undefined,
      bodyweight_kg: bodyweightKg,
      modifiers,
    };
  }

  // 自重类：锚点的 progression_level / 次数记录
  if (type === 'bodyweight' || type === 'rep_training') {
    const modifiers = computeModifiers(ctx.profileStatic, ctx.profileDynamic, !!anchor || !!historyBest, now);
    return {
      exercise_name: exerciseName,
      exercise_type: type,
      data_basis: anchor ? 'anchor' : historyBest ? 'history' : 'type_default',
      progression_level: anchor?.progression_level,
      best_set: historyBest
        ? { reps: historyBest.bestReps, weight: 0 }
        : undefined,
      bodyweight_kg: bodyweightKg,
      anchor_confidence: anchor
        ? recencyConfidence(anchor.last_updated ? new Date(anchor.last_updated).toISOString() : undefined, now)
        : historyBest
          ? recencyConfidence(historyBest.lastDate, now)
          : undefined,
      modifiers,
    };
  }

  if (type === 'isometric') {
    const modifiers = computeModifiers(ctx.profileStatic, ctx.profileDynamic, !!anchor, now);
    return {
      exercise_name: exerciseName,
      exercise_type: type,
      data_basis: anchor ? 'anchor' : 'type_default',
      best_set: anchor?.best_duration ? { duration_sec: anchor.best_duration } : undefined,
      modifiers,
    };
  }

  if (type === 'flexibility' || type === 'unknown') {
    const modifiers = computeModifiers(ctx.profileStatic, ctx.profileDynamic, !!anchor || !!historyBest, now);
    return {
      exercise_name: exerciseName,
      exercise_type: type,
      data_basis: 'type_default',
      bodyweight_kg: bodyweightKg,
      modifiers,
    };
  }

  // 负重类（resistance/unilateral/heavy_weight/assisted）
  const fitnessLevel = ctx.profileStatic?.fitness_level;
  const anchorEst1rm =
    anchor?.est_1rm && anchor.est_1rm > 0
      ? anchor.est_1rm
      : anchor?.best_weight && anchor.best_weight > 0 && (anchor.best_reps ?? 1) >= 1
        ? estimate1RM(anchor.best_weight, anchor.best_reps ?? 1)
        : undefined;

  let dataBasis: CapabilityProfile['data_basis'];
  let est1rm: number | undefined;
  let bestSet: SuggestionValues | undefined;
  let confidence: number | undefined;

  if (anchorEst1rm && anchorEst1rm > 0) {
    dataBasis = 'anchor';
    est1rm = anchorEst1rm;
    bestSet = anchor?.best_weight
      ? { weight: anchor.best_weight, reps: anchor.best_reps }
      : undefined;
    confidence = anchor?.last_updated
      ? recencyConfidence(new Date(anchor.last_updated).toISOString(), now)
      : 0.8;
  } else if (historyBest && historyBest.bestE1RM > 0) {
    dataBasis = 'history';
    est1rm = historyBest.bestE1RM;
    bestSet = { weight: historyBest.bestWeight, reps: historyBest.bestReps };
    confidence = recencyConfidence(historyBest.lastDate, now);
  } else {
    const bwEstimate = bodyweightEstimate(exerciseName, bodyweightKg, fitnessLevel);
    if (bwEstimate && bwEstimate > 0) {
      dataBasis = 'bodyweight_estimate';
      est1rm = bwEstimate;
    } else {
      dataBasis = 'type_default';
    }
  }

  const modifiers = computeModifiers(ctx.profileStatic, ctx.profileDynamic, dataBasis === 'anchor' || dataBasis === 'history', now);

  return {
    exercise_name: exerciseName,
    exercise_type: type,
    data_basis: dataBasis,
    est_1rm: est1rm && est1rm > 0 ? Math.min(1000, est1rm) : undefined,
    best_set: bestSet,
    bodyweight_kg: bodyweightKg,
    anchor_confidence: confidence,
    modifiers,
  };
}

// ---------------------------------------------------------------------------
// 指纹输入组装（缓存失效判断的数据来源）
// ---------------------------------------------------------------------------

export function collectFingerprintInput(
  ctx: SuggestionUserContext,
  exercises: readonly SuggestionExerciseInput[],
  agentMode: 'off' | 'hybrid',
  now = Date.now(),
): SuggestionFingerprintInput {
  const static_ = ctx.profileStatic;
  const dynamicRaw = asRecord(ctx.profileDynamic);
  const anchorUpdates: Record<string, number> = {};
  if (dynamicRaw) {
    const anchors = asRecord(dynamicRaw.load_anchors);
    if (anchors) {
      for (const [key, value] of Object.entries(anchors)) {
        const rec = asRecord(value);
        const updated = num(rec?.last_updated);
        if (updated !== undefined) anchorUpdates[key] = updated;
      }
    }
  }

  const limitations = ((ctx.profileDynamic?.active_limitations ?? []) as readonly ActiveLimitation[])
    .filter((l) => l?.part && l.expire_at && Date.parse(l.expire_at) > now)
    .map((l) => `${l.part}:${l.severity ?? '?'}`);

  return {
    goal: static_?.preferences?.goal,
    fitness_level: static_?.fitness_level,
    bodyweight_kg: static_?.weight ?? static_?.basic_info?.weight,
    limitations,
    anchorUpdates,
    exercises: exercises.map((e) => `${e.name}:${normalizeSuggestionExerciseType(e.type)}`),
    agent_mode: agentMode,
  };
}
