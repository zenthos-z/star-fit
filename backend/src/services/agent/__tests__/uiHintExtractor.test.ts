/**
 * Unit tests for the INT uiHint extraction layer (`uiHintExtractor.ts`).
 *
 * Covers the pure helpers (`tryParseCard`, `findFenceOpen`) and the streaming
 * transform (`extractUiHintEvents`): fenced-card peeling, fence markers split
 * across token chunks, the unfenced brace-balance fallback, liberal extraction
 * of INVALID cards (so the M5 loop can reject them — B4), prose preservation
 * and ordering, and verbatim forwarding of `done` / `error`.
 *
 * Framework: node:test + tsx (same convention as `tests/contract-tests.ts` and
 * the M5 `__tests__` suites). No IO, no LLM — the extractor is a pure pipeline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractUiHintEvents,
  findFenceOpen,
  tryParseCard,
} from "../uiHintExtractor.js";
import type { AgentEvent, ChatRequest } from "shared/contracts";

/** Build a raw AgentService that emits the given token chunks then `done`. */
function rawFromTokens(tokens: string[]): { chat: (req: ChatRequest) => AsyncIterable<AgentEvent> } {
  return {
    async *chat(): AsyncIterable<AgentEvent> {
      for (const t of tokens) {
        yield { type: "token", text: t };
      }
      yield { type: "done" };
    },
  };
}

/** Drain an async iterable of AgentEvents into an array. */
async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) {
    out.push(e);
  }
  return out;
}

const PLAN_CARD =
  '{"type":"plan_card","data":[{"exerciseId":"bench","name":"Bench","sets":3,"reps":10}]}';

// ---------------------------------------------------------------------------
// tryParseCard
// ---------------------------------------------------------------------------

test("tryParseCard: accepts a JSON object with a string type", () => {
  assert.ok(tryParseCard(PLAN_CARD));
  assert.equal(tryParseCard(PLAN_CARD)?.type, "plan_card");
});

test("tryParseCard: rejects non-objects and type-less objects", () => {
  assert.equal(tryParseCard('[1,2,3]'), null); // array
  assert.equal(tryParseCard('"hi"'), null); // string
  assert.equal(tryParseCard('{"summary":"x"}'), null); // no type
  assert.equal(tryParseCard('{"type":123}'), null); // non-string type
  assert.equal(tryParseCard('{"type":""}'), null); // empty type
  assert.equal(tryParseCard('not json'), null); // non-json
});

test("tryParseCard: accepts a card missing required fields (liberal — B4)", () => {
  // Deliberately incomplete plan_card (no exerciseId). Extraction MUST still
  // surface it so the M5 validator can reject + retry. Pre-filtering here would
  // silently defeat the validation loop.
  const invalid = '{"type":"plan_card","data":[{"name":"Bench"}]}';
  assert.ok(tryParseCard(invalid));
});

// ---------------------------------------------------------------------------
// findFenceOpen
// ---------------------------------------------------------------------------

test("findFenceOpen: locates ```json opener and consumes lang + newline", () => {
  const r = findFenceOpen("hi ```json\n{}");
  assert.ok(r);
  assert.equal(r!.index, 3);
  // ``` (3) + json (4) + \n (1) = 8
  assert.equal(r!.length, 8);
});

test("findFenceOpen: bare ``` opener before an object", () => {
  const r = findFenceOpen("```\n{\"type\":\"x\"}");
  assert.ok(r);
  assert.equal(r!.index, 0);
});

test("findFenceOpen: returns null when no fence present", () => {
  assert.equal(findFenceOpen("just prose, no fence"), null);
});

// ---------------------------------------------------------------------------
// extractUiHintEvents — streaming transform
// ---------------------------------------------------------------------------

