/**
 * uiHintValidationLoop unit tests (M5c).
 *
 * Covers B4 / AC4:
 *   - invalid card on first attempt -> structured errors fed back -> agent
 *     re-invoked -> valid card on second attempt is yielded,
 *   - exceeding maxRetries yields a VALIDATION_ERROR event,
 *   - L005: the loop genuinely re-invokes `chat` (real retry, not a silent
 *     skip) and the feedback request carries the real StructuredError shape.
 *
 * The probe `ScriptedAgent` implements the frozen `AgentService.chat` seam with
 * a per-call scripted event list, so the loop's retry behaviour is exercised
 * deterministically without any LLM/IO.
 *
 * Runner: node:test via tsx.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent, ChatRequest } from "shared/contracts";
import type { AgentService } from "../AgentService.js";
import { chatWithValidationLoop } from "../uiHintValidationLoop.js";

// ---------------------------------------------------------------------------
// Probe: a scripted AgentService
// ---------------------------------------------------------------------------

/**
 * Implements `AgentService` by replaying one scripted event list per `chat`
 * call. `calls` records every request (incl. feedback retries) so tests can
 * assert the loop really re-invoked the seam (L005). When the loop calls more
 * times than scripts provided, the last script is replayed (handy for the
 * "always invalid" case).
 */
class ScriptedAgent implements AgentService {
  readonly calls: ChatRequest[] = [];
  private callCount = 0;
  constructor(private readonly scripts: AgentEvent[][]) {}

