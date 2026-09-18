/**
 * workoutSummary — 逐类别动作卡片 → 格式化训练记录 单元测试
 *
 * 覆盖 types.ts ExerciseType 全部 9 类 + 边界（无心率/未完成组/空 sets/非法时间戳）。
 * 每类验证点（对应卡片 UI 可录入的字段）：
 *   resistance: 组数×重量×次数 → totalVolume + per-exercise weight/reps
 *   cardio:     时长 + 距离 + 心率 → totalCardioDurationSec/totalDistanceM/avgHr
 *   outdoor:    距离主导
 *   isometric:  时长 + 体重近似容量
 *   bodyweight: 次数（无重量不产生容量，避免虚增）
 *   assisted:   负重重量记录
 *   unilateral: 与 resistance 同口径（用户可再加倍）
 *   weight_only/reps_only: 单维度记录
 *   未完成组：completed_sets < sets，不计入统计
 */
import { describe, it, expect } from 'vitest';
import {
  buildSessionPayload,
  buildWorkoutStats,
  formatExerciseEntry,
} from './workoutSummary';
import type { Exercise, ExerciseSet } from '@/types';

const mkSet = (over: Partial<ExerciseSet> = {}): ExerciseSet => ({
  id: 'set-' + Math.random().toString(36).slice(2, 8),
  completed: true,
  ...over,
});

const mkEx = (over: Partial<Exercise> & { sets: ExerciseSet[] }): Exercise => ({
  id: 'ex-' + Math.random().toString(36).slice(2, 8),
  libraryId: 'lib',
  name: over.name || '测试动作',
  type: 'resistance',
  ...over,
});

const T0 = 1757000000000; // fixed timestamp

