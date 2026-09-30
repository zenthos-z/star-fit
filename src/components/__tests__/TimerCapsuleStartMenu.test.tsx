/**
 * TimerCapsule 分裂菜单三态组件测试（T8 / issue #65）
 *
 * 覆盖开始菜单三个呈现态的真实渲染路径（buildStartMenuOptions 产物 →
 * TimerCapsule 菜单渲染 → 点击行为）：
 *  - ready（训练日/本地暂存兜底）：第三选项「载入计划」可点，触发 onLoadPlan
 *  - rest（休息日）：第三选项「今日休息」不可点（点击不关菜单、不触发动作）
 *  - none（无排期/无周计划）：仅两选项回落（挑选动作 + AI 教练）
 *
 * 环境口径：jsdom = web 平台 → haptic() 静默降级（Capacitor web 分支直返），
 * 无需 mock；framer-motion 菜单挂载即入 DOM（动画只影响样式不影响查询）。
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TimerCapsule from '../TimerCapsule';
import { buildStartMenuOptions, type TodayPlanMenuState } from '../../utils/startOnboarding';

const baseProps = {
  status: 'idle' as const,
  startTime: 0,
  pausedDuration: 0,
  hasExercises: false,
  onStart: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onOpenManual: vi.fn(),
  onEnd: vi.fn(),
};

const renderMenu = (plan: TodayPlanMenuState, onLoadPlan = vi.fn()) => {
  const startOptions = buildStartMenuOptions(plan, {
    onPickLibrary: vi.fn(),
    onOpenCoach: vi.fn(),
    onLoadPlan,
  });
  render(<TimerCapsule {...baseProps} startOptions={startOptions} />);
  // 唤出菜单：点胶囊（空状态文案任一）
  fireEvent.click(screen.getByText('开始运动'));
  return onLoadPlan;
};

describe('TimerCapsule 开始菜单 · 三态（T8 #65）', () => {
  it('ready 态：菜单含「载入计划」，点击触发 onLoadPlan', () => {
    const onLoadPlan = renderMenu({ kind: 'ready', source: 'schedule' });

    const btn = screen.getByText('载入计划');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onLoadPlan).toHaveBeenCalledTimes(1);
    // 注：选中后菜单收起走 AnimatePresence 退出动画，jsdom 不推进动画帧，
    // 卸载断言依赖动画时序故不做（收起路径由真实使用覆盖；rest 态对照
    // 「不触发、不收起」已锁定 disabled 分支语义）
  });

  it('rest 态：第三选项「今日休息」呈现且不可点（不触发、不收起）', () => {
    const onLoadPlan = renderMenu({ kind: 'rest' });

    const btn = screen.getByText('今日休息');
    expect(btn).toBeInTheDocument();
    expect(btn.closest('button')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(btn);
    expect(onLoadPlan).not.toHaveBeenCalled();
    // 休息态选项不消费点击 → 菜单保持展开（用户可改选「挑选动作/AI 教练」）
    expect(screen.getByText('今日休息')).toBeInTheDocument();
  });

  it('none 态：两选项回落现状，无第三选项', () => {
    renderMenu({ kind: 'none' });

    expect(screen.getByText('挑选动作')).toBeInTheDocument();
    expect(screen.getByText('AI 教练')).toBeInTheDocument();
    expect(screen.queryByText('载入计划')).not.toBeInTheDocument();
    expect(screen.queryByText('今日休息')).not.toBeInTheDocument();
  });
});
