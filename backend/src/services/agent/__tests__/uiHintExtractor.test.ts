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
  isDegradedCardFragment,
  tryParseCard,
} from "../uiHintExtractor.js";
import type { AgentEvent, ChatRequest } from "shared/contracts";

/** Build a raw AgentService that emits the given token chunks then `done`. */
function rawFromTokens(tokens: string[]): {
  chat: (req: ChatRequest) => AsyncIterable<AgentEvent>;
} {
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
  assert.equal(tryParseCard("[1,2,3]"), null); // array
  assert.equal(tryParseCard('"hi"'), null); // string
  assert.equal(tryParseCard('{"summary":"x"}'), null); // no type
  assert.equal(tryParseCard('{"type":123}'), null); // non-string type
  assert.equal(tryParseCard('{"type":""}'), null); // empty type
  assert.equal(tryParseCard("not json"), null); // non-json
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
  const r = findFenceOpen('```\n{"type":"x"}');
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
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  assert.equal(
    tokenText.includes("plan_card"),
    false,
    "card JSON suppressed from prose",
  );
  assert.ok(tokenText.includes("Here is your plan"), "intro prose preserved");
  assert.ok(tokenText.includes("Let me know"), "closing prose preserved");
});

test("extractUiHintEvents: fence marker split across many token chunks", async () => {
  // Split the opener, the JSON, and the closer into single-char-ish chunks.
  const full = "```json\n" + PLAN_CARD + "\n```";
  const tokens = [...full];
  const raw = rawFromTokens(tokens);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  assert.ok(
    out.some((e) => e.type === "uiHint"),
    "card still recovered despite split fence",
  );
  assert.ok(out.some((e) => e.type === "done"));
});

