/**
 * streamProgress 单测（B5b 返工 / issue #38 白屏修复）。
 *
 * 覆盖：
 * - thinking 尾部窗口：超限丢头部、前置省略号、保留最新内容（拼接成本 O(WINDOW)）
 * - 块叙事空行拼接语义保留（片段含 \n → 空行分隔；逐字 delta → 无缝续接）
 * - 节流发射：首帧立即发射、interval 内静默、flush 强制发射
 * - 正文 token 全量累积（不截断）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  THINKING_WINDOW_CHARS,
  STREAM_EMIT_INTERVAL_MS,
  appendThinkingWindow,
  createStreamProgressEmitter,
  type StreamProgressPatch,
} from '../streamProgress';

describe('appendThinkingWindow（尾部窗口）', () => {
  it('窗口内直接拼接：逐字 delta 无缝续接', () => {
    expect(appendThinkingWindow('', 'abc')).toBe('abc');
    expect(appendThinkingWindow('abc', 'def')).toBe('abcdef');
  });

  it('块叙事（含换行）以空行与上文分隔', () => {
    expect(appendThinkingWindow('abc', '第一段\n第二段')).toBe('abc\n\n第一段\n第二段');
  });

  it('超限丢头部：结果以省略号开头、长度恒 ≤ 窗口+1、尾部是最新内容', () => {
    const big = 'x'.repeat(THINKING_WINDOW_CHARS + 5000);
    const out = appendThinkingWindow('', big);
    expect(out.length).toBeLessThanOrEqual(THINKING_WINDOW_CHARS + 1);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('xxxxx')).toBe(true);
  });

  it('反复灌入巨量片段，长度始终有界（O(WINDOW) 摊销）', () => {
    let w = '';
    for (let i = 0; i < 200; i++) {
      w = appendThinkingWindow(w, `chunk-${i}-`.repeat(200));
      expect(w.length).toBeLessThanOrEqual(THINKING_WINDOW_CHARS + 1);
    }
    // 最新片段必须可见
    expect(w).toContain('chunk-199-');
  });
});

describe('createStreamProgressEmitter（节流发射）', () => {
  const makeApply = () => {
    const patches: StreamProgressPatch[] = [];
    return { patches, apply: (p: StreamProgressPatch) => patches.push(p) };
  };

  it('首帧立即发射（用户尽快看到回包）', () => {
    const { patches, apply } = makeApply();
    let t = 0;
    const em = createStreamProgressEmitter(apply, () => t);
    em.onToken('你');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({ text: '你', thinkingText: '' });
  });

  it('interval 内静默：高频 thinking delta 只发射一次', () => {
    const { patches, apply } = makeApply();
    let t = 1000;
    const em = createStreamProgressEmitter(apply, () => t, STREAM_EMIT_INTERVAL_MS);
    for (let i = 0; i < 20000; i++) em.onThinking(`t${i} `);
    expect(patches).toHaveLength(1);
  });

  it('跨过 interval 后再次发射；thinking 内容是尾部窗口', () => {
    const { patches, apply } = makeApply();
    let t = 0;
    const em = createStreamProgressEmitter(apply, () => t);
    em.onToken('a');
    t += STREAM_EMIT_INTERVAL_MS + 1;
    const big = 'y'.repeat(THINKING_WINDOW_CHARS + 100);
    em.onThinking(big);
    expect(patches).toHaveLength(2);
    expect(patches[1].thinkingText.startsWith('…')).toBe(true);
    expect(patches[1].text).toBe('a'); // token 全量不截断
  });

  it('flush 强制发射最新累积（轮次结束收尾）', () => {
    const { patches, apply } = makeApply();
    let t = 0;
    const em = createStreamProgressEmitter(apply, () => t);
    em.onToken('a');
    em.onToken('b'); // 节流窗口内，不发射
    em.onThinking('想');
    em.flush();
    expect(patches).toHaveLength(2);
    expect(patches[1]).toEqual({ text: 'ab', thinkingText: '想' });
  });
});
