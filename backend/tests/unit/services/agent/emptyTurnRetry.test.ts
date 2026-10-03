/**
 * 空终步检测 + 模型重滚自动接续（refs #110 #111，#112）— jest 语义测试。
 *
 * 背景（#110 诊断 + #111 复现矩阵，均已合 main）：GLM OpenAI 兼容端点偶发
 * 整轮流式 delta 全程不带 role → @langchain/openai 转换层走 else 分支构造
 * ChatMessageChunk（不接收 additional_kwargs）→ tool_calls 增量被静默丢弃 →
 * 聚合体 content=''、零 tool_calls → LangGraph 视为合法终步 → 整轮空输出，
 * 用户端「正在解析数据…」死占位。上游 1.5.13/1.6.2 双版均 BUG。
 *
 * 被测实现拆在 src/services/agent/emptyTurnRetry.ts（2026-10-03 拆自
 * DeepAgentService——后者顶层 import 链含 skillLoader 的 import.meta，jest
 * CJS 加载不了整条链；与 splitLeakedReasoning 的拆分同款先例），核心语义
 * 全部在本文件覆盖：
 *  - 「无 role 假流」→ frameworkTrimMiddleware 就地重滚一次，终产合法
 *    AIMessage（tool_calls 完整还原），底层 handler 恰被调 2 次；
 *  - 「连续两次空终步」→ 只重滚一次（handler 恰 2 次，绝无第三次），抛
 *    EmptyAgentTurnError；emptyTurnToErrorEvent 映射 MODEL_ERROR error 事件
 *    （契约封闭枚举无 EMPTY_ANSWER 码，标识内嵌消息）；
 *  - 「正常流」→ 零额外调用（三条件各设一反例：非 roleless / 有 tool_calls
 *    / 有 content）+ abort 守卫（中止后不重滚）；
 *  - 打点：重滚 warn 日志含 threadId（观测性要求）。
 *
 * classifyAgentStream 流尾 EMPTY_ANSWER 兜底守卫的测试在
 * src/services/agent/__tests__/emptyTurnStreamGuard.test.ts（tsx/node:test——
 * 该函数留在 DeepAgentService 内，jest 无法加载）。
 *
 * Runner: jest（tests/unit/**，npm run test:unit 计入）。
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

import {
  AIMessageChunk,
  ChatMessageChunk,
  SystemMessage,
} from "@langchain/core/messages";
import {
  frameworkTrimMiddleware,
  EmptyAgentTurnError,
  emptyTurnToErrorEvent,
} from "../../../../src/services/agent/emptyTurnRetry.js";

// 重滚路径会 console.warn 打点——spy 掉保持输出干净，并断言观测性字段。
// （jest.spyOn 对已 spy 的方法不重置计数，须显式 mockClear。）
let warnSpy: jest.Spied<typeof console.warn>;
beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  warnSpy.mockClear();
});

// ---------------------------------------------------------------------------
// 测试脚手架
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
function runMiddleware(
  handler: Handler,
  request: unknown = makeModelRequest(),
): Promise<unknown> {
  const hook = frameworkTrimMiddleware.wrapModelCall as unknown as (
    req: unknown,
    h: Handler,
  ) => Promise<unknown>;
  return hook(request, handler);
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

    expect(calls).toHaveLength(2);
    expect(res).toBeInstanceOf(AIMessageChunk);
    const tc = (res as AIMessageChunk).tool_calls ?? [];
    expect(tc).toHaveLength(1);
    expect(tc[0]?.name).toBe("load_history");
    expect(tc[0]?.id).toBe("call_retry_001");
    // 观测性：重滚打点含 threadId。
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(logged).toContain("u1:t-empty-turn");
    expect(logged).toContain("重滚接续成功");
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
    expect(seenTools).toEqual([["load_history"], ["load_history"]]);
  });
});

// ---------------------------------------------------------------------------
// 用例 2：连续两次空终步 → 只重滚一次 + EmptyAgentTurnError + error 事件映射
// ---------------------------------------------------------------------------

describe("空终步重滚：连续两次空终步 → 仅重滚一次并抛 EmptyAgentTurnError", () => {
  it("handler 恰调 2 次（绝无第三次），抛带标识错误", async () => {
    const calls: unknown[] = [];
    let caught: unknown;
    await runMiddleware(async (req) => {
      calls.push(req);
      return rolelessAggregate();
    }).catch((e: unknown) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(EmptyAgentTurnError);
    expect((caught as Error).message).toMatch(/EMPTY_ANSWER/);
    expect(calls).toHaveLength(2);
  });

  it("emptyTurnToErrorEvent：EmptyAgentTurnError → MODEL_ERROR + EMPTY_ANSWER 标识", () => {
    const ev = emptyTurnToErrorEvent(
      new EmptyAgentTurnError(
        "模型连续两次返回空终步（EMPTY_ANSWER，refs #110 tool_calls 增量丢失），本轮无法产出回复。",
      ),
    );
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe("error");
    expect(ev?.error?.code).toBe("MODEL_ERROR");
    expect(ev?.error?.message).toMatch(/EMPTY_ANSWER/);
  });

  it("emptyTurnToErrorEvent：其他错误返回 null（交回 toErrorEvent 的 INTERNAL 分支）", () => {
    expect(emptyTurnToErrorEvent(new Error("boom"))).toBeNull();
    expect(emptyTurnToErrorEvent("plain string")).toBeNull();
    expect(emptyTurnToErrorEvent(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 用例 3：正常流 → 零额外调用（回归保护，三条件各一反例）
// ---------------------------------------------------------------------------

describe("空终步重滚：正常流零额外调用（回归保护）", () => {
  it("正常含 tool_calls 聚合（非 roleless）→ handler 恰 1 次，原样返回", async () => {
    const calls: unknown[] = [];
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      return aiWithToolCall();
    });
    expect(calls).toHaveLength(1);
    expect(res).toBeInstanceOf(AIMessageChunk);
    expect((res as AIMessageChunk).tool_calls ?? []).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("正常文本终步（有 content 无 tool_calls）→ 恰 1 次，不误触发", async () => {
    const calls: unknown[] = [];
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      return new AIMessageChunk({ content: "好的，先看你的训练历史。" });
    });
    expect(calls).toHaveLength(1);
    expect((res as AIMessageChunk).content).toBe("好的，先看你的训练历史。");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("roleless 但正文存活（ChatMessageChunk 有 content）→ 恰 1 次，重水化不重滚", async () => {
    const calls: unknown[] = [];
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      return rolelessAggregate("继续练，别加重量。");
    });
    expect(calls).toHaveLength(1);
    expect(res).toBeInstanceOf(AIMessageChunk);
    expect((res as AIMessageChunk).content).toBe("继续练，别加重量。");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("roleless 且仅 tool_call_chunks 存量（增量未丢的假想形态）→ 不重滚", async () => {
    // 谓词三条件之「零 tool_calls」反例：即使 roleless，只要任一载体有
    // tool_calls 就不是空终步。
    const calls: unknown[] = [];
    const res = await runMiddleware(async (req) => {
      calls.push(req);
      return new ChatMessageChunk({
        content: "",
        role: "assistant",
        additional_kwargs: {
          tool_calls: [
            {
              index: 0,
              id: "c-x",
              type: "function",
              function: { name: "find_exercises", arguments: "{}" },
            },
          ],
        },
      });
    });
    expect(calls).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
    // 重水化仍发生（既有行为），additional_kwargs 保留。
    expect(res).toBeInstanceOf(AIMessageChunk);
  });

  it("signal 已中止 → 不重滚（abort 语义优先，不额外计费）", async () => {
    const calls: unknown[] = [];
    const controller = new AbortController();
    controller.abort();
    const res = await runMiddleware(
      async (r) => {
        calls.push(r);
        return rolelessAggregate();
      },
      {
        ...(makeModelRequest() as object),
        runtime: {
          configurable: { thread_id: "u1:t-aborted" },
          signal: controller.signal,
        },
      },
    );
    expect(calls).toHaveLength(1);
    expect(res).toBeInstanceOf(AIMessageChunk);
  });
});
