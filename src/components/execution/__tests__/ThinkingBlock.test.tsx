import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ThinkingBlock } from '../ThinkingBlock';
import { THINKING_WINDOW_CHARS } from '../../../hooks/streamProgress';

/**
 * ThinkingBlock（issue #55 三修）组件测试：
 * 1. 溢出兜底：10KB 长思考文本渲染有界——DOM 文本节点被夹紧到尾部窗口，
 *    容器带 max-height + overflow-y 控制类；
 * 2. 自动滚动让位：流式时小窗自动贴底；用户上滑后暂停贴底，回到底部恢复；
 * 3. 横向锁死：overflow-x-hidden + break-words + overflow-wrap:anywhere，
 *    无空格超长 token 也被夹紧（容器内只保留竖向滚动）。
 *
 * 注：jsdom 无布局引擎，scrollHeight/clientHeight 用 defineProperty 注入，
 * overflow 行为以「类名契约 + 文本节点有界」断言（视觉路径由浏览器验收）。
 */

const KB10 = 10 * 1024;

const makeLongText = (chars: number): string => {
  let s = '';
  while (s.length < chars) s += '我在思考训练计划的结构与组次安排，';
  return s.slice(0, chars);
};

/** jsdom 无布局：给元素注入可读写/只读的滚动度量。 */
const mockMetrics = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
};

const getBody = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector('[data-testid="thinking-body"]');
  if (!el) throw new Error('thinking-body 未渲染');
  return el as HTMLElement;
};

