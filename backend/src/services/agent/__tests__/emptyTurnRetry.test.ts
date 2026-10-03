/**
 * 空终步检测 + 模型重滚自动接续（refs #110 #111，#112）。
 *
 * 背景（#110 诊断 + #111 复现矩阵，均已合 main）：GLM OpenAI 兼容端点偶发
 * 整轮流式 delta 全程不带 role → @langchain/openai 转换层走 else 分支构造
 * ChatMessageChunk（不接收 additional_kwargs）→ tool_calls 增量被静默丢弃 →
 * 聚合体 content=''、零 tool_calls → LangGraph 视为合法终步 → 整轮空输出，
 * 用户端「正在解析数据…」死占位。上游 1.5.13/1.6.2 双版均 BUG。
 *
 * 修复契约（任务书 #112 三用例）：
 *  - 「无 role 假流」→ frameworkTrimMiddleware 就地重滚一次，终产合法
 *    AIMessage（tool_calls 完整还原），底层 handler 恰被调 2 次；
 *  - 「连续两次空终步」→ 只重滚一次（handler 恰 2 次，绝无第三次），抛
 *    EmptyAgentTurnError；toErrorEvent 将其映射为 MODEL_ERROR error 事件
 *    （契约封闭枚举无 EMPTY_ANSWER 码，标识内嵌消息，见 PR 说明）；
 *  - 「正常流」→ 零额外调用（回归保护）；roleless 但正文存活 / 正常空
 *    content 终步均不得误触发重滚。
 *
 * 同链路纵深（classifyAgentStream 流尾守卫，#110 §5.4）：整轮零 token 零
 * uiHint 零 error 而流正常收尾 → done 前发 EMPTY_ANSWER 兜底 error 事件；
 * 有 token 的正常轮不得多发。
 *
 * Runner: node:test via tsx（与 __tests__ 其余文件一致）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AIMessageChunk,
  ChatMessageChunk,
  SystemMessage,
} from "@langchain/core/messages";
import {
  frameworkTrimMiddleware,
  EmptyAgentTurnError,
  classifyAgentStream,
  toErrorEvent,
} from "../DeepAgentService.js";
import type { AgentEvent } from "shared/contracts";

// ---------------------------------------------------------------------------
// middleware 层测试脚手架
// ---------------------------------------------------------------------------

/**
 * 最小 ModelRequest 夹具：tools 里混入裁剪目标（task）与非目标
 * （load_history），覆盖「裁剪 → 重滚复用同一 req2」链路；runtime 带
 * threadId 与未中止的 signal。
 */
function makeModelRequest(): unknown {
  return {
    model: {},
    messages: [],
    systemPrompt: "",
    systemMessage: new SystemMessage("test system"),
    tools: [
      { name: "task", description: "trim target" },
      { name: "load_history", description: "kept" },
    ],
    state: { messages: [] },
    runtime: {
      configurable: { thread_id: "u1:t-empty-turn" },
      signal: new AbortController().signal,
    },
  };
}

type Handler = (req: unknown) => Promise<unknown>;

/** 直接驱动导出中间件的 wrapModelCall（与生产同一条链）。 */
function runMiddleware(handler: Handler): Promise<unknown> {
  const hook = frameworkTrimMiddleware.wrapModelCall as unknown as (
    req: unknown,
    h: Handler,
  ) => Promise<unknown>;
  return hook(makeModelRequest(), handler);
}

/** 含 tool_calls 的正常 AIMessageChunk（重滚成功腿的形态）。 */
function aiWithToolCall(): AIMessageChunk {
  return new AIMessageChunk({
    content: "",
    tool_call_chunks: [
      {
        name: "load_history",
        args: "{}",
        id: "call_retry_001",
        index: 0,
        type: "tool_call_chunk",
      },
    ],
  });
}

/**
 * 构造 #111 BUG 腿签名的聚合体：ChatMessageChunk、role=undefined（类型层
 * ChatMessageFields 要求必填，以断言保持与线上转换层实际产物一致）。
 * content 可注入（「roleless 但正文存活」的反例腿）。
 */
function rolelessAggregate(content = ""): ChatMessageChunk {
  return new ChatMessageChunk({
    content,
    role: undefined as unknown as string,
  });
}

// ---------------------------------------------------------------------------
// classifyAgentStream 层合成流构造（与 streamCardRescue.test.ts 同款）
// ---------------------------------------------------------------------------

/** messages delta: [chunk, metadata]。 */
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

/** messages 正文 delta: [chunk, metadata]。 */
function msgDelta(text: string): unknown {
  return ["messages", [{ content: text }, {}]];
}

/** 无 tool_calls 的终步 AI 消息。 */
function aiTerminal(content: unknown): unknown {
  return { _getType: () => "ai", content, tool_calls: [] };
}

async function classify(stream: AsyncIterable<unknown>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of classifyAgentStream(stream)) events.push(e);
  return events;
}

async function fromSync(raws: unknown[]): Promise<AgentEvent[]> {
  return classify(
    (async function* () {
      for (const r of raws) yield r;
    })(),
  );
}

// ---------------------------------------------------------------------------
// 用例 1：无 role 假流 → 重滚触发且终产合法 AIMessage（含 tool_calls）
// ---------------------------------------------------------------------------

