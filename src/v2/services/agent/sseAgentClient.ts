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
const EVENT_TYPES = new Set<AgentEvent['type']>(['token', 'uiHint', 'done', 'error']);

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

  // eslint-disable-next-line no-constant-condition
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
}

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

      let response: Response;
      try {
        response = await fetchImpl(resolveUrl(), {
          method: 'POST',
          headers: getHeaders(),
          body,
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

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSSEChunk(buffer);
          buffer = parsed.remainder;
          for (const ev of parsed.events) yield ev;
        }
        // Flush any trailing bytes + decoder remainder, then parse the tail.
        buffer += decoder.decode();
        const tail = parseSSEChunk(buffer + '\n\n');
        for (const ev of tail.events) yield ev;
      } catch (err) {
        yield { type: 'error', error: { code: 'UPSTREAM_TIMEOUT', message: toErrorMessage(err) } };
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
  unknown: 'unknown_card',
};

export interface RenderableUiHint {
  type: string;
  title?: string;
  data?: Record<string, unknown>;
  actionUri?: string;
  priority?: number;
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
  return hint;
}
