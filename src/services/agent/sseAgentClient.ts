/**
 * createSseAgentClient — concrete SSE implementation of the frozen `AgentClient`
 * seam (P010). Consumes the backend `/api/chat` `text/event-stream` via fetch +
 * ReadableStream and yields `AgentEvent` elements.
 *
 * P007 (consumer-side stream error isolation): the consumer matches the backend
 * frame format (`token` | `uiHint` | `done` | `error`). A transport failure or a
 * malformed frame never crashes the stream — transport failures are surfaced as
 * a single terminal `error` AgentEvent, and malformed frames are skipped.
 *
 * P006 (injectable IO): `fetchImpl`, `url`, `getHeaders`, `getUserId` are all
 * injectable so the parser and client are unit-testable with fixtures (no real
 * network). The defaults wire to the production transport.
 *
 * Wire format (per sibling SSE card): each event is `data: <AgentEvent-json>\n\n`.
 */
import type { AgentEvent, ChatRequest, UiHintCard } from 'shared/contracts';
import type { AgentClient } from './AgentClient';
import { API_BASE, getHeaders as defaultGetHeaders, getUserId as defaultGetUserId } from '@/services/geminiService';

/** Valid AgentEvent type literals (frozen verbatim, matches shared contract). */
const EVENT_TYPES = new Set<AgentEvent['type']>(['token', 'uiHint', 'done', 'error', 'thinking']);

/**
 * Coerce an unknown parsed value into a well-typed AgentEvent, or `null` if it
 * is not a recognizable event (P007: skip, never throw). Defends against the
 * backend emitting shapes with optional fields missing.
 */
export function normalizeAgentEvent(value: unknown): AgentEvent | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string' || !EVENT_TYPES.has(type as AgentEvent['type'])) return null;

  switch (type as AgentEvent['type']) {
    case 'token':
      return { type: 'token', text: typeof obj.text === 'string' ? obj.text : '' };
    case 'thinking':
      // Agent self-revision prose from rejected validation rounds — collapsed
      // by the UI, never shown as answer text.
      return { type: 'thinking', text: typeof obj.text === 'string' ? obj.text : '' };
    case 'uiHint':
      // P007: a uiHint without a card payload is not renderable — skip it.
      return obj.card && typeof obj.card === 'object'
        ? { type: 'uiHint', card: obj.card as UiHintCard }
        : null;
    case 'done':
      return { type: 'done' };
    case 'error': {
      const err = obj.error as Record<string, unknown> | undefined;
      const code = err && typeof err.code === 'string' ? (err.code as AgentEvent['error']['code']) : 'INTERNAL';
      const message = err && typeof err.message === 'string' ? err.message : 'unknown error';
      return { type: 'error', error: { code, message } };
    }
  }
}

/** Result of parsing one chunk: complete events + the unparsed remainder. */
export interface ParseResult {
  events: AgentEvent[];
  remainder: string;
}

/**
 * Pure SSE frame parser (B3 fixture target). Splits `buffer` on blank-line
 * boundaries (`\n\n` or `\r\n\r\n`), extracts `data:` lines per frame, joins
 * them, JSON-parses, and normalizes. Incomplete trailing data is returned as
 * `remainder` so it can be prepended to the next chunk.
 */
export function parseSSEChunk(buffer: string): ParseResult {
  const events: AgentEvent[] = [];
  let pos = 0;

   
  while (true) {
    // Find the next blank-line boundary at/after `pos`.
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
      break; // no complete frame remaining
    }

    const frame = buffer.slice(pos, boundaryStart);
    pos = boundaryEnd;

    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        // Per the SSE spec, a single leading space after the colon is stripped.
        let payload = line.slice(5);
        if (payload.startsWith(' ')) payload = payload.slice(1);
        dataLines.push(payload);
      }
    }
    if (dataLines.length === 0) continue;

    const jsonStr = dataLines.join('\n');
    if (jsonStr === '[DONE]') continue; // tolerate sentinel if ever sent

    try {
      const parsed = JSON.parse(jsonStr);
      const event = normalizeAgentEvent(parsed);
      if (event) events.push(event);
    } catch {
      // P007: malformed JSON frame — skip, never crash the stream.
    }
  }

  return { events, remainder: buffer.slice(pos) };
}

