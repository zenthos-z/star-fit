/**
 * agentSse — SSE transport for the frozen `AgentService.chat` seam (P010).
 *
 * P007 sse-stream-error-isolation: the streaming endpoint has a fixed skeleton
 *   `reply.hijack()` -> write SSE headers -> `try { for await chunk -> sseEncode }`
 *   -> `catch` write a typed `error` frame (NEVER rethrow) -> `finally { raw.end() }`
 *   so the connection is always closed and never hangs.
 *
 * The two encoding helpers (`sseEncode`, `tokenFromChunk`) are PURE functions
 * with no HTTP dependency, so they unit-test in isolation (B1). `streamAgentSSE`
 * consumes the frozen `AsyncIterable<AgentEvent>` seam, so consumers
 * (chatController / frontend) need zero changes for the MAS->Deep Agents kernel
 * swap (P010).
 *
 * L004 scope boundary: this module is the SSE transport ONLY. It does not touch
 * `/mas/chat` or `/agent/plan` deactivation — that is R9's deletion scope.
 */

import type { FastifyReply } from 'fastify';
import type { AgentEvent } from 'shared/contracts';

// ---------------------------------------------------------------------------
// sseEncode — PURE (B1, P007)
// ---------------------------------------------------------------------------

/**
 * Encode a single {@link AgentEvent} as one `text/event-stream` frame.
 *
 * A frame is `data: <json>\n\n` — the trailing double newline terminates the
 * frame per the SSE spec, so a client `EventSource`/stream reader fires once per
 * event. Pure: same input -> same output, no I/O, no side effects.
 *
 * Carries all four event kinds (`token` | `uiHint` | `done` | `error`) verbatim;
 * the `type` discriminator lets the client branch without parsing `text`/`card`.
 */
export function sseEncode(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ---------------------------------------------------------------------------
// tokenFromChunk — PURE defensive extractor (P007)
// ---------------------------------------------------------------------------

/**
 * Pull incremental prose text out of any chunk shape a LangGraph / deepagents
 * stream can emit. Returns `null` when the chunk carries no text token.
 *
 * Handled shapes (defensive — a fake/probe agent and the real agent share one
 * extractor so they never diverge):
 *  - `[AIMessageChunk, metadata]` tuple  — `streamMode: 'messages'`
 *  - state object with `.messages`        — `streamMode: 'values' | 'updates'`
 *  - bare `string`
 *  - tool-call-only / metadata-only chunk -> `null` (no prose token)
 *
 * Pure: no I/O, deterministic.
 */
export function tokenFromChunk(chunk: unknown): string | null {
  // 1. bare string
  if (typeof chunk === 'string') {
    return chunk.length > 0 ? chunk : null;
  }
  if (chunk === null || typeof chunk !== 'object') {
    return null;
  }

  // 2. [message, metadata] tuple (streamMode 'messages')
  if (Array.isArray(chunk)) {
    return textFromMessageLike(chunk[0]);
  }

  // 3. state object carrying `.messages` (streamMode 'values' / 'updates')
  const maybeState = chunk as { messages?: unknown[] };
  if (Array.isArray(maybeState.messages) && maybeState.messages.length > 0) {
    const last = maybeState.messages[maybeState.messages.length - 1];
    return textFromMessageLike(last);
  }

  // 4. tool-call-only / metadata-only / unknown -> no prose token
  return null;
}

/**
 * Extract text from a message-like value's `.content`, which may be a string or
 * a multimodal content-block array. Tool-call blocks (no `text`) yield nothing.
 */
function textFromMessageLike(message: unknown): string | null {
  if (message === null || typeof message !== 'object') {
    return null;
  }
  const content = (message as { content?: unknown }).content;

  if (typeof content === 'string') {
    return content.length > 0 ? content : null;
  }

  if (Array.isArray(content)) {
    let text = '';
    for (const block of content) {
      if (
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        text += (block as { text: string }).text;
      }
    }
    return text.length > 0 ? text : null;
  }

  // content is a tool-call array / object without text -> no prose token
  return null;
}

// ---------------------------------------------------------------------------
// streamAgentSSE — P007 fixed skeleton (B2/B3, frozen seam P010)
// ---------------------------------------------------------------------------

/** SSE response headers sent on the hijacked raw response. */
const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Disable proxy buffering (nginx and friends) so frames flush immediately.
  'X-Accel-Buffering': 'no',
});

/**
 * Stream an {@link AgentEvent} async iterable to the client as SSE.
 *
 * Signature frozen verbatim (P010): `streamAgentSSE(reply, events)`. Any
 * MAS->Deep Agents contract drift is absorbed upstream of `events`; this
 * transport never sees kernel types.
 *
 * P007 skeleton:
 *   1. `reply.hijack()` — take over the raw socket; Fastify will not finalize.
 *   2. write SSE headers to `reply.raw`.
 *   3. `try` — for each event, `sseEncode` + `raw.write`; honor backpressure.
 *   4. `catch` — the generator threw: emit ONE typed `error` frame, never
 *      rethrow (a thrown rejection here would crash the process / hang the
 *      socket — the exact failure P007 exists to prevent).
 *   5. `finally` — ALWAYS `raw.end()` so the connection closes, never hangs.
 *
 * `events` is responsible for emitting its own terminal `done` frame on success;
 * this function only guarantees connection closure, not the `done` payload.
 */
export async function streamAgentSSE(
  reply: FastifyReply,
  events: AsyncIterable<AgentEvent>,
): Promise<void> {
  // P007 step 1: hijack so Fastify does not touch the raw stream.
  reply.hijack();
  const raw = reply.raw;

  // CORS: @fastify/cors injects `Access-Control-Allow-Origin` via an onSend
  // hook, which does NOT run once the reply is hijacked. The browser enforces
  // CORS on the actual (post-preflight) SSE response too — without these
  // headers the stream is blocked as net::ERR_FAILED despite a 200. Mirror the
  // server.ts policy (reflect origin + credentials; never `*` with credentials).
  const origin = (reply.request.headers.origin as string | undefined) ?? '';
  const headers: Record<string, string> = { ...SSE_HEADERS };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }

  // P007 step 2: SSE headers on the raw response.
  raw.writeHead(200, headers);

  try {
    // P007 step 3: encode + write each event, respecting backpressure.
    for await (const event of events) {
      const frame = sseEncode(event);
      const canFlush = raw.write(frame);
      if (!canFlush) {
        // Backpressure: wait for the stream to drain before the next frame.
        await new Promise<void>((resolve) => {
          raw.once('drain', () => resolve());
        });
      }
    }
  } catch (err) {
    // P007 step 4: error isolation — emit a typed error frame, never rethrow.
    const errorEvent: AgentEvent = {
      type: 'error',
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'SSE stream failed',
      },
    };
    try {
      raw.write(sseEncode(errorEvent));
    } catch {
      // Socket already torn down (client gone) — nothing more we can write;
      // the finally still closes our side.
    }
  } finally {
    // P007 step 5: ALWAYS end() — connection closes, never hangs.
    raw.end();
  }
}
