/**
 * PlanDayDetailPage 组件测试（T10/#67 重做）。
 *
 * 覆盖：
 * - 计划说明区：rationale 在位渲染「计划说明」；缺省整区隐藏（旧计划不炸）
 * - 三段式分组：热身动作 / 正式动作 / 收尾动作（拉伸）固定段序，空段省略
 * - 逐组参数：T9 sets 在位逐组独立行（60 kg × 8 次，不折叠）；无配重行 RPE 作负荷锚
 * - 旧计划回落：category 全 main 单段、等参数块折叠「第 1–N 组」、无说明区
 * - 休息日：弱化卡，无动作分组
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { PlanDayDetailPage } from '../PlanDayDetailPage';
import type { PlanDayDetailVM } from '../../../utils/weeklyPlanView';

// 原生触感 / tab bar / 动作库索引在 jsdom 下不可用 —— 挂桩为空实现
vi.mock('../../../lib/nativeHaptics', () => ({ haptic: vi.fn() }));
vi.mock('../../../lib/nativeTabBar', () => ({ setTabBarHidden: vi.fn() }));
vi.mock('../../../hooks/useExerciseLibraryIndex', () => ({
  useExerciseLibraryIndex: () => ({ byId: new Map(), byName: new Map() }),
}));

/** T9 结构化日：三段式 + 逐组处方 + rationale */
function structuredVM(): PlanDayDetailVM {
  return {
    entryDate: '2026-09-25',
    title: '周五 · 推拉腿',
    metaLine: '2026-W40 · 推拉腿',
    rationale: '腿日安排在力量块中段，主项按 60→65kg 递增；注意蹲深。',
    rest: false,
    exercises: [
      { exerciseId: 'e0', name: '髋部动态热身', category: 'warmup', sets: [{ setNo: 1, reps: 10, rpe: 5 }] },
      {
        exerciseId: 'e1',
        name: '杠铃深蹲',
        category: 'main',
        sets: [
          { setNo: 1, weightKg: 60, reps: 8, rpe: 7 },
          { setNo: 2, weightKg: 65, reps: 6, rpe: 8 },
        ],
      },
      { exerciseId: 'e2', name: '股四头肌静态拉伸', category: 'cooldown', sets: [{ setNo: 1, reps: 30, rpe: 4 }] },
    ],
  };
}

/** 旧计划日：无 rationale、全 main 段、等参数区间文案（可折叠） */
function legacyVM(): PlanDayDetailVM {
  return {
    entryDate: '2026-09-25',
    title: '周五 · 推拉腿',
    rest: false,
    exercises: [
      {
        exerciseId: 'e1',
        name: '杠铃深蹲',
        category: 'main',
        sets: [
          { setNo: 1, loadText: 'RPE 7–8' },
          { setNo: 2, loadText: 'RPE 7–8' },
          { setNo: 3, loadText: 'RPE 7–8' },
        ],
      },
    ],
  };
}

describe('PlanDayDetailPage（T10/#67）', () => {
  it('T9 计划：说明区渲染 rationale，三段式分组齐全', () => {
    render(<PlanDayDetailPage detail={structuredVM()} onClose={() => undefined} />);
    expect(screen.getByLabelText('计划说明')).toBeDefined();
    expect(screen.getByText(/60→65kg 递增/)).toBeDefined();
    expect(screen.getByText('热身动作')).toBeDefined();
    expect(screen.getByText('正式动作')).toBeDefined();
    expect(screen.getByText('收尾动作（拉伸）')).toBeDefined();
  });

  it('T9 计划：逐组独立行（60 kg × 8 / 65 kg × 6），不折叠', () => {
    render(<PlanDayDetailPage detail={structuredVM()} onClose={() => undefined} />);
    // 深蹲两行组号独立（第 1 / 第 2 组），配重与次数逐一出现
    expect(screen.getByText('60')).toBeDefined();
    expect(screen.getByText('65')).toBeDefined();
    expect(screen.getByText('8')).toBeDefined();
    expect(screen.getByText('6')).toBeDefined();
    expect(screen.getByText('第 2 组')).toBeDefined();
    // 旧式折叠行不应出现（逐组处方永不折叠）
    expect(screen.queryByText(/第 1–\d+ 组/)).toBeNull();
  });

  it('无配重行（热身/拉伸）：RPE 作负荷锚展示', () => {
    render(<PlanDayDetailPage detail={structuredVM()} onClose={() => undefined} />);
    expect(screen.getByText('RPE 5')).toBeDefined();
    expect(screen.getByText('RPE 4')).toBeDefined();
  });

  it('旧计划回落：无说明区、单 main 段、等参数块折叠为「第 1–3 组」', () => {
    render(<PlanDayDetailPage detail={legacyVM()} onClose={() => undefined} />);
    expect(screen.queryByLabelText('计划说明')).toBeNull();
    // 空段省略：只余正式动作段
    expect(screen.getByText('正式动作')).toBeDefined();
    expect(screen.queryByText('热身动作')).toBeNull();
    expect(screen.queryByText('收尾动作（拉伸）')).toBeNull();
    // 等参数块折叠单行，不逐组展开
    expect(screen.getByText('第 1–3 组')).toBeDefined();
    expect(screen.queryByText('第 2 组')).toBeNull();
    expect(screen.getByText('RPE 7–8')).toBeDefined();
  });

  it('休息日：弱化卡，无说明区与动作分组', () => {
    const rest: PlanDayDetailVM = {
      entryDate: '2026-09-26',
      title: '周六',
      rest: true,
      exercises: [],
    };
    render(<PlanDayDetailPage detail={rest} onClose={() => undefined} />);
    expect(screen.getByText('休息恢复')).toBeDefined();
    expect(screen.queryByLabelText('计划说明')).toBeNull();
    expect(screen.queryByText('正式动作')).toBeNull();
  });

  it('detail=null → 不渲染（AnimatePresence 关闭态）', () => {
    render(<PlanDayDetailPage detail={null} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
