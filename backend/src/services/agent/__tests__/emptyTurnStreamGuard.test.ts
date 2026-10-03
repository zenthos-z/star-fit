/**
 * classifyAgentStream 流尾空轮守卫（refs #110 §5.4 / #112）。
 *
 * 守卫语义：整轮零 token 零 uiHint 零 error 而流正常收尾 → done 前发
 * EMPTY_ANSWER 兜底 error 事件（code 用契约既有 MODEL_ERROR——AgentErrorCode
 * 封闭枚举且 #112 冻结 shared/contracts，标识内嵌消息）。uiHint 卡只能随
 * token 文本下发（extractUiHintEvents 在本层下游剥卡），故本层「零 token」
 * ⟺「零 token 且零 uiHint」；thinking 不算答案载荷——纯思考轮对用户同样是
 * 空轮，同样兜底。
 *
 * 与 jest 测试的分工（2026-10-03 迁移）：#112 的中间件核心语义（三条件
 * 谓词 / 重滚一次 / abort 守卫 / EmptyAgentTurnError / 事件映射）在
 * backend/tests/unit/services/agent/emptyTurnRetry.test.ts（jest，
 * `npm run test:unit` 计入；被测实现拆在 emptyTurnRetry.ts）。本文件只测
 * 流尾守卫——classifyAgentStream 留在 DeepAgentService 内，其顶层 import
 * 链含 skillLoader 的 import.meta，jest CJS 加载不了，故守卫测试留在
 * tsx/node:test 套件（jest.config 的目录↔运行器契约亦如此记载）。
 *
 * Runner: node:test via tsx（与 __tests__ 其余文件一致）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyAgentStream } from "../DeepAgentService.js";
import type { AgentEvent } from "shared/contracts";

// ---------------------------------------------------------------------------
// 合成流构造（与 streamCardRescue.test.ts 同款）
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

async function fromSync(raws: unknown[]): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of classifyAgentStream(
    (async function* () {
      for (const r of raws) yield r;
    })(),
  ))
    events.push(e);
  return events;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe("classifyAgentStream 空轮守卫：整轮零 token → EMPTY_ANSWER 兜底 error 事件", () => {
  it("空终步泄漏到流层（终步 content=''）→ done 前发 EMPTY_ANSWER error 事件", async () => {
    const events = await fromSync([
      thinkingDelta("先看看历史记录……"),
      modelRequestUpdate(aiTerminal("")),
    ]);
    const tokens = events.filter((e) => e.type === "token");
    assert.equal(tokens.length, 0, "本轮零 token（守卫触发前提）");
    const err = events.find((e) => e.type === "error");
    assert.ok(err, "必须发兜底 error 事件");
    assert.equal(err.error?.code, "MODEL_ERROR");
    assert.match(err.error?.message ?? "", /EMPTY_ANSWER/);
    // error 在 done 之前，流仍正常收尾。
    const errIdx = events.findIndex((e) => e.type === "error");
    const doneIdx = events.findIndex((e) => e.type === "done");
    assert.ok(doneIdx > errIdx, "error 先于 done（done 必达且在最后）");
  });

  it("纯思考轮（仅 reasoning delta，无终步快照）→ 同样兜底", async () => {
    const events = await fromSync([thinkingDelta("思考中……")]);
    assert.ok(
      events.some(
        (e) => e.type === "error" && e.error?.message.includes("EMPTY_ANSWER"),
      ),
      "thinking 不算答案载荷，空轮必须兜底",
    );
    assert.ok(events.some((e) => e.type === "done"));
  });

  it("有 token 的正常轮 → 不发 EMPTY_ANSWER error（回归）", async () => {
    const events = await fromSync([
      msgDelta("今天练腿，先做深蹲 4 组。"),
      modelRequestUpdate(aiTerminal("今天练腿，先做深蹲 4 组。")),
    ]);
    assert.ok(
      events.some((e) => e.type === "token"),
      "正常终步答案照常放行",
    );
    assert.ok(!events.some((e) => e.type === "error"), "正常轮不得多发 error");
    assert.ok(events.some((e) => e.type === "done"));
  });
});
