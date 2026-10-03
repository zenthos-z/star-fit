/**
 * RoleHealingChatOpenAI 单测（refs #113）— jest 语义测试。
 *
 * 背景：GLM OpenAI 兼容端点重型请求高发整轮流式 delta 全程无 role
 * （#110 诊断 + #111 复现矩阵），基线 ChatOpenAI 转换层对 role 缺省
 * delta 走 ChatMessageChunk 兜底分支，tool_calls / reasoning_content 被
 * 静默丢弃 → 空终步。根治 = RoleHealingChatOpenAI 在转换层按 assistant
 * 特征（tool_calls / reasoning_content）重建 AIMessageChunk。
 *
 * 本文件走全链路（本地 mock OpenAI 兼容 SSE 服务 → 真实例），而非直调
 * protected 转换方法——同时验证注入路径（ChatOpenAI 组合外壳把内部
 * completions 实例换成 healing 子类）真实生效，这是 1.5.x 结构下覆写
 * 能否被流式路径调用的关键风险点。两条消费路径均覆盖：
 *  - stream() + 逐 chunk concat（core stream/_generate 流式聚合等价）
 *  - invoke() + lc_prefer_streaming 回调（AgentNode 生产路径）
 *
 * 用例矩阵：
 *  1. 无 role + tool_calls → AIMessageChunk 且 tool_call_chunks 聚合完整
 *  2. 无 role + reasoning_content → AIMessageChunk，思考链拼接完整
 *  3. 无 role 无特征 → ChatMessageChunk（不误补）
 *  4. 有 role 正常流 → 与基线 ChatOpenAI 行为一致（回归对照）
 *
 * Runner: jest（tests/unit/**，npm run test:unit 计入）。
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  AIMessageChunk,
  ChatMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { RoleHealingChatOpenAI } from "../../../src/services/llmRoleHealing.js";

// ---------------------------------------------------------------------------
// mock OpenAI 兼容 SSE 服务：POST /shape/<name>/chat/completions
// ---------------------------------------------------------------------------

/** delta 序列 → SSE body。末事件 finish_reason=finish，随后 [DONE]。 */
function sseBody(
  deltas: Array<Record<string, unknown>>,
  finish: string,
): string {
  const events = deltas.map((delta, i) => ({
    id: "chatcmpl-test113",
    object: "chat.completion.chunk",
    created: 1759500000,
    model: "glm-test",
    choices: [
      {
        index: 0,
        delta,
        logprobs: null,
        finish_reason: i === deltas.length - 1 ? finish : null,
      },
    ],
  }));
  return (
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

/** 形态注册表：shape 名 → SSE 响应体。 */
const shapes: Record<string, string> = {
  // GLM 无 role + 纯工具调用（#110 捕获形态）：args 切 3 段模拟增量碎片。
  "glm-no-role-tool-calls": sseBody(
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "call_test_001",
            type: "function",
            function: { name: "plan_generate", arguments: "" },
          },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: '{"plan_' } }] },
      { tool_calls: [{ index: 0, function: { arguments: 'id":"p-001",' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"weeks":4}' } }] },
      {},
    ],
    "tool_calls",
  ),
  // GLM 无 role + 思考链 + 正文（计划轮典型混合流）。
  "glm-no-role-reasoning": sseBody(
    [
      { reasoning_content: "分析用户目标：" },
      { reasoning_content: "增肌 4 周，" },
      { reasoning_content: "每周 3 练。" },
      { content: "已生成计划。" },
      {},
    ],
    "stop",
  ),
  // GLM 无 role、无 assistant 特征（真未知角色 → 不该被 healing 误补）。
  "glm-no-role-plain": sseBody([{ content: "你好" }, {}], "stop"),
  // OpenAI 标准形态（对照组）：首 delta 带 role=assistant。
  "openai-normal": sseBody(
    [
      {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_test_001",
            type: "function",
            function: { name: "plan_generate", arguments: "" },
          },
        ],
      },
      {
        role: "assistant",
        tool_calls: [{ index: 0, function: { arguments: '{"plan_' } }],
      },
      {
        role: "assistant",
        tool_calls: [{ index: 0, function: { arguments: 'id":"p-001",' } }],
      },
      {
        role: "assistant",
        tool_calls: [{ index: 0, function: { arguments: '"weeks":4}' } }],
      },
      {},
    ],
    "tool_calls",
  ),
};

const server = http.createServer((req, res) => {
  const m = /^\/shape\/([a-z0-9-]+)\/chat\/completions$/.exec(req.url ?? "");
  if (req.method !== "POST" || !m || !shapes[m[1]]) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  res.end(shapes[m[1]]);
});

let baseURL = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeHealing(shape: string): RoleHealingChatOpenAI {
  return new RoleHealingChatOpenAI({
    apiKey: "sk-test-local",
    model: "glm-test",
    maxRetries: 0,
    configuration: { baseURL: `${baseURL}/shape/${shape}` },
  });
}

