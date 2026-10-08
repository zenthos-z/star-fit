/**
 * 同轮幂等工具结果缓存（#116 / #68）单测——直调 turnToolCacheMiddleware 的
 * before_agent / wrapToolCall 钩子（与 emptyTurnRetry.test.ts 同款合成请求
 * 手法），覆盖任务书四条验收用例 + 隔离/新鲜度/错误不粘轮纵深：
 *
 * 1. 同轮同参数 load_history 两次调用 → 第二次命中缓存（打点可见）
 * 2. 不同参数不命中
 * 3. 写类工具不缓存
 * 4. 跨轮（新 turn）不命中旧缓存
 */

import { ToolMessage } from "@langchain/core/messages";
import {
  TURN_CACHEABLE_TOOLS,
  __resetTurnToolCacheForTests,
  turnToolCacheMiddleware,
} from "../../../../src/services/agent/mcpTools.js";

// ---------------------------------------------------------------------------
// 合成请求手法（钩子直调，不起 LangGraph）
// ---------------------------------------------------------------------------

let callSeq = 0;

/** 模拟一轮（chat()）开始：before_agent 以该线程开启全新缓存体。 */
function startTurn(threadId: string): void {
  turnToolCacheMiddleware.beforeAgent?.(
    { messages: [] },
    { configurable: { thread_id: threadId } },
  );
}

/** 合成一个 wrapToolCall 请求（toolCall 形态对齐 langchain ToolCall）。 */
function toolRequest(
  threadId: string,
  name: string,
  args: unknown,
): Parameters<NonNullable<typeof turnToolCacheMiddleware.wrapToolCall>>[0] {
  callSeq += 1;
  return {
    toolCall: {
      name,
      args: args as Record<string, unknown>,
      id: `call_${callSeq}`,
      type: "tool_call" as const,
    },
    tool: undefined,
    state: { messages: [] },
    runtime: { configurable: { thread_id: threadId } },
  };
}

/**
 * 跑一次工具调用：handler 每执行一次即产出一个新结果（RESULT-<n>）并计数，
 * 断言「第二次同参是否复用缓存」等价于断言 handler 是否被再次执行。
 */
