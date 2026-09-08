// 结算汇总计算 —— 从 SettlementV2.tsx 内联函数抽取为纯函数（2026-09-08 Task 3，TDD 钉死算术口径）。
// 注意：App.tsx 另有一个简化版 calculateWorkoutStats（无 bodyweight 兜底、isometric 权重不同），
// 两端口径以本文件（SettlementV2 展示层）为准，后续统一时以此为基础。
import { Exercise } from '../../../types';
import { DEFAULT_BODYWEIGHT } from '../../../constants';

export interface SettlementSummary {
  totalVolume: number;
  totalSets: number;
}

/** 单个动作的容量：只计完成组。 */
export function calculateExerciseVolume(ex: Exercise): number {
  let vol = 0;
  const bodyweight = ex.referenceBodyweight || DEFAULT_BODYWEIGHT;
  const sets = Array.isArray(ex.sets) ? ex.sets : [];

  sets.forEach((set) => {
    if (!set.completed) return;

    const reps = set.reps || 0;
    const weight = set.weight || 0;
    const duration = set.duration || 0;

    switch (ex.type) {
      case 'resistance':
      case 'bodyweight':
      case 'assisted':
      case 'unilateral':
      case 'weight_only':
      case 'reps_only':
        vol += weight * reps;
        break;
      case 'cardio':
      case 'outdoor':
        break;
      case 'isometric':
        if (weight > 0) vol += weight * duration;
        else vol += bodyweight * duration;
        break;
    }
  });
  return vol;
}

/** 整个 session 的结算汇总。 */
export function computeSettlementSummary(exercises: Exercise[]): SettlementSummary {
  const totalVolume = exercises.reduce((acc, ex) => acc + calculateExerciseVolume(ex), 0);
  const totalSets = exercises.reduce(
    (acc, ex) => acc + (Array.isArray(ex.sets) ? ex.sets.filter(s => s.completed).length : 0),
    0
  );
  return { totalVolume, totalSets };
}
