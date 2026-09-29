/**
 * T1 SSE 事件记录器（issue #53）——聊天链路的 DEV 观测层，零侵入主流程。
 *
 * 原理：不碰 useAICoach / sseAgentClient 一行代码，而是把 globalThis.fetch
 * 包一层——响应 content-type 为 text/event-stream 时 tee 出一支只读分支，
 * 原响应原样交给生产消费方（字节完全一致）；旁路分支按 wire 帧逐帧记录：
 *   - 事件帧（token/thinking/uiHint/done/error）——复用生产解析器的
 *     normalizeAgentEvent 做规整化，所见即生产所得
 *   - `: ping` 注释保活帧——对 parseSSEChunk 天然不可见，断流诊断的眼睛
 *   - 未知类型帧 / 畸形 JSON 帧——标注后跳过，绝不抛错（禁炸红线）
 *
 * 回放（replay）与实况（live）共用同一解析-记录管线：fixture 原始字节流
 * 离线喂入，不需要后端也能演示/回归同一套帧处理逻辑。
 */
import { normalizeAgentEvent } from '../../services/agent/sseAgentClient';
import type { AgentEvent } from 'shared/contracts';

// ── 数据形状 ────────────────────────────────────────────────────────────────

export type SseFrameKind =
  | 'token'
  | 'thinking'
  | 'uiHint'
  | 'done'
  | 'error'
  | 'unknown'
  | 'comment'
  | 'malformed';

export interface SseFrame {
  /** turn 内递增序号 */
  seq: number;
  kind: SseFrameKind;
  /** 收帧时刻（epoch ms） */
  receivedAt: number;
  /** 帧原始文本（含 data: 前缀/注释行；超长截断） */
  raw: string;
  /** 事件帧：规整化后的 AgentEvent（生产解析器输出） */
  event?: AgentEvent;
  /** malformed/unknown 帧的 data 文本（截断展示） */
  dataText?: string;
  /** 一行速览（列表展示用） */
  summary: string;
}

export interface SseTurn {
  id: string;
  label: string;
  source: 'live' | 'replay';
  startedAt: number;
  endedAt?: number;
  status: 'open' | 'done' | 'error';
  errorNote?: string;
  /** 帧数超过上限时丢最旧帧并打标 */
  truncated?: boolean;
  frames: SseFrame[];
  requestBody?: string;
}

/** 内存护栏：调试台只关心最近几轮；每轮帧数封顶（流式打字机轮可上千帧） */
const MAX_TURNS = 12;
const MAX_FRAMES_PER_TURN = 1500;
const RAW_MAX_CHARS = 4000;
const SUMMARY_MAX_CHARS = 80;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── 帧分类（纯函数，测试直击）──────────────────────────────────────────────

interface ClassifiedParts {
  kind: SseFrameKind;
  event?: AgentEvent;
  dataText?: string;
  summary: string;
}

/**
 * 把一个完整 wire 帧（不含结尾空行）分类。容错红线：任何输入都返回可展示的
 * 分类结果，绝不抛错——与 parseSSEChunk 的 P007「跳过不炸」语义对齐，只是
 * 这里「跳过」改为「标注记录」，让坏帧在调试台可见。
 */
export function classifyFrame(rawFrame: string): ClassifiedParts | null {
  const lines = rawFrame.split(/\r?\n/);
  const dataLines: string[] = [];
  const commentLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      // SSE 规范：冒号后单个前导空格剥掉
      let payload = line.slice(5);
      if (payload.startsWith(' ')) payload = payload.slice(1);
      dataLines.push(payload);
    } else if (line.startsWith(':')) {
      let note = line.slice(1);
      if (note.startsWith(' ')) note = note.slice(1);
      commentLines.push(note);
    }
  }

  // 无 data 行：注释帧（: ping 保活）可记录，纯空帧丢弃
  if (dataLines.length === 0) {
    if (commentLines.length === 0) return null;
    const text = commentLines.join(' / ');
    return { kind: 'comment', summary: truncate(text, SUMMARY_MAX_CHARS) };
  }

  const jsonStr = dataLines.join('\n');

  if (jsonStr === '[DONE]') {
    // 非后端契约的哨兵（OpenAI 风格）：生产解析器直接跳过，这里留个标注
    return { kind: 'unknown', dataText: '[DONE]', summary: 'sentinel [DONE]' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      kind: 'malformed',
      dataText: truncate(jsonStr, RAW_MAX_CHARS),
      summary: `畸形 JSON：${truncate(jsonStr, SUMMARY_MAX_CHARS)}`,
    };
  }

  const event = normalizeAgentEvent(parsed);
  if (event) {
    switch (event.type) {
      case 'token':
        return { kind: 'token', event, summary: truncate(event.text ?? '', SUMMARY_MAX_CHARS) };
      case 'thinking':
        return { kind: 'thinking', event, summary: truncate(event.text ?? '', SUMMARY_MAX_CHARS) };
      case 'uiHint':
        return { kind: 'uiHint', event, summary: `card.type = ${event.card?.type ?? '(缺)'}` };
      case 'done':
        return { kind: 'done', event, summary: '流正常收尾' };
      case 'error':
        return { kind: 'error', event, summary: `${event.error?.code ?? '?'}：${truncate(event.error?.message ?? '', SUMMARY_MAX_CHARS - 12)}` };
    }
  }

  // 可解析 JSON 但不是可识别事件（未来帧类型 / 别的协议混入）→ 标注不炸
  const typeStr =
    parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string'
      ? (parsed as { type: string }).type
      : '(无 type)';
  return {
    kind: 'unknown',
    dataText: truncate(jsonStr, RAW_MAX_CHARS),
    summary: `未知帧类型：${typeStr}`,
  };
}

