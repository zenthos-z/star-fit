#!/usr/bin/env node
/**
 * repro-chunk-loss.mjs — ChatMessageChunk 丢 tool_calls 的确定性复现（refs #110）
 *
 * 背景：GLM OpenAI 兼容端点偶发整轮流式 delta 全程不带 role 字段。
 * @langchain/openai 的 convertCompletionsDeltaToBaseMessageChunk 对
 * role 缺省的 delta 走 else 分支 → new ChatMessageChunk({content, role,
 * response_metadata})，构造器不接收 additional_kwargs → delta.tool_calls
 * 增量在 chunk 转换层被静默丢弃。聚合产物 = ChatMessageChunk(content='',
 * 无 tool_calls)，LangGraph 视为合法终步 → 整轮空输出。
 *
 * 本脚本不走真模型（线上偶发不可复现），而是在本地起一个 OpenAI 兼容
 * SSE mock 服务，把两种形态的异常/正常流喂给 ChatOpenAI：
 *
 *   shape=glm-no-role   全程 delta 无 role（PR #110 捕获的异常形态）
 *   shape=openai-normal 首个 delta 带 role=assistant（OpenAI 标准形态，对照组）
 *
 * 每种形态分别验证两条消费路径（均不触网）：
 *   A. .stream() + 逐 chunk concat —— 等价 core stream()/_generate 聚合
 *   B. .invoke() + lc_prefer_streaming 回调 —— 等价 AgentNode 生产路径
 *      （langchain/dist/agents/nodes/AgentNode.js 调 modelWithTools.invoke()，
 *      core chat_models.js generate() 检测到流式回调后桥接 _streamResponseChunks）
 *
 * 用法：
 *   node backend/scripts/repro-chunk-loss.mjs [--label NAME] [--module-root DIR]
 *   npx tsx backend/scripts/repro-chunk-loss.mjs --healing [--label NAME]
 *
 *   --module-root DIR  从 DIR/node_modules/@langchain/openai 解析被测包
 *                      （缺省从脚本自身位置向上解析 = 仓库运行时真源）
 *   --healing          被测模型换 RoleHealingChatOpenAI（#113 根治子类，
 *                      backend/src/services/llmRoleHealing.ts）。须用 tsx 跑
 *                      （TS 源码直载），且不可与 --module-root 组合——healing
 *                      子类 extends 的是仓库解析域的 ChatOpenAI。
 *
 * 输出：每条腿的人类可读结论 + 末行 ##RESULT## JSON（矩阵 runner 采集）。
 * 退出码：仅当对照组（openai-normal）未通过时非零（说明脚手架坏了）；
 * 复现腿（glm-no-role）的 BUG 判定不影响退出码。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const readArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const LABEL = readArg("--label") ?? "default";
const MODULE_ROOT = readArg("--module-root");
const HEALING = argv.includes("--healing");
if (HEALING && MODULE_ROOT) {
  console.error("--healing 不可与 --module-root 组合（healing 子类绑定仓库解析域）。");
  process.exit(2);
}

// 防御：显式关闭 LangSmith 追踪，保证零外网副作用
delete process.env.LANGCHAIN_TRACING_V2;
delete process.env.LANGSMITH_TRACING;

// ---------------------------------------------------------------------------
// 解析被测 @langchain/openai（+ 同解析域的 @langchain/core 版本）
// ---------------------------------------------------------------------------
async function loadModuleUnderTest() {
  if (MODULE_ROOT) {
    const entry = path.join(
      MODULE_ROOT,
      "node_modules",
      "@langchain",
      "openai",
      "dist",
      "index.js",
    );
    const req = createRequire(path.join(MODULE_ROOT, "node_modules", "x.js"));
    const coreMessages = pathToFileURL(
      req.resolve("@langchain/core/messages"),
    ).href;
    return {
      mod: await import(pathToFileURL(entry).href),
      messages: await import(coreMessages),
      openaiVersion: readPkg(
        path.join(MODULE_ROOT, "node_modules", "@langchain", "openai", "package.json"),
      ).version,
      coreVersion: readPkg(req.resolve("@langchain/core/package.json")).version,
    };
  }
  const req = createRequire(import.meta.url);
  return {
    mod: await import("@langchain/openai"),
    messages: await import("@langchain/core/messages"),
    openaiVersion: readPkg(req.resolve("@langchain/openai/package.json")).version,
    coreVersion: readPkg(req.resolve("@langchain/core/package.json")).version,
  };
}

function readPkg(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const { mod, messages: messagesMod, openaiVersion, coreVersion } =
  await loadModuleUnderTest();
const { ChatOpenAI } = mod;

// #113 healing 模式：从仓库源码直载 RoleHealingChatOpenAI（须 tsx 运行时）。
// 其内部 extends 的 @langchain/openai 从 backend/src 解析链向上解析到仓库
// 根 node_modules——与缺省 loadModuleUnderTest 同一实例域，instanceof 稳定。
let RoleHealingChatOpenAI = null;
if (HEALING) {
  ({ RoleHealingChatOpenAI } = await import("../src/services/llmRoleHealing.ts"));
}

// ---------------------------------------------------------------------------
// mock OpenAI 兼容 SSE 服务：POST /shape/<shape>/chat/completions
// ---------------------------------------------------------------------------
/** 构造一轮「纯工具调用」流。args 故意切成 4 段模拟真实增量碎片。 */
function buildChunks(shape) {
  const first = {
    tool_calls: [
      {
        index: 0,
        id: "call_repro_001",
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
    id: "chatcmpl-repro001",
    object: "chat.completion.chunk",
    created: 1759500000,
    model: "glm-4.6-repro",
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

function sseBody(shape) {
  return (
    buildChunks(shape)
      .map((payload) => `data: ${JSON.stringify(payload)}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

const server = http.createServer((req, res) => {
  const m = /^\/shape\/([a-z0-9-]+)\/chat\/completions$/.exec(req.url ?? "");
  if (req.method !== "POST" || !m) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  res.end(sseBody(m[1]));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// 观测工具
// ---------------------------------------------------------------------------
const classOf = (o) => o?.constructor?.name ?? String(o);
const describeToolCalls = (msg) => {
  const tc = msg?.tool_calls ?? msg?.additional_kwargs?.tool_calls;
  if (!tc) return { present: false, detail: null };
  const fmtArgs = (a) => (typeof a === "string" ? a : JSON.stringify(a));
  return {
    present: true,
    detail: tc
      .map(
        (c) =>
          `${c.name ?? c.function?.name}(${fmtArgs(c.args ?? c.function?.arguments)})`,
      )
      .join("; "),
  };
};

async function runShape(shape, { HumanMessage }) {
  const ModelClass = HEALING ? RoleHealingChatOpenAI : ChatOpenAI;
  const model = new ModelClass({
    apiKey: "sk-repro-local",
    model: "glm-4.6-repro",
    maxRetries: 0,
    configuration: { baseURL: `${base}/shape/${shape}` },
  });
  const messages = [new HumanMessage("帮我生成一份 4 周计划")];

  // A. stream + concat（等价 _generate 流式分支/core stream 聚合）
  // 注意：stream() 是 async 方法，返回 Promise<IterableReadableStream>，
  // for-await-of 不会自动解包 iterable 表达式，须先 await。
  const chunks = [];
  for await (const c of await model.stream(messages)) chunks.push(c);
  const aggregate = chunks.reduce((acc, c) => acc.concat(c));
  const streamClassSeq = [...new Set(chunks.map(classOf))];

  // B. invoke + 流式回调（等价 AgentNode 生产路径）
  const preferStreaming = {
    lc_prefer_streaming: true,
    handleLLMNewToken: () => {},
  };
  const invoked = await model.invoke(messages, { callbacks: [preferStreaming] });

  const tc = describeToolCalls(aggregate);
  const tcInvoke = describeToolCalls(invoked);
  const verdictFor = (cls, t) =>
    cls === "AIMessageChunk" && t.present ? "PASS" : "BUG";

  return {
    shape,
    chunkClassSeq: streamClassSeq,
    aggregate: {
      class: classOf(aggregate),
      content: aggregate.content,
      toolCalls: tc,
    },
    invoked: {
      class: classOf(invoked),
      content: invoked.content,
      toolCalls: tcInvoke,
    },
    verdict: {
      stream: verdictFor(classOf(aggregate), tc),
      invoke: verdictFor(classOf(invoked), tcInvoke),
    },
  };
}

// ---------------------------------------------------------------------------
// 执行矩阵
// ---------------------------------------------------------------------------
const { HumanMessage } = messagesMod;
const shapes = ["glm-no-role", "openai-normal"];
const legs = {};
for (const shape of shapes) {
  legs[shape] = await runShape(shape, { HumanMessage });
}

server.close();

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------
console.log(`\n[leg: ${LABEL}] @langchain/openai=${openaiVersion}  @langchain/core=${coreVersion}${HEALING ? "  model=RoleHealingChatOpenAI (#113)" : "  model=ChatOpenAI (基线)"}`);
for (const shape of shapes) {
  const r = legs[shape];
  const note =
    shape === "glm-no-role"
      ? "全程 delta 无 role（PR #110 GLM 异常形态）"
      : "首 delta 带 role=assistant（对照组）";
  console.log(`  shape=${shape}  ${note}`);
  console.log(`    stream()  chunk 类序列: ${r.chunkClassSeq.join(" → ")}`);
  console.log(
    `    stream()  聚合体: ${r.aggregate.class} content=${JSON.stringify(r.aggregate.content)} tool_calls=${r.aggregate.toolCalls.present ? `保留 (${r.aggregate.toolCalls.detail})` : "丢失"}`,
  );
  console.log(
    `    invoke()  返回体: ${r.invoked.class} content=${JSON.stringify(r.invoked.content)} tool_calls=${r.invoked.toolCalls.present ? `保留 (${r.invoked.toolCalls.detail})` : "丢失"}`,
  );
  console.log(`    VERDICT: stream=${r.verdict.stream}  invoke=${r.verdict.invoke}`);
}

console.log(
  `##RESULT## ${JSON.stringify({ label: LABEL, openai: openaiVersion, core: coreVersion, legs })}`,
);

const controlsOk = legs["openai-normal"].verdict.stream === "PASS" && legs["openai-normal"].verdict.invoke === "PASS";
if (!controlsOk) {
  console.error("对照组（openai-normal）未通过 —— 复现脚手架异常，不代表上游行为。");
  process.exit(1);
}
process.exit(0);