async function runTool(
  threadId: string,
  name: string,
  args: unknown,
  state: { calls: number; error?: boolean },
): Promise<ToolMessage> {
  const res = await turnToolCacheMiddleware.wrapToolCall!(
    toolRequest(threadId, name, args),
    async (req) => {
      state.calls += 1;
      return new ToolMessage({
        content: `RESULT-${state.calls}`,
        tool_call_id: req.toolCall.id ?? "call_unknown",
        name: req.toolCall.name,
        ...(state.error ? { status: "error" as const } : {}),
      });
    },
  );
  return res as ToolMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let infoSpy: jest.SpyInstance;

beforeEach(() => {
  __resetTurnToolCacheForTests();
  infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  infoSpy.mockRestore();
});

describe("turnToolCacheMiddleware（#116 同轮幂等工具缓存）", () => {
  it("白名单 = 任务书指定的四个幂等只读工具（#151 S3 +pick_template 目录）", () => {
    expect([...TURN_CACHEABLE_TOOLS].sort()).toEqual([
      "find_exercises",
      "list_exercises",
      "load_history",
      "pick_template",
      "read_file",
    ]);
  });

  it("同轮同参数 load_history 第二次命中缓存：handler 不再执行，打点可见", async () => {
    const threadId = "thread-hit";
    startTurn(threadId);
    const state = { calls: 0 };

    const first = await runTool(threadId, "load_history", { limit: 10 }, state);
    expect(state.calls).toBe(1);
    expect(first.content).toBe("RESULT-1");
    expect(infoSpy).not.toHaveBeenCalled();

    const second = await runTool(
      threadId,
      "load_history",
      { limit: 10 },
      state,
    );
    // 命中：handler 未执行，内容复用首轮结果
    expect(state.calls).toBe(1);
    expect(second.content).toBe("RESULT-1");
    // 重建的 ToolMessage 换上了本次调用的 tool_call_id（call_2 ≠ 首轮 call_1）
    expect(second.tool_call_id).toBe("call_2");
    expect(second.tool_call_id).not.toBe(first.tool_call_id);
    // 打点可见（工具名 + 参数指纹）
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("[turn-tool-cache] HIT load_history"),
    );
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('"limit":10'));
  });

  it("参数键序不同视为同参（深比较）：{include_profile,limit} 与 {limit,include_profile} 命中", async () => {
    const threadId = "thread-deep-eq";
    startTurn(threadId);
    const state = { calls: 0 };

    await runTool(
      threadId,
      "load_history",
      { include_profile: true, limit: 3 },
      state,
    );
    const second = await runTool(
      threadId,
      "load_history",
      { limit: 3, include_profile: true },
      state,
    );
    expect(state.calls).toBe(1);
    expect(second.content).toBe("RESULT-1");
  });

  it("同轮不同参数不命中：limit=10 与 limit=5 各自执行", async () => {
    const threadId = "thread-diff-args";
    startTurn(threadId);
    const state = { calls: 0 };

    const a = await runTool(threadId, "load_history", { limit: 10 }, state);
    const b = await runTool(threadId, "load_history", { limit: 5 }, state);
    expect(state.calls).toBe(2);
    expect(a.content).toBe("RESULT-1");
    expect(b.content).toBe("RESULT-2");
    const hitLogs = infoSpy.mock.calls.filter((c) =>
      String(c[0]).includes("HIT"),
    );
    expect(hitLogs).toHaveLength(0);
  });

  it("写类工具（write_memory）绝不缓存：同参两次各自执行", async () => {
    const threadId = "thread-write";
    startTurn(threadId);
    const state = { calls: 0 };

    await runTool(threadId, "write_memory", { key: "k", content: "v" }, state);
    await runTool(threadId, "write_memory", { key: "k", content: "v" }, state);
    expect(state.calls).toBe(2);
    const hitLogs = infoSpy.mock.calls.filter((c) =>
      String(c[0]).includes("HIT"),
    );
    expect(hitLogs).toHaveLength(0);
  });

  it("跨轮（新 turn）不命中旧缓存：before_agent 重开后同参重新执行", async () => {
    const threadId = "thread-new-turn";
    startTurn(threadId); // 第 1 轮
    const state = { calls: 0 };

    await runTool(threadId, "load_history", { limit: 10 }, state);
    expect(state.calls).toBe(1);

    startTurn(threadId); // 第 2 轮：旧缓存整体作废
    const second = await runTool(
      threadId,
      "load_history",
      { limit: 10 },
      state,
    );
    expect(state.calls).toBe(2);
    expect(second.content).toBe("RESULT-2");
  });

  it("写类工具执行后清空本轮缓存：轮内写后读拿到新数据", async () => {
    const threadId = "thread-invalidate";
    startTurn(threadId);
    const state = { calls: 0 };

    await runTool(threadId, "load_history", { limit: 10 }, state);
    expect(state.calls).toBe(1);

    // write_session 执行（清空本轮缓存）
    await runTool(
      threadId,
      "write_session",
      { summary: "done", exercises: [] },
      state,
    );
    expect(
      infoSpy.mock.calls.some(
        (c) =>
          String(c[0]).includes("清空本轮缓存") &&
          String(c[0]).includes("write_session"),
      ),
    ).toBe(true);

    // 写后再读：不命中旧缓存，重新执行
    const after = await runTool(threadId, "load_history", { limit: 10 }, state);
    expect(state.calls).toBe(3);
    expect(after.content).toBe("RESULT-3");
  });

  it("错误结果不粘轮：status=error 的首轮结果不进缓存", async () => {
    const threadId = "thread-error";
    startTurn(threadId);
    const failing = { calls: 0, error: true };

    await runTool(threadId, "list_exercises", { body_part: "chest" }, failing);
    expect(failing.calls).toBe(1);

    // 第二次同参：错误未被缓存 → 重新执行
    const ok = { calls: 0 };
    const second = await runTool(
      threadId,
      "list_exercises",
      { body_part: "chest" },
      ok,
    );
    expect(ok.calls).toBe(1);
    expect(second.content).toBe("RESULT-1");
    expect(second.status).toBeUndefined();
  });

  it("线程隔离：另一线程同工具同参数不命中本线程缓存", async () => {
    const threadA = "thread-A";
    const threadB = "thread-B";
    startTurn(threadA);
    startTurn(threadB);
    const stateA = { calls: 0 };
    const stateB = { calls: 0 };

    await runTool(
      threadA,
      "read_file",
      { file_path: "/plan-generation/SKILL.md" },
      stateA,
    );
    const fromB = await runTool(
      threadB,
      "read_file",
      { file_path: "/plan-generation/SKILL.md" },
      stateB,
    );

    expect(stateA.calls).toBe(1);
    expect(stateB.calls).toBe(1); // B 未命中 A 的缓存
    expect(fromB.content).toBe("RESULT-1");
  });

  it("before_agent 未跑（无本轮缓存体）时直通不缓存", async () => {
    const threadId = "thread-no-turn";
    const state = { calls: 0 };

    await runTool(threadId, "load_history", {}, state);
    await runTool(threadId, "load_history", {}, state);
    expect(state.calls).toBe(2);
  });
});