/** Injectable dependencies (P006). All optional — defaults wire production IO. */
export interface AgentClientOptions {
  /** Override the global fetch (test injection / proxy wiring). */
  fetchImpl?: typeof fetch;
  /** Override the SSE endpoint URL (defaults to `${API_BASE}/chat`). */
  url?: string;
  /** Override header builder (defaults to geminiService.getHeaders). */
  getHeaders?: () => Record<string, string>;
  /** Override identity resolver (defaults to geminiService.getUserId). */
  getUserId?: () => string;
  /**
   * [B5b SSE ②] 空闲看门狗间隔（默认 45s = 3× 后端 15s 保活帧）。任何字节
   * （含 `: ping` 注释帧）都会重置计时；超过该间隔无字节视为连接已死，
   * 中止 fetch 并以 `CONNECTION_LOST` 收尾。测试注入小值避免真实等待。
   */
  idleTimeoutMs?: number;
}

/**
 * [B5b SSE ② / issue #38] 空闲看门狗间隔：45s = 连丢 3 个后端保活帧。
 * 后端每 15s 发一帧 `: ping`（见 backend agentSse.ts SSE_PING_INTERVAL_MS）；
 * 只要字节还在到达，计时器不断重置。45s 无字节说明传输层已断（iOS
 * WKWebView 空闲超时 / 网络切换），此时应显式失败而不是永远转圈。
 */
export const SSE_IDLE_TIMEOUT_MS = 45_000;

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'network error';
}

/**
 * Build an `AgentClient` whose `chat` streams `AgentEvent`s from `/api/chat`.
 *
 * P010: implicit identity is absorbed into the seam — if `req.userId` is empty
 * the client injects the resolved user id, so callers can omit it.
 */
export function createSseAgentClient(opts: AgentClientOptions = {}): AgentClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const getHeaders = opts.getHeaders ?? defaultGetHeaders;
  const getUserId = opts.getUserId ?? defaultGetUserId;
  const idleTimeoutMs = opts.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
  // URL resolved lazily so importing this module never evaluates API_BASE
  // (which touches `window`) — safe in non-DOM test environments.
  // API_BASE already includes the `/api` segment (e.g. `http://localhost:43111/api`),
  // matching the convention used by every other service (`${API_BASE}/exercises`,
  // `${API_BASE}/tutorial`, ...). Appending `/api/chat` here would double the prefix
  // and hit `/api/api/chat` → 404 (previously surfaced as the "系统开小差" fallback).
  const resolveUrl = (): string => opts.url ?? `${API_BASE}/chat`;

  return {
    async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
      // P010: absorb implicit identity into the seam.
      const userId = req.userId || getUserId();
      const body = JSON.stringify({ ...req, userId });

      // [B5b SSE ②] 看门狗超时后中止整条 fetch（挂起的 reader.read() 随之
      // reject/done），连接不会残留在后台。
      const abort = new AbortController();

      let response: Response;
      try {
        response = await fetchImpl(resolveUrl(), {
          method: 'POST',
          headers: getHeaders(),
          body,
          signal: abort.signal,
        });
      } catch (err) {
        yield { type: 'error', error: { code: 'UPSTREAM_TIMEOUT', message: toErrorMessage(err) } };
        return;
      }

      if (!response.ok || !response.body) {
        // DIAG: include the actual URL so a wrong prefix (e.g. /api/api/chat) is visible
        yield { type: 'error', error: { code: 'INTERNAL', message: `HTTP ${response.status} @ ${resolveUrl()}` } };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // [B5b SSE ②] 是否见过语义终态：后端正常收尾必发 done 事件；流断了
      // （字节中断/连接被掐）就不会有。据此区分「正常结束」与「断流」。
      let sawDone = false;

      /**
       * 空闲看门狗：read() 与 idleTimeoutMs 计时器竞速。任意字节（含后端
       * 15s `: ping` 保活注释帧）到达即重置；超时返回 {kind:'timeout'} 表示
       * 连接已死（由 abort 兜底释放挂起的 read）。read 拒绝透传为
       * {kind:'throw'}，交回外层 catch 统一映射。
       */
      type ReadOutcome =
        | { kind: 'read'; result: ReadableStreamReadResult<Uint8Array> }
        | { kind: 'throw'; error: unknown }
        | { kind: 'timeout' };
      const readWithWatchdog = (): Promise<ReadOutcome> =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ kind: 'timeout' }), idleTimeoutMs);
          reader.read().then(
            (result) => {
              clearTimeout(timer);
              resolve({ kind: 'read', result });
            },
            (error) => {
              clearTimeout(timer);
              resolve({ kind: 'throw', error });
            },
          );
        });

      try {
        while (true) {
          const outcome = await readWithWatchdog();
          if (outcome.kind === 'timeout') {
            // 45s 无任何字节（3 个保活帧全丢）→ 传输层已断，显式失败
            abort.abort();
            yield { type: 'error', error: { code: 'CONNECTION_LOST', message: '连接已中断，请检查网络后重试' } };
            return;
          }
          if (outcome.kind === 'throw') throw outcome.error;
          const { done, value } = outcome.result;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSSEChunk(buffer);
          buffer = parsed.remainder;
          for (const ev of parsed.events) {
            if (ev.type === 'done') sawDone = true;
            yield ev;
          }
        }
        // Flush any trailing bytes + decoder remainder, then parse the tail.
        buffer += decoder.decode();
        const tail = parseSSEChunk(buffer + '\n\n');
        for (const ev of tail.events) {
          if (ev.type === 'done') sawDone = true;
          yield ev;
        }
        // [B5b SSE ②] 流读完但没有 done 事件 = 中途被掐断（非正常收尾）。
        // 已有 error 收尾的（parse 出 error 事件）不重复报；否则补一个
        // CONNECTION_LOST，让 UI 走「连接中断，点击重试」而不是干等。
        if (!sawDone) {
          yield { type: 'error', error: { code: 'CONNECTION_LOST', message: '回复未完整送达（连接中断）' } };
        }
      } catch (err) {
        // abort 触发的 read reject 在这里落地；看门狗已 yield 过 CONNECTION_LOST，
        // 这里统一映射为 UPSTREAM_TIMEOUT 语义（调用端取第一个 error）。
        yield { type: 'error', error: { code: 'UPSTREAM_TIMEOUT', message: toErrorMessage(err) } };
      } finally {
        abort.abort(); // 兜底释放：生成器提前 return（消费者 break）也断开连接
      }
    },
  };
}

