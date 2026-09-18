/**
 * workoutSummary — 训练结束时的数据预处理层 (Phase 1 pre-processing)
 *
 * 职责：把前端原始的 Exercise[]（每类动作字段形态不同）整理成
 * POST /api/sessions 期望的「格式化训练记录」：
 *   - exercises[] 每个动作一行汇总（组数/完成组数/重量/次数/时长/距离/平均心率）
 *   - stats 会话级统计（总容量 / 完成组数 / 有氧总时长 / 总距离 / 平均心率）
 *
 * 设计约束（CLAUDE.md 红线）：
 *   - 算术计算在本模块完成，AI 绝不参与计算
 *   - 字段与 backend/src/controllers/sessionController.ts 的 Zod schema 对齐
 */

import type { Exercise, ExerciseSet } from '@/types';

/** 判断一组是否完成：兼容 completed 布尔与 protocol v2 的 status 字段 */
export const isSetCompleted = (set: ExerciseSet): boolean =>
  set.completed === true || set.status === 'COMPLETED';

/** 单个动作的格式化训练记录（与后端 ExerciseEntrySchema 对齐） */
export interface FormattedExerciseEntry {
  name: string;
  type: string;
  /** 计划组数 */
  sets: number;
  /** 实际完成组数 */
  completed_sets: number;
  /** 抗阻类：平均单次重量 kg（未完成/无重量时缺省） */
  weight?: number;
  /** 抗阻类：平均每组次数 */
  reps?: number;
  /** 有氧/等长：实际时长合计（秒） */
  duration?: number;
  /** 有氧/户外：实际距离合计（米） */
  distance?: number;
  /** 已记录心率的组平均心率 bpm */
  avg_hr?: number;
  /** 组间休息时长合计（秒，来自 completedAt/restEndTime 时间戳推算；无可推算段时缺省） */
  rest_sec?: number;
}

