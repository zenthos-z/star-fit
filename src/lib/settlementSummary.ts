// 结算汇总计算 —— 从 SettlementV2.tsx 内联函数抽取为纯函数（2026-09-08 Task 3，TDD 钉死算术口径）。
// ★容量口径统一（2026-09-16）：单组容量 setVolume 唯一定义在 src/utils/workoutSummary.ts，
// 本文件与 /api/sessions 传输层、History 页共用同一实现，杜绝「结算页 ≠ 落库 ≠ 历史页」三分裂。
// 语义：resistance/weight_only/reps_only = w×r；bodyweight = (bw+w)×r；
// assisted = max(0, bw−|w|)×r（负助力容量只算真实负荷）；unilateral = w×r×2；
// isometric = (w>0 ? w : bw兜底)×duration；cardio/outdoor = 0。
import { Exercise } from '@/src/types/legacy';
import { setVolume } from '../utils/workoutSummary';

export interface SettlementSummary {
  totalVolume: number;
  totalSets: number;
  /** 可选：全部完成组的平均心率（任一组缺心率则整体缺失） */
  avgHr?: number;
}

/** 单个动作的容量：只计完成组。 */
export function calculateExerciseVolume(ex: Exercise): number {
  let vol = 0;
  const sets = Array.isArray(ex.sets) ? ex.sets : [];

  sets.forEach((set) => {
    if (!set.completed) return;
    vol += setVolume(ex, set);
  });
  return vol;
}

/** 整个 session 的结算汇总（容量/完成组数/可选平均心率）。App 端训练完成统计与 Settlement 展示共用此口径。 */
export function computeSettlementSummary(exercises: Exercise[]): SettlementSummary {
  const totalVolume = exercises.reduce((acc, ex) => acc + calculateExerciseVolume(ex), 0);
  const totalSets = exercises.reduce(
    (acc, ex) => acc + (Array.isArray(ex.sets) ? ex.sets.filter(s => s.completed).length : 0),
    0
  );

  // 平均心率：取全部完成组的心率均值；任一完成组缺心率则整体视为缺失（宁缺勿错）
  let hrSum = 0;
  let hrCount = 0;
  let hrMissing = false;
  exercises.forEach(ex => {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    sets.forEach(s => {
      if (!s.completed) return;
      const hr = (s as { heartRate?: number }).heartRate;
      if (typeof hr === 'number' && !Number.isNaN(hr)) {
        hrSum += hr;
        hrCount += 1;
      } else {
        hrMissing = true;
      }
    });
  });
  const avgHr = !hrMissing && hrCount > 0 ? Math.round(hrSum / hrCount) : undefined;

  return { totalVolume, totalSets, ...(avgHr !== undefined ? { avgHr } : {}) };
}