const INPUT = [new HumanMessage("帮我生成一份 4 周计划")];

/** stream() 逐 chunk concat 聚合（core 流式聚合等价）。 */
async function aggregateStream(model: RoleHealingChatOpenAI | ChatOpenAI) {
  const chunks = [];
  for await (const c of await model.stream(INPUT)) chunks.push(c);
  return chunks.reduce((acc, c) => acc.concat(c));
}

/** invoke() + 流式回调（AgentNode 生产路径等价）。 */
const preferStreamingCallback = {
  lc_prefer_streaming: true,
  handleLLMNewToken: () => {},
};

async function invokePreferStreaming(
  model: RoleHealingChatOpenAI | ChatOpenAI,
) {
  return model.invoke(INPUT, { callbacks: [preferStreamingCallback] });
}

// 聚合层（chunk concat）会把拼完的 args JSON 字符串解析为对象——
// 下游（LangGraph / DeepAgentService）消费的即该形态。
const EXPECTED_TOOL_CALLS = [
  {
    name: "plan_generate",
    args: { plan_id: "p-001", weeks: 4 },
    id: "call_test_001",
    type: "tool_call",
  },
];

// ---------------------------------------------------------------------------
// 1. 无 role + tool_calls → AIMessageChunk 且 tool_call_chunks 完整
// ---------------------------------------------------------------------------
describe("RoleHealingChatOpenAI / 无 role + tool_calls（#113 根治形态）", () => {
  it("stream() 聚合体为 AIMessageChunk，tool_calls 完整还原", async () => {
    const aggregate = await aggregateStream(
      makeHealing("glm-no-role-tool-calls"),
    );
    expect(aggregate).toBeInstanceOf(AIMessageChunk);
    expect(aggregate.tool_calls).toEqual(EXPECTED_TOOL_CALLS);
    expect(aggregate.content).toBe("");
  });

  it("invoke()（lc_prefer_streaming）同样产出完整 tool_calls（生产路径）", async () => {
    const invoked = await invokePreferStreaming(
      makeHealing("glm-no-role-tool-calls"),
    );
    expect(invoked).toBeInstanceOf(AIMessageChunk);
    expect(invoked.tool_calls).toEqual(EXPECTED_TOOL_CALLS);
  });
});

// ---------------------------------------------------------------------------
// 2. 无 role + reasoning_content → AIMessageChunk，思考链拼接完整
// ---------------------------------------------------------------------------
describe("RoleHealingChatOpenAI / 无 role + reasoning_content", () => {
  it("聚合体为 AIMessageChunk，reasoning_content 拼接完整且正文保留", async () => {
    const aggregate = await aggregateStream(
      makeHealing("glm-no-role-reasoning"),
    );
    expect(aggregate).toBeInstanceOf(AIMessageChunk);
    expect(aggregate.additional_kwargs.reasoning_content).toBe(
      "分析用户目标：增肌 4 周，每周 3 练。",
    );
    expect(aggregate.content).toBe("已生成计划。");
  });

  it("invoke()（lc_prefer_streaming）思考链不丢失", async () => {
    const invoked = await invokePreferStreaming(
      makeHealing("glm-no-role-reasoning"),
    );
    expect(invoked).toBeInstanceOf(AIMessageChunk);
    expect(invoked.additional_kwargs.reasoning_content).toBe(
      "分析用户目标：增肌 4 周，每周 3 练。",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. 无 role 无特征 → ChatMessageChunk（不误补）
// ---------------------------------------------------------------------------
describe("RoleHealingChatOpenAI / 无 role 无特征（真未知角色）", () => {
  it("维持 ChatMessageChunk，不乱补 assistant", async () => {
    const aggregate = await aggregateStream(makeHealing("glm-no-role-plain"));
    expect(aggregate).toBeInstanceOf(ChatMessageChunk);
    expect(aggregate).not.toBeInstanceOf(AIMessageChunk);
    expect(aggregate.content).toBe("你好");
  });
});

// ---------------------------------------------------------------------------
// 4. 有 role 正常流 → 与基线 ChatOpenAI 行为一致（回归）
// ---------------------------------------------------------------------------
describe("RoleHealingChatOpenAI / 有 role 正常流（回归对照）", () => {
  it("聚合结果与基线 ChatOpenAI 一致（类名/tool_calls/content）", async () => {
    const healing = await aggregateStream(makeHealing("openai-normal"));
    const baseline = await aggregateStream(
      new ChatOpenAI({
        apiKey: "sk-test-local",
        model: "glm-test",
        maxRetries: 0,
        configuration: { baseURL: `${baseURL}/shape/openai-normal` },
      }),
    );
    expect(healing.constructor).toBe(baseline.constructor);
    expect(healing.tool_calls).toEqual(baseline.tool_calls);
    expect(healing.tool_calls).toEqual(EXPECTED_TOOL_CALLS);
    expect(healing.content).toBe(baseline.content);
  });
});
