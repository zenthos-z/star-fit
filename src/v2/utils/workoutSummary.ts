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

    if (ex.type === 'isometric') {
      // 等长收缩：容量 = 体重近似 × 时秒（维持既有口径）
      for (const s of completed) {
        const weight = (s.weight || 0) > 0 ? (s.weight as number) : 75;
        totalVolume += weight * (s.duration || 0);
      }
    } else if (isCardioLike(ex)) {
      totalCardioDurationSec += completed.reduce((sum, s) => sum + (s.duration || 0), 0);
      totalDistanceM += completed.reduce((sum, s) => sum + (s.distance || 0), 0);
    } else {
      totalVolume += completed.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
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
