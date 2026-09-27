/**
 * B4 GLM anthropic 协议端点最小 e2e 冒烟脚本（issue #35）。
 *
 * 目的：以 env 里的真实 key 对 glm-anthropic 路径打真请求，断言：
 *   1) 流式返回：text 块增量 ≥2 个（真流式，非一次性）
 *   2) thinking 流：GLM 5.3-flash 经 anthropic 端点默认下发 thinking 块，
 *      且与 text 块协议级分离（ChatAnthropic 映射为 content blocks）
 *   3) 工具调用：bindTools 后 tool_call_chunks 正常聚合出完整 args
 *
 * 共 2 次真请求（非压测）。key 只从 env 读，绝不打印、绝不落盘。
 *
 * 运行（backend 目录）：
 *   GLM_API_KEY=xxx npx tsx tests/manual/glmAnthropicSmoke.ts
 * 未设 GLM_API_KEY 时回退 ANTHROPIC_AUTH_TOKEN（Claude Code 工人环境同款）。
 * 通道解析顺序与 exerciseTranslate/llmClient.ts 一致。
 *
 * @version 1.0.0
 * @created 2026-09-27
 */
import dotenv from "dotenv";
import path from "node:path";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import process from "node:process";

// 与 tests/setup-env.ts 同款：优先 .env.local，不覆盖已注入的 env 变量
//（调度者以 env 直接注入 key 时优先生效）。
dotenv.config({
  path: path.resolve(import.meta.dirname, "../../.env.local"),
});
dotenv.config({
  path: path.resolve(import.meta.dirname, "../../.env"),
  override: false,
});

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/anthropic";

function resolveChannel(): { apiKey: string; baseURL: string; model: string } {
  const apiKey =
    process.env.GLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const baseURL = (
    process.env.GLM_ANTHROPIC_BASE_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const model = process.env.GLM_MODEL || "glm-5.3-flash";
  if (!apiKey) {
    console.error(
      "✗ 缺少 key：请设置 GLM_API_KEY（或 ANTHROPIC_AUTH_TOKEN）。" +
        `通道 ${baseURL}，模型 ${model}`,
    );
    process.exit(2);
  }
  return { apiKey, baseURL, model };
}

async function main(): Promise<void> {
  const { apiKey, baseURL, model } = resolveChannel();
  console.log(`• 通道: ${baseURL}  模型: ${model}  key: <env，不回显>`);

  const base = {
    model,
    apiKey,
    anthropicApiUrl: baseURL,
    temperature: 1.0,
    maxTokens: 2048,
  } as const;

  // ---- 断言 1+2：流式 text 增量 + thinking 块分离（单次请求） ----
  const llm = new ChatAnthropic({ ...base });
  let textChunks = 0;
  let textLen = 0;
  let thinkingLen = 0;
  for await (const chunk of await llm.stream(
    "请先认真思考一下，再用一句中文解释为什么渐进超负荷是力量训练的核心原则。",
  )) {
    const c = chunk.content;
    if (typeof c === "string") {
      if (c) {
        textChunks += 1;
        textLen += c.length;
      }
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (b.type === "text" && b.text) {
          textChunks += 1;
          textLen += b.text.length;
        } else if (b.type === "thinking" && b.thinking) {
          thinkingLen += b.thinking.length;
        }
      }
    }
  }
  console.log(
    `• 流式: text 增量 ${textChunks} 段 / ${textLen} 字，thinking ${thinkingLen} 字`,
  );
  if (textChunks < 2) {
    throw new Error(
      `流式断言失败：text 增量仅 ${textChunks} 段（应 ≥2，疑似非流式）`,
    );
  }
  if (textLen === 0) {
    throw new Error("流式断言失败：正文为空");
  }
  if (thinkingLen === 0) {
    throw new Error(
      "thinking 断言失败：未观察到 thinking 块（SSE 思考链将无内容，检查端点/模型行为）",
    );
  }

  // ---- 断言 3：工具调用流式聚合（单次请求） ----
  const echo = tool(async ({ msg }) => ` echoed:${msg}`, {
    name: "echo_msg",
    description: "原样回显一条消息，用于链路自检",
    schema: z.object({ msg: z.string().describe("要回显的消息") }),
  });
  const llmTools = new ChatAnthropic({ ...base }).bindTools([echo]);
  let sawToolChunk = false;
  // 工具参数经 input_json_delta 以字符串片段下发（tool_call_chunks[].args），
  // 与 AIMessageChunk.concat 同款方式按 index 聚合后解析。
  const argsFragments = new Map<number, string>();
  for await (const chunk of await llmTools.stream(
    "必须调用 echo_msg 工具，参数 msg 为字符串 hello-glm-anthropic，不要直接回答。",
  )) {
    if (chunk.tool_call_chunks?.length) {
      sawToolChunk = true;
      for (const tc of chunk.tool_call_chunks) {
        const idx = tc.index ?? 0;
        argsFragments.set(
          idx,
          (argsFragments.get(idx) ?? "") + (tc.args ?? ""),
        );
      }
    }
  }
  const aggregated = [...argsFragments.values()].find(
    (s) => s.trim().length > 0,
  );
  console.log(
    `• 工具调用: tool_call_chunks=${sawToolChunk} 聚合 args=${aggregated ?? "<未聚合出非空 args>"}`,
  );
  if (!sawToolChunk) {
    throw new Error("工具调用断言失败：流内无 tool_call_chunks");
  }
  if (!aggregated || !aggregated.includes("hello-glm-anthropic")) {
    throw new Error(
      `工具调用断言失败：聚合 args 不含预期参数（得到 ${aggregated ?? "空"}）`,
    );
  }

  console.log(
    "✓ glm-anthropic 冒烟全部通过（流式 / thinking 分离 / 工具调用）",
  );
}

main().catch((err: unknown) => {
  console.error("✗ 冒烟失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