  async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
    this.calls.push(req);
    const idx = Math.min(this.callCount, this.scripts.length - 1);
    this.callCount += 1;
    for (const event of this.scripts[idx]) {
      yield event;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const baseReq: ChatRequest = {
  userId: "11111111-1111-1111-1111-111111111111",
  message: "Build my plan.",
  threadId: "thread_test_1",
};

/** A valid plan card (passes the M5b validator). */
const VALID_PLAN: unknown = {
  type: "plan_card",
  data: [
    {
      exerciseId: "sq",
      name: "Squat",
      exercise_type: "resistance",
      sets: 3,
      reps: 8,
      weight: 80,
    },
  ],
};

/** An invalid plan card (missing required fields). */
const INVALID_PLAN: unknown = {
  type: "plan_card",
  data: [{ exerciseId: "sq", name: "Squat" }],
};

/** Build a uiHint AgentEvent carrying `card`. Cast through the seam boundary. */
function uiHint(card: unknown): AgentEvent {
  return { type: "uiHint", card: card as never } as AgentEvent;
}

/** Drain an async iterable into an array. */
async function drain(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) {
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// B4 / AC4 — retry until valid
// ---------------------------------------------------------------------------

describe("chatWithValidationLoop — B4 retry loop", () => {
  it("retries after an invalid card and yields the later valid card (L005 real retry)", async () => {
    const agent = new ScriptedAgent([
      [uiHint(INVALID_PLAN)], // attempt 0: invalid
      [uiHint(VALID_PLAN), { type: "done" }], // attempt 1: valid + done
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    // L005: the loop REALLY re-invoked chat (2 calls), not a silent skip.
    assert.equal(
      agent.calls.length,
      2,
      "chat must be called twice (initial + 1 retry)",
    );

    // Exactly one uiHint forwarded, and it is the valid one.
    const uiHints = events.filter((e) => e.type === "uiHint");
    assert.equal(uiHints.length, 1, "only the valid card is forwarded");
    assert.deepEqual(uiHints[0].card, VALID_PLAN);

    // The invalid card was suppressed (not in the output).
    assert.equal(
      events.some((e) => e.type === "uiHint" && e.card === INVALID_PLAN),
      false,
      "invalid card must not be forwarded",
    );

    // The stream terminated cleanly (done forwarded from the successful attempt).
    assert.ok(
      events.some((e) => e.type === "done"),
      "done from the valid attempt is forwarded",
    );
    assert.equal(
      events.some((e) => e.type === "error"),
      false,
      "no error when retry succeeds",
    );

    // L005: feedback carried the real structured-error shape to the 2nd call.
    const feedbackReq = agent.calls[1];
    assert.match(feedbackReq.message, /uiHint validation feedback/i);
    assert.match(feedbackReq.message, /plan_card/i); // references the rejected type
    assert.ok(
      feedbackReq.metadata && feedbackBackHasErrors(feedbackReq),
      "metadata must carry structured uiHintValidationFeedback errors",
    );
  });

  it("yields a VALIDATION_ERROR after maxRetries is exhausted", async () => {
    const agent = new ScriptedAgent([
      [uiHint(INVALID_PLAN)], // always invalid (single script replays)
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 1 }),
    );

    // 1 initial + 1 retry = 2 total attempts before giving up.
    assert.equal(
      agent.calls.length,
      2,
      "must exhaust initial + maxRetries attempts",
    );

    const errEvent = events.find((e) => e.type === "error");
    assert.ok(
      errEvent,
      "an error event must be yielded when retries are exhausted",
    );
    assert.equal(errEvent.error?.code, "VALIDATION_ERROR");
    assert.match(errEvent.error?.message ?? "", /validation/i);

    // No uiHint forwarded (the card never validated).
    assert.equal(
      events.some((e) => e.type === "uiHint"),
      false,
    );
  });

  it("releases pre-card prose live; rejected-round post-card prose goes to thinking, never tokens", async () => {
    const agent = new ScriptedAgent([
      // attempt 0: prose before the first card is released live (two-phase
      // phase 1 — it cannot be card body); prose AFTER a valid card is held
      // and, when a later card is rejected, becomes thinking.
      [
        { type: "token", text: "让我重新算一下…" },
        uiHint(VALID_PLAN),
        { type: "token", text: "（这是围绕卡片的初稿叙述）" },
        uiHint(INVALID_PLAN),
      ],
      // attempt 1: clean answer + valid card
      [
        { type: "token", text: "最终分析：" },
        uiHint(VALID_PLAN),
        { type: "done" },
      ],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.equal(agent.calls.length, 2);

    // Post-card prose of the rejected round surfaces once as thinking.
    const thinkings = events.filter((e) => e.type === "thinking");
    assert.equal(
      thinkings.length,
      1,
      "rejected-round post-card prose surfaces once as thinking",
    );
    assert.equal(thinkings[0].text, "（这是围绕卡片的初稿叙述）");

    // Pre-card prose of the rejected round was released live as a token.
    const tokens = events.filter((e) => e.type === "token");
    assert.deepEqual(
      tokens.map((t) => t.text),
      ["让我重新算一下…", "最终分析："],
    );
    assert.equal(
      events.some((e) => e.type === "token" && e.text?.includes("初稿叙述")),
      false,
      "held post-card prose must never appear as answer text",
    );

    // Both valid cards (attempt 0's first card + the retry's card) forward.
    const uiHints = events.filter((e) => e.type === "uiHint");
    assert.equal(uiHints.length, 2);
  });

  it("passes a valid card through on the first attempt with no retry", async () => {
    const agent = new ScriptedAgent([[uiHint(VALID_PLAN), { type: "done" }]]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.equal(
      agent.calls.length,
      1,
      "no retry when the first card is valid",
    );
    const uiHints = events.filter((e) => e.type === "uiHint");
    assert.equal(uiHints.length, 1);
    assert.deepEqual(uiHints[0].card, VALID_PLAN);
    assert.ok(events.some((e) => e.type === "done"));
    assert.equal(
      events.some((e) => e.type === "error"),
      false,
    );
  });

  it("streams a cardless turn through live, preserving per-token chunk boundaries", async () => {
    const agent = new ScriptedAgent([
      [
        { type: "token", text: "Hello" },
        { type: "token", text: " world" },
        { type: "done" },
      ],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.equal(agent.calls.length, 1);
    assert.deepEqual(
      events.map((e) => e.type),
      ["token", "token", "done"],
    );
    // Two-phase release: cardless turns are never buffered — every token
    // event passes through as it arrives (the old per-attempt coalescing is
    // gone, which is exactly what makes pure-text turns stream in real time).
    assert.equal(events[0].text, "Hello");
    assert.equal(events[1].text, " world");
  });

  it("passes an upstream error event through (does not retry on error)", async () => {
    const agent = new ScriptedAgent([
      [{ type: "error", error: { code: "MODEL_ERROR", message: "boom" } }],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.equal(
      agent.calls.length,
      1,
      "error events are forwarded, not retried",
    );
    assert.equal(events[0].type, "error");
    assert.equal(events[0].error?.code, "MODEL_ERROR");
  });
});

/** Type-narrowing helper: does the feedback request carry structured errors? */
function feedbackBackHasErrors(req: ChatRequest): boolean {
  const meta = req.metadata as Record<string, unknown> | undefined;
  const fb = meta?.uiHintValidationFeedback as
    { errors?: Array<{ code?: string; message?: string }> } | undefined;
  return Array.isArray(fb?.errors) && (fb?.errors?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// 真流式两阶段放行（M5c）
// ---------------------------------------------------------------------------

describe("chatWithValidationLoop — two-phase real streaming", () => {
  it("纯文本轮全程流式：每个 token 事件按到达顺序逐字放行，不合并", async () => {
    const agent = new ScriptedAgent([
      [
        { type: "token", text: "好" },
        { type: "token", text: "的，" },
        { type: "token", text: "马上" },
        { type: "token", text: "给你算。" },
        { type: "done" },
      ],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.deepEqual(
      events.map((e) => (e.type === "token" ? e.text : e.type)),
      ["好", "的，", "马上", "给你算。", "done"],
      "cardless turn streams token-by-token with zero buffering",
    );
  });

  it("卡片轮：围栏前散文立即放行，卡片后散文缓冲至 done 再 flush（不丢字）", async () => {
    const agent = new ScriptedAgent([
      [
        { type: "token", text: "这是为你定的计划：" },
        uiHint(VALID_PLAN),
        { type: "token", text: "注意热身。" },
        { type: "done" },
      ],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.deepEqual(
      events.map((e) =>
        e.type === "token"
          ? `token:${e.text}`
          : e.type === "uiHint"
            ? "uiHint"
            : e.type,
      ),
      ["token:这是为你定的计划：", "uiHint", "token:注意热身。", "done"],
      "pre-card prose streams live before the card; post-card prose flushes at done",
    );
  });

  it("坏卡打回：围栏前散文已放行为 token；围栏内/卡片间散文走 thinking，绝不外漏", async () => {
    const agent = new ScriptedAgent([
      // attempt 0: valid card + card-interstitial prose + invalid card
      [
        { type: "token", text: "开场白。" },
        uiHint(VALID_PLAN),
        { type: "token", text: "（坏卡周围的草稿叙述）" },
        uiHint(INVALID_PLAN),
      ],
      // attempt 1: clean
      [uiHint(VALID_PLAN), { type: "done" }],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    const tokens = events.filter((e) => e.type === "token");
    const thinkings = events.filter((e) => e.type === "thinking");

    // Pre-card prose was released live; the retry round's card has no prose.
    assert.deepEqual(
      tokens.map((t) => t.text),
      ["开场白。"],
    );
    // Card-interstitial prose of the rejected round → thinking, never token.
    assert.deepEqual(
      thinkings.map((t) => t.text),
      ["（坏卡周围的草稿叙述）"],
    );
    assert.equal(
      events.some((e) => e.type === "token" && e.text?.includes("草稿叙述")),
      false,
      "rejected-round interstitial prose must never leak as tokens",
    );
  });

  it("重试轮同样两阶段：重试轮的围栏前散文照常实时放行", async () => {
    const agent = new ScriptedAgent([
      [uiHint(INVALID_PLAN)], // attempt 0: invalid, no prose
      [
        { type: "token", text: "修正后的开场。" },
        uiHint(VALID_PLAN),
        { type: "token", text: "收尾。" },
        { type: "done" },
      ],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.equal(agent.calls.length, 2);
    assert.deepEqual(
      events.map((e) => (e.type === "token" ? e.text : e.type)),
      ["修正后的开场。", "uiHint", "收尾。", "done"],
      "retry round streams its pre-card prose live and flushes tail at done",
    );
  });

  it("纯文本轮中途无卡片但以 error 结束：已放行的 token 不丢", async () => {
    const agent = new ScriptedAgent([
      [
        { type: "token", text: "部分输出" },
        { type: "error", error: { code: "MODEL_ERROR", message: "boom" } },
      ],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.deepEqual(
      events.map((e) => (e.type === "token" ? e.text : e.type)),
      ["部分输出", "error"],
      "live-released tokens before an error are not swallowed",
    );
  });
});