test("extractUiHintEvents: fenced card mid-stream -> token + uiHint + token + done", async () => {
  const raw = rawFromTokens([
    "Here is your plan.\n",
    "```json\n",
    PLAN_CARD + "\n",
    "```\n",
    "Let me know!",
  ]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const types = out.map((e) => e.type);

  assert.ok(types.includes("token"), "prose before card streams as token(s)");
  assert.ok(types.includes("uiHint"), "card emitted as uiHint");
  assert.ok(types.includes("done"), "done forwarded");
  const hint = out.find((e) => e.type === "uiHint");
  assert.equal((hint?.card as { type?: string }).type, "plan_card");
  // The raw JSON text must NOT leak into the token stream as a separate card.
  const tokenText = out.filter((e) => e.type === "token").map((e) => e.text).join("");
  assert.equal(tokenText.includes("plan_card"), false, "card JSON suppressed from prose");
  assert.ok(tokenText.includes("Here is your plan"), "intro prose preserved");
  assert.ok(tokenText.includes("Let me know"), "closing prose preserved");
});

test("extractUiHintEvents: fence marker split across many token chunks", async () => {
  // Split the opener, the JSON, and the closer into single-char-ish chunks.
  const full = "```json\n" + PLAN_CARD + "\n```";
  const tokens = [...full];
  const raw = rawFromTokens(tokens);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  assert.ok(out.some((e) => e.type === "uiHint"), "card still recovered despite split fence");
  assert.ok(out.some((e) => e.type === "done"));
});

test("extractUiHintEvents: unfenced card recovered via brace-balance fallback", async () => {
  // No fence at all; the card is inline JSON. Recovered at flush.
  const raw = rawFromTokens(["plan: ", PLAN_CARD, " done"]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  assert.ok(out.some((e) => e.type === "uiHint"), "unfenced card recovered");
  const hint = out.find((e) => e.type === "uiHint");
  assert.equal((hint?.card as { type?: string }).type, "plan_card");
});

test("extractUiHintEvents: no card -> only tokens + done", async () => {
  const raw = rawFromTokens(["just", " a", " plain reply"]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  assert.equal(out.some((e) => e.type === "uiHint"), false);
  assert.equal(out[out.length - 1]!.type, "done");
  assert.equal(
    out.filter((e) => e.type === "token").map((e) => e.text).join(""),
    "just a plain reply",
  );
});

test("extractUiHintEvents: invalid card still extracted (liberal — B4 loop)", async () => {
  const invalid = '{"type":"plan_card","data":[{"name":"Bench"}]}'; // missing exerciseId
  const raw = rawFromTokens(["```json\n", invalid, "\n```\n"]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const hint = out.find((e) => e.type === "uiHint");
  assert.ok(hint, "invalid card extracted so the M5 loop can reject + retry");
  assert.equal((hint?.card as { type?: string }).type, "plan_card");
});

test("extractUiHintEvents: error event forwarded after flushing prose", async () => {
  async function* gen(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "partial prose " };
    yield { type: "error", error: { code: "INTERNAL", message: "boom" } };
  }
  const out = await drain(extractUiHintEvents(gen()));
  // Prose may be split across token events by the holdback buffer; assert the
  // semantic invariant: prose is fully preserved, then the error is forwarded
  // and is terminal (never lost, never reordered before prose).
  const tokenText = out.filter((e) => e.type === "token").map((e) => e.text).join("");
  assert.equal(tokenText, "partial prose ");
  assert.equal(out[out.length - 1]!.type, "error");
  assert.deepEqual(
    (out[out.length - 1] as { error?: { code: string; message: string } }).error,
    { code: "INTERNAL", message: "boom" },
  );
});

test("extractUiHintEvents: existing uiHint events forwarded verbatim (idempotent)", async () => {
  async function* gen(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "hi" };
    yield { type: "uiHint", card: { type: "summary_card", data: {} } as never };
    yield { type: "done" };
  }
  const out = await drain(extractUiHintEvents(gen()));
  const hint = out.find((e) => e.type === "uiHint");
  assert.deepEqual(hint?.card, { type: "summary_card", data: {} });
});

test("extractUiHintEvents: multiple fenced cards in one stream", async () => {
  const raw = rawFromTokens([
    "```json\n" + PLAN_CARD + "\n```\n",
    "middle prose\n",
    "```json\n" + '{"type":"summary_card","data":{"summary":"x"}}' + "\n```\n",
  ]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const hints = out.filter((e) => e.type === "uiHint");
  assert.equal(hints.length, 2);
  assert.equal((hints[0]?.card as { type?: string }).type, "plan_card");
  assert.equal((hints[1]?.card as { type?: string }).type, "summary_card");
});