test("extractUiHintEvents: unfenced card recovered via brace-balance fallback", async () => {
  // No fence at all; the card is inline JSON. Recovered at flush.
  const raw = rawFromTokens(["plan: ", PLAN_CARD, " done"]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  assert.ok(
    out.some((e) => e.type === "uiHint"),
    "unfenced card recovered",
  );
  const hint = out.find((e) => e.type === "uiHint");
  assert.equal((hint?.card as { type?: string }).type, "plan_card");
});

test("extractUiHintEvents: no card -> only tokens + done", async () => {
  const raw = rawFromTokens(["just", " a", " plain reply"]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  assert.equal(
    out.some((e) => e.type === "uiHint"),
    false,
  );
  assert.equal(out[out.length - 1]!.type, "done");
  assert.equal(
    out
      .filter((e) => e.type === "token")
      .map((e) => e.text)
      .join(""),
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
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  assert.equal(tokenText, "partial prose ");
  assert.equal(out[out.length - 1]!.type, "error");
  assert.deepEqual(
    (out[out.length - 1] as { error?: { code: string; message: string } })
      .error,
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

// ---------------------------------------------------------------------------
// Chain-of-thought leak guard (2026-09-14): malformed card payloads must NEVER
// reach the answer prose (`token`) — they downgrade to `thinking` events.
// ---------------------------------------------------------------------------

test("leak guard: malformed fenced card (trailing commas) -> thinking, not token", async () => {
  const raw = rawFromTokens([
    "这是你的计划：\n```json\n",
    '{"type": "plan", "data": [{"name": "卧推",},],}',
    "\n```\n祝训练愉快",
  ]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  const thinkText = out
    .filter((e) => e.type === "thinking")
    .map((e) => e.text)
    .join("");
  assert.equal(
    tokenText.includes('"type"'),
    false,
    "malformed card JSON must not reach prose",
  );
  assert.ok(
    thinkText.includes("plan"),
    "malformed card JSON downgraded to thinking",
  );
  assert.ok(tokenText.includes("祝训练愉快"), "surrounding prose preserved");
  assert.equal(
    out.some((e) => e.type === "uiHint"),
    false,
    "no card emitted for unparsable JSON",
  );
});

test("leak guard: reasoning draft inside fence -> thinking, not token", async () => {
  const raw = rawFromTokens([
    "```json\n让我想想，用户想要胸计划，我应该安排卧推、上斜、飞鸟\n```",
  ]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  const thinkText = out
    .filter((e) => e.type === "thinking")
    .map((e) => e.text)
    .join("");
  assert.equal(
    tokenText.includes("让我想想"),
    false,
    "draft prose must not leak into answer",
  );
  assert.ok(thinkText.includes("让我想想"), "draft downgraded to thinking");
});

test("leak guard: truncated fence at stream end (no close) -> thinking, not token", async () => {
  const raw = rawFromTokens([
    "好的，我来生成：\n```json\n",
    '{"type": "plan", "data": [{"name": "卧推"',
  ]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  assert.equal(
    tokenText.includes('"data"'),
    false,
    "truncated card payload must not reach prose",
  );
  assert.ok(
    out.some((e) => e.type === "thinking"),
    "truncated payload downgraded to thinking",
  );
  assert.ok(
    tokenText.includes("好的，我来生成："),
    "prose before fence preserved",
  );
});

test("leak guard: genuine prose (no braces) still passes through as tokens", async () => {
  const raw = rawFromTokens(["plain trailing prose without any braces"]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  assert.equal(
    out
      .filter((e) => e.type === "token")
      .map((e) => e.text)
      .join(""),
    "plain trailing prose without any braces",
  );
  assert.equal(
    out.some((e) => e.type === "thinking"),
    false,
  );
});

// ---------------------------------------------------------------------------
// 流中断/不可解析卡载荷防泄漏（2026-09-30，refs #73 验收 + T56/#78 联动）：
// 未闭合/不可解析的卡片 JSON 不得以正文 token 倾给用户——缓冲到终态（done /
// error）判定后再放行（成卡）或降级（thinking）。三条历史泄漏路径：
//   A. 无围栏 balanced-but-unparseable 卡 JSON 在流中被当散文放行
//      （uiHintExtractor findBalancedCard "balanced but not a card — leave
//      intact as prose"：括号已平衡 → holdback=0 → 整段 JSON 流进正文）；
//   B. 非 token 事件（LiveEchoGate 中途吐的 thinking）触发 flush，把正在
//      累积的卡缓冲中途清空——卡头进 thinking、卡尾失去 `{` 锚后以散文
//      泄漏，且其后的收尾散文被残缺围栏吞掉（双重故障）；
//   C. 未确认围栏残片（"```jso"）在终态 flush 时以 token 泄漏。
// ---------------------------------------------------------------------------

test("leak guard A: unfenced balanced-but-unparseable card JSON -> buffered, downgraded at terminal, prose around preserved", async () => {
  // 模型少写围栏、JSON 又带尾逗号（parse 失败、括号平衡）—— :170 路径。
  const broken =
    '{"type": "weekly_plan", "data": {"week_label": "第 1 周", "days": [1, 2,]}}';
  const raw = rawFromTokens([
    "这是你的计划：\n\n",
    broken,
    "\n\n确认后开始训练。",
  ]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  const thinkText = out
    .filter((e) => e.type === "thinking")
    .map((e) => e.text)
    .join("");
  assert.equal(
    tokenText.includes("weekly_plan"),
    false,
    "不可解析卡 JSON 绝不以正文 token 倾给用户（:170 泄漏路径）",
  );
  assert.equal(
    tokenText.includes('"week_label"'),
    false,
    "卡载荷字段不得泄漏进正文",
  );
  assert.ok(
    thinkText.includes("weekly_plan"),
    "畸形卡 JSON 终态降级为 thinking（不丢失）",
  );
  assert.ok(tokenText.includes("这是你的计划"), "卡前散文照常放行");
  assert.ok(
    tokenText.includes("确认后开始训练"),
    "卡后散文终态放行（不被陪葬）",
  );
});

test("leak guard B: interleaved thinking event must not cut card accumulation mid-stream", async () => {
  // LiveEchoGate 实测形态：answerLive 直通段里 echo 块以 thinking 事件穿插
  // 在 token 之间。旧实现对任何非 token 事件 flush——正在累积的围栏卡被
  // 中途清空：卡头进 thinking、卡尾失去 `{` 锚以散文泄漏、残缺 "```" 把
  // 收尾散文吞进围栏。
  async function* gen(): AsyncIterable<AgentEvent> {
    yield {
      type: "token",
      text: '好的，这是你的周计划：\n```json\n{"type": "week',
    };
    yield { type: "thinking", text: "1\t复述的工具返回块……" };
    yield {
      type: "token",
      text: 'ly_plan", "data": {"week_label": "第 1 周", "days": []}}',
    };
    yield { type: "token", text: "\n```\n以上是本周计划。" };
    yield { type: "done" };
  }
  const out = await drain(extractUiHintEvents(gen()));
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  const hint = out.find((e) => e.type === "uiHint");
  assert.ok(hint, "穿插 thinking 后围栏卡仍被完整提取");
  assert.equal((hint?.card as { type?: string }).type, "weekly_plan");
  assert.equal(
    tokenText.includes("week_label"),
    false,
    "卡尾不得因缓冲被清空而以散文泄漏",
  );
  assert.ok(tokenText.includes("好的，这是你的周计划"), "卡前散文照常放行");
  assert.ok(
    tokenText.includes("以上是本周计划"),
    "收尾散文照常放行（不得被残缺围栏吞掉）",
  );
});

test("leak guard C: unconfirmed fence fragment tail at terminal -> thinking, not token", async () => {
  // 流在 "```jso" 处截断（开围栏未确认）——:174 相邻路径。
  const raw = rawFromTokens(["计划参数如下", "```jso"]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  assert.equal(
    tokenText.includes("```"),
    false,
    "围栏残片不得以 token 泄漏（终态降级 thinking）",
  );
  assert.ok(tokenText.includes("计划参数如下"), "残片前的散文照常放行");
});

test("leak guard A 防误伤: prose braces（{ 目标 }）不缓冲、不降级", async () => {
  const prose = "目标拆解 { 目标 } 与 { 手段 } 完成";
  const raw = rawFromTokens([prose]);
  const out = await drain(extractUiHintEvents(raw.chat({} as ChatRequest)));
  const tokenText = out
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  assert.equal(tokenText, prose, "散文中的中文花括号原样透传");
  assert.equal(
    out.some((e) => e.type === "thinking"),
    false,
  );
});

// ---------------------------------------------------------------------------
// isDegradedCardFragment — 泄漏残片谓词（refs #73/#56 机制升级）
// ---------------------------------------------------------------------------

test("isDegradedCardFragment: 括号平衡但语法破损的 weekly_plan → 残片", () => {
  const broken =
    '{"type": "weekly_plan", "data": { "week_label": "第 2 周", "days": [{"entry_date": "2026-10-05", "rest": false,}] }}';
  assert.equal(isDegradedCardFragment(broken), true);
});

test("isDegradedCardFragment: 未闭合截断卡 → 残片", () => {
  const truncated =
    '{"type": "weekly_plan", "data": { "week_label": "第 2 周", "days": [{"entry_date": "2026-10-05"';
  assert.equal(isDegradedCardFragment(truncated), true);
});

test("isDegradedCardFragment: 完整可解析的卡 JSON（工具复述）→ 非残片", () => {
  assert.equal(isDegradedCardFragment(PLAN_CARD), false);
  // 复述形态：叙述 + 围栏内完整示例卡（read_file 技能文档回显）——不触发重试
  const echoNarration =
    "好的，我来看下技能文档的示例卡：\n```json\n" + PLAN_CARD + "\n```";
  assert.equal(isDegradedCardFragment(echoNarration), false);
});

test("isDegradedCardFragment: 散文括号 / 工具行 JSON → 非残片", () => {
  assert.equal(isDegradedCardFragment("{ 目标 } 拆解完成"), false);
  // list_exercises 行对象：type 非卡型、无 data —— 不触发重试
  assert.equal(
    isDegradedCardFragment(
      '{"id": "abc123", "name": "Squat", "type": "compound"}',
    ),
    false,
  );
});

test("isDegradedCardFragment: {type,data} 卡形态但 type 不在白名单（破损）→ 残片", () => {
  const unknownTypeBroken =
    '{"type": "plan_card_v2", "data": { "days": [1, 2,]';
  assert.equal(isDegradedCardFragment(unknownTypeBroken), true);
});
