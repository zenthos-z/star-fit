import { ProxyAgent } from "undici";
import { ConfigRepo } from "./knowledgeRepo.js";
// L004: provider set + DeepSeek resolution owned by modelConfigService (single source).
import {
  resolveDeepSeekModel,
  resolveGLMModel,
  resolveDefaultedProvider,
  resolveTaskConfig,
  isKnownProvider,
  UnknownProviderError,
  MissingApiKeyError,
  getApiKey as resolveApiKey,
  DEFAULT_GLM_MODEL,
  DEFAULT_DEEPSEEK_FLASH,
} from "./modelConfigService.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Scenario identifies a usage context (maps to the existing task taxonomy).
export type Scenario =
  "default" | "chat" | "plan" | "tutorial" | "image" | (string & {});

// LLM 超时配置（统一管理）
const LLM_TIMEOUT_CONFIG = {
  HEADERS_TIMEOUT: 150000, // undici headers 超时（大于应用层）
  BODY_TIMEOUT: 150000, // undici body 超时
  CONNECT_TIMEOUT: 30000, // 连接建立超时
  APPLICATION_TIMEOUT: 120000, // 应用层 AbortController 超时 (120秒 = 2分钟，适合复杂计划生成)
} as const;

async function getProxyUrl(provider: string): Promise<string> {
  // glm: no provider-specific proxy key — go straight to GLOBAL_PROXY.
  const upper = provider.toUpperCase();
  if (upper === "GLM") {
    const dbGlobal = await ConfigRepo.getConfig("system", "GLOBAL_PROXY");
    if (dbGlobal) return dbGlobal;
    return process.env.GLOBAL_PROXY || "";
  }

  const specificKey = upper === "OPENAI" ? "OPENAI_PROXY" : "GEMINI_PROXY";
  const dbSpecific = await ConfigRepo.getConfig("system", specificKey);
  if (dbSpecific) return dbSpecific;

  const dbGlobal = await ConfigRepo.getConfig("system", "GLOBAL_PROXY");
  if (dbGlobal) return dbGlobal;

  const envSpecific =
    upper === "OPENAI" ? process.env.OPENAI_PROXY : process.env.GEMINI_PROXY;
  return envSpecific || process.env.GLOBAL_PROXY || "";
}

/**
 * 创建带超时配置的 ProxyAgent Dispatcher
 * 确保 undici 底层超时大于应用层超时，避免 HeadersTimeoutError
 */
function createDispatcher(
  proxyUrl: string,
): InstanceType<typeof ProxyAgent> | undefined {
  if (!proxyUrl) return undefined;

  // undici ProxyAgent takes a single options arg (string | ProxyAgentOptions),
  // not (url, options). Pass uri + timeouts together.
  return new ProxyAgent({
    uri: proxyUrl,
    headersTimeout: LLM_TIMEOUT_CONFIG.HEADERS_TIMEOUT,
    bodyTimeout: LLM_TIMEOUT_CONFIG.BODY_TIMEOUT,
    connectTimeout: LLM_TIMEOUT_CONFIG.CONNECT_TIMEOUT,
  });
}

