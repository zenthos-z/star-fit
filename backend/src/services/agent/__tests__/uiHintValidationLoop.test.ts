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
import {
  chatWithValidationLoop,
  RETRY_STATUS_TOKEN,
} from "../uiHintValidationLoop.js";
// 泄漏重试测试走生产同构组装（raw → extractUiHintEvents → 校验循环）
import { extractUiHintEvents } from "../uiHintExtractor.js";

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

    // Pre-card prose of the rejected round was released live as a token;
    // the retry round opened with the backend-injected retry status token.
    const tokens = events.filter((e) => e.type === "token");
    assert.deepEqual(
      tokens.map((t) => t.text),
      ["让我重新算一下…", RETRY_STATUS_TOKEN, "最终分析："],
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

    // Pre-card prose was released live; the retry round opened with the
    // backend-injected retry status token; the retry card has no prose.
    assert.deepEqual(
      tokens.map((t) => t.text),
      ["开场白。", RETRY_STATUS_TOKEN],
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
      [RETRY_STATUS_TOKEN, "修正后的开场。", "uiHint", "收尾。", "done"],
      "retry round opens with the status token, then streams its pre-card prose live and flushes tail at done",
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

// ---------------------------------------------------------------------------
// 便宜重试（validation cheap retry）—— 只修卡不重写
// ---------------------------------------------------------------------------

describe("chatWithValidationLoop — cheap retry (card-only correction)", () => {
  it("重试请求含被拒卡 JSON 原文与「只修卡不重写」指令", async () => {
    const agent = new ScriptedAgent([
      [uiHint(INVALID_PLAN)],
      [uiHint(VALID_PLAN), { type: "done" }],
    ]);

    await drain(chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }));

    const feedbackReq = agent.calls[1];
    // 坏卡 JSON 原文（带 type 字段）内嵌在反馈消息里。
    assert.ok(
      feedbackReq.message.includes('"type": "plan_card"'),
      "feedback must embed the rejected card's verbatim JSON",
    );
    assert.ok(
      /RE-EMIT ONLY THE\s+CORRECTED CARD/.test(feedbackReq.message),
      "feedback must demand a card-only re-emit",
    );
    // 显式禁止：重写散文 / 重调工具 / 重读技能文件。
    assert.match(
      feedbackReq.message,
      /Do NOT rewrite or repeat the surrounding prose/i,
    );
    assert.match(feedbackReq.message, /Do NOT re-call any tools/i);
    assert.match(feedbackReq.message, /Do NOT re-read any skill files/i);
    assert.match(
      feedbackReq.message,
      /```json[\s\S]*```/,
      "card JSON is fenced",
    );
    // 结构化元数据同样携带被拒卡（程序化消费方可用）。
    const meta = feedbackReq.metadata as Record<string, unknown> | undefined;
    const fb = meta?.uiHintValidationFeedback as
      { attempt?: number; rejectedCard?: unknown } | undefined;
    assert.ok(fb && fb.attempt === 1, "metadata carries the retry attempt");
    assert.ok(fb?.rejectedCard, "metadata carries the rejected card");
    // 上下文瘦身：重试请求仅基于 ORIGINAL message（不叠加历史轮次散文）。
    assert.equal(
      feedbackReq.message.startsWith(baseReq.message),
      true,
      "feedback appends to the ORIGINAL user message only",
    );
  });

  it("重试轮开始时 yield 修订卡提示 token（仅重试轮，首轮不出）", async () => {
    const agent = new ScriptedAgent([
      // 首轮：坏卡
      [uiHint(INVALID_PLAN)],
      // 重试轮：好卡 + done
      [uiHint(VALID_PLAN), { type: "done" }],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    const tokens = events.filter((e) => e.type === "token");
    // 提示 token 恰在重试轮开始时出现一次，且内容为后端显式注入的标记。
    assert.deepEqual(
      tokens.map((t) => t.text),
      [RETRY_STATUS_TOKEN],
      "the retry status token is the ONLY token in this retry round",
    );
    // 标记 token 前是首轮的 done 位置——事件序列中它先于修正卡。
    const markerIdx = events.findIndex((e) => e.type === "token");
    const cardIdx = events.findIndex((e) => e.type === "uiHint");
    assert.ok(markerIdx < cardIdx, "status token precedes the corrected card");
    assert.ok(
      RETRY_STATUS_TOKEN.startsWith("\n"),
      "status token starts with a newline (轻量、独立成行)",
    );
  });

  it("首轮卡合法时不发提示 token（零干扰）", async () => {
    const agent = new ScriptedAgent([[uiHint(VALID_PLAN), { type: "done" }]]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    assert.equal(
      events.some((e) => e.type === "token" && e.text === RETRY_STATUS_TOKEN),
      false,
      "no status token when the first card is already valid",
    );
    assert.equal(agent.calls.length, 1);
  });

  it("重试轮成功出卡：提示 token 后正常继续，卡片照常转发、done 照常放行", async () => {
    const agent = new ScriptedAgent([
      [uiHint(INVALID_PLAN)],
      [
        { type: "token", text: "这是修正后的方案：" },
        uiHint(VALID_PLAN),
        { type: "token", text: "注意热身。" },
        { type: "done" },
      ],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    // 事件序列：提示 token → 重试轮散文 → 卡片 → 收尾散文 → done。
    assert.deepEqual(
      events.map((e) => (e.type === "token" ? e.text : e.type)),
      [
        RETRY_STATUS_TOKEN,
        "这是修正后的方案：",
        "uiHint",
        "注意热身。",
        "done",
      ],
    );
    const uiHints = events.filter((e) => e.type === "uiHint");
    assert.deepEqual(uiHints[0].card, VALID_PLAN);
    assert.equal(
      events.some((e) => e.type === "error"),
      false,
      "retry success yields no error",
    );
  });

  it("maxRetries 耗尽仍 VALIDATION_ERROR，且每个重试轮各发一次提示 token", async () => {
    const agent = new ScriptedAgent([
      [uiHint(INVALID_PLAN)],
      [uiHint(INVALID_PLAN)],
      [uiHint(INVALID_PLAN)],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    // 1 首轮 + 2 重试轮 = 3 次调用后放弃。
    assert.equal(agent.calls.length, 3);
    const errEvent = events.find((e) => e.type === "error");
    assert.equal(errEvent?.error?.code, "VALIDATION_ERROR");
    assert.ok(errEvent?.error?.message?.includes("3 attempt(s)"));
    // 两个重试轮各注入一次提示 token（首轮不注入）。
    assert.equal(
      events.filter((e) => e.type === "token" && e.text === RETRY_STATUS_TOKEN)
        .length,
      2,
      "one status token per retry round",
    );
    // 坏卡从未外泄为 uiHint。
    assert.equal(
      events.some((e) => e.type === "uiHint"),
      false,
    );
  });

  it("坏卡散文仍不外漏：重试轮散文照旧走 thinking，标记 token 是唯一新增 token", async () => {
    const agent = new ScriptedAgent([
      // 首轮：先一张合法卡（进入 hold 模式），卡片间的草稿散文 + 坏卡
      [
        uiHint(VALID_PLAN),
        { type: "token", text: "（围绕坏卡的草稿叙述）" },
        uiHint(INVALID_PLAN),
      ],
      // 重试轮：好卡
      [uiHint(VALID_PLAN), { type: "done" }],
    ]);

    const events = await drain(
      chatWithValidationLoop(agent, baseReq, { maxRetries: 2 }),
    );

    const tokens = events.filter((e) => e.type === "token");
    const thinkings = events.filter((e) => e.type === "thinking");
    // 卡片间散文（被坏卡打回的那个围栏段）→ thinking，绝不进 answer token 流。
    assert.deepEqual(
      thinkings.map((t) => t.text),
      ["（围绕坏卡的草稿叙述）"],
    );
    assert.deepEqual(
      tokens.map((t) => t.text),
      [RETRY_STATUS_TOKEN],
      "only the backend-injected status token leaks into the token stream",
    );
    // 标记 token 内容不计入任何卡片/质量门比对（此处验证它独立于卡外泄）。
    assert.equal(
      events.some((e) => e.type === "token" && e.text?.includes("草稿叙述")),
      false,
      "rejected-round prose never appears as answer text",
    );
  });
});

// ---------------------------------------------------------------------------
// 泄漏终态自动重生成（refs #73/#56 机制升级）
// ---------------------------------------------------------------------------

/**
 * 破损 weekly_plan 残片：括号平衡、非围栏、trailing comma 语法破损——
 * 「模型把卡片 JSON 写歪在正文」的实锤形态（提取器终态降级 thinking）。
 */
const BROKEN_WEEKLY_FRAGMENT =
  '{"type": "weekly_plan", "data": { "week_label": "第 2 周", "split_summary": "推拉腿 · 每周 3 练", "days": [{"entry_date": "2026-10-05", "rest": false,}] }}';

/** 合法 weekly_plan 卡（过 M5b 校验器）。 */
const VALID_WEEKLY: unknown = {
  type: "weekly_plan",
  data: {
    week_label: "第 2 周",
    split_summary: "推拉腿 · 每周 3 练",
    days: [
      {
        entry_date: "2026-10-05",
        rest: false,
        exercises: [
          {
            exercise_id: "abcdefgh12345678",
            name: "卧推",
            sets: [{ set: 1, weight: 60, reps: 8 }],
          },
        ],
      },
    ],
  },
};

describe("chatWithValidationLoop — 泄漏终态自动重生成（refs #73/#56）", () => {
  it("破损 weekly_plan 写进正文（非围栏）→ 触发重试轮；重试产出合法卡后无降级残片外漏", async () => {
    // 生产组装同构：raw token 流 → extractUiHintEvents → 校验循环
    const raw = new ScriptedAgent([
      [
        { type: "token", text: "这是你本周的计划：" },
        { type: "token", text: BROKEN_WEEKLY_FRAGMENT },
        { type: "done" },
      ],
      [
        {
          type: "token",
          text: "```json\n" + JSON.stringify(VALID_WEEKLY) + "\n```",
        },
        { type: "done" },
      ],
    ]);
    const service: AgentService = {
      async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
        yield* chatWithValidationLoop(
          {
            async *chat(r) {
              yield* extractUiHintEvents(raw.chat(r));
            },
          },
          req,
        );
      },
    };

    const events = await drain(service.chat(baseReq));

    // 重试轮真的发生了（chat 被再次调用）
    assert.equal(
      raw.calls.length,
      2,
      "泄漏残片必须触发重试轮（chat 被再次调用）",
    );

    // 最终流含 uiHint（重试产出的合法 weekly_plan）
    const uiHints = events.filter((e) => e.type === "uiHint");
    assert.equal(uiHints.length, 1);
    assert.equal((uiHints[0].card as { type: string }).type, "weekly_plan");

    // 正文（token 拼接）无破损 JSON 残片、无降级文案；thinking 通道也无残片
    const tokenText = events
      .filter((e) => e.type === "token")
      .map((e) => e.text)
      .join("");
    assert.equal(
      tokenText.includes("weekly_plan"),
      false,
      "破损卡 JSON 不得留在正文",
    );
    assert.equal(
      events.some(
        (e) =>
          (e.type === "token" || e.type === "thinking") &&
          (e.text ?? "").includes("week_label"),
      ),
      false,
      "重试成功后原降级片段从流中剥离（不下发 degraded 内容）",
    );

    // 复用重试回路的既有感知：RETRY_STATUS_TOKEN 恰一次、无 error
    assert.equal(
      events.filter((e) => e.type === "token" && e.text === RETRY_STATUS_TOKEN)
        .length,
      1,
    );
    assert.equal(
      events.some((e) => e.type === "error"),
      false,
    );
    assert.ok(events.some((e) => e.type === "done"));

    // 反馈请求携带残片原文 + 围栏协议结构化错误
    const feedbackReq = raw.calls[1];
    assert.ok(
      feedbackReq.message.includes(BROKEN_WEEKLY_FRAGMENT),
      "反馈必须内嵌降级残片原文",
    );
    assert.match(feedbackReq.message, /```json fence/);
    const meta = feedbackReq.metadata as Record<string, unknown> | undefined;
    const fb = meta?.uiHintValidationFeedback as
      | {
          errors?: Array<{ code?: string }>;
          leakFragments?: string[];
        }
      | undefined;
    assert.equal(fb?.errors?.[0]?.code, "card_leak");
    assert.deepEqual(fb?.leakFragments, [BROKEN_WEEKLY_FRAGMENT]);
  });

  it("重试耗尽 → 维持现状：残片以 thinking 降级放行 + done 收尾，无 uiHint、无新增 error", async () => {
    const raw = new ScriptedAgent([
      [
        { type: "token", text: "计划如下：" },
        { type: "token", text: BROKEN_WEEKLY_FRAGMENT },
        { type: "done" },
      ],
    ]);
    const service: AgentService = {
      async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
        yield* chatWithValidationLoop(
          {
            async *chat(r) {
              yield* extractUiHintEvents(raw.chat(r));
            },
          },
          req,
        );
      },
    };

    const events = await drain(service.chat(baseReq));

    // 1 首轮 + 2 重试轮（DEFAULT_MAX_RETRIES）
    assert.equal(raw.calls.length, 3);
    // 无 uiHint、无 error（不新增用户可见错误——前端兜底文案仍是最后防线）
    assert.equal(
      events.some((e) => e.type === "uiHint"),
      false,
    );
    assert.equal(
      events.some((e) => e.type === "error"),
      false,
    );
    // 末两事件 = 降级 thinking（末轮残片）+ done（现状语义）
    const lastTwo = events.slice(-2);
    assert.equal(lastTwo[0]?.type, "thinking");
    assert.equal(lastTwo[0]?.text, BROKEN_WEEKLY_FRAGMENT);
    assert.equal(lastTwo[1]?.type, "done");
    // 两个重试轮各一次 RETRY_STATUS_TOKEN
    assert.equal(
      events.filter((e) => e.type === "token" && e.text === RETRY_STATUS_TOKEN)
        .length,
      2,
    );
  });

  it("回路级：thinking 残片 + done（无卡可校验）→ 打回重试，重试出卡后残片剥离", async () => {
    const agent = new ScriptedAgent([
      [
        { type: "thinking", text: BROKEN_WEEKLY_FRAGMENT },
        { type: "token", text: "收尾。" },
        { type: "done" },
      ],
      [uiHint(VALID_PLAN), { type: "done" }],
    ]);

    const events = await drain(chatWithValidationLoop(agent, baseReq));

    assert.equal(agent.calls.length, 2, "残片触发重试轮");
    const uiHints = events.filter((e) => e.type === "uiHint");
    assert.equal(uiHints.length, 1, "重试产出的合法卡照常转发");
    assert.equal(
      events.some((e) => (e.text ?? "").includes("week_label")),
      false,
      "原残片重试成功后不再以任何事件下发",
    );
    // 反馈请求是围栏协议纠错（非 Zod shape 错误）
    assert.match(agent.calls[1].message, /围栏/);
  });

  it("误伤防线：完整可解析卡 JSON 的 thinking（工具复述）不触发重试", async () => {
    const echoThinking =
      "好的，我来看下技能文档的示例卡：\n```json\n" +
      JSON.stringify(VALID_PLAN) +
      "\n```";
    const agent = new ScriptedAgent([
      [
        { type: "thinking", text: echoThinking },
        { type: "token", text: "普通回答，无卡。" },
        { type: "done" },
      ],
    ]);

    const events = await drain(chatWithValidationLoop(agent, baseReq));

    assert.equal(
      agent.calls.length,
      1,
      "复述（完整可解析卡 JSON）不得误燃重试轮",
    );
    assert.ok(
      events.some((e) => e.type === "thinking" && e.text === echoThinking),
      "复述 thinking 照现状即时放行",
    );
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("已有合法卡时残片不触发重试：卡片转发 + 残片按现状 thinking 放行", async () => {
    const agent = new ScriptedAgent([
      [
        uiHint(VALID_PLAN),
        { type: "thinking", text: BROKEN_WEEKLY_FRAGMENT },
        { type: "done" },
      ],
    ]);

    const events = await drain(chatWithValidationLoop(agent, baseReq));

    assert.equal(agent.calls.length, 1, "已发卡的轮不重试");
    assert.equal(events.filter((e) => e.type === "uiHint").length, 1);
    assert.ok(
      events.some(
        (e) => e.type === "thinking" && e.text === BROKEN_WEEKLY_FRAGMENT,
      ),
      "首卡后的残片按现状放行（前端已有卡时静默摘除）",
    );
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("残片 + error 终态：不重试，残片按现状放行后 error 透传", async () => {
    const agent = new ScriptedAgent([
      [
        { type: "thinking", text: BROKEN_WEEKLY_FRAGMENT },
        { type: "error", error: { code: "MODEL_ERROR", message: "boom" } },
      ],
    ]);

    const events = await drain(chatWithValidationLoop(agent, baseReq));

    assert.equal(agent.calls.length, 1, "error 终态不重试（既有语义）");
    assert.deepEqual(
      events.map((e) => e.type),
      ["thinking", "error"],
    );
  });
});
