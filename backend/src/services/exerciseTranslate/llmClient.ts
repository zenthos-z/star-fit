/**
 * A6 翻译 LLM 通道（Anthropic Messages / OpenAI Chat Completions 双协议，issue #19/#59）。
 *
 * 模型通道说明（环境实测 2026-09-26 / 2026-09-29）：
 *  - 本机无 OPENAI_API_KEY / DEEPSEEK_API_KEY；可用通道 = 智谱 open.bigmodel.cn：
 *    · Anthropic Messages 兼容网关（/api/anthropic，按量计费）
 *    · CodingPlan 套餐路由（/api/coding/paas/v4，套餐计费，仅 OpenAI
 *      Chat Completions 协议——/v1/messages 路径 404 实测）→ 批量作业
 *      成本纪律走本通道（TRANSLATE_BASE_URL 指向 coding 路由即自动切换协议）
 *  - 默认模型 glm-5.3-flash（带 thinking 块，正文深化翻译质量优先；
 *    chat/completions 下思考过程走 reasoning_content，content 即正文）
 *  - 覆盖顺序：TRANSLATE_BASE_URL / TRANSLATE_API_KEY / TRANSLATE_MODEL
 *    > ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN > CodingPlan 默认值
 *  - 协议选择：TRANSLATE_PROTOCOL 显式指定 > 按 baseUrl 自动识别
 *    （含 /coding/ 或 /paas/ 段 → openai，否则 anthropic）
 *
 * 校验回路（CLAUDE.md 红线）：响应文本一律 parseJSONSafe + 调用方 Zod schema，
 * 失败即抛（重试后仍失败则整批中止，不静默跳过）。
 *
 * @version 1.1.0
 * @created 2026-09-26
 */

import { parseJSONSafe } from "../../../../shared/dist/contracts/index.js";

export interface LlmChannel {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** wire 协议：anthropic = /v1/messages；openai = /chat/completions */
  protocol: "anthropic" | "openai";
}

/** 默认模型（智谱 glm-5.3-flash，双协议同名） */
export const DEFAULT_TRANSLATE_MODEL = "glm-5.3-flash";
/** Anthropic Messages 兼容网关（按量计费） */
export const DEFAULT_TRANSLATE_BASE_URL =
  "https://open.bigmodel.cn/api/anthropic";
/** CodingPlan 套餐路由（套餐计费，OpenAI Chat Completions 协议） */
export const DEFAULT_TRANSLATE_OPENAI_BASE_URL =
  "https://open.bigmodel.cn/api/coding/paas/v4";

/** 按 baseUrl 识别 wire 协议（CodingPlan 路由仅支持 chat/completions） */
function detectProtocol(baseUrl: string): "anthropic" | "openai" {
  return /\/(coding|paas)\//.test(baseUrl) || /\/v4$/.test(baseUrl)
    ? "openai"
    : "anthropic";
}