async function fetchWithRetry(
  url: string,
  options: any,
  log: any,
  retries = 3,
  backoff = 1000,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, options);
      if (r.ok) return r;

      // Retry on 503 (Service Unavailable) and 429 (Too Many Requests)
      if (r.status === 503 || r.status === 429) {
        if (i === retries) return r;

        const delay = backoff * Math.pow(2, i);
        log.warn(
          { status: r.status, attempt: i + 1, delay },
          "LLM request failed, retrying...",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return r;
    } catch (e: any) {
      if (i === retries || e.name === "AbortError") throw e;

      const delay = backoff * Math.pow(2, i);
      log.warn(
        { err: e, attempt: i + 1, delay },
        "LLM network error, retrying...",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Should not be reached");
}

async function getApiKey(provider: string): Promise<string> {
  const keyName =
    provider.toUpperCase() === "OPENAI" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY";
  const dbKey = await ConfigRepo.getConfig("system", keyName);
  if (dbKey) return dbKey;
  return process.env[keyName] || "";
}

/**
 * 获取 OpenAI 兼容 API 的 Base URL
 * 支持国产模型（GLM-4.7、Qwen、豆包等）的端点配置
 */
async function getBaseURL(): Promise<string> {
  const dbBaseURL = await ConfigRepo.getConfig("system", "OPENAI_BASE_URL");
  if (dbBaseURL) return dbBaseURL;
  return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
}

/**
 * Load a langchain BaseChatModel for a scenario.
 *
 * Default provider is GLM (Z.ai, model "glm-5.3-flash", OpenAI-compatible);
 * deepseek / gemini / openai are honored when configured via DB/env. thinking
 * is off by default (glm/openai have no thinking kwargs; deepseek explicitly
 * disables it). Unknown provider / missing API key fail explicitly (no silent
 * fallback).
 */
export async function loadModel(
  scenario: Scenario = "default",
): Promise<BaseChatModel> {
  const provider = await resolveDefaultedProvider(scenario);
  // B6 (P012): unknown provider must fail explicitly, not silently fall back.
  if (!isKnownProvider(provider)) {
    throw new UnknownProviderError(provider);
  }

  if (provider === "glm") {
    const resolved = await resolveGLMModel(scenario);
    const apiKey = await resolveApiKey("glm");
    if (!apiKey) {
      throw new MissingApiKeyError("glm");
    }
    const { ChatOpenAI } = await import("@langchain/openai");
    // Z.ai GLM is OpenAI-compatible. No thinking kwargs (GLM-5.3-flash default
    // behaves fine for tool calls without extra request-body fields).
    return new ChatOpenAI({
      model: resolved.model || DEFAULT_GLM_MODEL,
      apiKey,
      configuration: { baseURL: resolved.baseURL },
      temperature: 1.0,
    });
  }

  if (provider === "deepseek") {
    const resolved = await resolveDeepSeekModel("flash");
    const apiKey = await resolveApiKey("deepseek");
    if (!apiKey) {
      throw new MissingApiKeyError("deepseek");
    }
    // ★ChatDeepSeek（@langchain/deepseek）：thinking 开启时思考链走 API 专属字段
    // reasoning_content（协议级与 content 分离），该封装透传到
    // additional_kwargs.reasoning_content —— DeepAgentService 按字段分流进折叠
    // 思考区，正文零污染。
    // 历史（2026-09 初）：曾用 ChatOpenAI + thinking:{type:'disabled'} 强制关思考，
    // 因当时实测 thinking 开启会截断 tool_calls arguments（'{"city": "Beijing</"'）。
    // 2026-09-16 复测：ChatDeepSeek + thinking 开启，bindTools 工具调用 arguments
    // 完整合法（'{"city":"北京","date":"2025-10-27"}'），老坑未复现——截断疑与
    // ChatOpenAI 的 OpenAI SDK 序列化路径有关，而非 DeepSeek 服务端。
    const { ChatDeepSeek } = await import("@langchain/deepseek");
    return new ChatDeepSeek({
      model: resolved.model || DEFAULT_DEEPSEEK_FLASH,
      apiKey,
      configuration: { baseURL: resolved.baseURL },
      temperature: 1.0,
      // ChatDeepSeek 默认即开启 thinking（deepseek reasoning 模型默认行为），
      // 显式写出以防上游默认变化：
      modelKwargs: { thinking: { type: "enabled" } },
    });
  }

  if (provider === "openai") {
    const cfg = await resolveTaskConfig(scenario);
    const apiKey = await resolveApiKey("openai");
    if (!apiKey) {
      throw new MissingApiKeyError("openai");
    }
    const { ChatOpenAI } = await import("@langchain/openai");
    return new ChatOpenAI({
      model: cfg.model,
      apiKey,
      configuration: { baseURL: cfg.baseURL || "https://api.openai.com/v1" },
      temperature: 1.0,
    });
  }

  // gemini
  const cfg = await resolveTaskConfig(scenario);
  const apiKey = await resolveApiKey("gemini");
  if (!apiKey) {
    throw new MissingApiKeyError("gemini");
  }
  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
  return new ChatGoogleGenerativeAI({
    model: cfg.model,
    apiKey,
    temperature: 1.0,
    maxOutputTokens: 8192,
  });
}

/**
 * loadVisionModel — 多模态（视觉）模型加载，供带图 Agent 轮次使用。
 *
 * 选型：火山 ark 套餐内 doubao-seed-2.1-turbo（实测可看图：BENCH PRESS / 27.5kg /
 * 11次 / 4组 全部准确读出），OpenAI 兼容。配置位 VISION_MODEL / VISION_BASE_URL /
 * VISION_API_KEY（DB > env > 默认复用 DEEPSEEK 的 ark key/baseURL）。与主模型
 * （deepseek 纯文本）并存：带图请求才切视觉模型，无图保持原 provider 不变。
 */
export async function loadVisionModel(): Promise<BaseChatModel> {
  const dbModel = await ConfigRepo.getConfig("system", "VISION_MODEL");
  const model =
    dbModel || process.env.VISION_MODEL || "doubao-seed-2-1-turbo-260628";
  const dbURL = await ConfigRepo.getConfig("system", "VISION_BASE_URL");
  const baseURL =
    dbURL || process.env.VISION_BASE_URL || process.env.DEEPSEEK_BASE_URL || "";
  const dbKey = await ConfigRepo.getConfig("system", "VISION_API_KEY");
  const apiKey =
    dbKey || process.env.VISION_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) {
    throw new MissingApiKeyError("vision");
  }
  const { ChatOpenAI } = await import("@langchain/openai");
  return new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL: baseURL || undefined },
    temperature: 0.5,
  });
}

