import { describe, it, expect } from 'vitest';
import type { Exercise, ExerciseSet, Session } from '../../../types/legacy';
import {
  buildFeelTrigger,
  collectUnfilledFeelGroups,
  applyFeelPatchesToSession,
  type FeelConfirmPatch,
} from '../feelGate';

/**
 * #98 纯函数层测试：组后触发判定（仅最后一组）/ 结算闸门扫描（已完成未填感受）/
 * 批量写回 session（闸门「补完并结束」的结算快照来源）。
 * 组件层交互另见 FeelModal.test.tsx。
 */

const mkSet = (over: Partial<ExerciseSet> & Pick<ExerciseSet, 'id'>): ExerciseSet => ({
  reps: 8,
  weight: 60,
  ...over,
});

const mkExercise = (over: Partial<Exercise> & Pick<Exercise, 'id' | 'type' | 'sets'>): Exercise => ({
  name: '杠铃卧推',
  libraryId: '',
  ...over,
});

const mkSession = (exercises: Exercise[]): Session => ({
  id: 'sess-1',
  startTime: 1000,
  pausedDuration: 0,
  status: 'active',
  exercises,
});

describe('buildFeelTrigger（仅力量类最后一组完成跃迁触发）', () => {
  const ex = mkExercise({
    id: 'ex-1',
    type: 'resistance',
    sets: [mkSet({ id: 's1' }), mkSet({ id: 's2' }), mkSet({ id: 's3' })],
  });

  it('最后一组未完成→完成 → 触发，聚合全部组', () => {
    const t = buildFeelTrigger(ex, 's3', false);
    expect(t).not.toBeNull();
    expect(t!.mode).toBe('action');
    expect(t!.groups).toHaveLength(1);
    expect(t!.groups[0].exId).toBe('ex-1');
    expect(t!.groups[0].exName).toBe('杠铃卧推');
    expect(t!.groups[0].sets.map(s => s.setId)).toEqual(['s1', 's2', 's3']);
    expect(t!.groups[0].sets.map(s => s.setNo)).toEqual([1, 2, 3]);
  });

  it('中间组完成 → 不触发（静默，v2 核心行为变化）', () => {
    expect(buildFeelTrigger(ex, 's1', false)).toBeNull();
    expect(buildFeelTrigger(ex, 's2', false)).toBeNull();
  });

  it('已完成的组再次上报完成 → 不触发（取消后重完成的重复弹窗防线）', () => {
    expect(buildFeelTrigger(ex, 's3', true)).toBeNull();
  });

  it('非力量类型（有氧/户外无休息语境）→ 不触发', () => {
    const cardio = mkExercise({
      id: 'ex-c',
      type: 'cardio',
      sets: [mkSet({ id: 'c1' })],
    });
    expect(buildFeelTrigger(cardio, 'c1', false)).toBeNull();
    const outdoor = mkExercise({ id: 'ex-o', type: 'outdoor', sets: [mkSet({ id: 'o1' })] });
    expect(buildFeelTrigger(outdoor, 'o1', false)).toBeNull();
  });

  it('力量类型全集（resistance/bodyweight/assisted/unilateral/weight_only/reps_only/isometric）最后一组 → 触发', () => {
    const types = ['resistance', 'bodyweight', 'assisted', 'unilateral', 'weight_only', 'reps_only', 'isometric'] as const;
    for (const type of types) {
      const e = mkExercise({ id: `ex-${type}`, type, sets: [mkSet({ id: `${type}-last` })] });
      expect(buildFeelTrigger(e, `${type}-last`, false)).not.toBeNull();
    }
  });

  it('未知 setId → 不触发（防御）', () => {
    expect(buildFeelTrigger(ex, 'ghost', false)).toBeNull();
  });
});

