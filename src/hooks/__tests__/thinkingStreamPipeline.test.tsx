import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createStreamProgressEmitter, THINKING_WINDOW_CHARS } from '../streamProgress';
import { updateScrollFollow, snapIfFollowing, THINKING_FOLLOW_DETACH_PX } from '../chatScrollFollow';
import { ThinkingBlock } from '../../components/execution/ThinkingBlock';

/**
 * 长思考流「路径级」验证（issue #55 验证门 3，mock SSE 长流）：
 * 一次性串起 SSE thinking delta 的三个修复点——
 *   点1 溢出：2 万+ delta（GLM 深思考轮实测量级）经 emitter 尾窗 → 渲染层
 *       兜底夹紧 → DOM 文本节点有界 + 容器 max-height/overflow 控制类；
 *   点2 锁滚动：页面上滑让位 → 流式自动贴底让位（不抢手势）→ 回底恢复；
 *   点3 横滑：渲染容器 overflow-x-hidden + 折行类（横向限制在容器宽度内）。
 * 人工视觉验收推迟用户（任务书约定），此处锁定可自动化的行为契约。
 */

const feedThinking = (chunks: string[]): string => {
  const patches: string[] = [];
  const emitter = createStreamProgressEmitter(patch => patches.push(patch.thinkingText));
  for (const c of chunks) emitter.onThinking(c);
  emitter.flush();
  return patches[patches.length - 1]; // 最终一帧 = 渲染层收到的 thinkingText
};

describe('长思考流三修路径（issue #55 · mock SSE 长流）', () => {
  it('点1+3：20KB 思考流 → 尾窗 → ThinkingBlock 渲染有界且容器受控', () => {
    // mock SSE：GLM 深思考轮 2 万+ delta，每帧几十字符
    const full = '分析用户深蹲 5x5 的恢复窗口与容量递增节奏。'.repeat(500); // ≈ 21KB
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += 37) chunks.push(full.slice(i, i + 37));

    const thinkingText = feedThinking(chunks);
    // 尾窗生效：emitter 出口有界
    expect(thinkingText.length).toBeLessThanOrEqual(THINKING_WINDOW_CHARS + 1);
    expect(thinkingText.startsWith('…')).toBe(true);

    // 渲染层兜底：即使上游窗口失效也夹紧；容器带竖向限高 + 横向锁死
    const { container } = render(<ThinkingBlock text={thinkingText} streaming={true} />);
    const body = container.querySelector('[data-testid="thinking-body"]') as HTMLElement;
    expect(body).not.toBeNull();
    expect((body.textContent || '').length).toBeLessThanOrEqual(THINKING_WINDOW_CHARS + 1);
    expect(body.className).toContain('max-h-[7.5rem]');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('overflow-x-hidden');
    expect(body.className).toContain('[overflow-wrap:anywhere]');
  });

  it('点2：长流更新中用户上滑 → 让位不贴底；回到底部 → 恢复跟随', () => {
    const { container, rerender } = render(<ThinkingBlock text="第一帧思考" streaming={true} />);
    const body = container.querySelector('[data-testid="thinking-body"]') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 8000 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 200 });

    // 流式更新 → 自动贴底
    rerender(<ThinkingBlock text={'第二帧思考'.repeat(50)} streaming={true} />);
    expect(body.scrollTop).toBe(8000);

    // 用户上滑（模拟器手势）→ 让位
    body.scrollTop = 7000; // 距底 1000 > THINKING_FOLLOW_DETACH_PX
    const follow = { current: true };
    updateScrollFollow(body, follow, THINKING_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(false);
    expect(snapIfFollowing(body, follow)).toBe(false);
    expect(body.scrollTop).toBe(7000); // 不被拽回底部

    // 回到底部 → 恢复跟随
    body.scrollTop = 8000;
    updateScrollFollow(body, follow, THINKING_FOLLOW_DETACH_PX);
    expect(follow.current).toBe(true);
    expect(snapIfFollowing(body, follow)).toBe(true);
  });

  it('点1（页面级）：聊天主容器上滑让位 → snapIfFollowing 不再抢占（scrollToBottom 同口径守卫）', () => {
    const chatEl = { scrollTop: 19300, scrollHeight: 20000 } as HTMLElement; // 贴底态
    Object.defineProperty(chatEl, 'clientHeight', { configurable: true, value: 700 });
    const follow = { current: true };

    // 流式贴底态
    updateScrollFollow(chatEl, follow);
    expect(follow.current).toBe(true);

    // 用户上滑 1500px（> CHAT_FOLLOW_DETACH_PX=48）→ 让位
    chatEl.scrollTop = 17800;
    updateScrollFollow(chatEl, follow);
    expect(follow.current).toBe(false);
    expect(snapIfFollowing(chatEl, follow)).toBe(false);
    expect(chatEl.scrollTop).toBe(17800);

    // 用户手动回到底部 → 恢复
    chatEl.scrollTop = 19300;
    updateScrollFollow(chatEl, follow);
    expect(follow.current).toBe(true);
  });
});
