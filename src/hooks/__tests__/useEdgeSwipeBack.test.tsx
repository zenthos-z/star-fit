/**
 * useEdgeSwipeBack 单元测试 — [issue #83] 左缘右滑返回手势
 *
 * 锁定的行为边界：
 * 1. 仅左缘窄带（≤20px）起滑才感知；带外起滑不激活
 * 2. 激活需右移意图（dx>6 且横向占优）；竖向意图放行（不劫持滚动）
 * 3. 释放：位移 > 屏宽 1/3 或速度足够 → 提交 onBack；否则弹回 rest
 * 4. 接管期间 DOM 模式直写 transform/transition，结束后还原 React 管辖值
 * 5. 手势结束吞掉误触 click；未激活的点按不拦截 click
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React, { useEffect } from 'react';
import { useEdgeSwipeBack, EDGE_SWIPE_BAND_PX } from '../useEdgeSwipeBack';

const VIEW_W = 390;

/** jsdom 无 Touch 构造器：造带 touches/changedTouches 的合成 TouchEvent */
function touchEvent(
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  x: number,
  y: number,
): TouchEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const touch = { clientX: x, clientY: y, identifier: 1 };
  Object.defineProperties(e, {
    touches: { value: type === 'touchend' ? [] : [touch] },
    changedTouches: { value: [touch] },
  });
  return e;
}

/** mock framer animate：同步走完释放动画（锁定结算语义，不测曲线本身） */
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    animate: (_v: unknown, _target: unknown, opts?: { onComplete?: () => void }) => {
      opts?.onComplete?.();
      return { stop: () => {} };
    },
  };
});

function fire(el: Element, type: Parameters<typeof touchEvent>[0], x: number, y: number) {
  el.dispatchEvent(touchEvent(type, x, y));
}

/** 测试挂载件：复刻真实组件的 ref→effect 顺序（React 先设 ref 再跑 effect）；
 *  x 跟手值实时镜像到宿主 data-x 属性，供断言读取 */
const Harness: React.FC<{
  onBack: () => void;
  enabled?: boolean;
  withChild?: boolean;
  framerMode?: boolean;
}> = ({ onBack, enabled = true, withChild = false, framerMode = false }) => {
  const { ref, x } = useEdgeSwipeBack({
    enabled,
    onBack,
    dom: framerMode ? undefined : {
      restTransform: 'translateY(0)',
      closedTransform: 'translateY(100%)',
      restTransition: 'transform 420ms',
    },
  });
  useEffect(() => {
    const unsub = x.on('change', (v) => {
      // ref 是 callback ref（无 .current），直接按标记取宿主元素写镜像值
      const el = document.querySelector('[data-testid="host"]');
      if (el) el.setAttribute('data-x', String(v));
    });
    return unsub;
  }, [x]);
  return (
    <div ref={ref} data-testid="host" data-x="0">
      {withChild && <button data-testid="child">点我</button>}
    </div>
  );
};

describe('useEdgeSwipeBack', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: VIEW_W, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('左缘窄带起滑→跟手→越过 1/3 屏宽释放→提交 onBack 并停靠关闭位', () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    const host = screen.getByTestId('host');

    fire(host, 'touchstart', 0, 400);
    fire(host, 'touchmove', 20, 402); // dx=20>6 且横向占优 → 激活
    fire(host, 'touchmove', 200, 402);
    expect(host.style.transform).toBe('translateY(0) translateX(200px)');
    expect(host.style.transition).toBe('none'); // 跟手期禁 CSS 过渡

    fire(host, 'touchend', 200, 402); // dx=200 > 390/3 → 提交
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(host.style.transform).toBe('translateY(100%)'); // 停靠关闭位
    expect(host.style.transition).toBe('transform 420ms'); // 还原 React 管辖值
  });

  it('位移不足且速度不足 → 弹回打开位，不触发 onBack', () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    const host = screen.getByTestId('host');

    fire(host, 'touchstart', 0, 300);
    fire(host, 'touchmove', 60, 300); // 激活（dx=60>6）
    fire(host, 'touchend', 60, 300); // dx=60 < 130 且瞬时释放无速度 → 弹回
    expect(onBack).not.toHaveBeenCalled();
    expect(host.style.transform).toBe('translateY(0)');
  });

  it('带外起滑（x>20px）不感知手势', () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    const host = screen.getByTestId('host');

    fire(host, 'touchstart', EDGE_SWIPE_BAND_PX + 5, 300);
    fire(host, 'touchmove', 200, 300);
    fire(host, 'touchend', 200, 300);
    expect(host.getAttribute('data-x')).toBe('0');
    expect(onBack).not.toHaveBeenCalled();
    expect(host.style.transform).toBe('');
  });

  it('竖向意图不激活（放行原生滚动），点按 click 不被吞', () => {
    const onBack = vi.fn();
    const childClick = vi.fn();
    render(<Harness onBack={onBack} withChild />);
    const host = screen.getByTestId('host');
    const child = screen.getByTestId('child');
    child.addEventListener('click', childClick);

    // 竖向滑动（dy 占优）：不激活
    fire(host, 'touchstart', 8, 300);
    fire(host, 'touchmove', 10, 360); // dx=2, dy=60 → 放行
    fire(host, 'touchend', 10, 360);
    expect(onBack).not.toHaveBeenCalled();

    // 窄带内点按（无位移）：click 照常派发
    fire(host, 'touchstart', 8, 300);
    fire(host, 'touchend', 8, 300);
    child.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(childClick).toHaveBeenCalledTimes(1);
  });

  it('手势结束后短窗内的 click 被吞（快速轻扫提交，速度达标）', () => {
    const onBack = vi.fn();
    const childClick = vi.fn();
    render(<Harness onBack={onBack} withChild />);
    const host = screen.getByTestId('host');
    const child = screen.getByTestId('child');
    child.addEventListener('click', childClick);

    const realNow = performance.now.bind(performance);
    const t0 = realNow();
    const nowSpy = vi.spyOn(performance, 'now');
    // 先用真实时钟走激活与首样本，再快进 60ms 造出高速度样本
    fire(host, 'touchstart', 8, 300);
    fire(host, 'touchmove', 40, 300);
    nowSpy.mockImplementation(() => t0 + 60);
    fire(host, 'touchmove', 90, 300); // 速度≈(90-40)/60≈0.83px/ms > 0.5
    fire(host, 'touchend', 90, 300); // dx=82 < 130，速度提交
    expect(onBack).toHaveBeenCalledTimes(1);

    child.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(childClick).not.toHaveBeenCalled(); // 释放误触 click 被吞
    nowSpy.mockRestore();
    expect(realNow).toBeTruthy();
  });

  it('enabled=false 时不感知手势', () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} enabled={false} />);
    const host = screen.getByTestId('host');

    fire(host, 'touchstart', 8, 300);
    fire(host, 'touchmove', 200, 300);
    fire(host, 'touchend', 200, 300);
    expect(host.getAttribute('data-x')).toBe('0');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('framer 模式（无 dom 适配）：提交 onBack，x 保留跟手位（重开时归零）', () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} framerMode />);
    const host = screen.getByTestId('host');

    fire(host, 'touchstart', 8, 300);
    fire(host, 'touchmove', 220, 300); // dx=212 → 激活跟手
    fire(host, 'touchend', 220, 300); // dx=212 > 130 → 提交
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(host.getAttribute('data-x')).toBe('212'); // 非 dom 模式不清 x（exit 在屏外播放），重开由 useLayoutEffect 归零
  });
});
