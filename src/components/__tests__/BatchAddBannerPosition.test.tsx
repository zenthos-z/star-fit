/**
 * BatchAddBanner 避让 Tab Bar 位置测试（issue #85）
 *
 * 横幅常驻根层级、picker 关闭后 tab bar 复现，bottom-0 双端被盖：
 *  - iOS 原生 bar 悬浮 WebView 之上 → bottom = safe-area + 72px（MainTabBar body 避让同款常量）
 *  - CSS 回落 bar（z-105，实高 ≈59px）→ bottom = safe-bottom + 64px，z 抬至 106
 * 平台经 nativeTabBar.isNativeTabBar 可控 mock 切换（jsdom 默认 web）。
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { tabState } = vi.hoisted(() => ({ tabState: { native: false } }));
vi.mock('../../lib/nativeTabBar', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/nativeTabBar')>();
  const mock = { ...actual };
  Object.defineProperty(mock, 'isNativeTabBar', { get: () => tabState.native });
  return mock;
});

import BatchAddBanner from '../picker/BatchAddBanner';
import type { BatchCreateState } from '../../hooks/useBatchExerciseCreate';

const partialState: BatchCreateState = {
  status: 'partial',
  total: 4,
  succeeded: 2,
  failed: [],
};

describe('BatchAddBanner 避让 Tab Bar（issue #85）', () => {
  beforeEach(() => {
    tabState.native = false;
  });

  it('web（CSS 回落 bar）：bottom = safe-bottom + 64px，z-[106] 高于 tab bar(105) 低于 AI sheet(110)', () => {
    render(<BatchAddBanner state={partialState} onRetry={() => {}} onDismiss={() => {}} />);
    const el = screen.getByRole('status');
    // jsdom 对 calc/var 序列化会改写，按关键片段断言（避让常量 + 偏移量）
    expect(el.style.bottom).toContain('var(--safe-bottom');
    expect(el.style.bottom).toContain('64px');
    expect(el.className).toContain('z-[106]');
    expect(el.className).not.toContain('bottom-0');
  });

  it('iOS 原生 bar：bottom = safe-area + 72px（悬浮层高度常量）', () => {
    tabState.native = true;
    render(<BatchAddBanner state={partialState} onRetry={() => {}} onDismiss={() => {}} />);
    const el = screen.getByRole('status');
    expect(el.style.bottom).toContain('safe-area-inset-bottom');
    expect(el.style.bottom).toContain('72px');
  });
});