// ── 增量字节流 → 帧管线（live/replay 共用）────────────────────────────────

export interface FramePipeline {
  /** 喂入一段新到达的字节文本；完整帧立即出栈，残尾留存 */
  ingest(text: string): void;
  /** 流结束：把残尾按最后一帧尝试出栈 */
  flush(): void;
}

export function createFramePipeline(
  onFrame: (rawFrame: string, receivedAt: number) => void,
): FramePipeline {
  let buffer = '';

  const drain = () => {
    let pos = 0;
    for (;;) {
      const lf = buffer.indexOf('\n\n', pos);
      const crlf = buffer.indexOf('\r\n\r\n', pos);
      let boundaryStart = -1;
      let boundaryEnd = -1;
      if (crlf !== -1 && (lf === -1 || crlf < lf)) {
        boundaryStart = crlf;
        boundaryEnd = crlf + 4;
      } else if (lf !== -1) {
        boundaryStart = lf;
        boundaryEnd = lf + 2;
      } else {
        break;
      }
      const frame = buffer.slice(pos, boundaryStart);
      pos = boundaryEnd;
      if (frame.trim().length > 0) onFrame(frame, Date.now());
    }
    buffer = buffer.slice(pos);
  };

  return {
    ingest(text: string) {
      buffer += text;
      drain();
    },
    flush() {
      drain();
      if (buffer.trim().length > 0) {
        onFrame(buffer, Date.now());
        buffer = '';
      }
    },
  };
}

// ── 记录器 store（useSyncExternalStore 友好）──────────────────────────────

type Listener = () => void;

export class SseRecorder {
  private listeners = new Set<Listener>();
  private seqCounters = new Map<string, number>();
  turns: SseTurn[] = [];

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SseTurn[] => this.turns;

  private notify() {
    for (const l of this.listeners) l();
  }

  beginTurn(input: {
    label: string;
    source: 'live' | 'replay';
    requestBody?: string;
  }): SseTurn {
    const turn: SseTurn = {
      id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: input.label,
      source: input.source,
      startedAt: Date.now(),
      status: 'open',
      frames: [],
      requestBody: input.requestBody ? truncate(input.requestBody, 1000) : undefined,
    };
    this.turns = [...this.turns, turn];
    if (this.turns.length > MAX_TURNS) {
      this.turns = this.turns.slice(this.turns.length - MAX_TURNS);
    }
    this.notify();
    return turn;
  }

  endTurn(turnId: string, status: 'done' | 'error', errorNote?: string) {
    this.turns = this.turns.map(t =>
      t.id === turnId ? { ...t, endedAt: Date.now(), status, errorNote } : t,
    );
    this.notify();
  }

  pushFrame(turnId: string, rawFrame: string, receivedAt: number): SseFrame | null {
    const parts = classifyFrame(rawFrame);
    if (!parts) return null;
    const seq = (this.seqCounters.get(turnId) ?? 0) + 1;
    this.seqCounters.set(turnId, seq);
    const frame: SseFrame = {
      seq,
      kind: parts.kind,
      receivedAt,
      raw: truncate(rawFrame, RAW_MAX_CHARS),
      event: parts.event,
      dataText: parts.dataText,
      summary: parts.summary,
    };
    let droppedNote = false;
    this.turns = this.turns.map(t => {
      if (t.id !== turnId) return t;
      let frames = [...t.frames, frame];
      let truncated = t.truncated ?? false;
      if (frames.length > MAX_FRAMES_PER_TURN) {
        frames = frames.slice(frames.length - MAX_FRAMES_PER_TURN);
        truncated = true;
        droppedNote = true;
      }
      return { ...t, frames, truncated };
    });
    this.notify();
    if (droppedNote) {
      // 丢帧只打标不递归通知
      this.turns = this.turns.map(t =>
        t.id === turnId && !t.errorNote
          ? { ...t, errorNote: `帧数超过 ${MAX_FRAMES_PER_TURN}，已丢最旧帧` }
          : t,
      );
    }
    return frame;
  }

