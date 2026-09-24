import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { HoldToConfirm } from '../HoldToConfirm';

/**
 * 锁定屏长按防误触组件测试：
 * - 纯点击（pointerdown 后立刻 up）不触发 onConfirm
 * - 长按不足 HOLD_MS 不触发
 * - 长按满 HOLD_MS 触发一次 onConfirm
 * - pointerleave/cancel 中途打断不触发
 */

describe('HoldToConfirm（锁定屏长按确认）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderBtn = (onConfirm = vi.fn()) => {
    const utils = render(<HoldToConfirm variant="primary" label="完成第 3 组" onConfirm={onConfirm} />);
    const el = utils.container.querySelector('div[style*="touch-action"], .relative.select-none') as HTMLElement
      || utils.container.firstElementChild as HTMLElement;
    return { el, onConfirm, ...utils };
  };

  const down = (el: HTMLElement) => {
    act(() => {
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 10, clientY: 10 });
    });
  };
  const up = (el: HTMLElement) => {
    act(() => {
      fireEvent.pointerUp(el, { pointerId: 1 });
    });
  };

  it('纯点击不触发 onConfirm（防误触根基）', () => {
    const { el, onConfirm } = renderBtn();
    down(el);
    up(el);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('长按满 700ms 触发一次 onConfirm', () => {
    const { el, onConfirm } = renderBtn();
    down(el);
    act(() => { vi.advanceTimersByTime(800); });
    up(el);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('长按不足 700ms 松手不触发', () => {
    const { el, onConfirm } = renderBtn();
    down(el);
    act(() => { vi.advanceTimersByTime(400); });
    up(el);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('pointerCancel 中途打断不触发', () => {
    const { el, onConfirm } = renderBtn();
    down(el);
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { fireEvent.pointerCancel(el, { pointerId: 1 }); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