/** 会话级统计（与后端 StatsSchema 对齐） */
export interface WorkoutStats {
  totalVolume: number;
  setsCount: number;
  /** 有氧/户外实际时长合计（秒） */
  totalCardioDurationSec: number;
  /** 有氧/户外实际距离合计（米） */
  totalDistanceM: number;
  /** 全会话组级平均心率 bpm（无心率数据时 undefined） */
  avgHr?: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 有氧类动作：产出时长/距离统计，不参与重量容量 */
const isCardioLike = (ex: Exercise): boolean =>
  ex.type === 'cardio' || ex.type === 'outdoor' || ex.metadata?.isOutdoor === true;

/** 时长型动作（有氧/户外/等长）：时长是主要记录维度 */
const isDurationBased = (ex: Exercise): boolean => isCardioLike(ex) || ex.type === 'isometric';

/**
 * 单组容量（统一口径，与 src/v2/lib/settlementSummary.ts / components/History.tsx 一致）。
 * 2026-09-18 用户拍板「真实配重」语义：容量 = 真实负荷 × 次数。
 * - resistance/weight_only/reps_only: weight × reps
 * - bodyweight: (referenceBodyweight + weight) × reps（真实负荷=自重+追加配重；
 *   referenceBodyweight 缺失时不虚增——兜底 0，等用户画像补体重后自然修正）
 * - assisted: max(0, referenceBodyweight − |weight|) × reps（真实配重=自重−辅助重量；
 *   weight 为负助力，容量只算真实负荷，保证 totalVolume ≥ 0）
 * - unilateral: weight × reps × 2（左右各一遍，与 History/设置页口径一致）
 * - isometric: (weight>0 ? weight : referenceBodyweight 兜底0) × duration（维持近似容量口径）
 * - cardio/outdoor: 0（时长/距离另计）
 */
export const setVolume = (ex: Exercise, s: ExerciseSet): number => {
  const reps = s.reps || 0;
  const weight = s.weight || 0;
  const duration = s.duration || 0;
  // 自重基准：优先用户画像体重；未设置时不凭空捏造 75kg（新用户自重未知，虚增容量即 bug）
  const bodyweight = ex.referenceBodyweight || 0;

  switch (ex.type) {
    case 'resistance':
    case 'weight_only':
    case 'reps_only':
      return weight * reps;
    case 'bodyweight':
      return (bodyweight + weight) * reps;
    case 'assisted':
      return Math.max(0, bodyweight - Math.abs(weight)) * reps;
    case 'unilateral':
      return weight * reps * 2;
    case 'isometric':
      return (weight > 0 ? weight : bodyweight) * duration;
    default:
      return 0;
  }
};

/**
 * 从完成组序列聚合组间休息时长（秒）。
 * 休息 = min(restEndTime, 下一组completedAt) − 本组completedAt；
 * 任一时间戳缺失 / 计算为负（如手动提前结束休息后又完成下一组）则丢弃该段。
 */
const sumRestSeconds = (completedSets: ExerciseSet[]): number => {
  let total = 0;
  for (let i = 0; i < completedSets.length - 1; i++) {
    const cur = completedSets[i];
    const next = completedSets[i + 1];
    if (typeof cur.completedAt !== 'number' || typeof next.completedAt !== 'number') continue;
    const restEnd = Math.min(
      typeof cur.restEndTime === 'number' ? cur.restEndTime : Infinity,
      next.completedAt
    );
    const sec = Math.floor((restEnd - cur.completedAt) / 1000);
    if (sec > 0) total += sec;
  }
  return total;
};

/** 把一个动作的 sets 压缩成格式化记录（纯函数，不含会话时长） */
export function formatExerciseEntry(ex: Exercise): FormattedExerciseEntry {
  const sets = Array.isArray(ex.sets) ? ex.sets : [];
  const completed = sets.filter(isSetCompleted);

  const entry: FormattedExerciseEntry = {
    name: ex.name,
    type: ex.type,
    sets: sets.length,
    completed_sets: completed.length,
  };

  if (completed.length === 0) {
    return entry;
  }

  if (isDurationBased(ex)) {
    const duration = completed.reduce((sum, s) => sum + (s.duration || 0), 0);
    const distance = completed.reduce((sum, s) => sum + (s.distance || 0), 0);
    if (duration > 0) entry.duration = Math.round(duration);
    if (distance > 0) entry.distance = Math.round(distance);
  } else {
    // 抗阻/自重/单侧/辅助等：容量类统计（重量 × 次数）
    // assisted 用负重量表示助力（如 -10kg），必须保留 —— 用 !== undefined 判定
    const withWeight = completed.filter((s) => s.weight !== undefined && s.weight !== 0);
    if (withWeight.length > 0) {
      entry.weight = round1(withWeight.reduce((sum, s) => sum + (s.weight as number), 0) / withWeight.length);
    }
    const withReps = completed.filter((s) => (s.reps || 0) > 0);
    if (withReps.length > 0) {
      entry.reps = Math.round(withReps.reduce((sum, s) => sum + (s.reps || 0), 0) / withReps.length);
    }
  }

  // 心率：任何类型动作的组级心率都纳入平均
  const withHr = completed.filter((s) => (s.heartRate || 0) > 0);
  if (withHr.length > 0) {
    entry.avg_hr = Math.round(withHr.reduce((sum, s) => sum + (s.heartRate || 0), 0) / withHr.length);
  }

  // 休息：组间休息时长合计（≥2 个完成组且有 completedAt 时间戳才能推算）
  const restSec = sumRestSeconds(completed);
  if (restSec > 0) {
    entry.rest_sec = restSec;
  }

  return entry;
}

/** 会话级统计：容量 + 有氧时长/距离 + 全局平均心率 */
export function buildWorkoutStats(exercises: Exercise[]): WorkoutStats {
  let totalVolume = 0;
  let setsCount = 0;
  let totalCardioDurationSec = 0;
  let totalDistanceM = 0;
  let hrSum = 0;
  let hrCount = 0;

  for (const ex of exercises) {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    const completed = sets.filter(isSetCompleted);
    setsCount += completed.length;

    // 容量统一走 setVolume（口径与 settlementSummary/History 一致）；
    // 有氧/户外另计时长与距离
    if (isCardioLike(ex)) {
      totalCardioDurationSec += completed.reduce((sum, s) => sum + (s.duration || 0), 0);
      totalDistanceM += completed.reduce((sum, s) => sum + (s.distance || 0), 0);
    } else {
      for (const s of completed) {
        totalVolume += setVolume(ex, s);
      }
    }

    for (const s of completed) {
      if ((s.heartRate || 0) > 0) {
        hrSum += s.heartRate as number;
        hrCount += 1;
      }
    }
  }

  const stats: WorkoutStats = {
    totalVolume: Math.round(totalVolume),
    setsCount,
    totalCardioDurationSec: Math.round(totalCardioDurationSec),
    totalDistanceM: Math.round(totalDistanceM),
  };
  if (hrCount > 0) {
    stats.avgHr = Math.round(hrSum / hrCount);
  }
  return stats;
}

/** POST /api/sessions 的完整请求体（格式化训练记录） */
export interface SessionPersistPayload {
  sessionId: string;
  startTime: number;
  endTime: number;
  exercises: FormattedExerciseEntry[];
  stats: WorkoutStats;
  notes?: string;
}

/**
 * 从一个 finished Session 构建持久化 payload（Phase 1 的唯一数据出口）。
 * 返回 null 表示 session 无可持久化内容（无动作或时间戳非法）。
 */
export function buildSessionPayload(session: {
  id: string;
  startTime: number;
  endTime?: number;
  exercises: Exercise[];
  pausedDuration?: number;
}): SessionPersistPayload | null {
  const exercises = Array.isArray(session.exercises) ? session.exercises : [];
  if (exercises.length === 0) return null;
  const endTime = session.endTime || Date.now();
  if (!(session.startTime > 0) || session.startTime >= endTime) return null;

  return {
    sessionId: session.id,
    startTime: session.startTime,
    endTime,
    exercises: exercises.map(formatExerciseEntry),
    stats: buildWorkoutStats(exercises),
  };
}