  clear() {
    this.turns = [];
    this.seqCounters.clear();
    this.notify();
  }
}

/** 调试台全局单例：实况 tap 与回放面板共用 */
export const sseRecorder = new SseRecorder();

// ── fetch 旁路 tap（零侵入观测点）─────────────────────────────────────────

let tapInstalled = false;

/**
 * 包一层 globalThis.fetch：SSE 响应 tee 出旁路逐帧记录，原响应原样返回。
 * 幂等：重复调用不会叠层。返回卸载函数（恢复原 fetch）。
 */
export function installSseFetchTap(recorder: SseRecorder = sseRecorder): () => void {
  if (tapInstalled) return () => undefined;
  tapInstalled = true;
  const originalFetch = globalThis.fetch;

  const tappedFetch: typeof fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.body || !contentType.includes('text/event-stream')) {
      return response;
    }

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : '(unknown url)';

    let messageSummary = '';
    try {
      if (typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { message?: unknown };
        if (typeof body.message === 'string') messageSummary = truncate(body.message, 40);
      }
    } catch {
      /* 请求体不是 JSON（或不带 message）就不带摘要 */
    }

    const [tapBranch, consumerBranch] = response.body.tee();
    const turn = recorder.beginTurn({
      label: `POST ${url.replace(/^https?:\/\/[^/]+/, '')}${messageSummary ? ` · ${messageSummary}` : ''}`,
      source: 'live',
      requestBody: typeof init?.body === 'string' ? init.body : undefined,
    });
    void drainStream(tapBranch, turn.id, recorder);

    return new Response(consumerBranch, { status: response.status, headers: response.headers });
  };

  globalThis.fetch = tappedFetch;

  return () => {
    if (globalThis.fetch === tappedFetch) {
      globalThis.fetch = originalFetch;
    }
    tapInstalled = false;
  };
}

async function drainStream(
  body: ReadableStream<Uint8Array>,
  turnId: string,
  recorder: SseRecorder,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const pipeline = createFramePipeline((rawFrame, receivedAt) => {
    recorder.pushFrame(turnId, rawFrame, receivedAt);
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pipeline.ingest(decoder.decode(value, { stream: true }));
    }
    pipeline.ingest(decoder.decode());
    pipeline.flush();
    recorder.endTurn(turnId, 'done');
  } catch (err) {
    // 消费方提前 abort（看门狗）等场景：旁路流被同步取消，如实记录
    recorder.endTurn(turnId, 'error', err instanceof Error ? err.message : String(err));
  }
}

// ── 离线回放（fixture 字节流 → 同一管线）──────────────────────────────────

export interface ReplayOptions {
  /** 每块喂入间隔；0 = 同步灌完（测试用） */
  chunkDelayMs?: number;
  /** 分块大小（字节），模拟网络分包 */
  chunkSize?: number;
}

/**
 * 把一段原始 SSE 文本按块喂进记录器（source=replay 的 turn）。
 * 返回 turn id。chunkDelayMs=0 时同步完成。
 */
export function replayRawStream(
  raw: string,
  label: string,
  recorder: SseRecorder = sseRecorder,
  opts: ReplayOptions = {},
): string {
  const { chunkDelayMs = 30, chunkSize = 96 } = opts;
  const turn = recorder.beginTurn({ label, source: 'replay' });
  const pipeline = createFramePipeline((rawFrame, receivedAt) => {
    recorder.pushFrame(turn.id, rawFrame, receivedAt);
  });

  const chunks: string[] = [];
  for (let i = 0; i < raw.length; i += chunkSize) chunks.push(raw.slice(i, i + chunkSize));

  const feedRest = (from: number) => {
    for (let i = from; i < chunks.length; i++) {
      pipeline.ingest(chunks[i]);
      if (chunkDelayMs > 0) {
        setTimeout(() => feedRest(i + 1), chunkDelayMs);
        return;
      }
    }
    pipeline.flush();
    recorder.endTurn(turn.id, 'done');
  };
  feedRest(0);
  return turn.id;
}
