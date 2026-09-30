/**
 * InfoPage 组件测试（T10/#67 信息页周计划重做）。
 *
 * 覆盖：
 * - 「详情」按钮：两字文案（原「查看当日详情」收敛），点击进入当日详情子页
 * - 焦点短标签：横条格内标注取 day_focus（一两个字）；旧数据无该列回落「N组」
 * - 详情子页贯通：说明区（rationale）+ 三段式分组在信息页入口可达
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import InfoPage from '../InfoPage';
import { getWeekDates, todayDateKey } from '../../../utils/weeklyPlanView';
import type { TodayScheduleResponse } from 'shared/contracts';
import type { WeeklyPlanState } from '../../../hooks/useWeeklyPlan';

// 原生触感 / tab bar / 动作库索引在 jsdom 下不可用 —— 挂桩为空实现
vi.mock('../../../lib/nativeHaptics', () => ({ haptic: vi.fn() }));
vi.mock('../../../lib/nativeTabBar', () => ({ setTabBarHidden: vi.fn() }));
vi.mock('../../../hooks/useExerciseLibraryIndex', () => ({
  useExerciseLibraryIndex: () => ({ byId: new Map(), byName: new Map() }),
}));
// 信息页周边（历史卡/诊断 sheet/页菜单）：非本批契约，桩为空
vi.mock('../../history/SessionCardItem', () => ({ SessionCardItem: () => null }));
vi.mock('../../settings/DiagnosticsSheet', () => ({ DiagnosticsSheet: () => null }));
vi.mock('../PageActionsMenu', () => ({ PageActionsMenu: () => null }));

// useWeeklyPlan 工厂 mock（hoist 以便逐测注入数据）
const { mockUseWeeklyPlan } = vi.hoisted(() => ({ mockUseWeeklyPlan: vi.fn() }));
vi.mock('../../../hooks/useWeeklyPlan', () => ({
  useWeeklyPlan: mockUseWeeklyPlan,
}));

const rpe = (min: number, max: number) => ({ type: 'rpe' as const, min, max });

/** 结构化训练日（T9 字段齐全：day_focus/rationale/category/sets） */
function structuredDay(date: string): TodayScheduleResponse {
  return {
    date,
    week_id: '2026-W40',
    status: 'planned',
    split: 'push_pull_legs',
    entries: [
      {
        entry_id: 'e0',
        exercise_id: 'V1StGXR8_Z5jdHi6',
        exercise_name: '髋部动态热身',
        target_sets: 1,
        target_load: rpe(5, 5),
        status: 'planned',
        sort_order: 0,
        day_focus: '腿',
        rationale: '腿日安排在力量块中段，主项按 60→65kg 递增；注意蹲深。',
        category: 'warmup',
        sets: [{ set_no: 1, reps: 10, rpe: 5 }],
      },
      {
        entry_id: 'e1',
        exercise_id: 'a1b2c3d4e5f6',
        exercise_name: '杠铃深蹲',
        target_sets: 2,
        target_load: rpe(7, 8),
        status: 'planned',
        sort_order: 1,
        day_focus: '腿',
        rationale: '腿日安排在力量块中段，主项按 60→65kg 递增；注意蹲深。',
        category: 'main',
        sets: [
          { set_no: 1, weight_kg: 60, reps: 8, rpe: 7 },
          { set_no: 2, weight_kg: 65, reps: 6, rpe: 8 },
        ],
      },
    ],
  };
}

/** 旧计划训练日（无 T9 字段；组数合计 15 → 回落标注「15组」） */
function legacyDay(date: string): TodayScheduleResponse {
  return {
    date,
    week_id: '2026-W40',
    status: 'planned',
    split: 'push_pull_legs',
    entries: [
      {
        entry_id: 'l1',
        exercise_id: 'a1b2c3d4e5f6',
        exercise_name: '杠铃深蹲',
        target_sets: 15,
        target_load: rpe(7, 8),
        status: 'planned',
        sort_order: 0,
      },
    ],
  };
}

function restDay(date: string): TodayScheduleResponse {
  return { date, week_id: '2026-W40', status: 'rest_day', split: 'push_pull_legs', entries: [] };
}

/** 本周数据：今天=结构化腿日；另一训练日=旧数据；其余休息 */
function weeklyState(): WeeklyPlanState {
  const week = getWeekDates(new Date());
  const today = todayDateKey();
  const other = week.find((d) => d !== today)!;
  const dayMap: Record<string, TodayScheduleResponse> = {
    [today]: structuredDay(today),
    [other]: legacyDay(other),
  };
  for (const d of week) {
    if (!dayMap[d]) dayMap[d] = restDay(d);
  }
  return {
    loading: false,
    error: null,
    weekDates: week,
    dayMap,
    weekId: '2026-W40',
    split: 'push_pull_legs',
    hasNoPlan: false,
    refresh: () => undefined,
  };
}

describe('InfoPage（T10/#67 周计划重做）', () => {
  beforeEach(() => {
    mockUseWeeklyPlan.mockReturnValue(weeklyState());
  });

  it('「详情」两字按钮（原「查看当日详情」收敛），点击进入详情子页', () => {
    render(<InfoPage sessions={[]} onSelect={() => undefined} onDelete={() => undefined} />);
    const btn = screen.getByRole('button', { name: /当日详情/ });
    expect(btn.textContent).toBe('详情');
    // 贯通：点击后详情子页说明区可达
    fireEvent.click(btn);
    expect(screen.getByLabelText('计划说明')).toBeDefined();
    expect(screen.getByText('热身动作')).toBeDefined();
    expect(screen.getByText('正式动作')).toBeDefined();
  });

  it('横条焦点标签：结构化日显示 day_focus「腿」，旧数据日回落「15组」', () => {
    render(<InfoPage sessions={[]} onSelect={() => undefined} onDelete={() => undefined} />);
    expect(screen.getByText('腿')).toBeDefined();
    expect(screen.getByText('15组')).toBeDefined();
    // 休息日标注不变
    expect(screen.getAllByText('休').length).toBeGreaterThan(0);
  });

  it('详情子页内逐组参数独立行（60 kg × 8 / 65 kg × 6）', () => {
    render(<InfoPage sessions={[]} onSelect={() => undefined} onDelete={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /当日详情/ }));
    expect(screen.getByText('60')).toBeDefined();
    expect(screen.getByText('65')).toBeDefined();
    expect(screen.getByText('第 2 组')).toBeDefined();
    expect(screen.queryByText(/第 1–\d+ 组/)).toBeNull();
  });
});