/** Default singleton used by production hooks. URL/identity resolve lazily. */
export const agentClient: AgentClient = createSseAgentClient();

/**
 * Aggregate a full agent turn stream into the shape hooks render. Tokens
 * concatenate into `text`; the last `uiHint` card wins; the first `error` is
 * surfaced. Used by hooks that don't need incremental streaming UX (keeps the
 * existing single-bubble rendering path working — "uiHint synthesis retained").
 */
export interface ChatResult {
  text: string;
  card?: UiHintCard;
  error?: { code: string; message: string };
}

export async function consumeAgentStream(events: AsyncIterable<AgentEvent>): Promise<ChatResult> {
  let text = '';
  let card: UiHintCard | undefined;
  let error: { code: string; message: string } | undefined;

  for await (const ev of events) {
    if (ev.type === 'token' && ev.text) {
      text += ev.text;
    } else if (ev.type === 'uiHint' && ev.card) {
      card = ev.card; // last card wins
    } else if (ev.type === 'error' && ev.error && !error) {
      error = { code: ev.error.code, message: ev.error.message };
    }
    // 'done' terminates the turn semantically; loop ends when generator exhausts.
  }

  return { text, card, error };
}

/**
 * Map (B4) a contract `UiHintCard` to the renderable `uiHint` object the legacy
 * `ExerciseRenderer` consumes. Card types are suffixed to the legacy enum names
 * so the existing polymorphic card renderer keeps working without perceiving the
 * backend swap. Pass-through for `title` / `data` / `actionUri`.
 *
 * Returns `undefined` when there is no card, so callers can spread the result
 * directly onto a chat message.
 */
const CARD_TYPE_TO_LEGACY: Record<UiHintCard['type'], string> = {
  plan: 'plan_card',
  summary: 'summary_card',
  survey: 'survey_card',
  instruction: 'instruction_card',
  deviation: 'deviation_confirmation',
  // 2026-09: user-profile auto-update consent bubble. Rendered as-is so the
  // frontend can bind its special confirm/cancel bubble to this type.
  profile_update_confirm: 'profile_update_confirm',
  unknown: 'unknown_card',
};

export interface RenderableUiHint {
  type: string;
  title?: string;
  data?: Record<string, unknown>;
  actionUri?: string;
  priority?: number;
  /** plan 专用：'next_day' = 明日计划卡（Agent 按「制定明天计划」意图打标） */
  target?: 'next_day';
}

export function synthesizeUiHint(card?: UiHintCard): RenderableUiHint | undefined {
  if (!card) return undefined;
  const hint: RenderableUiHint = {
    type: CARD_TYPE_TO_LEGACY[card.type] ?? card.type,
    data: card.data,
  };
  if (card.title !== undefined) hint.title = card.title;
  if (card.actionUri !== undefined) hint.actionUri = card.actionUri;
  if (card.priority !== undefined) hint.priority = card.priority;
  // plan 明日卡（2026-09-14）：Agent 对「制定明天计划」的请求打 target='next_day'，
  // 卡片在前端按「存为明日计划」消费，而不是灌进当前训练会话
  if (card.target !== undefined) hint.target = card.target;
  return hint;
}
