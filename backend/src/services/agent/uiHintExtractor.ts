/**
 * uiHintExtractor (INT) — streaming token -> uiHint extraction layer.
 *
 * This is the integration bridge the individual cards left open: {@link
 * DeepAgentService.chat} (M3) yields the RAW agent stream (`token` / `done` /
 * `error` only — L004), and the M5 validation loop
 * (`chatWithValidationLoop`) CONSUMES `uiHint` events but produces none. Real
 * agents (verified by the L003 probe against the live `deepseek-v4-flash`
 * model) emit the structured card as a fenced JSON block inside the prose
 * stream:
 *
 *   Here is your plan...
 *   ```json
 *   { "type": "plan_card", "data": [ ...exercises... ] }
 *   ```
 *   ...closing prose...
 *
 * `extractUiHintEvents` is a pure async-iterable transform that walks that raw
 * stream, peels the JSON card out of its ``` fence, and re-emits it as a
 * structured `{ type: 'uiHint', card }` AgentEvent while streaming the
 * surrounding prose through as `token` events. It is a stateless pipeline
 * stage: feed it the raw seam, get the card-augmented seam. M3's `chat` stays
 * raw (L004); M5's loop stays the sole validation/retry home (L004). This
 * module does neither — it only extracts.
 *
 * Extraction policy (L004 boundary): LIBERAL. Any JSON object (fenced or, as a
 * fallback, a balanced inline object) that has a non-empty string `type` field
 * is emitted as a `uiHint` event, VALID OR NOT. Correctness is the M5
 * validator's job; deliberately extracting invalid cards is what lets the
 * validation loop (B4) see a bad first attempt, feed errors back, and retry —
 * if extraction pre-filtered to "valid only", the retry loop would be silently
 * defeated.
 *
 * Robustness: primary path is the ``` fence (what the real model emits). A
 * brace-balance fallback recovers cards emitted without a fence. Fence markers
 * and in-progress `{` objects may arrive split across token chunks; a tail is
 * retained so a partial ``` or a half-arrived card is never mistaken for prose.
 */

import type { AgentEvent, UiHintCard } from 'shared/contracts';

// ---------------------------------------------------------------------------
// Pure card parser — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Attempt to parse `jsonStr` into a uiHint card payload.
 *
 * Liberal: succeeds for ANY JSON object with a non-empty string `type` field.
 * Returns the parsed object (typed loosely as {@link UiHintCard} at the seam
 * boundary — the M5 validator re-checks the exact shape). `null` for non-JSON,
 * non-objects, arrays, or objects without a `type` discriminator (so prose /
 * JSON that is not a card is left alone).
 */
export function tryParseCard(jsonStr: string): Record<string, unknown> | null {
  const trimmed = jsonStr.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof (parsed as { type?: unknown }).type === 'string' &&
    (parsed as { type: string }).type.length > 0
  ) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fence scanning — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * A ``` fence opener, optionally followed by a language word (`json`, `JSON`,
 * ...) and trailing whitespace. Matches ```json\n, ```{\n, ```JSON, or bare ```.
 *
 * Returns the index of the opener and its total length, or `null` if none.
 */
export function findFenceOpen(
  text: string,
): { index: number; length: number } | null {
  const start = text.indexOf('```');
  if (start === -1) {
    return null;
  }
  // After the triple backtick, consume an optional language word then spaces.
  let i = start + 3;
  while (i < text.length && /[A-Za-z0-9+.-]/.test(text[i]!)) {
    i += 1;
  }
  // The opener is only CONFIRMED once we can see a character past the language
  // word (a non-word char: newline, space, or content like `{`). If the buffer
  // ends inside the word — e.g. just "```" or "```jso" with more letters
  // possibly arriving — do not match yet; the caller retains the tail and
  // retries on the next chunk. Without this, "```" arriving alone would commit
  // to fence mode and swallow the following "json\n" as fence body.
  if (i >= text.length) {
    return null;
  }
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    i += 1;
  }
  // Consume at most one newline right after the opener (common: ```json\n{).
  if (text[i] === '\n') {
    i += 1;
  } else if (text[i] === '\r' && text[i + 1] === '\n') {
    i += 2;
  }
  return { index: start, length: i - start };
}

/**
 * Largest opener we might retain a tail for (so a split ```json\n is never
 * flushed as prose prematurely). ```json\n = 9 chars; 12 gives headroom.
 */
