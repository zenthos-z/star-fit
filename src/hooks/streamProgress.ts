/**
 * streamProgress（B5b 返工 / issue #38 白屏修复）— 聊天流式进度的
 * 「尾部窗口 + 节流发射」策略，纯函数 + 可注入 emitter，供 useAICoach
 * 两条流式分支（主路径 / survey 上传）共用。
 *
 * 白屏根因（模拟器实测）：GLM 深思考单轮可产 2 万+ thinking delta，
 * 旧实现每 delta 一次 setChatHistory（全列表 map + 整树 reconcile）且
 * thinkingAccumulated 全量字符串拼接（O(n²) 字符拷贝）+ 数万字符巨型
 * text node，JS 线程跑满后 WKWebView 被系统 watchdog 掐掉 → 白屏。
 *
 * 修复策略：
 * - thinkingText 只保留最近 THINKING_WINDOW_CHARS 字符（思考链是过程
 *   展示，永不进正文/不落库，头部可丢）；
 * - 进度 setState 按 STREAM_EMIT_INTERVAL_MS 节流；轮次结束的定型写
 *   （含最终正文）不受节流影响，仍写全量正文 text。
 */

/** thinking 展示窗口：折叠思考区只渲染最近 N 字符（展开也是同一窗口）。 */
export const THINKING_WINDOW_CHARS = 4000;

/** 流式进度 setState 最小间隔（ms）。45s 空闲看门狗与 15s ping 均不受影响。 */
export const STREAM_EMIT_INTERVAL_MS = 200;

/**
 * 把一个 thinking 片段并入尾部窗口。
 *
 * 拼接语义沿用旧实现：片段内含换行 → 视为整段叙事，以空行与上文分隔；
 * 否则按逐字 delta 无缝续接。窗口溢出时丢弃头部并前置省略号，保证
 * 展示的永远是「最近在想什么」，且拼接/渲染成本恒为 O(WINDOW)。
 */
export function appendThinkingWindow(windowText: string, chunk: string): string {
  const joined = windowText
    ? (chunk.includes('\n') ? `${windowText}\n\n${chunk}` : windowText + chunk)
    : chunk;
  if (joined.length <= THINKING_WINDOW_CHARS) return joined;
  return `…${joined.slice(joined.length - THINKING_WINDOW_CHARS)}`;
}

/** 流式进度补丁：写到正在流式渲染的 thinking 气泡上。 */
export interface StreamProgressPatch {
  text: string;
  thinkingText: string;
}

/**
 * 节流发射器：token/thinking delta 高频到达时本地累积，仅在距上次
 * 发射 ≥ interval 时才调用 `apply`（首帧立即发射，让用户尽快看到回包）。
 * `flush()` 强制发射一次（流结束/异常收尾时调用）。
 *
 * `now` 可注入（单测用假时钟），默认 Date.now。
 */
export interface StreamProgressEmitter {
  onToken(text: string): void;
  onThinking(chunk: string): void;
  flush(): void;
}

export function createStreamProgressEmitter(
  apply: (patch: StreamProgressPatch) => void,
  now: () => number = Date.now,
  intervalMs: number = STREAM_EMIT_INTERVAL_MS,
): StreamProgressEmitter {
  let text = '';
  let thinkingText = '';
  let lastEmitAt = -Infinity;

  const emit = (force: boolean): void => {
    const t = now();
    if (!force && t - lastEmitAt < intervalMs) return;
    lastEmitAt = t;
    apply({ text, thinkingText });
  };

  return {
    onToken(chunk: string) {
      text += chunk;
      emit(false);
    },
    onThinking(chunk: string) {
      thinkingText = appendThinkingWindow(thinkingText, chunk);
      emit(false);
    },
    flush() {
      emit(true);
    },
  };
}
