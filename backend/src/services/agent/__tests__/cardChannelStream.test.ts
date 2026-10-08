/**
 * classifyAgentStream 工具通道卡发射（#151 S2）— 卡汇排水语义测试。
 *
 * 覆盖发射点四条语义：
 *  1. updates 快照处排水：submit_xxx 成功路径推入卡汇的卡，在任意节点
 *     快照落地时以 {type:"uiHint", card} 发射（工具卡与终步散文 token
 *     同一下游）；
 *  2. 卡 = 答案载荷：纯工具轮（零 token）因排水而不再触发空终步守卫的
 *     EMPTY_ANSWER 兜底（否则工具轮会被误判空轮）；
 *  3. 无 threadId（旧调用形态）→ 不排水（围栏路径回归不受影响）；
 *  4. try/finally：流异常中断时清空该线程卡汇，未发射的卡不滞留下一轮。
 *
 * 合成流构造与 emptyTurnStreamGuard.test.ts / streamCardRescue.test.ts
 * 同款。内核闸门/幂等语义在 backend/tests/unit/services/agent/cardSubmit.test.ts
 * （jest）。
 *
 * Runner: node:test via tsx（与 __tests__ 其余文件一致）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyAgentStream } from "../DeepAgentService.js";
import type { AgentEvent } from "shared/contracts";
import {
  __resetCardSinkForTests,
  clearThreadCards,
  drainCardsFromSink,
  pushCardToSink,
} from "../cardSubmit.js";

// ---------------------------------------------------------------------------
// 合成流构造（与 emptyTurnStreamGuard.test.ts 同款）
// ---------------------------------------------------------------------------

/** messages 正文 delta: [chunk, metadata]。 */
function msgDelta(text: string): unknown {
  return ["messages", [{ content: text }, {}]];
}

/** messages reasoning delta（字段级思考链，不算答案载荷）。 */
function thinkingDelta(text: string): unknown {
  return [
    "messages",
    [
      {
        additional_kwargs: { reasoning_content: text },
        content: "",
      },
      {},
    ],
  ];
}

/** updates 快照：model_request 节点最后一条消息决定 step 分类。 */
function modelRequestUpdate(ai: unknown): unknown {
  return ["updates", { model_request: { messages: [ai] } }];
}

/** 无 tool_calls 的终步 AI 消息。 */
function aiTerminal(content: unknown): unknown {
  return { _getType: () => "ai", content, tool_calls: [] };
}

/** tools 节点快照（submit_xxx 执行完毕后的相邻快照）。 */
function toolsUpdate(toolContent: string): unknown {
  return [
    "updates",
    {
      tools: {
        messages: [{ _getType: () => "tool", content: toolContent }],
      },
    },
  ];
}

/** 一张最小合法形态的 survey 卡（排水只关心对象本身）。 */
const SINK_CARD = {
  type: "survey_card",
  data: {
    purpose: "plan_gap",
    questions: [{ id: "goal", question: "目标？" }],
  },
};

async function collect(
  raws: unknown[],
  options?: { threadId?: string },
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of classifyAgentStream(
    (async function* () {
      for (const r of raws) yield r;
    })(),
    options,
  ))
    events.push(e);
  return events;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe("classifyAgentStream 卡汇排水（#151 S2 工具通道发射）", () => {
  it("updates 快照处发射 uiHint：卡先于该快照后的 token，done 收尾", async () => {
    __resetCardSinkForTests();
    pushCardToSink("u:t1", SINK_CARD);
    const events = await collect(
      [
        thinkingDelta("先看问卷题库……"),
        toolsUpdate('{"ok":true,"cardId":"abc12345","channel":"tool"}'),
        msgDelta("问卷已提交，请查收卡片。"),
        modelRequestUpdate(aiTerminal("问卷已提交，请查收卡片。")),
      ],
      { threadId: "u:t1" },
    );
    const uiHints = events.filter((e) => e.type === "uiHint");
    assert.equal(uiHints.length, 1, "排水恰好发射一张卡");
    assert.deepEqual(
      (uiHints[0] as { card: unknown }).card,
      SINK_CARD,
      "卡对象原样转发（verbatim，与围栏卡同一下游）",
    );
    assert.ok(
      events.some((e) => e.type === "token"),
      "终步散文照常放行",
    );
    assert.ok(!events.some((e) => e.type === "error"), "不得误发 error");
    const doneIdx = events.findIndex((e) => e.type === "done");
    assert.ok(doneIdx === events.length - 1, "done 必达且在最后");
    // 排水即清空：流后卡汇无残留。
    assert.equal(drainCardsFromSink("u:t1").length, 0);
  });

  it("纯工具轮（零 token 零散文）排水后不触发 EMPTY_ANSWER 兜底", async () => {
    __resetCardSinkForTests();
    pushCardToSink("u:t2", SINK_CARD);
    // 与 emptyTurnStreamGuard 首用例同款输入——那边发 EMPTY_ANSWER，
    // 这边卡即答案载荷，守卫必须被压下。
    const events = await collect(
      [thinkingDelta("出卡……"), modelRequestUpdate(aiTerminal(""))],
      { threadId: "u:t2" },
    );
    assert.equal(
      events.filter((e) => e.type === "token").length,
      0,
      "本轮零 token",
    );
    assert.ok(
      events.some((e) => e.type === "uiHint"),
      "卡已发射",
    );
    assert.ok(
      !events.some(
        (e) => e.type === "error" && e.error?.message.includes("EMPTY_ANSWER"),
      ),
      "卡 = 答案载荷，纯工具轮不是空轮",
    );
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("无 threadId（旧调用形态）→ 不排水：围栏路径行为不变", async () => {
    __resetCardSinkForTests();
    pushCardToSink("u:orphan", SINK_CARD);
    const events = await collect([
      msgDelta("正常回答"),
      modelRequestUpdate(aiTerminal("正常回答")),
    ]);
    assert.ok(
      !events.some((e) => e.type === "uiHint"),
      "无线程锚点时卡汇不参与发射",
    );
    assert.ok(events.some((e) => e.type === "token"));
    clearThreadCards("u:orphan"); // 测试隔离清理
  });

  it("无 threadId + 空轮 → EMPTY_ANSWER 兜底照旧（回归）", async () => {
    __resetCardSinkForTests();
    const events = await collect([
      thinkingDelta("思考……"),
      modelRequestUpdate(aiTerminal("")),
    ]);
    assert.ok(
      events.some(
        (e) => e.type === "error" && e.error?.message.includes("EMPTY_ANSWER"),
      ),
      "既有空轮守卫不受卡通道改造影响",
    );
  });

  it("流异常中断 → finally 清空卡汇，未发射的卡不跨轮滞留", async () => {
    __resetCardSinkForTests();
    pushCardToSink("u:t3", SINK_CARD);
    const boom = (async function* (): AsyncGenerator<unknown> {
      yield thinkingDelta("出卡后模型中断……");
      throw new Error("LLM stream aborted");
    })();
    await assert.rejects(async () => {
      for await (const _e of classifyAgentStream(boom, { threadId: "u:t3" }));
    }, /aborted/);
    assert.equal(
      drainCardsFromSink("u:t3").length,
      0,
      "finally 清空：陈旧卡绝不泄漏进下一轮",
    );
  });
});
