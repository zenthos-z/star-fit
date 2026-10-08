import { describe, it, expect } from 'vitest';
import type { Exercise, ExerciseSet, Session } from '../types/legacy';
import { applySetUpdate } from '../App';

/**
 * #144 休息态互斥测试：训练任一时刻只允许一个休息计时在走。
 * 收口点 = App.tsx applySetUpdate（handleUpdateSet 的 setSession 纯函数形态——
 * 锁屏大按钮 / 训练卡片 / 手表遥控三条完成路径全经 handleUpdateSet，一处覆盖）。
 *
 * 场景 a：不同组之间——A组完成进入休息后勾选 B组 → A组未结束的休息立即终结
 * 场景 b：不同动作之间——完成动作2某组 → 动作1 里休息中的组全部立即终结
 * 「立即结束」语义：仅清 restEndTime（休息徽章消失），不写 completed、不动 completedAt。
 * 防误杀：当前组自己新塞的 60s 默认休息必须保留（60s 默认休息逻辑不变）。
 */

const NOW = 1_760_000_000_000;

const mkSet = (id: string, over: Partial<ExerciseSet> = {}): ExerciseSet => ({
  id,
  reps: 8,
  weight: 60,
  ...over,
});

const mkExercise = (id: string, name: string, sets: ExerciseSet[], type: Exercise['type'] = 'resistance'): Exercise => ({
  id,
  libraryId: '',
  name,
  type,
  sets,
});

const mkSession = (exercises: Exercise[]): Session => ({
  id: 'sess-1',
  startTime: NOW - 600_000,
  pausedDuration: 0,
  status: 'active',
  exercises,
});

/** 组 A 已完成且正在休息（restEndTime 在未来）的典型前置态 */
const restingSet = (id: string) => mkSet(id, { completed: true, completedAt: NOW - 30_000, restEndTime: NOW + 30_000 });

describe('applySetUpdate — #144 休息态互斥（场景 a：不同组之间）', () => {
  it('同动作：A组休息中 → 勾 B组 → A组 restEndTime 立即清除（不写 completed）', () => {
    const ex = mkExercise('ex-1', '杠铃卧推', [restingSet('s-a'), mkSet('s-b')]);
    const next = applySetUpdate(mkSession([ex]), 'ex-1', 's-b', { completed: true }, NOW);

    const a = next.exercises[0].sets[0];
    expect(a.restEndTime).toBeUndefined(); // 休息徽章消失
    expect(a.completed).toBe(true);        // 仅终结倒计时，完成态不动
    expect(a.completedAt).toBe(NOW - 30_000); // completedAt 不动
  });

  it('跨动作：动作1 A组休息中 → 勾动作2 B组 → A组 restEndTime 立即清除', () => {
    const ex1 = mkExercise('ex-1', '杠铃卧推', [restingSet('s-a')]);
    const ex2 = mkExercise('ex-2', '杠铃划船', [mkSet('s-b')]);
    const next = applySetUpdate(mkSession([ex1, ex2]), 'ex-2', 's-b', { completed: true }, NOW);

    expect(next.exercises[0].sets[0].restEndTime).toBeUndefined();
  });

  it('防误杀：被勾的 B组自己新塞 60s 默认休息完整保留（restEndTime=now+60000、completedAt=now）', () => {
    const ex = mkExercise('ex-1', '杠铃卧推', [restingSet('s-a'), mkSet('s-b')]);
    const next = applySetUpdate(mkSession([ex]), 'ex-1', 's-b', { completed: true }, NOW);

    const b = next.exercises[0].sets[1];
    expect(b.restEndTime).toBe(NOW + 60_000);
    expect(b.completedAt).toBe(NOW);
    expect(b.completed).toBe(true);
  });
});

describe('applySetUpdate — #144 休息态互斥（场景 b：不同动作之间）', () => {
  it('动作1 两个组都在休息中 → 完成动作2 某组 → 动作1 休息全部立即清掉', () => {
    const ex1 = mkExercise('ex-1', '杠铃卧推', [restingSet('s-a1'), restingSet('s-a2')]);
    const ex2 = mkExercise('ex-2', '杠铃划船', [mkSet('s-b')]);
    const next = applySetUpdate(mkSession([ex1, ex2]), 'ex-2', 's-b', { completed: true }, NOW);

    expect(next.exercises[0].sets.map(s => s.restEndTime)).toEqual([undefined, undefined]);
    // 完成态原样保留：互斥只是不再倒计时
    expect(next.exercises[0].sets.every(s => s.completed === true)).toBe(true);
  });
});

describe('applySetUpdate — #144 边界：非完成更新不触发互斥', () => {
  it('改重量（无 completed）：其他组挂着的休息不受干扰', () => {
    const ex = mkExercise('ex-1', '杠铃卧推', [restingSet('s-a'), mkSet('s-b')]);
    const next = applySetUpdate(mkSession([ex]), 'ex-1', 's-b', { weight: 65 }, NOW);

    expect(next.exercises[0].sets[0].restEndTime).toBe(NOW + 30_000);
    expect(next.exercises[0].sets[1].weight).toBe(65);
  });

  it('取消完成（completed: false）：只清自身休息（既有语义），其他组休息不被误伤', () => {
    const ex = mkExercise('ex-1', '杠铃卧推', [restingSet('s-a'), mkSet('s-b', { completed: true, restEndTime: NOW + 20_000 })]);
    const next = applySetUpdate(mkSession([ex]), 'ex-1', 's-b', { completed: false }, NOW);

    expect(next.exercises[0].sets[0].restEndTime).toBe(NOW + 30_000); // A组休息保留
    expect(next.exercises[0].sets[1].restEndTime).toBeUndefined();    // 自身取消完成清休息
    expect(next.exercises[0].sets[1].completed).toBe(false);
  });

  it('已到期的休息终点（<= now）不被动：仅未到期（> now）的倒计时参与互斥', () => {
    const expired = mkSet('s-a', { completed: true, completedAt: NOW - 90_000, restEndTime: NOW - 5_000 });
    const ex1 = mkExercise('ex-1', '杠铃卧推', [expired]);
    const ex2 = mkExercise('ex-2', '杠铃划船', [mkSet('s-b')]);
    const next = applySetUpdate(mkSession([ex1, ex2]), 'ex-2', 's-b', { completed: true }, NOW);

    expect(next.exercises[0].sets[0].restEndTime).toBe(NOW - 5_000);
  });
});