describe('ThinkingBlock（思考链渲染三修 · issue #55）', () => {
  beforeEach(() => {
    // framer-motion 动画在 jsdom 下直接落终态，无需处理
  });

  describe('#1 溢出兜底（10KB 文本渲染有界）', () => {
    it('10KB 思考文本被夹紧到尾部窗口（≤ WINDOW+1 字符，前置省略号）', () => {
      const long = makeLongText(KB10);
      expect(long.length).toBe(KB10);
      const { container } = render(<ThinkingBlock text={long} streaming={false} />);
      const body = getBody(container);
      const rendered = body.textContent || '';
      expect(rendered.length).toBeLessThanOrEqual(THINKING_WINDOW_CHARS + 1);
      expect(rendered.length).toBeGreaterThan(THINKING_WINDOW_CHARS - 1);
      expect(rendered.startsWith('…')).toBe(true);
      // 尾窗语义：保留的是最近的内容
      expect(rendered.endsWith(long.slice(-10))).toBe(true);
    });

    it('未超窗文本原样渲染（不误伤短思考）', () => {
      const short = makeLongText(100);
      const { container } = render(<ThinkingBlock text={short} streaming={false} />);
      expect(getBody(container).textContent).toBe(short);
    });

    it('容器带 max-height + overflow-y 控制类（竖向撑不穿屏幕）', () => {
      const { container } = render(<ThinkingBlock text={makeLongText(KB10)} streaming={false} />);
      const cls = getBody(container).className;
      expect(cls).toContain('max-h-[7.5rem]');
      expect(cls).toContain('overflow-y-auto');
    });

    it('text 为空不渲染', () => {
      const { container } = render(<ThinkingBlock text="" streaming={true} />);
      expect(container.querySelector('[data-testid="thinking-body"]')).toBeNull();
    });
  });

  describe('#3 横向锁死', () => {
    it('容器带 overflow-x-hidden + 折行类（横向限制在容器宽度内）', () => {
      const { container } = render(<ThinkingBlock text={makeLongText(KB10)} streaming={false} />);
      const cls = getBody(container).className;
      expect(cls).toContain('overflow-x-hidden');
      expect(cls).toContain('break-words');
      expect(cls).toContain('[overflow-wrap:anywhere]');
      expect(cls).toContain('whitespace-pre-wrap'); // 保留换行叙事结构
      expect(cls).toContain('min-w-0'); // flex 场景下不被内容撑宽
    });

    it('无空格超长 token（10KB 连续字符）同样被窗口夹紧', () => {
      const wall = 'A'.repeat(KB10); // 最坏情况：无任何可断行点
      const { container } = render(<ThinkingBlock text={wall} streaming={false} />);
      const rendered = getBody(container).textContent || '';
      expect(rendered.length).toBeLessThanOrEqual(THINKING_WINDOW_CHARS + 1);
      expect(rendered.startsWith('…')).toBe(true);
    });
  });

  describe('#2 自动滚动让位', () => {
    it('流式更新时小窗自动贴底（跟随态）', () => {
      const { container, rerender } = render(<ThinkingBlock text={makeLongText(200)} streaming={true} />);
      const body = getBody(container);
      mockMetrics(body, 5000, 200);
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(300)} streaming={true} />);
      });
      expect(body.scrollTop).toBe(5000); // 贴底：始终展示最新思考
    });

    it('用户上滑后暂停自动贴底（让位，不抢回手势）', () => {
      const { container, rerender } = render(<ThinkingBlock text={makeLongText(200)} streaming={true} />);
      const body = getBody(container);
      mockMetrics(body, 5000, 200);
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(300)} streaming={true} />);
      });
      expect(body.scrollTop).toBe(5000);

      // 用户在窗内上滑：scrollTop 离开底部超过思考窗阈值 → 让位
      act(() => {
        body.scrollTop = 4700; // 距底 100 > THINKING_FOLLOW_DETACH_PX(24)
        fireEvent.scroll(body);
      });
      expect(body.scrollTop).toBe(4700);

      // 后续流式更新不再贴底
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(400)} streaming={true} />);
      });
      expect(body.scrollTop).toBe(4700);
    });

    it('用户手动回到底部后恢复跟随', () => {
      const { container, rerender } = render(<ThinkingBlock text={makeLongText(200)} streaming={true} />);
      const body = getBody(container);
      mockMetrics(body, 5000, 200);

      // 上滑让位
      act(() => {
        body.scrollTop = 4700;
        fireEvent.scroll(body);
      });
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(300)} streaming={true} />);
      });
      expect(body.scrollTop).toBe(4700);

      // 手动回到底部 → 恢复跟随
      act(() => {
        body.scrollTop = 5000;
        fireEvent.scroll(body);
      });
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(400)} streaming={true} />);
      });
      expect(body.scrollTop).toBe(5000);
    });

    it('程序化贴底触发的 scroll 不误判为用户让位（距离≈0 → 仍跟随）', () => {
      const { container, rerender } = render(<ThinkingBlock text={makeLongText(200)} streaming={true} />);
      const body = getBody(container);
      mockMetrics(body, 5000, 200);
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(300)} streaming={true} />);
      });
      expect(body.scrollTop).toBe(5000);
      // 贴底后的 scroll 事件（React onScroll 由 scrollTop 赋值触发）
      act(() => {
        fireEvent.scroll(body);
      });
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(400)} streaming={true} />);
      });
      expect(body.scrollTop).toBe(5000); // 仍跟随
    });

    it('结束流式后不再自动贴底（尊重收起态/阅读位置）', () => {
      const { container, rerender } = render(<ThinkingBlock text={makeLongText(200)} streaming={true} />);
      const body = getBody(container);
      mockMetrics(body, 5000, 200);
      act(() => {
        rerender(<ThinkingBlock text={makeLongText(300)} streaming={false} />);
      });
      expect(body.scrollTop).toBe(0); // 定型收起，不滚动
    });
  });

  describe('状态标签', () => {
    it('流式中显示「思考中…」，定型后显示「已深度思考」', () => {
      const { container, rerender } = render(<ThinkingBlock text={makeLongText(200)} streaming={true} />);
      expect(container.textContent).toContain('思考中…');
      rerender(<ThinkingBlock text={makeLongText(200)} streaming={false} />);
      expect(container.textContent).toContain('已深度思考');
    });
  });
});
