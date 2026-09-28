/**
 * WeeklyPlanCard 组件测试（B5b / issue #38 提案-确认状态机）。
 *
 * 覆盖：
 * - 无 apply 载荷（历史卡/纯展示卡）→ 不渲染确认按钮组（行为与旧版一致）
 * - 有 apply 载荷 → 渲染确认按钮，点击 onConfirm 携带 {action, apply}
 * - 持久化决定 decision.result='done' → 终态「已启用 · 信息栏已同步」，按钮消失
 * - decision.action='cancel_apply' → 终态「已放弃」，无二次写库入口
 * - decision.result='failed' → 失败态可重试（按钮重现）
 * - writing（pending）→ 按钮禁用加载态
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { WeeklyPlanCard } from '../WeeklyPlanCard';
import type { WeeklyPlanCardData } from 'shared/contracts';

// 原生触感与动作库索引在 jsdom 下不可用 —— 挂桩为空实现
vi.mock('../../../../lib/nativeHaptics', () => ({ haptic: vi.fn() }));
vi.mock('../../../../hooks/useExerciseLibraryIndex', () => ({
  useExerciseLibraryIndex: () => ({ byId: new Map(), byName: new Map() }),
}));

/** 最小周计划卡数据（days 覆盖 7 天由 weeklyCardRows 消化，这里给 2 天足够） */
function makeData(overrides: Partial<WeeklyPlanCardData> = {}): WeeklyPlanCardData {
  return {
    week_label: '第 1 周',
    split_summary: '推拉腿 · 每周 3 练',
    days: [
      {
        entry_date: '2026-09-28',
        split_label: '推',
        focus: '胸肩三头',
        rest: false,
        exercises: [
          { exercise_id: 'x1', name: '平板杠铃卧推', sets: [{ set: 1, weight: 60, reps: 8 }] },
        ],
      },
      { entry_date: '2026-09-29', rest: true, exercises: [] },
    ],
    ...overrides,
  } as WeeklyPlanCardData;
}

const APPLY = {
  scope: 'week' as const,
  split: 'push_pull_legs' as const,
  dates: [] as string[],
  entries: [
    {
      entry_date: '2026-09-28',
      exercise_id: 'x1',
      target_sets: 4,
      target_load: { type: 'rpe' as const, min: 7, max: 8 },
      status: 'planned' as const, // z.infer 输出型必填（schema 层缺省 planned）
      sort_order: 0,
    },
  ],
};

describe('WeeklyPlanCard（B5b 提案-确认状态机）', () => {
  it('无 apply 载荷 → 纯展示卡，不渲染确认按钮组', () => {
    render(<WeeklyPlanCard uiHint={{ type: 'weekly_plan', data: makeData() }} />);
    expect(screen.queryByRole('button', { name: /确认启用/ })).toBeNull();
    expect(screen.queryByText('暂不启用')).toBeNull();
  });

  it('有 apply 载荷 → 渲染确认按钮；点击 onConfirm 携带 action + apply', () => {
    const onConfirm = vi.fn();
    render(
      <WeeklyPlanCard
        uiHint={{ type: 'weekly_plan', data: makeData({ apply: APPLY }) }}
        onConfirm={onConfirm}
      />,
    );
    const btn = screen.getByRole('button', { name: '确认启用本周计划' });
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith({ action: 'confirm_apply', apply: APPLY });
  });

  it('scope=days → 按钮文案点明调整范围（单日）', () => {
    render(
      <WeeklyPlanCard
        uiHint={{
          type: 'weekly_plan',
          data: makeData({
            apply: { ...APPLY, scope: 'days', split: undefined, dates: ['2026-09-30'] },
          }),
        }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '确认调整这一天' })).toBeDefined();
  });

  it('decision.result=done → 终态「已启用 · 信息栏已同步」，按钮组消失', () => {
    render(
      <WeeklyPlanCard
        uiHint={{
          type: 'weekly_plan',
          data: makeData({ apply: APPLY }),
          decision: { action: 'confirm_apply', decidedAt: Date.now(), result: 'done' },
        }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText('已启用 · 信息栏已同步')).toBeDefined();
    expect(screen.queryByText('暂不启用')).toBeNull();
  });

  it('decision.action=cancel_apply → 终态「已放弃」，无写库入口', () => {
    const onConfirm = vi.fn();
    render(
      <WeeklyPlanCard
        uiHint={{
          type: 'weekly_plan',
          data: makeData({ apply: APPLY }),
          decision: { action: 'cancel_apply', decidedAt: Date.now() },
        }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('已放弃，未修改计划')).toBeDefined();
    // 终态下不渲染任何可点按钮（除训练日行本身）
    expect(screen.queryByText('暂不启用')).toBeNull();
    expect(screen.queryByRole('button', { name: /确认/ })).toBeNull();
  });

  it('decision.result=pending → writing 加载态（按钮禁用，不可再点）', () => {
    const onConfirm = vi.fn();
    render(
      <WeeklyPlanCard
        uiHint={{
          type: 'weekly_plan',
          data: makeData({ apply: APPLY }),
          decision: { action: 'confirm_apply', decidedAt: Date.now(), result: 'pending' },
        }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('启用中…')).toBeDefined();
    expect(screen.queryByRole('button', { name: /确认启用/ })).toBeNull();
  });

  it('decision.result=failed → 失败提示 + 「重试启用」按钮（可再点）', () => {
    const onConfirm = vi.fn();
    render(
      <WeeklyPlanCard
        uiHint={{
          type: 'weekly_plan',
          data: makeData({ apply: APPLY }),
          decision: {
            action: 'confirm_apply',
            decidedAt: Date.now(),
            result: 'failed',
            failMessage: 'HTTP 500',
          },
        }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/启用未完成（HTTP 500）/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重试启用' }));
    expect(onConfirm).toHaveBeenCalledWith({ action: 'confirm_apply', apply: APPLY });
  });
});