describe("空终步重滚：无 role 假流 → 就地重滚一次并接续（refs #110 #111）", () => {
  it("首次空聚合（#111 复现签名）→ handler 恰调 2 次，终产含 tool_calls 的 AIMessageChunk", async () => {
    const calls: unknown[] = [];
    let n = 0;
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      n += 1;
      // 首调 = #111 BUG 腿签名：ChatMessageChunk、content=''、零 tool_calls。
      // 重滚 = 对照组形态：AIMessageChunk + 完整 tool_calls。
      return n === 1 ? rolelessAggregate() : aiWithToolCall();
    });

    assert.equal(calls.length, 2, `原调 + 一次重滚（实际 ${calls.length} 次）`);
    assert.ok(
      res instanceof AIMessageChunk,
      `重滚结果必须是合法 AIMessage（实际 ${res?.constructor?.name}）`,
    );
    const tc = (res as AIMessageChunk).tool_calls ?? [];
    assert.equal(tc.length, 1, "tool_calls 完整还原");
    assert.equal(tc[0]?.name, "load_history");
    assert.equal(tc[0]?.id, "call_retry_001");
  });

  it("重滚腿同样走裁剪链：两次 handler 收到的 tools 均已剔除框架死重", async () => {
    const seenTools: string[][] = [];
    let n = 0;
    await runMiddleware(async (req) => {
      seenTools.push(
        ((req as { tools?: Array<{ name: string }> }).tools ?? []).map(
          (t) => t.name,
        ),
      );
      n += 1;
      return n === 1 ? rolelessAggregate() : aiWithToolCall();
    });
    assert.deepEqual(seenTools, [["load_history"], ["load_history"]]);
  });
});

// ---------------------------------------------------------------------------
// 用例 2：连续两次空终步 → 只重滚一次 + EmptyAgentTurnError + error 事件
// ---------------------------------------------------------------------------

describe("空终步重滚：连续两次空终步 → 仅重滚一次并抛 EmptyAgentTurnError", () => {
  it("handler 恰调 2 次（绝无第三次），抛带标识错误", async () => {
    const calls: unknown[] = [];
    await assert.rejects(
      () =>
        runMiddleware(async (req) => {
          calls.push(req);
          return rolelessAggregate();
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof EmptyAgentTurnError,
          `应抛 EmptyAgentTurnError（实际 ${(err as Error)?.name}）`,
        );
        assert.match((err as Error).message, /EMPTY_ANSWER/);
        return true;
      },
    );
    assert.equal(
      calls.length,
      2,
      `只重滚一次（实际 handler 调 ${calls.length} 次）`,
    );
  });

  it("EmptyAgentTurnError → toErrorEvent 映射为 MODEL_ERROR error 事件", () => {
    const ev = toErrorEvent(
      new EmptyAgentTurnError(
        "模型连续两次返回空终步（EMPTY_ANSWER，refs #110 tool_calls 增量丢失），本轮无法产出回复。",
      ),
    );
    assert.equal(ev.type, "error");
    assert.equal(ev.error?.code, "MODEL_ERROR");
    assert.match(ev.error?.message ?? "", /EMPTY_ANSWER/);
  });

  it("其他错误仍走 INTERNAL（映射回归）", () => {
    const ev = toErrorEvent(new Error("boom"));
    assert.equal(ev.error?.code, "INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// 用例 3：正常流 → 零额外调用（回归保护）
// ---------------------------------------------------------------------------

describe("空终步重滚：正常流零额外调用（回归保护）", () => {
  it("正常含 tool_calls 聚合 → handler 恰 1 次，原样返回", async () => {
    const calls: unknown[] = [];
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      return aiWithToolCall();
    });
    assert.equal(calls.length, 1);
    assert.ok(res instanceof AIMessageChunk);
    assert.equal((res as AIMessageChunk).tool_calls?.length, 1);
  });

  it("正常文本终步（有 content 无 tool_calls）→ 恰 1 次，不误触发", async () => {
    const calls: unknown[] = [];
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      return new AIMessageChunk({ content: "好的，先看你的训练历史。" });
    });
    assert.equal(calls.length, 1);
    assert.equal((res as AIMessageChunk).content, "好的，先看你的训练历史。");
  });

  it("roleless 但正文存活（ChatMessageChunk 有 content）→ 恰 1 次，重水化不重滚", async () => {
    const calls: unknown[] = [];
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      return rolelessAggregate("继续练，别加重量。");
    });
    assert.equal(calls.length, 1, "正文存活的 roleless 流不构成空终步");
    assert.ok(res instanceof AIMessageChunk, "仍按既有逻辑重水化");
    assert.equal((res as AIMessageChunk).content, "继续练，别加重量。");
  });

  it("signal 已中止 → 不重滚（abort 语义优先，不额外计费）", async () => {
    const calls: unknown[] = [];
    const controller = new AbortController();
    controller.abort();
    const hook = frameworkTrimMiddleware.wrapModelCall as unknown as (
      r: unknown,
      h: Handler,
    ) => Promise<unknown>;
    const res = await hook(
      {
        ...(makeModelRequest() as object),
        runtime: {
          configurable: { thread_id: "u1:t-aborted" },
          signal: controller.signal,
        },
      },
      async (r) => {
        calls.push(r);
        return rolelessAggregate();
      },
    );
    assert.equal(calls.length, 1, "中止后不再重滚");
    assert.ok(
      res instanceof AIMessageChunk,
      "返回重水化后的空消息（随 abort 终止）",
    );
  });
});

// ---------------------------------------------------------------------------
// 用例 4：classifyAgentStream 流尾守卫（EMPTY_ANSWER 兜底事件）
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
