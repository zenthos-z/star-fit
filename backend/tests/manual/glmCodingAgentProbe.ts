/**
 * B4 bug B 复现探针（issue #35）：GLM coding 端点 + deepagents 多轮工具任务
 * 报 "[Invalid response from wrapModelCall in middleware stripImageForTextModel:
 * expected AIMessage or Command got object]" 的库级复现（不起服务/不连 DB）。
 *
 * 三段：
 *  A) 直接 invoke + bindTools 单轮 —— 确认基础链路
 *  B) createDeepAgent + stripImage 同款中间件 + 多轮工具任务（stream）
 *  C) 中间件里记录 handler 返回值的真实构造器名 —— 定位“plain object”来源
 *
 * 运行（backend 目录）：
 *   GLM_API_KEY=xxx npx tsx tests/manual/glmCodingAgentProbe.ts
 * 未设 GLM_API_KEY 时回退 ANTHROPIC_AUTH_TOKEN。key 绝不打印/落盘。
 *
 * @version 1.0.0
 * @created 2026-09-27
 */
import dotenv from "dotenv";
import path from "node:path";
import process from "node:process";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { createDeepAgent } from "deepagents";
import { z } from "zod";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env.local") });
dotenv.config({
  path: path.resolve(import.meta.dirname, "../../.env"),
  override: false,
});

const CODING_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";

function resolveChannel(): { apiKey: string; baseURL: string; model: string } {
  const apiKey =
    process.env.GLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const baseURL = (process.env.GLM_BASE_URL || CODING_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const model = process.env.GLM_MODEL || "glm-5.3-flash";
  if (!apiKey) {
    console.error(
      "✗ 缺少 key：请设置 GLM_API_KEY（或 ANTHROPIC_AUTH_TOKEN）。",
    );
    process.exit(2);
  }
  return { apiKey, baseURL, model };
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t !== "object") return t;
  const proto = Object.getPrototypeOf(v);
  return proto?.constructor?.name ?? "Object(无原型)";
}

const echoTool = new DynamicStructuredTool({
  name: "echo_msg",
  description: "原样回显一条消息",
  schema: z.object({ msg: z.string().describe("要回显的消息") }),
  func: async ({ msg }) => `echo:${msg}`,
});

const addTool = new DynamicStructuredTool({
  name: "add_nums",
  description: "两数相加并返回结果",
  schema: z.object({
    x: z.number().describe("加数1"),
    y: z.number().describe("加数2"),
  }),
  func: async ({ x, y }) => `sum=${x + y}`,
});

/** stripImageMiddleware 同款（DeepAgentService.ts:1117），附返回值类型记录。 */
const seenHandlerReturns: string[] = [];
const probeMiddleware = createMiddleware({
  name: "stripImageForTextModel",
  wrapModelCall: async (request, handler) => {
    const { messages } = request;
    let touched = false;
    const cleaned = messages.map((msg) => {
      const content = (msg as { content?: unknown }).content;
      if (!Array.isArray(content)) return msg;
      const hasImage = content.some(
        (part) => (part as { type?: string })?.type === "image_url",
      );
      if (!hasImage) return msg;
      touched = true;
      const textParts = content
        .filter((part) => (part as { type?: string })?.type === "text")
        .map((part) => (part as { text?: string }).text ?? "");
      return new HumanMessage({
        content: textParts.join("\n") + "\n（占位）",
        additional_kwargs: (
          msg as { additional_kwargs?: Record<string, unknown> }
        ).additional_kwargs,
      });
    });
    const result = touched
      ? await handler({ ...request, messages: cleaned })
      : await handler(request);
    seenHandlerReturns.push(describeReturn(result));
    return result;
  },
});

const TASK =
  "这是一道需要推理的协调任务：请先在心中认真思考并规划步骤（不要跳步），然后严格按顺序完成：" +
  "1) 调用 echo_msg 工具，参数 msg 为字符串 round-one；" +
  "2) 调用 add_nums 工具，参数 x=19, y=23，并思考 19+23 是否等于 42；" +
  "3) 全部工具返回后，用一句中文汇报两个工具的结果，并解释你对 19+23 的推理过程。";

/** 记录 handler 返回值是否带 reasoning_content（GLM coding 端点思考链字段）。 */
function describeReturn(result: unknown): string {
  const name = typeName(result);
  const r = result as { additional_kwargs?: Record<string, unknown> } | null;
  const rc = r?.additional_kwargs?.reasoning_content;
  const hasRc = typeof rc === "string" && rc.length > 0;
  return hasRc ? `${name}(+rc:${rc.length})` : name;
}

async function main(): Promise<void> {
  const { apiKey, baseURL, model } = resolveChannel();
  console.log(`• 通道: ${baseURL}  模型: ${model}  key: <env，不回显>`);

  const base = {
    model,
    apiKey,
    configuration: { baseURL },
    temperature: 1.0,
    maxTokens: 16384,
  } as const;

  // ---- A) 单轮：直接 invoke + bindTools ----
  const llm = new ChatOpenAI({ ...base });
  const bound = llm.bindTools([echoTool, addTool]);
  const single = await bound.invoke([
    {
      role: "user",
      content: "调用 echo_msg，msg 为字符串 direct-check，不要直接回答。",
    },
  ]);
  console.log(
    `• A) invoke 返回类型: ${typeName(single)}  tool_calls=${single.tool_calls?.length ?? 0}`,
  );

  // ---- B) 多轮：createDeepAgent + stream ----
  const agent = createDeepAgent({
    model: new ChatOpenAI({ ...base }),
    tools: [echoTool, addTool],
    systemPrompt: "你是测试探针助手。必须按用户指令依次调用工具。",
    middleware: [probeMiddleware],
    responseFormat: undefined,
    name: "probe-agent",
  });

  let errorSeen: unknown = null;
  let stepCount = 0;
  try {
    const stream = await agent.stream(
      { messages: [{ role: "user", content: TASK }] },
      { configurable: { thread_id: "glm-coding-probe-1" } },
    );
    for await (const chunk of stream) {
      stepCount += 1;
      const keys = Object.keys(chunk ?? {});
      if (stepCount <= 3 || errorSeen) {
        console.log(`  · chunk#${stepCount} keys=${keys.join(",")}`);
      }
    }
  } catch (err) {
    errorSeen = err;
  }

  console.log(
    `• B) 流 chunks=${stepCount}  handler返回类型序列=[${seenHandlerReturns.join(" → ")}]`,
  );
  if (errorSeen) {
    const e = errorSeen as Error & { name?: string; cause?: unknown };
    console.log(`✗ B 阶段失败: ${e.name ?? ""} ${e.message}`);
    let cause = e.cause;
    let depth = 0;
    while (cause && depth < 4) {
      const c = cause as Error;
      console.log(`  ↳ cause[${depth}]: ${c.name ?? ""} ${c.message}`);
      cause = (c as { cause?: unknown }).cause;
      depth += 1;
    }
    process.exit(1);
  }
  console.log("✓ glm coding 端点多轮工具任务通过（无 wrapModelCall 报错）");
}

main().catch((err: unknown) => {
  console.error(
    "✗ 探针异常:",
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