export async function generateTextUnified(
  input: string,
  log: any,
  task: string = "chat",
  systemPrompt?: string,
): Promise<string> {
  const { provider, model } = await resolveTaskConfig(task);
  const providerTrim = String(provider || "").trim();
  const modelTrim = String(model || "").trim();
  let endpoint = "";
  let proxy = "";

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    LLM_TIMEOUT_CONFIG.APPLICATION_TIMEOUT,
  );

  try {
    if (providerTrim === "openai") {
      const key = await getApiKey("openai");
      if (!key) {
        const e: any = new Error("OPENAI_API_KEY missing");
        e.provider = providerTrim;
        e.model = modelTrim;
        e.task = task;
        throw e;
      }
      const proxyUrl = (await getProxyUrl("openai")).trim();
      const dispatcher = createDispatcher(proxyUrl);
      proxy = proxyUrl;
      const baseURL = await getBaseURL();
      endpoint = baseURL + "/chat/completions";

      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: input });

      const r = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelTrim,
            messages,
          }),
          dispatcher,
          signal: controller.signal,
        },
        log,
      );
      clearTimeout(timeoutId);
      if (!r.ok) {
        const errBody = await r.text();
        const e: any = new Error(`openai_http_${r.status}`);
        e.status = r.status;
        e.body = errBody;
        e.provider = providerTrim;
        e.model = modelTrim;
        e.task = task;
        e.endpoint = endpoint;
        e.proxy = proxy;
        throw e;
      }
      const j: any = await r.json();
      return (
        String(j?.choices?.[0]?.message?.content || "").trim() ||
        "抱歉，当前无法生成回复，请稍后再试。"
      );
    } else if (providerTrim === "deepseek") {
      const key = await resolveApiKey("deepseek");
      if (!key) {
        throw new MissingApiKeyError("deepseek");
      }
      const proxyUrl = (await getProxyUrl("deepseek")).trim();
      const dispatcher = createDispatcher(proxyUrl);
      proxy = proxyUrl;
      // DeepSeek is OpenAI-compatible. Default model deepseek-v4-flash (flash tier).
      const ds = await resolveDeepSeekModel("flash");
      const baseURL = ds.baseURL;
      endpoint = baseURL + "/chat/completions";

      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: input });

      const r = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: ds.model || DEFAULT_DEEPSEEK_FLASH,
            messages,
          }),
          dispatcher,
          signal: controller.signal,
        },
        log,
      );
      clearTimeout(timeoutId);
      if (!r.ok) {
        const errBody = await r.text();
        const e = new Error(`deepseek_http_${r.status}`) as Error &
          Record<string, unknown>;
        e.status = r.status;
        e.body = errBody;
        e.provider = providerTrim;
        e.model = ds.model;
        e.task = task;
        e.endpoint = endpoint;
        e.proxy = proxy;
        throw e;
      }
      const j = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return (
        String(j?.choices?.[0]?.message?.content || "").trim() ||
        "抱歉，当前无法生成回复，请稍后再试。"
      );
    } else if (providerTrim === "glm") {
      const key = await resolveApiKey("glm");
      if (!key) {
        throw new MissingApiKeyError("glm");
      }
      const proxyUrl = (await getProxyUrl("glm")).trim();
      const dispatcher = createDispatcher(proxyUrl);
      proxy = proxyUrl;
      // Z.ai GLM is OpenAI-compatible (chat/completions).
      const glm = await resolveGLMModel(task);
      const baseURL = glm.baseURL;
      endpoint = baseURL.replace(/\/+$/, "") + "/chat/completions";

      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: input });

      const r = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: glm.model || DEFAULT_GLM_MODEL,
            messages,
          }),
          dispatcher,
          signal: controller.signal,
        },
        log,
      );
      clearTimeout(timeoutId);
      if (!r.ok) {
        const errBody = await r.text();
        const e = new Error(`glm_http_${r.status}`) as Error &
          Record<string, unknown>;
        e.status = r.status;
        e.body = errBody;
        e.provider = providerTrim;
        e.model = glm.model;
        e.task = task;
        e.endpoint = endpoint;
        e.proxy = proxy;
        throw e;
      }
      const j = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return (
        String(j?.choices?.[0]?.message?.content || "").trim() ||
        "抱歉，当前无法生成回复，请稍后再试。"
      );
    } else {
      const apiKey = await getApiKey("gemini");
      if (!apiKey) {
        const e: any = new Error("GOOGLE_API_KEY missing");
        e.provider = providerTrim;
        e.model = modelTrim;
        e.task = task;
        throw e;
      }
      const proxyUrl = (await getProxyUrl("gemini")).trim();
      const dispatcher = createDispatcher(proxyUrl);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelTrim)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      proxy = proxyUrl;
      endpoint = url;

      const contents = [
        {
          role: "user",
          parts: [
            {
              text: systemPrompt
                ? `${systemPrompt}\n\nUser Input: ${input}`
                : input,
            },
          ],
        },
      ];

      const r = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents }),
          dispatcher,
          signal: controller.signal,
        },
        log,
      );
      clearTimeout(timeoutId);
      if (!r.ok) {
        const errBody = await r.text();
        const e: any = new Error(`gemini_http_${r.status}`);
        e.status = r.status;
        e.body = errBody;
        e.provider = providerTrim;
        e.model = modelTrim;
        e.task = task;
        e.endpoint = endpoint;
        e.proxy = proxy;
        throw e;
      }
      const j: any = await r.json();

      if (j?.error) {
        const e: any = new Error(
          `gemini_api_error: ${j.error.message || j.error.status}`,
        );
        e.details = j.error;
        e.provider = providerTrim;
        e.model = modelTrim;
        throw e;
      }

      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      return (
        String(text || "").trim() || "抱歉，当前无法生成回复，请稍后再试。"
      );
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      log.error(
        {
          provider: providerTrim,
          model: modelTrim,
          task,
          proxy,
          timeout: LLM_TIMEOUT_CONFIG.APPLICATION_TIMEOUT,
        },
        "LLM request timed out",
      );
      throw new Error("AI 服务响应超时，请检查网络或重试。");
    }
    // 捕获 HeadersTimeoutError / BodyTimeoutError
    if (
      err.code === "UND_ERR_HEADERS_TIMEOUT" ||
      err.code === "UND_ERR_BODY_TIMEOUT"
    ) {
      log.error(
        {
          provider: providerTrim,
          model: modelTrim,
          task,
          proxy,
          errCode: err.code,
        },
        "LLM undici timeout error",
      );
      throw new Error("AI 服务连接超时，请检查代理配置或稍后重试。");
    }
    log.error(
      { err, provider: providerTrim, model: modelTrim, task, endpoint, proxy },
      "Unified generation error",
    );
    throw err;
  }
}
