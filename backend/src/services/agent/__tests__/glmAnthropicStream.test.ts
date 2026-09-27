/**
 * GLM anthropic 协议流式适配单测（B4，issue #35）。
 *
 * 背景：glm-anthropic（B4 备选路径）走 ChatAnthropic（bigmodel anthropic 端点）。
 * 该协议下推理走 content 块数组里的 {type:'thinking', thinking:'…'}（实测
 * 2026-09-27 GLM 5.3-flash 默认下发 thinking 块），而非 DeepSeek 的
 * additional_kwargs.reasoning_content。classifyAgentStream 的适配点：
 *   1. extractText 只取 type='text' 块 → thinking 块绝不进正文 token；
 *   2. extractReasoningContent 同步识别 thinking 块 → 逐 delta 进 thinking
 *      事件（前端折叠区），与 DeepSeek reasoning_content 路径行为对齐。
 *
 * 本文件用合成流（与 streamToolLeak.test.ts 同款构造方式）注入 anthropic
 * 形态的 chunk，断言上述两条不变量。Runner: node:test via tsx。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyAgentStream } from "../DeepAgentService.js";
import type { AgentEvent } from "shared/contracts";

// ---------------------------------------------------------------------------
// 合成流构造（anthropic chunk 形态）
// ---------------------------------------------------------------------------

/** anthropic thinking 增量：content 块数组 [{type:'thinking', thinking}] */
function thinkingDelta(text: string): unknown {
  return [
    "messages",
    [{ content: [{ type: "thinking", thinking: text }] }, {}],
  ];
}

/** anthropic text 增量：content 块数组 [{type:'text', text}]（bindTools 时
 * coerceContentToString=false，text 也是块数组形态） */
function textDelta(text: string): unknown {
  return ["messages", [{ content: [{ type: "text", text }] }, {}]];
}

/** updates 快照：model_request 节点最后一条 AI 消息（终步，无 tool_calls）。 */
function terminalUpdate(content: string): unknown {
  return [
    "updates",
    {
      model_request: {
        messages: [{ _getType: () => "ai", content, tool_calls: [] }],
      },
    },
  ];
}

/** updates 快照：中间步（带 tool_calls）。 */
function toolCallUpdate(): unknown {
  return [
    "updates",
    {
      model_request: {
        messages: [
          {
            _getType: () => "ai",
            content: [{ type: "thinking", thinking: "查一下" }],
            tool_calls: [{ name: "list_exercises", args: "{}" }],
          },
        ],
      },
    },
  ];
}

async function classify(stream: unknown[]): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  async function* gen() {
    for (const r of stream) yield r;
  }
  for await (const e of classifyAgentStream(gen())) events.push(e);
  return events;
}

function texts(events: AgentEvent[], type: AgentEvent["type"]): string {
  return events
    .filter((e) => e.type === type && e.text)
    .map((e) => e.text as string)
    .join("");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("B4 GLM anthropic thinking 块分流", () => {
  it("thinking 块逐 delta 转 thinking 事件，text 块进正文", async () => {
    const events = await classify([
      thinkingDelta("用户想要计划，"),
      thinkingDelta("我先查动作库。"),
      textDelta("好的，"),
      textDelta("这是你的计划。"),
      terminalUpdate("好的，这是你的计划。"),
    ]);

    // thinking 事件按 delta 分批到达（两条），内容完整
    const thinkingEvents = events.filter((e) => e.type === "thinking");
    assert.equal(thinkingEvents.length, 2);
    assert.equal(texts(events, "thinking"), "用户想要计划，我先查动作库。");
    // 正文 token 只含 text 块，绝无 thinking 内容
    assert.equal(texts(events, "token"), "好的，这是你的计划。");
  });

  it("工具调用轮的 thinking 块只进折叠区，零 token 泄漏", async () => {
    const events = await classify([
      thinkingDelta("需要调用工具查数据。"),
      textDelta("我先看看。"),
      toolCallUpdate(),
      thinkingDelta("工具返回了，整理答案。"),
      textDelta("答案是 42。"),
      terminalUpdate("答案是 42。"),
    ]);

    assert.equal(
      texts(events, "thinking"),
      "需要调用工具查数据。我先看看。工具返回了，整理答案。",
    );
    assert.equal(texts(events, "token"), "答案是 42。");
  });

  it("DeepSeek 形态（additional_kwargs.reasoning_content）不受影响", async () => {
    const events = await classify([
      [
        "messages",
        [
          {
            content: "答案文本",
            additional_kwargs: { reasoning_content: "旧协议推理" },
          },
          {},
        ],
      ],
      terminalUpdate("答案文本"),
    ]);

    assert.equal(texts(events, "thinking"), "旧协议推理");
    assert.equal(texts(events, "token"), "答案文本");
  });
});