describe('workoutSummary 逐类别卡片数据输出', () => {
  it('resistance（抗阻）：统计组数/重量/次数/总容量', () => {
    const ex = mkEx({
      name: '杠铃卧推',
      type: 'resistance',
      sets: [
        mkSet({ weight: 60, reps: 10 }),
        mkSet({ weight: 60, reps: 10 }),
        mkSet({ weight: 55, reps: 8, completed: false }), // 未完成 → 不计入
      ],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.sets).toBe(3);
    expect(entry.completed_sets).toBe(2);
    expect(entry.weight).toBe(60);
    expect(entry.reps).toBe(10);
    expect(entry.duration).toBeUndefined();
    expect(entry.distance).toBeUndefined();

    const stats = buildWorkoutStats([ex]);
    expect(stats.totalVolume).toBe(60 * 10 * 2); // 1200
    expect(stats.setsCount).toBe(2);
  });

  it('cardio（有氧）：统计时长/距离/心率，不产生重量容量', () => {
    const ex = mkEx({
      name: '跑步机',
      type: 'cardio',
      metadata: { cardioMode: 'DISTANCE_TARGET' },
      sets: [
        mkSet({ duration: 1200, distance: 3000, heartRate: 140 }),
        mkSet({ duration: 600, distance: 1500, heartRate: 150 }),
      ],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.duration).toBe(1800);
    expect(entry.distance).toBe(4500);
    expect(entry.avg_hr).toBe(145);
    expect(entry.weight).toBeUndefined();

    const stats = buildWorkoutStats([ex]);
    expect(stats.totalCardioDurationSec).toBe(1800);
    expect(stats.totalDistanceM).toBe(4500);
    expect(stats.avgHr).toBe(145);
    expect(stats.totalVolume).toBe(0); // 有氧不产生重量容量
  });

  it('outdoor（户外）：距离主导，同有氧口径', () => {
    const ex = mkEx({
      name: '户外跑',
      type: 'outdoor',
      sets: [mkSet({ duration: 3600, distance: 8000, heartRate: 135 })],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.distance).toBe(8000);
    expect(entry.duration).toBe(3600);

    const stats = buildWorkoutStats([ex]);
    expect(stats.totalDistanceM).toBe(8000);
    expect(stats.totalCardioDurationSec).toBe(3600);
  });

  it('isometric（等长）：时长统计 + 体重近似容量（无体重时不虚增）', () => {
    const ex = mkEx({
      name: '平板支撑',
      type: 'isometric',
      sets: [mkSet({ duration: 60, weight: 0 }), mkSet({ duration: 45, weight: 0 })],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.duration).toBe(105);
    expect(entry.weight).toBeUndefined(); // 0 重量不写入

    const stats = buildWorkoutStats([ex]);
    // referenceBodyweight 缺失（新用户未设置体重）→ 容量 0，不凭空捏造 75kg
    expect(stats.totalVolume).toBe(0);
  });

  it('isometric 带体重画像：容量 = referenceBodyweight × 秒', () => {
    const ex = mkEx({
      name: '平板支撑',
      type: 'isometric',
      referenceBodyweight: 75,
      sets: [mkSet({ duration: 60, weight: 0 }), mkSet({ duration: 45, weight: 0 })],
    });
    expect(buildWorkoutStats([ex]).totalVolume).toBe(75 * 105);
  });

  it('bodyweight（自重）：次数统计；容量 = (体重+配重)×次数（2026-09-18 真实配重口径）', () => {
    const ex = mkEx({
      name: '俯卧撑',
      type: 'bodyweight',
      referenceBodyweight: 75,
      sets: [mkSet({ weight: 0, reps: 20 }), mkSet({ weight: 0, reps: 15 })],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.reps).toBe(18); // 平均 (20+15)/2 四舍五入
    expect(entry.weight).toBeUndefined();

    const stats = buildWorkoutStats([ex]);
    // 容量 = (体重75 + 配重0) × 次数
    expect(stats.totalVolume).toBe(75 * 35);
    expect(stats.setsCount).toBe(2);
  });

  it('bodyweight 无体重画像：容量 0（不虚增，修复新用户「配重0却有容量」）', () => {
    const ex = mkEx({
      name: '卷腹',
      type: 'bodyweight',
      sets: [mkSet({ weight: 0, reps: 15 }), mkSet({ weight: 0, reps: 15 })],
    });
    expect(buildWorkoutStats([ex]).totalVolume).toBe(0);
  });

  it('bodyweight 自重+追加配重：容量 = (体重+配重)×次数', () => {
    const ex = mkEx({
      name: '负重俯卧撑',
      type: 'bodyweight',
      referenceBodyweight: 70,
      sets: [mkSet({ weight: 10, reps: 20 })],
    });
    expect(buildWorkoutStats([ex]).totalVolume).toBe(80 * 20);
  });

  it('assisted（辅助）：负重量记录', () => {
    const ex = mkEx({
      name: '助力引体',
      type: 'assisted',
      sets: [mkSet({ weight: -10, reps: 8 }), mkSet({ weight: -10, reps: 8 })],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.weight).toBe(-10);
    expect(entry.reps).toBe(8);
  });

  it('unilateral（单侧）：容量 = w×r×2（左右各一遍，2026-09-16 口径统一）', () => {
    const ex = mkEx({
      name: '箭步蹲',
      type: 'unilateral',
      sets: [mkSet({ weight: 20, reps: 12 })],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.weight).toBe(20);
    expect(entry.reps).toBe(12);
    expect(buildWorkoutStats([ex]).totalVolume).toBe(480);
  });

  it('assisted 容量：真实负荷 = max(0, 体重−|助力|)×次数，totalVolume 恒非负', () => {
    const ex = mkEx({
      name: '双杠臂屈伸',
      type: 'assisted',
      referenceBodyweight: 70,
      sets: [mkSet({ weight: -20, reps: 10 })],
    });
    // 真实负荷 50kg × 10 = 500（旧口径会算出 -200，触发后端 min(0) 400）
    expect(buildWorkoutStats([ex]).totalVolume).toBe(500);
  });

  it('weight_only / reps_only：单维度记录', () => {
    const w = mkEx({ name: '硬拉1RM', type: 'weight_only', sets: [mkSet({ weight: 100, reps: 1 })] });
    const r = mkEx({ name: '波比跳', type: 'reps_only', sets: [mkSet({ weight: 0, reps: 30 })] });
    const wEntry = formatExerciseEntry(w);
    expect(wEntry.weight).toBe(100);
    const rEntry = formatExerciseEntry(r);
    expect(rEntry.reps).toBe(30);
  });

  it('status 字段（protocol v2）兼容：status=COMPLETED 视为完成', () => {
    const ex = mkEx({
      type: 'cardio',
      sets: [{ id: 's1', status: 'COMPLETED', duration: 600, distance: 2000 }],
    });
    const stats = buildWorkoutStats([ex]);
    expect(stats.totalCardioDurationSec).toBe(600);
    expect(stats.setsCount).toBe(1);
  });

  it('全部未完成：completed_sets=0，不产生任何统计字段', () => {
    const ex = mkEx({
      type: 'cardio',
      sets: [mkSet({ completed: false, duration: 0, distance: 0 })],
    });
    const entry = formatExerciseEntry(ex);
    expect(entry.completed_sets).toBe(0);
    expect(entry.duration).toBeUndefined();
    const stats = buildWorkoutStats([ex]);
    expect(stats.setsCount).toBe(0);
    expect(stats.totalCardioDurationSec).toBe(0);
  });

  it('休息时长（2026-09-16 新增）：completedAt/restEndTime 推算组间休息合计', () => {
    // 组1 在 T0 完成，restEndTime = T0+90s（被+30s 延长过）；组2 在 T0+60s 完成
    // 休息 = min(T0+90, T0+60) − T0 = 60s
    const ex = mkEx({
      name: '杠铃卧推',
      type: 'resistance',
      sets: [
        mkSet({ weight: 60, reps: 10, completedAt: T0, restEndTime: T0 + 90_000 }),
        mkSet({ weight: 60, reps: 8, completedAt: T0 + 60_000 }),
      ],
    });
    expect(formatExerciseEntry(ex).rest_sec).toBe(60);
  });

  it('休息时长：提前结束休息（restEndTime > 下一组completedAt）按实际休息计', () => {
    // 组1 完成 T0，restEndTime=T0+120s；组2 在 T0+45s 完成 → 休息 45s
    const ex = mkEx({
      type: 'resistance',
      sets: [
        mkSet({ weight: 40, reps: 10, completedAt: T0, restEndTime: T0 + 120_000 }),
        mkSet({ weight: 40, reps: 10, completedAt: T0 + 45_000 }),
      ],
    });
    expect(formatExerciseEntry(ex).rest_sec).toBe(45);
  });

  it('休息时长：缺时间戳（旧数据）或为负时不产出字段', () => {
    const noTs = mkEx({
      type: 'resistance',
      sets: [mkSet({ weight: 40, reps: 10 }), mkSet({ weight: 40, reps: 10 })],
    });
    expect(formatExerciseEntry(noTs).rest_sec).toBeUndefined();

    // 时间倒挂（手动改记录等异常）→ 丢弃
    const inverted = mkEx({
      type: 'resistance',
      sets: [
        mkSet({ weight: 40, reps: 10, completedAt: T0 + 30_000, restEndTime: T0 + 60_000 }),
        mkSet({ weight: 40, reps: 10, completedAt: T0 }),
      ],
    });
    expect(formatExerciseEntry(inverted).rest_sec).toBeUndefined();
  });

  it('buildSessionPayload：非法时间戳 / 空动作返回 null；正常产出完整 payload', () => {
    expect(buildSessionPayload({ id: 's', startTime: 0, endTime: 1, exercises: [] })).toBeNull();

    const ok = buildSessionPayload({
      id: 'session-1',
      startTime: T0,
      endTime: T0 + 45 * 60 * 1000,
      exercises: [
        mkEx({ name: '杠铃卧推', type: 'resistance', sets: [mkSet({ weight: 60, reps: 10 })] }),
        mkEx({ name: '跑步机', type: 'cardio', sets: [mkSet({ duration: 1800, distance: 4000, heartRate: 145 })] }),
      ],
    });
    expect(ok).not.toBeNull();
    expect(ok!.sessionId).toBe('session-1');
    expect(ok!.exercises).toHaveLength(2);
    expect(ok!.exercises[0]).toMatchObject({ name: '杠铃卧推', sets: 1, completed_sets: 1, weight: 60, reps: 10 });
    expect(ok!.exercises[1]).toMatchObject({ name: '跑步机', duration: 1800, distance: 4000, avg_hr: 145 });
    expect(ok!.stats).toMatchObject({ totalVolume: 600, setsCount: 2, totalCardioDurationSec: 1800, totalDistanceM: 4000, avgHr: 145 });
  });

  it('混合会话（抗阻+有氧+等长）：各类统计互不污染', () => {
    const stats = buildWorkoutStats([
      mkEx({ type: 'resistance', sets: [mkSet({ weight: 60, reps: 10 })] }),
      mkEx({ type: 'cardio', sets: [mkSet({ duration: 1800, distance: 4000, heartRate: 145 })] }),
      mkEx({ type: 'isometric', referenceBodyweight: 75, sets: [mkSet({ duration: 60 })] }),
    ]);
    expect(stats.totalVolume).toBe(600 + 75 * 60); // 抗阻 + 等长（有体重画像）近似
    expect(stats.totalCardioDurationSec).toBe(1800); // 等长不计入有氧时长
    expect(stats.totalDistanceM).toBe(4000);
    expect(stats.avgHr).toBe(145);
    expect(stats.setsCount).toBe(3);
  });

  it('混合会话无体重画像：等长/自重不产生容量（不凭空捏造 75kg）', () => {
    const stats = buildWorkoutStats([
      mkEx({ type: 'resistance', sets: [mkSet({ weight: 60, reps: 10 })] }),
      mkEx({ type: 'isometric', sets: [mkSet({ duration: 60 })] }),
      mkEx({ type: 'bodyweight', sets: [mkSet({ weight: 0, reps: 15 })] }),
    ]);
    expect(stats.totalVolume).toBe(600); // 只有抗阻贡献容量
  });
});
