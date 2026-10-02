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

import type { AgentEvent, UiHintCard } from "shared/contracts";
// 吞卡修复（refs #73）：救卡判别用已知卡类型白名单（与校验器/技能同源），
// 区分真卡与「带 type 字段的工具返回复述」（list_exercises 行对象）。
import { ALLOWED_UIHINT_TYPES } from "./uiHintFormat.js";

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
  if (!trimmed.startsWith("{")) {
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
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof (parsed as { type?: unknown }).type === "string" &&
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
  const start = text.indexOf("```");
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
  while (i < text.length && (text[i] === " " || text[i] === "\t")) {
    i += 1;
  }
  // Consume at most one newline right after the opener (common: ```json\n{).
  if (text[i] === "\n") {
    i += 1;
  } else if (text[i] === "\r" && text[i + 1] === "\n") {
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
 * JSON-suspect predicate for a brace region (T56/#78 泄漏防线）：`{` followed
 * (within whitespace) by a `"` — canonical JSON opening, quoted key — or
 * structural-character heavy (>60% of non-whitespace is {}[]",:). CJK prose
 * braces (`{ 目标 }`) match neither: they quote nothing and are mostly
 * non-structural, so genuine prose keeps streaming untouched.
 */
function looksLikeJsonSuspect(obj: string): boolean {
  if (/^\{\s*"/.test(obj)) return true;
  const nonWs = obj.replace(/\s+/g, "");
  if (nonWs.length === 0) return false;
  const structural = (obj.match(/[\{\}\[\]"',:]/g) ?? []).length;
  return structural / nonWs.length > 0.6;
}

interface TopLevelScan {
  /** Earliest balanced `{...}` that parses into a card, if any. */
  card: { start: number; end: number; card: Record<string, unknown> } | null;
  /**
   * Start of the earliest JSON-suspect region that must NOT stream as prose:
   * a balanced-but-not-a-card JSON-looking object (malformed card JSON /
   * type-less tool JSON — the old "balanced but not a card — leave intact as
   * prose" path streamed it straight into the answer bubble, T56/#78 SSE
   * capture), or a still-unbalanced `{`. `-1` when nothing is suspect.
   */
  suspectStart: number;
}

/**
 * Walk top-level brace regions of `text` (string/escape-aware): prose braces
 * (`{ 目标 }`) are skipped past — a leading prose brace must neither block
 * card extraction nor trigger the JSON holdback (旧实现只看第一个对象，
 * 首对象非卡即整体放弃）。
 */
function scanTopLevelBraces(text: string): TopLevelScan {
  let i = 0;
  for (;;) {
    const brace = text.indexOf("{", i);
    if (brace === -1) return { card: null, suspectStart: -1 };
    const end = matchBalancedBraces(text, brace, text.length);
    if (end === -1) {
      return { card: null, suspectStart: brace }; // unbalanced (still growing)
    }
    const candidate = text.slice(brace, end);
    const card = tryParseCard(candidate);
    if (card) {
      return { card: { start: brace, end, card }, suspectStart: -1 };
    }
    if (looksLikeJsonSuspect(candidate)) {
      return { card: null, suspectStart: brace };
    }
    i = end; // balanced non-suspect (prose brace) — keep scanning
  }
}

/**
 * Earliest balanced card object in `text`, or `null`. Thin wrapper over
 * {@link scanTopLevelBraces} for the mid-stream extraction path.
 */
function findBalancedCard(
  text: string,
): { start: number; end: number; card: Record<string, unknown> } | null {
  return scanTopLevelBraces(text).card;
}

/**
 * Number of trailing chars to hold back because they contain card-suspect
 * JSON that must NOT stream as prose: an in-progress (unmatched) `{...`
 * object, OR a balanced object that did not extract as a card but looks like
 * JSON — held until the terminal flush (done/error), which downgrades the
 * suspect span to `thinking` and releases the surrounding prose (refs #73
 * 验收 / T56-#78 联动：宁可缓冲到终态判定后再决定放行或降级）。
 */
function jsonSuspectHoldback(text: string): number {
  const { suspectStart } = scanTopLevelBraces(text);
  return suspectStart === -1 ? 0 : text.length - suspectStart;
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
  private outsideBuf = "";
  /** Accumulated fence body while INSIDE a fence (no closing ``` yet). */
  private insideBuf = "";
  private inFence = false;

  /** Feed one token text chunk; returns zero or more events to emit now. */
  feed(text: string): AgentEvent[] {
    return this.inFence ? this.feedInside(text) : this.feedOutside(text);
  }

  /** Drain residuals at stream end (or on a terminal event). Idempotent. */
  flush(): AgentEvent[] {
    const out: AgentEvent[] = [];
    if (this.inFence) {
      // Stream ended mid-fence (no closing ```). Best-effort: recover a card
      // from what accumulated. If it is NOT a parseable card, it is model
      // scratch work (malformed JSON / reasoning draft) — downgrade to a
      // `thinking` event instead of leaking it into the answer prose.
      const card = tryParseCard(this.insideBuf);
      if (card) {
        out.push(this.uiHint(card));
      } else if (this.insideBuf.trim()) {
        out.push(this.thinking(this.insideBuf.trim()));
      }
      this.insideBuf = "";
      this.inFence = false;
    }
    // OUTSIDE residuals: terminal judgment per span — cards extracted, JSON
    // suspects downgraded, prose released (see emitOutsideResidual).
    if (this.outsideBuf) {
      out.push(...this.emitOutsideResidual(this.outsideBuf));
      this.outsideBuf = "";
    }
    return out;
  }

  /**
   * Terminal judgment for outside-buffer residual text (refs #73 验收 /
   * T56-#78 联动）：逐顶层括号区/围栏残片裁决——
   *   - 平衡卡对象 → uiHint（与流中提取同一宽松口径）；
   *   - JSON 可疑段（畸形卡 JSON / 无 type 工具 JSON / 未闭合 `{`）→ 降级
   *     `thinking`，绝不进正文；
   *   - 前后散文 → token 终态放行（不被可疑段陪葬）；
   *   - 尾部未确认围栏残片（流截断在 "```jso" 等）→ 降级 `thinking`。
   */
  private emitOutsideResidual(text: string): AgentEvent[] {
    const out: AgentEvent[] = [];
    let i = 0;
    for (;;) {
      const brace = text.indexOf("{", i);
      if (brace === -1) break;
      const end = matchBalancedBraces(text, brace, text.length);
      const spanEnd = end === -1 ? text.length : end;
      const span = text.slice(brace, spanEnd);
      const card = end === -1 ? null : tryParseCard(span);
      if (card) {
        if (text.slice(i, brace)) out.push(this.token(text.slice(i, brace)));
        out.push(this.uiHint(card));
      } else if (looksLikeJsonSuspect(span)) {
        if (text.slice(i, brace)) out.push(this.token(text.slice(i, brace)));
        if (span.trim()) out.push(this.thinking(span.trim()));
      } else if (end === -1) {
        break; // unbalanced non-suspect (prose brace) — leave to prose below
      } else {
        // balanced non-suspect (prose brace): the prose before it AND the
        // brace span itself are answer text — emit both, keep scanning.
        if (text.slice(i, end)) out.push(this.token(text.slice(i, end)));
        i = end;
        continue;
      }
      i = spanEnd;
      if (end === -1) return out; // suspect span consumed to end
    }
    const rest = text.slice(i);
    if (!rest) return out;
    const fenceAt = rest.lastIndexOf("```");
    if (fenceAt !== -1) {
      // Stream cut mid-opener (or stray closer): a fence fragment is never
      // prose — downgrade it, release what precedes.
      if (rest.slice(0, fenceAt)) out.push(this.token(rest.slice(0, fenceAt)));
      out.push(this.thinking(rest.slice(fenceAt).trim()));
      return out;
    }
    out.push(this.token(rest));
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
        const close = after.indexOf("```");
        if (close !== -1) {
          const card = tryParseCard(after.slice(0, close));
          if (card) {
            out.push(this.uiHint(card));
          } else if (after.slice(0, close).trim()) {
            // Unparsable fenced body — downgrade to thinking (leak guard).
            out.push(this.thinking(after.slice(0, close).trim()));
          }
          this.outsideBuf = after.slice(close + 3);
          continue; // more fences may follow in the remainder.
        }
        // Opener found, close not yet seen — switch to INSIDE and accumulate.
        this.insideBuf = after;
        this.outsideBuf = "";
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
      //    long language word), AND any card-suspect JSON region (in-progress
      //    `{` OR balanced-but-unparseable card JSON — T56/#78: the latter used
      //    to stream straight into the answer bubble), so neither a half-arrived
      //    fence/card nor malformed card JSON is ever flushed as prose.
      let holdback = FENCE_TAIL_KEEP;
      const fenceFrag = this.outsideBuf.lastIndexOf("```");
      if (fenceFrag !== -1) {
        holdback = Math.max(holdback, this.outsideBuf.length - fenceFrag);
      }
      holdback = Math.max(holdback, jsonSuspectHoldback(this.outsideBuf));
      if (this.outsideBuf.length > holdback) {
        const safe = this.outsideBuf.slice(
          0,
          this.outsideBuf.length - holdback,
        );
        this.outsideBuf = this.outsideBuf.slice(
          this.outsideBuf.length - holdback,
        );
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
    const close = this.insideBuf.indexOf("```");
    if (close === -1) {
      // Still accumulating the fenced body; emit nothing yet.
      return [];
    }
    const body = this.insideBuf.slice(0, close);
    const rest = this.insideBuf.slice(close + 3);
    this.insideBuf = "";
    this.inFence = false;
    // Hand the remainder (after the closing fence) back to OUTSIDE processing.
    this.outsideBuf = rest;
    const out: AgentEvent[] = [];
    const card = tryParseCard(body);
    if (card) {
      out.push(this.uiHint(card));
    } else if (body.trim()) {
      // Unparsable fence body (malformed JSON / reasoning draft): downgrade to
      // thinking — model scratch work must not leak into the answer prose.
      out.push(this.thinking(body.trim()));
    }
    // Continue draining OUTSIDE (rest may itself open another fence / hold prose).
    out.push(...this.feedOutside(""));
    return out;
  }

  // -- Event constructors ---------------------------------------------------

  private token(text: string): AgentEvent {
    return { type: "token", text };
  }

  /** Model scratch work (malformed card JSON / drafts) — never answer prose. */
  private thinking(text: string): AgentEvent {
    return { type: "thinking", text };
  }

  private uiHint(card: Record<string, unknown>): AgentEvent {
    return { type: "uiHint", card: card as UiHintCard };
  }
}

// ---------------------------------------------------------------------------
// Card segmentation — stream-layer rescue (吞卡修复, refs #73)
// ---------------------------------------------------------------------------

/**
 * String/escape-aware brace matcher for a `{...}` object starting at `start`:
 * returns the end index (exclusive) of the balanced object, or -1 when it is
 * unbalanced within `limit`.
 */
function matchBalancedBraces(
  text: string,
  start: number,
  limit: number,
): number {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < limit; i += 1) {
    const ch = text[i]!;
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Mark brace-balanced inline card objects within `[from, to)` into `spans`.
 * Non-card balanced objects (tool-return echoes without a top-level `type`)
 * are skipped past, not rescued; an unbalanced `{` aborts (incomplete object —
 * nothing later in the region can be rescued safely past it).
 */
function markInlineCards(
  text: string,
  from: number,
  to: number,
  spans: Array<[number, number]>,
): void {
  let i = from;
  while (i < to) {
    const brace = text.indexOf("{", i);
    if (brace === -1 || brace >= to) return;
    const end = matchBalancedBraces(text, brace, to);
    if (end === -1) return;
    if (tryParseRescuableCard(text.slice(brace, end))) {
      spans.push([brace, end]);
    }
    i = end;
  }
}

/**
 * Rescue-eligible card: parses as a card ({@link tryParseCard}) AND carries a
 * KNOWN card `type` ({@link ALLOWED_UIHINT_TYPES}).
 *
 * The liberal tryParseCard (ANY non-empty string `type`) is right for the
 * streaming extractor — invalid cards MUST reach the validator to drive the
 * retry loop — but too loose for the tool_calls rescue: tool-return echoes
 * also carry `type` fields (e.g. list_exercises rows `{id, name,
 * type:"compound"}`), and rescuing those would leak tool echoes into the token
 * stream (streamToolLeak 回归实锤). The allowlist is the discriminator: a
 * real card's type is always in it — the validator rejects anything else
 * anyway.
 */
function tryParseRescuableCard(
  jsonStr: string,
): Record<string, unknown> | null {
  const card = tryParseCard(jsonStr);
  if (card === null) return null;
  const type = card["type"];
  return typeof type === "string" &&
    (ALLOWED_UIHINT_TYPES as readonly string[]).includes(type)
    ? card
    : null;
}

/**
 * Split a COMPLETE buffered message body into card segments and the rest.
 *
 * Used by the stream layer (`classifyAgentStream`) to rescue cards emitted in
 * a message that ALSO carries tool_calls (the GLM "emits the card while calling
 * a tool" shape, refs #73): without this, the whole body is classified as
 * thinking and an ~12k-char weekly_plan card never reaches the user. A span is
 * a CARD segment when it is either
 *   - a complete ``` fence whose body parses into a uiHint card payload
 *     ({@link tryParseCard}: JSON object with a non-empty string `type`), or
 *   - a brace-balanced inline JSON object of the same card shape (models
 *     occasionally omit the fence — the streaming extractor recovers these on
 *     the terminal path; parity here).
 * Everything else (narration, non-card fences such as an echoed ```markdown
 * skill doc, tool-return JSON without a top-level `type`) stays in `rest` so
 * the caller keeps routing it to thinking — the tool-leak governance is
 * untouched: intermediate steps still emit ZERO prose tokens.
 *
 * `isEcho` (optional): a candidate card segment judged to be an echo of a tool
 * result (e.g. the example card fence inside plan-generation knowledge.md §9
 * quoted verbatim in a read_file echo) is demoted back into `rest` instead of
 * being rescued — an example card from an echoed doc must never be delivered
 * to the user as a real card.
 */
export function splitCardSegments(
  text: string,
  isEcho?: (segment: string) => boolean,
): { cards: string[]; rest: string } {
  const cardSpans: Array<[number, number]> = [];
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf("```", pos);
    const regionEnd = open === -1 ? text.length : open;
    markInlineCards(text, pos, regionEnd, cardSpans);
    if (open === -1) break;
    // Fence head: ``` + optional language word, then optional spaces and at
    // most one newline (mirrors findFenceOpen).
    let headEnd = open + 3;
    while (headEnd < text.length && /[A-Za-z0-9+.-]/.test(text[headEnd]!)) {
      headEnd += 1;
    }
    while (
      headEnd < text.length &&
      (text[headEnd] === " " || text[headEnd] === "\t")
    ) {
      headEnd += 1;
    }
    if (text[headEnd] === "\n") headEnd += 1;
    else if (text[headEnd] === "\r" && text[headEnd + 1] === "\n") headEnd += 2;
    const close = text.indexOf("```", headEnd);
    if (close === -1) {
      // Unclosed fence: the remainder is not a deliverable fence. Best-effort
      // — scan its body for inline card objects (same recovery the streaming
      // extractor performs at stream end), then stop.
      markInlineCards(text, headEnd, text.length, cardSpans);
      break;
    }
    if (tryParseRescuableCard(text.slice(headEnd, close))) {
      cardSpans.push([open, close + 3]);
    }
    pos = close + 3;
  }

  const cards: string[] = [];
  const restParts: string[] = [];
  let cursor = 0;
  for (const [start, end] of cardSpans) {
    const segment = text.slice(start, end);
    if (isEcho && isEcho(segment)) {
      continue; // echo of a tool result — leave the span inside `rest`
    }
    if (start > cursor) restParts.push(text.slice(cursor, start));
    cards.push(segment);
    cursor = end;
  }
  restParts.push(text.slice(cursor));
  return { cards, rest: restParts.join("").trim() };
}

// ---------------------------------------------------------------------------
// Leak-fragment predicate — 终态降级片段识别（refs #73/#56 机制升级）
// ---------------------------------------------------------------------------

/**
 * 卡型 type 字面量全集：后端校验白名单（ALLOWED_UIHINT_TYPES）+ 前端 LEGACY
 * 别名（cardLeakRecovery 的 RECOVERABLE_CARD_TYPES 同源口径——plan/summary/
 * survey/survey_success）。泄漏重试只认「自报卡型」的降级片段；工具返回
 * JSON（如 list_exercises 行的 type:"compound"）不命中，不触发重试。
 */
const LEAK_CARD_TYPE_NAMES = new Set<string>([
  ...ALLOWED_UIHINT_TYPES,
  "plan",
  "summary",
  "survey",
  "survey_success",
]);

/**
 * 判定一段降级 `thinking` 文本是否为「卡片泄漏残片」——模型本轮意图发卡，
 * 但卡片 JSON 写歪在正文（非围栏 / 语法破损 / 括号不闭合），被终态降级收起
 * （emitOutsideResidual / 未闭合围栏路径，refs #73）的片段。
 *
 * 判定信号（逐顶层括号区，与 emitOutsideResidual 的裁决粒度一致）：
 *   1. 区间自报已知卡型 type 字面量，或呈 `{type, data}` 卡协议形态
 *      （type 值不在白名单也算发卡意图）；
 *   2. 且该区间整体 JSON.parse 失败——能完整解析成卡的 JSON 不会被降级
 *      （终态会转 uiHint），只可能出现在流层工具返回复述里（read_file 技能
 *      文档示例卡的 isEcho 降级），复述不触发重试（否则无卡轮会被复述
 *      误燃一轮重生成）。
 *
 * 散文括号（`{ 目标 }`）、工具行 JSON（type 非卡型、无 data）不命中。
 */
export function isDegradedCardFragment(text: string): boolean {
  let i = 0;
  for (;;) {
    const brace = text.indexOf("{", i);
    if (brace === -1) return false;
    const end = matchBalancedBraces(text, brace, text.length);
    const spanEnd = end === -1 ? text.length : end;
    if (claimsBrokenCardShape(text.slice(brace, spanEnd))) {
      return true;
    }
    if (end === -1) return false; // 未闭合区已吞到文末，后面没有独立区间了
    i = end;
  }
}

/** 单个括号区间的破损卡判定：自报卡型 + 整体 parse 失败。 */
function claimsBrokenCardShape(span: string): boolean {
  const claimed = /"type"\s*:\s*"([A-Za-z0-9_]+)"/.exec(span);
  if (claimed === null) return false;
  const knownCardIntent =
    LEAK_CARD_TYPE_NAMES.has(claimed[1]!) || /"data"\s*:/.test(span);
  if (!knownCardIntent) return false;
  try {
    JSON.parse(span);
    return false; // 完整可解析的卡 JSON = 工具复述，不是降级残片
  } catch {
    return true; // 自报卡型但语法破损 —— 真·泄漏残片
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
      if (
        event.type === "token" &&
        typeof event.text === "string" &&
        event.text.length > 0
      ) {
        for (const out of extractor.feed(event.text)) {
          yield out;
        }
      } else if (event.type === "done" || event.type === "error") {
        // True terminal: run the buffered card judgment (release as uiHint /
        // downgrade to thinking) first, then forward the event unchanged.
        for (const out of extractor.flush()) {
          yield out;
        }
        yield event;
      } else {
        // Non-token, non-terminal (thinking / an upstream uiHint): forward
        // verbatim WITHOUT flushing — a mid-answer thinking event (LiveEchoGate
        // echo) must never cut an in-progress card buffer (T56/#78 泄漏路径 B:
        // 卡头进 thinking、卡尾失去 `{` 锚以散文泄漏、残缺围栏吞收尾散文).
        // Forwarding existing uiHint events verbatim keeps this transform
        // idempotent if a card was already split out upstream.
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
