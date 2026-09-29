/**
 * Tab bar 显隐全场景回归清单（issue #57）
 *
 * 背景：A10（PR #51）把动作库从 ExerciseSettingsModal 内嵌（自带
 * setTabBarHidden）改为 ExercisePickerModal 直连挂载，隐藏逻辑未随迁
 * → 动作库页 tab bar 复现，遮挡底部购物车悬浮条（BatchAddBanner z-90
 * 与 picker 内悬浮条均低于 CSS tab bar z-105）。
 *
 * 显隐矩阵（修复后期望态，逐场景断言防修复过头）：
 *
 * | 场景                                   | tab bar | 机制 |
 * | -------------------------------------- | ------- | ---- |
 * | 主页签页（信息/开始运动/AI Agent）      | 显示     | 默认 |
 * | History / Settings 全屏路由（z-100）    | 显示     | CSS z-105 > 100，页签目的地须可切 |
 * | 结算页（SETTLEMENT 路由）               | 隐藏     | App.tsx hidden prop |
 * | AI 浮层打开（isAiOverlayOpen）          | 隐藏     | App.tsx hidden prop |
 * | 教程 sheet（tutorialExerciseId）        | 隐藏     | App.tsx hidden prop |
 * | 动作库 picker（pickerEntry）← 本次回归  | 隐藏     | App.tsx hidden prop（CSS 端）+ 组件内 setTabBarHidden（iOS 原生端） |
 * | 各全屏 sheet（设置/时间编辑/偏差警告等） | 隐藏     | 各组件 setTabBarHidden 引用计数（既有模式，不重复测） |
 *
 * 环境口径：jsdom = web 平台 → isNativeTabBar=false，走 CSS 回落渲染路径；
 * iOS 原生侧以 setTabBarHidden spy 断言引用计数调用。
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { setTabBarHiddenMock } = vi.hoisted(() => ({
  setTabBarHiddenMock: vi.fn(),
}));

// 仅替换 setTabBarHidden 为 spy，其余（isNativeTabBar=false 于 web）走真实模块
vi.mock('../../lib/nativeTabBar', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/nativeTabBar')>();
  return { ...actual, setTabBarHidden: setTabBarHiddenMock };
});

import MainTabBar from '../MainTabBar';
import ExercisePickerModal from '../picker/ExercisePickerModal';

const nav = () => screen.queryByRole('navigation', { name: '主导航' });

beforeEach(() => {
  setTabBarHiddenMock.mockClear();
});

describe('MainTabBar · CSS 回落显隐矩阵（web/Android 端）', () => {
  it('主页签页（hidden 缺省）：tab bar 渲染，三页签可见', () => {
    render(<MainTabBar tab={1} onSelect={() => {}} />);
    expect(nav()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '信息' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始运动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI Agent' })).toBeInTheDocument();
  });

  it.each([
    ['结算页 SETTLEMENT 路由'],
    ['AI 浮层 isAiOverlayOpen'],
    ['教程 tutorialExerciseId'],
    ['动作库 pickerEntry（#57 新增）'],
  ])('%s：hidden=true → tab bar 不渲染', () => {
    render(<MainTabBar tab={0} onSelect={() => {}} hidden />);
    expect(nav()).not.toBeInTheDocument();
  });

  it('hidden 翻转 true→false：tab bar 恢复渲染（picker 关闭回主页签页不丢导航）', () => {
    const { rerender } = render(<MainTabBar tab={0} onSelect={() => {}} hidden />);
    expect(nav()).not.toBeInTheDocument();
    rerender(<MainTabBar tab={0} onSelect={() => {}} />);
    expect(nav()).toBeInTheDocument();
  });

  it('显示态下点按页签仍可切换（修复未误伤导航交互）', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MainTabBar tab={0} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'AI Agent' }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});

describe('ExercisePickerModal · iOS 原生侧盖 tab（引用计数）', () => {
  it('挂载即 setTabBarHidden(true)，卸载恢复 false（A10 迁移时丢失的隐藏随 #57 补回）', () => {
    const { unmount } = render(
      <ExercisePickerModal mode="batch" hasHistory={false} onClose={() => {}} onConfirm={() => {}} />,
    );
    expect(setTabBarHiddenMock).toHaveBeenCalledWith(true);

    unmount();
    expect(setTabBarHiddenMock).toHaveBeenLastCalledWith(false);
  });
});
