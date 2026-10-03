#!/usr/bin/env node
/**
 * probe-finish-reason.mjs — finish_reason 在聚合消息上的落点探针（refs #112）
 *
 * 问题：frameworkTrimMiddleware 的空终步检测需要「finish_reason ===
 * "tool_calls"」信号。SSE 终包的 finish_reason 只进入 ChatGenerationChunk
 * 的 generationInfo；本探针验证 AgentNode 生产路径（invoke + lc_prefer_streaming
 * 桥接 _streamResponseChunks 聚合）返回的消息上它是否可见。
 *
 * 方法（与 repro-chunk-loss.mjs 同款，不起真模型）：本地 OpenAI 兼容 SSE
 * mock，glm-no-role / openai-normal 双形态，走 invoke + 流式回调路径，
 * dump 聚合体的 response_metadata / additional_kwargs / usage_metadata。
 *
 * 实测结论（2026-10-03，仓库运行时 @langchain/openai 1.5.13）：
 * 两种形态的聚合消息 response_metadata 均只有
 * {"model_provider":"openai","usage":{}} —— finish_reason 在该层不可达
 * （core chat_models.js 的 hasStreamingHandler 桥接分支不把 generationInfo
 * 合并进 message.response_metadata，与 _generate 直连分支不同）。因此
 * #112 的检测谓词采用「聚合体为 ChatMessageChunk」作为 provider 异常流
 * （全程无 role）的等价签名，见 DeepAgentService.ts 中间件注释。
 *
 * 用法：node backend/scripts/probe-finish-reason.mjs
 */
import http from "node:http";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

// 防御：显式关闭 LangSmith 追踪，保证零外网副作用
delete process.env.LANGCHAIN_TRACING_V2;
delete process.env.LANGSMITH_TRACING;

function buildChunks(shape) {
  const first = {
    tool_calls: [
      {
        index: 0,
        id: "call_probe_001",
        type: "function",
        function: { name: "plan_generate", arguments: "" },
      },
    ],
  };
  if (shape === "openai-normal") first.role = "assistant"; // 对照组仅此一处差异
  const argFrags = ['{"plan_', 'id":"p-001",', '"weeks":4}'];
  const chunks = [first];
  for (const frag of argFrags) {
    chunks.push({
      tool_calls: [{ index: 0, function: { arguments: frag } }],
    });
  }
  chunks.push({}); // 终包：空 delta + finish_reason
  return chunks.map((delta, i, arr) => ({
    id: "chatcmpl-probe001",
    object: "chat.completion.chunk",
    created: 1759500000,
    model: "glm-4.6-probe",
    choices: [
      {
        index: 0,
        delta,
        logprobs: null,
        finish_reason: i === arr.length - 1 ? "tool_calls" : null,
      },
    ],
  }));
}

const server = http.createServer((req, res) => {
  const m = /\/shape\/([a-z0-9-]+)\/chat\/completions$/.exec(req.url ?? "");
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(
    buildChunks(m?.[1] ?? "glm-no-role")
      .map((p) => `data: ${JSON.stringify(p)}\n\n`)
      .join("") + "data: [DONE]\n\n",
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

for (const shape of ["glm-no-role", "openai-normal"]) {
  const model = new ChatOpenAI({
    apiKey: "sk-probe",
    model: "glm-4.6-probe",
    maxRetries: 0,
    configuration: { baseURL: `${base}/shape/${shape}` },
  });
  const preferStreaming = {
    lc_prefer_streaming: true,
    handleLLMNewToken: () => {},
  };
  const invoked = await model.invoke([new HumanMessage("test")], {
    callbacks: [preferStreaming],
  });
  console.log(`\n=== shape=${shape} class=${invoked.constructor.name} ===`);
  console.log("content:", JSON.stringify(invoked.content));
  console.log("tool_calls:", JSON.stringify(invoked.tool_calls ?? null));
  console.log(
    "additional_kwargs:",
    JSON.stringify(invoked.additional_kwargs ?? {}),
  );
  console.log(
    "response_metadata:",
    JSON.stringify(invoked.response_metadata ?? {}),
  );
  console.log(
    "usage_metadata:",
    JSON.stringify(invoked.usage_metadata ?? null),
  );
}
server.close();
process.exit(0);
