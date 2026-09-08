import { describe, it, expect } from 'vitest';
import { computeSettlementSummary, calculateExerciseVolume } from '../settlementSummary';
import { Exercise, ExerciseType } from '../../../../types';

const mkSet = (p: Partial<{ weight: number; reps: number; duration: number; completed: boolean; heartRate: number }>) => ({
  id: Math.random().toString(36).slice(2),
  completed: false,
  ...p,
});

const mkEx = (type: ExerciseType, sets: ReturnType<typeof mkSet>[], referenceBodyweight?: number): Exercise => ({
  id: Math.random().toString(36).slice(2),
  name: type,
  type,
  sets,
  ...(referenceBodyweight ? { referenceBodyweight } : {}),
} as unknown as Exercise);

describe('calculateExerciseVolume', () => {
  it('力量动作：容量 = Σ(重量×次数)，未完成组不计', () => {
    const ex = mkEx('resistance', [
      mkSet({ weight: 60, reps: 10, completed: true }),
      mkSet({ weight: 60, reps: 8, completed: true }),
      mkSet({ weight: 100, reps: 5, completed: false }), // 未完成
    ]);
    expect(calculateExerciseVolume(ex)).toBe(60 * 10 + 60 * 8);
  });

  it('自重动作无配重时容量为 0（weight 默认 0）', () => {
    const ex = mkEx('bodyweight', [mkSet({ reps: 20, completed: true })]);
    expect(calculateExerciseVolume(ex)).toBe(0);
  });

  it('自重动作带配重时按 weight×reps 计', () => {
    const ex = mkEx('bodyweight', [mkSet({ weight: 10, reps: 20, completed: true })]);
    expect(calculateExerciseVolume(ex)).toBe(200);
  });

  it('等长动作有配重：容量 = weight×duration', () => {
    const ex = mkEx('isometric', [mkSet({ weight: 40, duration: 30, completed: true })]);
    expect(calculateExerciseVolume(ex)).toBe(40 * 30);
  });

  it('等长动作无配重：容量 = referenceBodyweight×duration', () => {
    const ex = mkEx('isometric', [mkSet({ duration: 30, completed: true })], 80);
    expect(calculateExerciseVolume(ex)).toBe(80 * 30);
  });

  it('等长动作无配重且无 referenceBodyweight：兜底 75kg', () => {
    const ex = mkEx('isometric', [mkSet({ duration: 30, completed: true })]);
    expect(calculateExerciseVolume(ex)).toBe(75 * 30);
  });

  it('cardio/outdoor 不计容量', () => {
    const ex = mkEx('cardio', [mkSet({ duration: 1800, completed: true })]);
    expect(calculateExerciseVolume(ex)).toBe(0);
  });

  it('sets 非数组时防御为 0', () => {
    const ex = { id: 'x', name: 'x', type: 'resistance', sets: null } as unknown as Exercise;
    expect(calculateExerciseVolume(ex)).toBe(0);
  });
});

describe('computeSettlementSummary', () => {
  it('空 session：全 0', () => {
    expect(computeSettlementSummary([])).toEqual({ totalVolume: 0, totalSets: 0 });
  });

  it('多动作汇总：容量累加、组数只计完成', () => {
    const a = mkEx('resistance', [
      mkSet({ weight: 50, reps: 10, completed: true }),
      mkSet({ weight: 50, reps: 10, completed: true }),
      mkSet({ weight: 55, reps: 8, completed: false }),
    ]);
    const b = mkEx('cardio', [mkSet({ duration: 600, completed: true })]);
    expect(computeSettlementSummary([a, b])).toEqual({
      totalVolume: 50 * 10 * 2,
      totalSets: 3, // a 的 2 个完成组 + cardio 的 1 个完成组
    });
  });

  it('等长无配重：用 referenceBodyweight 而非硬编码 75（与旧 App 端口径的差异点）', () => {
    const ex = mkEx('isometric', [mkSet({ duration: 60, completed: true })], 80);
    expect(computeSettlementSummary([ex])).toEqual({ totalVolume: 80 * 60, totalSets: 1 });
  });

  it('全部完成组都有心率：avgHr = 四舍五入均值', () => {
    const a = mkEx('cardio', [
      { ...mkSet({ duration: 60, completed: true }), heartRate: 140 },
      { ...mkSet({ duration: 60, completed: true }), heartRate: 151 },
    ]);
    expect(computeSettlementSummary([a]).avgHr).toBe(146); // (140+151)/2 = 145.5 → 146
  });

  it('任一完成组缺心率：avgHr 整体缺失（宁缺勿错）', () => {
    const a = mkEx('cardio', [
      { ...mkSet({ duration: 60, completed: true }), heartRate: 140 },
      mkSet({ duration: 60, completed: true }), // 无心率
    ]);
    expect(computeSettlementSummary([a]).avgHr).toBeUndefined();
  });

  it('未完成组的心率不参与均值', () => {
    const a = mkEx('cardio', [
      { ...mkSet({ duration: 60, completed: true }), heartRate: 140 },
      { ...mkSet({ duration: 60, completed: false }), heartRate: 200 },
    ]);
    expect(computeSettlementSummary([a]).avgHr).toBe(140);
  });
});