/** 从环境变量解析 LLM 通道；key 缺失即抛（写明通道要求，不让批跑半路才炸） */
export function resolveLlmChannelFromEnv(): LlmChannel {
  const protocolEnv = process.env.TRANSLATE_PROTOCOL?.toLowerCase();
  const explicitBase =
    process.env.TRANSLATE_BASE_URL || process.env.ANTHROPIC_BASE_URL;
  const protocol: "anthropic" | "openai" =
    protocolEnv === "openai" || protocolEnv === "anthropic"
      ? protocolEnv
      : explicitBase
        ? detectProtocol(explicitBase)
        : "openai"; // 无任何覆盖时默认 CodingPlan 套餐通道（成本纪律）
  const baseUrl =
    explicitBase ||
    (protocol === "openai"
      ? DEFAULT_TRANSLATE_OPENAI_BASE_URL
      : DEFAULT_TRANSLATE_BASE_URL);
  const apiKey =
    process.env.TRANSLATE_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const model = process.env.TRANSLATE_MODEL || DEFAULT_TRANSLATE_MODEL;
  if (!apiKey) {
    throw new Error(
      "缺少 LLM 通道 key：请设置 TRANSLATE_API_KEY（或 ANTHROPIC_AUTH_TOKEN）。" +
        `当前通道 ${baseUrl}，模型 ${model}（${
          protocol === "openai"
            ? "OpenAI Chat Completions 协议"
            : "Anthropic Messages 兼容协议"
        }）`,
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model, protocol };
}

interface MessagesApiResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface ChatCompletionsApiResponse {
  choices?: Array<{
    message?: { content?: string | Array<{ text?: string }> };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** 限流友好退避（bigmodel 1302 RPM 限流实测 2026-09-26：并发 8 持续 429，
 *  3 次短退避全部耗尽；改长退避 + 抖动，避免多 worker 同拍重试共振） */
const RETRY_DELAYS_MS = [15_000, 60_000, 180_000];
const REQUEST_TIMEOUT_MS = 300_000;
/** 单次生成上限：glm-5.3-flash 的 thinking 走 reasoning_content 同样消耗
 *  completion 额度，批 5 条深化扩写必须留足余量，防正文 JSON 被截断 */
const MAX_TOKENS = 32_768;

/**
 * 单次 LLM 调用（system + user → 原始文本）。
 * 429/5xx/网络错误按指数退避重试；其余 HTTP 错误直接抛（提示词/鉴权类问题重试无意义）。
 */
export async function callLlmText(
  channel: LlmChannel,
  systemPrompt: string,
  userPrompt: string,
  label: string,
): Promise<{ text: string; usage: { in: number; out: number } }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const base = RETRY_DELAYS_MS[attempt - 1];
      const delay = Math.round(base * (0.75 + Math.random() * 0.5)); // ±25% 抖动
      console.warn(
        `  ⚠ ${label} 第 ${attempt} 次重试（${Math.round(delay / 1000)}s 后）: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
      await sleep(delay);
    }
    try {
      return await requestOnce(channel, systemPrompt, userPrompt, label);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} LLM 调用重试耗尽`);
}

async function requestOnce(
  channel: LlmChannel,
  systemPrompt: string,
  userPrompt: string,
  label: string,
): Promise<{ text: string; usage: { in: number; out: number } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const openai = channel.protocol === "openai";
  let response: Response;
  try {
    response = await fetch(
      openai
        ? `${channel.baseUrl}/chat/completions`
        : `${channel.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(openai
            ? { authorization: `Bearer ${channel.apiKey}` }
            : {
                "x-api-key": channel.apiKey,
                authorization: `Bearer ${channel.apiKey}`,
                "anthropic-version": "2023-06-01",
              }),
        },
        body: JSON.stringify(
          openai
            ? {
                model: channel.model,
                max_tokens: MAX_TOKENS,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
              }
            : {
                model: channel.model,
                max_tokens: MAX_TOKENS,
                system: systemPrompt,
                messages: [{ role: "user", content: userPrompt }],
              },
        ),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `${label} LLM HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const raw = await response.json();
  const text = openai
    ? extractChatCompletionsText(raw as ChatCompletionsApiResponse)
    : extractMessagesText(raw as MessagesApiResponse);
  if (text === "") {
    throw new Error(
      `${label} LLM 返回空文本（thinking 前缀被截断时调大 MAX_TOKENS）`,
    );
  }
  const usageRaw = (raw as { usage?: Record<string, number> }).usage;
  return {
    text,
    usage: openai
      ? {
          in: usageRaw?.prompt_tokens ?? 0,
          out: usageRaw?.completion_tokens ?? 0,
        }
      : {
          in: usageRaw?.input_tokens ?? 0,
          out: usageRaw?.output_tokens ?? 0,
        },
  };
}

/** Anthropic Messages 协议：content blocks 拼接 text 段 */
function extractMessagesText(data: MessagesApiResponse): string {
  return (data.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();
}

/** OpenAI Chat Completions 协议：首 choice 的 message.content（兼容分段数组） */
function extractChatCompletionsText(data: ChatCompletionsApiResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  return (content ?? [])
    .map((seg) => (typeof seg?.text === "string" ? seg.text : ""))
    .join("")
    .trim();
}

/**
 * LLM JSON 调用：文本 → 剥离 markdown 代码栅栏 → parseJSONSafe → Zod 校验。
 * 任一步失败即抛（红线：Zod 验证失败必须抛错，不静默跳过）。
 */
export async function callLlmJson<T>(
  channel: LlmChannel,
  systemPrompt: string,
  userPrompt: string,
  schema: { parse(value: unknown): T },
  label: string,
): Promise<{ value: T; usage: { in: number; out: number } }> {
  const { text, usage } = await callLlmText(
    channel,
    systemPrompt,
    userPrompt,
    label,
  );
  const json = parseJSONSafe<unknown>(
    stripCodeFence(text),
    `${label}:parseJSON`,
  );
  if (json === null) {
    throw new Error(
      `${label} LLM 返回非 JSON 文本（前 200 字: ${text.slice(0, 200)}）`,
    );
  }
  const value = schema.parse(json);
  return { value, usage };
}

/** 剥离 ```json ... ``` / ``` ... ``` 代码栅栏（LLM 常见包裹） */
export function stripCodeFence(text: string): string {
  const fenced = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
  return fenced ? fenced[1] : text;
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  if (error.name === "AbortError") {
    return true;
  } // 超时按可重试处理
  const status = (error as Error & { status?: number }).status;
  return status === undefined || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