const FENCE_TAIL_KEEP = 12;

// ---------------------------------------------------------------------------
// Module-private brace helpers
// ---------------------------------------------------------------------------

/**
 * Find the earliest balanced `{ ... }` object in `text` (brace counting that
 * respects JSON strings + escapes) that parses into a uiHint card. Returns the
 * half-open span `[start, end)` and the card, or `null` if none.
 */
function findBalancedCard(
  text: string,
): { start: number; end: number; card: Record<string, unknown> } | null {
  const from = text.indexOf('{');
  if (from === -1) {
    return null;
  }
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(from, i + 1);
        const card = tryParseCard(candidate);
        if (card) {
          return { start: from, end: i + 1, card };
        }
        return null; // balanced but not a card — leave intact as prose.
      }
    }
  }
  return null; // unbalanced (still growing) — leave intact.
}

/**
 * Number of trailing chars to hold back because they contain an unmatched `{`
 * (a card mid-arrival). Holds the whole in-progress object so it is never
 * flushed as prose before it completes. `0` when braces are balanced.
 */
function openBraceHoldback(text: string): number {
  let depth = 0;
  let outerStart = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      if (depth === 0) {
        outerStart = i;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        outerStart = -1;
      }
    }
  }
  return depth > 0 && outerStart !== -1 ? text.length - outerStart : 0;
}

// ---------------------------------------------------------------------------
// Streaming extractor
// ---------------------------------------------------------------------------

/**
 * Stateful, chunk-fed extractor. Pure logic over an internal buffer; no I/O.
 * `feed()` is called per token chunk; `flush()` drains residuals at stream end.
 */
class StreamCardExtractor {
  /** Prose / undecided text while scanning OUTSIDE a fence. */
  private outsideBuf = '';
  /** Accumulated fence body while INSIDE a fence (no closing ``` yet). */
  private insideBuf = '';
  private inFence = false;

  /** Feed one token text chunk; returns zero or more events to emit now. */
  feed(text: string): AgentEvent[] {
    return this.inFence ? this.feedInside(text) : this.feedOutside(text);
  }

  /** Drain residuals at stream end (or on a terminal event). Idempotent. */
  flush(): AgentEvent[] {
    const out: AgentEvent[] = [];
    if (this.inFence) {
      // Stream ended mid-fence (no closing ```). Best-effort: try to recover a
      // card from what accumulated; otherwise surface the raw text as prose so
      // nothing is silently dropped.
      const card = tryParseCard(this.insideBuf);
      if (card) {
        out.push(this.uiHint(card));
      } else if (this.insideBuf.trim()) {
        out.push(this.token(this.insideBuf));
      }
      this.insideBuf = '';
      this.inFence = false;
    }
    // OUTSIDE residuals: a complete unfenced card may still be sitting in the
    // buffer; otherwise emit the residual prose verbatim.
    if (this.outsideBuf) {
      const balanced = findBalancedCard(this.outsideBuf);
      if (balanced) {
        if (this.outsideBuf.slice(0, balanced.start)) {
          out.push(this.token(this.outsideBuf.slice(0, balanced.start)));
        }
        out.push(this.uiHint(balanced.card));
        if (this.outsideBuf.slice(balanced.end)) {
          out.push(this.token(this.outsideBuf.slice(balanced.end)));
        }
      } else {
        out.push(this.token(this.outsideBuf));
      }
      this.outsideBuf = '';
    }
    return out;
  }

  // -- OUTSIDE fence --------------------------------------------------------