describe('collectUnfilledFeelGroups（结算闸门扫描 §3）', () => {
  it('只收「已完成且未填感受」的组，按动作聚合，组号 1-based', () => {
    const exercises = [
      mkExercise({
        id: 'ex-1',
        type: 'resistance',
        sets: [
          mkSet({ id: 's1', completed: true, feel: 60 }),          // 已填 → 不收
          mkSet({ id: 's2', completed: true }),                    // 未填 → 收（setNo 2）
          mkSet({ id: 's3', completed: false }),                   // 未完成 → 不收
        ],
      }),
      mkExercise({
        id: 'ex-2',
        type: 'bodyweight',
        sets: [mkSet({ id: 'b1', completed: true })],              // 未填 → 收
      }),
    ];
    const groups = collectUnfilledFeelGroups(exercises);
    expect(groups).toEqual([
      { exId: 'ex-1', exName: '杠铃卧推', sets: [{ setId: 's2', setNo: 2, weight: 60, reps: 8 }] },
      { exId: 'ex-2', exName: '杠铃卧推', sets: [{ setId: 'b1', setNo: 1, weight: 60, reps: 8 }] },
    ]);
  });

  it('有氧/户外动作即使有未填完成组也不拦结算（无休息语境）', () => {
    const exercises = [
      mkExercise({ id: 'ex-c', type: 'cardio', sets: [mkSet({ id: 'c1', completed: true })] }),
      mkExercise({ id: 'ex-o', type: 'outdoor', sets: [mkSet({ id: 'o1', completed: true })] }),
    ];
    expect(collectUnfilledFeelGroups(exercises)).toEqual([]);
  });

  it('全部组已填（或跳过路径后仍为空？——跳过=保持空感受，闸门不重复拦同一次结束）→ 扫描即时性', () => {
    // 跳过语义：不写 feel → 下一轮结算闸门仍会拦（跳过是「本次放行」，不是「标记已处理」）
    const exercises = [
      mkExercise({ id: 'ex-1', type: 'resistance', sets: [mkSet({ id: 's1', completed: true })] }),
    ];
    expect(collectUnfilledFeelGroups(exercises)).toHaveLength(1);
  });

  it('无未填组 → 空数组（闸门放行）', () => {
    const exercises = [
      mkExercise({
        id: 'ex-1',
        type: 'resistance',
        sets: [mkSet({ id: 's1', completed: true, feel: 80 }), mkSet({ id: 's2', completed: true, feel: 0 })],
      }),
    ];
    expect(collectUnfilledFeelGroups(exercises)).toEqual([]);
  });
});

describe('applyFeelPatchesToSession（批量写回 + 结算快照）', () => {
  const session = mkSession([
    mkExercise({
      id: 'ex-1',
      type: 'resistance',
      sets: [
        mkSet({ id: 's1', completed: true, feel: 70, feel_note: '原有备注' }),
        mkSet({ id: 's2', completed: true }),
      ],
    }),
    mkExercise({
      id: 'ex-2',
      type: 'resistance',
      sets: [mkSet({ id: 'b1', completed: true })],
    }),
  ]);

  it('按 exId+setId 精确写入 feel/feel_note，其余组原样', () => {
    const patches: FeelConfirmPatch[] = [
      { exId: 'ex-1', setId: 's2', feel: 42, feel_note: '太重了' },
      { exId: 'ex-2', setId: 'b1', feel: 65 },
    ];
    const next = applyFeelPatchesToSession(session, patches);
    expect(next.exercises[0].sets[0]).toEqual(session.exercises[0].sets[0]); // 未涉及的组不动
    expect(next.exercises[0].sets[1].feel).toBe(42);
    expect(next.exercises[0].sets[1].feel_note).toBe('太重了');
    expect(next.exercises[1].sets[0].feel).toBe(65);
    // 原 session 不可变（纯函数）
    expect(session.exercises[0].sets[1].feel).toBeUndefined();
  });

  it('无 feel_note 键的补丁不碰已有备注（跳过语义：不写不擦）', () => {
    const patches: FeelConfirmPatch[] = [{ exId: 'ex-1', setId: 's1', feel: 75 }];
    const next = applyFeelPatchesToSession(session, patches);
    expect(next.exercises[0].sets[0].feel).toBe(75);
    expect(next.exercises[0].sets[0].feel_note).toBe('原有备注');
  });

  it('批量闸门补完：多动作混合补丁一次落齐（finalize 直接消费返回值）', () => {
    const patches: FeelConfirmPatch[] = [
      { exId: 'ex-1', setId: 's2', feel: 50 },
      { exId: 'ex-2', setId: 'b1', feel: 50 },
    ];
    const next = applyFeelPatchesToSession(session, patches);
    expect(collectUnfilledFeelGroups(next.exercises)).toEqual([]); // 补完 → 闸门清空
  });
});
