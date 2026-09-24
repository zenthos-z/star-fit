/**
 * Type Bridge — 显式兼容层（legacy 记录模型 ↔ protocol 协议模型）
 *
 * γ批收敛说明（2026-09-24）：
 * - 前身 src/utils/typeBridge.ts 已消解：仅保留仍被引用的 convertSessionToWorkoutSession，
 *   其依赖的私有转换函数一并下沉至此；其余零调用符号（convertActionToExercise、
 *   convertWorkoutSessionToSession、UIHint 归一化系列）经全仓测绘确认无引用后删除。
 * - 两套类型各有所主、保留双套：
 *   legacy.ts  = 领域记录模型（Exercise/ExerciseSet/Session，老 UI 与存储/服务层引用面大）
 *   protocol.ts = v2 协议交换模型（ExerciseAction/WorkoutSession/UIHint，zod 派生）
 *   本文件是两者之间唯一显式桥接点。
 */
import { Exercise, Session } from './legacy';
import type { ExerciseAction } from './protocol';
import { WorkoutSession } from './protocol';

// Unified lowercase type system - no conversion needed
// Protocol now uses the same types as ExerciseType
const convertExerciseType = (oldType: string): any => {
  // Direct pass-through since both use lowercase
  return oldType || 'UNKNOWN';
};

const convertSessionStatus = (status: string): 'UNKNOWN' | 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' => {
  const statusMap: Record<string, 'UNKNOWN' | 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'> = {
    'idle': 'DRAFT',
    'active': 'IN_PROGRESS',
    'paused': 'IN_PROGRESS',
    'finished': 'COMPLETED'
  };
  return statusMap[status] || 'UNKNOWN';
};

const convertExerciseToAction = (exercise: Exercise): ExerciseAction => {
  return {
    protocol_version: '2.0.0',
    id: exercise.id,
    exerciseId: exercise.name.startsWith('fit://')
      ? exercise.name
      : `fit://library/exercise/${exercise.name}`,
    type: convertExerciseType(exercise.type),
    sets: exercise.sets.map((set, idx) => ({
      index: idx,
      reps: set.reps,
      weight: set.weight,
      duration: set.duration,
      distance: set.distance,
      rpe: set.rpe,
      status: set.completed ? 'COMPLETED' : 'PLANNED',
      timestamp: set.completed ? new Date().toISOString() : undefined,
      restEndTime: set.restEndTime
    })),
    uiHint: {
      cardType: exercise.uiHint?.cardType as any,
      pluginId: (exercise.uiHint as any)?.pluginId
    },
    metadata: {
      targetDuration: exercise.metadata?.targetDuration,
      targetDistance: exercise.metadata?.targetDistance,
      targetRpe: exercise.targetRpe,
      referenceBodyweight: exercise.referenceBodyweight,
      primaryMuscles: exercise.primaryMuscles,
      equipment: exercise.equipment,
      bodyCategory: exercise.bodyCategory,
      unilateral: exercise.unilateral,
      notes: exercise.notes,
      originalType: exercise.type,  // Dual insurance: preserve original type
      ...exercise.metadata
    }
  };
};

/**
 * legacy Session（记录模型）→ protocol WorkoutSession（协议模型）单向转换。
 * 唯一仍被业务引用的桥接函数（SettlementV2 结算链路）。
 */
export const convertSessionToWorkoutSession = (session: Session): WorkoutSession => {
  return {
    protocol_version: '2.0.0',
    id: session.id,
    userId: typeof localStorage !== 'undefined' ? (localStorage.getItem('starfit_user_id') || 'unknown') : 'unknown',
    status: convertSessionStatus(session.status),
    startTime: new Date(session.startTime).toISOString(),
    endTime: session.endTime ? new Date(session.endTime).toISOString() : undefined,
    exercises: session.exercises.map(convertExerciseToAction),
    environment: 'UNKNOWN',
    version: 1,
    metadata: {
      pausedDuration: session.pausedDuration,
      pauseStartTime: session.pauseStartTime
    }
  };
};
