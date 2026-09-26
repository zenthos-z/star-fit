/**
 * A6 翻译 LLM 通道（Anthropic Messages 兼容协议，issue #19）。
 *
 * 模型通道说明（环境实测 2026-09-26）：
 *  - 本机无 OPENAI_API_KEY / DEEPSEEK_API_KEY；可用通道 = Anthropic Messages
 *    兼容网关（智谱 open.bigmodel.cn，ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN）
 *  - 默认模型 glm-5.3-flash（带 thinking 块，正文深化翻译质量优先）
 *  - 覆盖顺序：TRANSLATE_BASE_URL / TRANSLATE_API_KEY / TRANSLATE_MODEL
 *    > ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN > 上述默认值
 *
 * 校验回路（CLAUDE.md 红线）：响应文本一律 parseJSONSafe + 调用方 Zod schema，
 * 失败即抛（重试后仍失败则整批中止，不静默跳过）。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { parseJSONSafe } from "../../../../shared/dist/contracts/index.js";

export interface LlmChannel {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 默认模型通道（智谱 glm-5.3-flash，Anthropic Messages 兼容网关） */
export const DEFAULT_TRANSLATE_MODEL = "glm-5.3-flash";
export const DEFAULT_TRANSLATE_BASE_URL =
  "https://open.bigmodel.cn/api/anthropic";

/** 从环境变量解析 LLM 通道；key 缺失即抛（写明通道要求，不让批跑半路才炸） */
export function resolveLlmChannelFromEnv(): LlmChannel {
  const baseUrl =
    process.env.TRANSLATE_BASE_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    DEFAULT_TRANSLATE_BASE_URL;
  const apiKey =
    process.env.TRANSLATE_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  const model = process.env.TRANSLATE_MODEL || DEFAULT_TRANSLATE_MODEL;
  if (!apiKey) {
    throw new Error(
      "缺少 LLM 通道 key：请设置 TRANSLATE_API_KEY（或 ANTHROPIC_AUTH_TOKEN）。" +
        `当前通道 ${baseUrl}，模型 ${model}（Anthropic Messages 兼容协议）`,
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

interface MessagesApiResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** 限流友好退避（bigmodel 1302 RPM 限流实测 2026-09-26：并发 8 持续 429，
 *  3 次短退避全部耗尽；改长退避 + 抖动，避免多 worker 同拍重试共振） */
const RETRY_DELAYS_MS = [15_000, 60_000, 180_000];
const REQUEST_TIMEOUT_MS = 300_000;

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
  let response: Response;
  try {
    response = await fetch(`${channel.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": channel.apiKey,
        authorization: `Bearer ${channel.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: channel.model,
        max_tokens: 16_384,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });
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

  const data = (await response.json()) as MessagesApiResponse;
  const text = (data.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();
  if (text === "") {
    throw new Error(`${label} LLM 返回空文本`);
  }
  return {
    text,
    usage: {
      in: data.usage?.input_tokens ?? 0,
      out: data.usage?.output_tokens ?? 0,
    },
  };
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
