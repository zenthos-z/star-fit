/**
 * Tests for the SSE AgentClient seam (M8FE).
 *
 * B3 (SSE consumption): inject an SSE fixture stream via a mock fetch and assert
 * the client yields the corresponding AgentEvents — covering all four backend
 * frame types (token | uiHint | done | error) and error isolation (P007: an
 * error frame / transport failure never crashes the stream).
 *
 * B4 (uiHint synthesis): inject a uiHint card fixture and assert synthesizeUiHint
 * produces a renderable card object (real card schema, not an empty object).
 *
 * P012 (build-gate vacuity probe): the SSE parser is exercised against real
 * `data: <json>\n\n` frames, not stubbed away — the parsing path is genuinely
 * under test.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseSSEChunk,
  normalizeAgentEvent,
  createSseAgentClient,
  consumeAgentStream,
  synthesizeUiHint,
} from '../sseAgentClient';
import type { AgentEvent, UiHintCard } from 'shared/contracts';

/** Build a minimal Response-like object carrying a ReadableStream body. */
function sseResponse(chunks: string[], init: { ok?: boolean; status?: number } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body,
  } as unknown as Response;
}

/** Stitch SSE frames from AgentEvents using the backend wire format. */
function frame(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const noHeaders = () => ({ 'Content-Type': 'application/json' });
const fixedUser = () => '11111111-1111-1111-1111-111111111111';

/** Collect every AgentEvent yielded by a chat() call. */
async function drain(req: { message: string; scenario?: 'chat' | 'plan' }, chunks: string[], responseInit?: { ok?: boolean; status?: number }) {
  const fetchImpl = vi.fn(async () => sseResponse(chunks, responseInit)) as unknown as typeof fetch;
  const client = createSseAgentClient({ fetchImpl, url: '/api/chat', getHeaders: noHeaders, getUserId: fixedUser });
  const out: AgentEvent[] = [];
  for await (const ev of client.chat({ userId: fixedUser(), message: req.message, scenario: req.scenario })) {
    out.push(ev);
  }
  return { out, fetchImpl };
}

describe('parseSSEChunk (pure parser)', () => {
  it('parses all four frame types with the real `data: <json>\\n\\n` format', () => {
    const buffer = frame({ type: 'token', text: 'hel' }) +
      frame({ type: 'token', text: 'lo' }) +
      frame({ type: 'uiHint', card: { type: 'plan', data: { items: 2 }, priority: 0 } }) +
      frame({ type: 'done' });

    const { events, remainder } = parseSSEChunk(buffer);
    expect(remainder).toBe('');
    expect(events.map(e => e.type)).toEqual(['token', 'token', 'uiHint', 'done']);
    expect(events[0].text).toBe('hel');
    expect(events[1].text).toBe('lo');
    expect(events[2].card?.type).toBe('plan');
  });

  it('returns an incomplete trailing frame as remainder (cross-chunk safety)', () => {
    // Two complete frames + one partial frame (no closing blank line).
    const buffer = frame({ type: 'token', text: 'hi' }) + 'data: {"type":"tok';
    const { events, remainder } = parseSSEChunk(buffer);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('token');
    expect(remainder).toBe('data: {"type":"tok');
  });

  it('resumes parsing when the remainder is completed by a later chunk', () => {
    const { events: first, remainder } = parseSSEChunk('data: {"type":"tok');
    expect(first).toHaveLength(0);
    const { events: second } = parseSSEChunk(remainder + 'en","text":"x"}\n\n');
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual({ type: 'token', text: 'x' });
  });

  it('skips malformed JSON frames instead of throwing (P007)', () => {
    const buffer = 'data: {not json}\n\n' + frame({ type: 'done' });
    const { events } = parseSSEChunk(buffer);
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('tolerates \\r\\n\\r\\n frame boundaries and a leading space after data:', () => {
    const buffer = 'data: {"type":"token","text":"a"}\r\n\r\n';
    const { events } = parseSSEChunk(buffer);
    expect(events).toEqual([{ type: 'token', text: 'a' }]);
  });
});

describe('normalizeAgentEvent', () => {
  it('rejects non-events defensively', () => {
    expect(normalizeAgentEvent(null)).toBeNull();
    expect(normalizeAgentEvent({})).toBeNull();
    expect(normalizeAgentEvent({ type: 'bogus' })).toBeNull();
  });

  it('defaults a token with missing text to empty string', () => {
    expect(normalizeAgentEvent({ type: 'token' })).toEqual({ type: 'token', text: '' });
  });

  it('drops a uiHint that has no card payload', () => {
    expect(normalizeAgentEvent({ type: 'uiHint' })).toBeNull();
  });

  it('fills a default error shape when fields are missing', () => {
    expect(normalizeAgentEvent({ type: 'error' })).toEqual({
      type: 'error',
      error: { code: 'INTERNAL', message: 'unknown error' },
    });
  });
});

describe('createSseAgentClient (B3 — SSE fixture → AgentEvent)', () => {
  it('yields token stream + uiHint + done from a real SSE fixture', async () => {
    const chunks = [
      frame({ type: 'token', text: 'Plan: ' }),
      // Split a frame across two chunks to exercise ReadableStream streaming.
      'data: {"type":"tok',
      'en","text":"A"}\n\n',
      frame({ type: 'uiHint', card: { type: 'plan', data: { n: 1 }, priority: 2 } }),
      frame({ type: 'done' }),
    ];
    const { out, fetchImpl } = await drain({ message: 'hi' }, chunks);

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(out.map(e => e.type)).toEqual(['token', 'token', 'uiHint', 'done']);
    expect(out[0].text).toBe('Plan: ');
    expect(out[1].text).toBe('A');
    expect(out[2].card?.type).toBe('plan');
  });

  it('does not crash on an error frame mid-stream (P007 error isolation)', async () => {
    const chunks = [
      frame({ type: 'token', text: 'partial' }),
      frame({ type: 'error', error: { code: 'MODEL_ERROR', message: 'boom' } }),
      frame({ type: 'done' }),
    ];
    const { out } = await drain({ message: 'hi' }, chunks);
    // Stream continues past the error frame; all events surfaced.
    expect(out.map(e => e.type)).toEqual(['token', 'error', 'done']);
    expect(out[1].error).toEqual({ code: 'MODEL_ERROR', message: 'boom' });
  });

  it('surfaces a transport (fetch) failure as a terminal error event, not a throw', async () => {
    const client = createSseAgentClient({
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
      url: '/api/chat',
      getHeaders: noHeaders,
      getUserId: fixedUser,
    });
    const out: AgentEvent[] = [];
    for await (const ev of client.chat({ userId: fixedUser(), message: 'x' })) out.push(ev);
    expect(out).toEqual([
      { type: 'error', error: { code: 'UPSTREAM_TIMEOUT', message: 'network down' } },
    ]);
  });

  it('surfaces a non-2xx HTTP response as a terminal error event', async () => {
    const { out } = await drain({ message: 'x' }, [], { ok: false, status: 503 });
    expect(out).toEqual([
      { type: 'error', error: { code: 'INTERNAL', message: 'HTTP 503' } },
    ]);
  });

  it('injects implicit userId into the request body (P010 seam absorbs identity)', async () => {
    const { fetchImpl } = await drain({ message: 'x' }, [frame({ type: 'done' })]);
    const call = (fetchImpl as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.userId).toBe(fixedUser());
    expect(body.message).toBe('x');
  });
});

describe('consumeAgentStream', () => {
  it('concatenates tokens, keeps the last card, surfaces error', async () => {
    async function* gen(): AsyncIterable<AgentEvent> {
      yield { type: 'token', text: 'foo ' };
      yield { type: 'token', text: 'bar' };
      yield { type: 'uiHint', card: { type: 'survey', data: { q: 'rpe?' }, priority: 0 } };
      yield { type: 'done' };
    }
    const result = await consumeAgentStream(gen());
    expect(result.text).toBe('foo bar');
    expect(result.card?.type).toBe('survey');
    expect(result.error).toBeUndefined();
  });

  it('keeps the last uiHint when several are emitted', async () => {
    async function* gen(): AsyncIterable<AgentEvent> {
      yield { type: 'uiHint', card: { type: 'plan', data: { a: 1 }, priority: 0 } };
      yield { type: 'uiHint', card: { type: 'summary', data: { b: 2 }, priority: 0 } };
      yield { type: 'done' };
    }
    const result = await consumeAgentStream(gen());
    expect(result.card?.type).toBe('summary');
  });
});

describe('synthesizeUiHint (B4 — uiHint fixture → renderable card)', () => {
  it('maps a plan card to the legacy renderable shape', () => {
    const card: UiHintCard = {
      type: 'plan',
      data: [
        { name: '杠铃卧推', sets: [{ weight: 60, reps: 10 }] },
      ] as unknown as Record<string, unknown>,
      priority: 1,
    };
    const hint = synthesizeUiHint(card);
    expect(hint).toBeDefined();
    expect(hint!.type).toBe('plan_card'); // legacy renderer enum
    expect(hint!.data).toEqual(card.data);
    expect(hint!.priority).toBe(1);
  });

  it('maps every contract card type to a renderable legacy type', () => {
    const cases: Array<[UiHintCard['type'], string]> = [
      ['plan', 'plan_card'],
      ['summary', 'summary_card'],
      ['survey', 'survey_card'],
      ['instruction', 'instruction_card'],
      ['deviation', 'deviation_confirmation'],
      ['unknown', 'unknown_card'],
    ];
    for (const [contractType, legacyType] of cases) {
      const hint = synthesizeUiHint({ type: contractType, data: { x: 1 }, priority: 0 });
      expect(hint!.type).toBe(legacyType);
      expect(hint!.data).toEqual({ x: 1 });
    }
  });

  it('returns undefined when no card is present (spread-safe for messages)', () => {
    expect(synthesizeUiHint(undefined)).toBeUndefined();
  });
});