  private feedOutside(text: string): AgentEvent[] {
    this.outsideBuf += text;
    const out: AgentEvent[] = [];
    // Loop: a single chunk may contain prose + a complete card + more prose.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // 1. Fenced card?
      const open = findFenceOpen(this.outsideBuf);
      if (open) {
        const prose = this.outsideBuf.slice(0, open.index);
        if (prose) {
          out.push(this.token(prose));
        }
        const after = this.outsideBuf.slice(open.index + open.length);
        const close = after.indexOf('```');
        if (close !== -1) {
          const card = tryParseCard(after.slice(0, close));
          if (card) {
            out.push(this.uiHint(card));
          } else if (after.slice(0, close).trim()) {
            out.push(this.token(after.slice(0, close)));
          }
          this.outsideBuf = after.slice(close + 3);
          continue; // more fences may follow in the remainder.
        }
        // Opener found, close not yet seen — switch to INSIDE and accumulate.
        this.insideBuf = after;
        this.outsideBuf = '';
        this.inFence = true;
        break;
      }
      // 2. Unfenced balanced card? (models that omit the fence — recovered
      //    mid-stream so the card is not flushed as prose.)
      const balanced = findBalancedCard(this.outsideBuf);
      if (balanced) {
        if (this.outsideBuf.slice(0, balanced.start)) {
          out.push(this.token(this.outsideBuf.slice(0, balanced.start)));
        }
        out.push(this.uiHint(balanced.card));
        this.outsideBuf = this.outsideBuf.slice(balanced.end);
        continue;
      }
      // 3. Nothing complete yet. Emit safe prose, holding back a tail that
      //    covers a potential split ``` opener (including an as-yet-unconfirmed
      //    long language word), AND any in-progress (unmatched) `{`, so a
      //    half-arrived fence or card is never flushed as prose.
      let holdback = FENCE_TAIL_KEEP;
      const fenceFrag = this.outsideBuf.lastIndexOf('```');
      if (fenceFrag !== -1) {
        holdback = Math.max(holdback, this.outsideBuf.length - fenceFrag);
      }
      holdback = Math.max(holdback, openBraceHoldback(this.outsideBuf));
      if (this.outsideBuf.length > holdback) {
        const safe = this.outsideBuf.slice(0, this.outsideBuf.length - holdback);
        this.outsideBuf = this.outsideBuf.slice(this.outsideBuf.length - holdback);
        if (safe) {
          out.push(this.token(safe));
        }
      }
      break;
    }
    return out;
  }

  // -- INSIDE fence ---------------------------------------------------------

  private feedInside(text: string): AgentEvent[] {
    this.insideBuf += text;
    const close = this.insideBuf.indexOf('```');
    if (close === -1) {
      // Still accumulating the fenced body; emit nothing yet.
      return [];
    }
    const body = this.insideBuf.slice(0, close);
    const rest = this.insideBuf.slice(close + 3);
    this.insideBuf = '';
    this.inFence = false;
    // Hand the remainder (after the closing fence) back to OUTSIDE processing.
    this.outsideBuf = rest;
    const out: AgentEvent[] = [];
    const card = tryParseCard(body);
    if (card) {
      out.push(this.uiHint(card));
    } else if (body.trim()) {
      out.push(this.token(body));
    }
    // Continue draining OUTSIDE (rest may itself open another fence / hold prose).
    out.push(...this.feedOutside(''));
    return out;
  }

  // -- Event constructors ---------------------------------------------------

  private token(text: string): AgentEvent {
    return { type: 'token', text };
  }

  private uiHint(card: Record<string, unknown>): AgentEvent {
    return { type: 'uiHint', card: card as UiHintCard };
  }
}

// ---------------------------------------------------------------------------
// Public async-iterable transform
// ---------------------------------------------------------------------------

/**
 * Transform a raw `AgentEvent` stream (token / done / error) into a
 * card-augmented stream (token / uiHint / done / error).
 *
 * Token events are scanned for fenced (or, as a fallback, balanced inline) JSON
 * cards; each recognized card is re-emitted as a `{ type: 'uiHint', card }`
 * event and removed from the prose. All other event kinds (`done` / `error`,
 * and any `uiHint` already present) are forwarded verbatim after flushing
 * pending prose.
 */
export async function* extractUiHintEvents(
  events: AsyncIterable<AgentEvent>,
): AsyncIterable<AgentEvent> {
  const extractor = new StreamCardExtractor();
  try {
    for await (const event of events) {
      if (event.type === 'token' && typeof event.text === 'string' && event.text.length > 0) {
        for (const out of extractor.feed(event.text)) {
          yield out;
        }
      } else {
        // A terminal / non-token event: flush any pending prose first, then
        // forward the event unchanged. Forwarding existing uiHint events
        // verbatim keeps this transform idempotent if a card was already split
        // out upstream.
        for (const out of extractor.flush()) {
          yield out;
        }
        yield event;
      }
    }
  } finally {
    // Stream exhausted without a terminal event: still flush pending prose so
    // nothing is lost. flush() is idempotent.
    for (const out of extractor.flush()) {
      yield out;
    }
  }
}
