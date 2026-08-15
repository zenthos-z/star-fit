import { getProviderForTask } from "./modelRouter.js";
import { ProxyAgent } from "undici";
import { ConfigRepo } from "./knowledgeRepo.js";
// L004: provider set + DeepSeek resolution owned by modelConfigService (single source).
import {
  resolveDeepSeekModel,
  resolveDefaultedProvider,
  resolveTaskConfig,
  isKnownProvider,
  UnknownProviderError,
  MissingApiKeyError,
  getApiKey as resolveApiKey,
} from "./modelConfigService.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Scenario identifies a usage context (maps to the existing task taxonomy).
export type Scenario = "default" | "chat" | "plan" | "tutorial" | "image" | (string & {});

// Default DeepSeek chat model (flash tier). Mirrors
// modelConfigService.DEFAULT_DEEPSEEK_FLASH (single source of truth via ConfigRepo
// key DEEPSEEK_MODEL_FLASH, L004). Used as a defensive default for the deepseek
// branch when no override is configured.
const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";

// LLM 超时配置（统一管理）
const LLM_TIMEOUT_CONFIG = {
  HEADERS_TIMEOUT: 150000,    // undici headers 超时（大于应用层）
  BODY_TIMEOUT: 150000,       // undici body 超时
  CONNECT_TIMEOUT: 30000,     // 连接建立超时
  APPLICATION_TIMEOUT: 120000  // 应用层 AbortController 超时 (120秒 = 2分钟，适合复杂计划生成)
} as const;

async function getProxyUrl(provider: string): Promise<string> {
  const specificKey = provider.toUpperCase() === 'OPENAI' ? 'OPENAI_PROXY' : 'GEMINI_PROXY';
  const dbSpecific = await ConfigRepo.getConfig('system', specificKey);
  if (dbSpecific) return dbSpecific;

  const dbGlobal = await ConfigRepo.getConfig('system', 'GLOBAL_PROXY');
  if (dbGlobal) return dbGlobal;

  const envSpecific = provider.toUpperCase() === 'OPENAI' ? process.env.OPENAI_PROXY : process.env.GEMINI_PROXY;
  return envSpecific || process.env.GLOBAL_PROXY || "";
}

/**
 * 创建带超时配置的 ProxyAgent Dispatcher
 * 确保 undici 底层超时大于应用层超时，避免 HeadersTimeoutError
 */
function createDispatcher(proxyUrl: string): InstanceType<typeof ProxyAgent> | undefined {
  if (!proxyUrl) return undefined;

  // undici ProxyAgent takes a single options arg (string | ProxyAgentOptions),
  // not (url, options). Pass uri + timeouts together.
  return new ProxyAgent({
    uri: proxyUrl,
    headersTimeout: LLM_TIMEOUT_CONFIG.HEADERS_TIMEOUT,
    bodyTimeout: LLM_TIMEOUT_CONFIG.BODY_TIMEOUT,
    connectTimeout: LLM_TIMEOUT_CONFIG.CONNECT_TIMEOUT
  });
}

async function fetchWithRetry(url: string, options: any, log: any, retries = 3, backoff = 1000): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, options);
      if (r.ok) return r;
      
      // Retry on 503 (Service Unavailable) and 429 (Too Many Requests)
      if (r.status === 503 || r.status === 429) {
        if (i === retries) return r;
        
        const delay = backoff * Math.pow(2, i);
        log.warn({ status: r.status, attempt: i + 1, delay }, "LLM request failed, retrying...");
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return r;
    } catch (e: any) {
      if (i === retries || e.name === 'AbortError') throw e;
      
      const delay = backoff * Math.pow(2, i);
      log.warn({ err: e, attempt: i + 1, delay }, "LLM network error, retrying...");
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Should not be reached");
}

async function getApiKey(provider: string): Promise<string> {
  const keyName = provider.toUpperCase() === 'OPENAI' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY';
  const dbKey = await ConfigRepo.getConfig('system', keyName);
  if (dbKey) return dbKey;
  return process.env[keyName] || "";
}

/**
 * 获取 OpenAI 兼容 API 的 Base URL
 * 支持国产模型（GLM-4.7、Qwen、豆包等）的端点配置
 */
async function getBaseURL(): Promise<string> {
  const dbBaseURL = await ConfigRepo.getConfig('system', 'OPENAI_BASE_URL');
  if (dbBaseURL) return dbBaseURL;
  return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
}

/**
 * Load a langchain BaseChatModel for a scenario.
 *
 * Default provider is DeepSeek (model "deepseek-v4-flash", flash tier); gemini
 * and openai are honored when configured via DB/env (P009: their defaults are
 * unchanged). thinking is off by default.
 * B1: default resolves to deepseek-v4-flash.
 * B6 (P012): unknown provider / missing API key fail explicitly (no silent
 * gemini fallback).
 */
export async function loadModel(scenario: Scenario = "default"): Promise<BaseChatModel> {
  const provider = await resolveDefaultedProvider(scenario);

  // B6 (P012): unknown provider must fail explicitly, not silently fall back.
  if (!isKnownProvider(provider)) {
    throw new UnknownProviderError(provider);
  }

  if (provider === "deepseek") {
    const resolved = await resolveDeepSeekModel("flash");
    const apiKey = await resolveApiKey("deepseek");
    if (!apiKey) {
      throw new MissingApiKeyError("deepseek");
    }
    const { ChatOpenAI } = await import("@langchain/openai");
    // V4 默认开 thinking，思考模式下 tool_choice 的 function arguments 会被
    // 截断/损坏（实测 deepseek-v4-flash @ api.deepseek.com：thinking 开 →
    // '{"city": "Beijing</"'，关 → 干净 '{"city": "Beijing"}'）。Agent 依赖可靠
    // 工具调用，故强制关思考（modelKwargs 映射到请求体顶层，即 DeepSeek 的
    // thinking:{type:'disabled'}；见 ../memory gemini-gym-backend-real-run V4 约束）。
    return new ChatOpenAI({
      model: resolved.model || DEEPSEEK_DEFAULT_MODEL,
      apiKey,
      configuration: { baseURL: resolved.baseURL },
      temperature: 1.0,
      modelKwargs: { thinking: { type: "disabled" } },
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

export async function generateTextUnified(input: string, log: any, task: string = "chat", systemPrompt?: string): Promise<string> {
  const { provider, model } = await getProviderForTask(task);
  const providerTrim = String(provider || "").trim();
  const modelTrim = String(model || "").trim();
  let endpoint = "";
  let proxy = "";
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_CONFIG.APPLICATION_TIMEOUT);

  try {
    if (providerTrim === "openai") {
      const key = await getApiKey('openai');
      if (!key) {
        const e: any = new Error("OPENAI_API_KEY missing");
        e.provider = providerTrim;
        e.model = modelTrim;
        e.task = task;
        throw e;
      }
      const proxyUrl = (await getProxyUrl('openai')).trim();
      const dispatcher = createDispatcher(proxyUrl);
      proxy = proxyUrl;
      const baseURL = await getBaseURL();
      endpoint = baseURL + "/chat/completions";

      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: input });

      const r = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelTrim,
          messages,
        }),
        dispatcher,
        signal: controller.signal
      }, log);
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
      return String(j?.choices?.[0]?.message?.content || "").trim() || "抱歉，当前无法生成回复，请稍后再试。";
    } else if (providerTrim === "deepseek") {
      const key = await resolveApiKey('deepseek');
      if (!key) {
        throw new MissingApiKeyError('deepseek');
      }
      const proxyUrl = (await getProxyUrl('deepseek')).trim();
      const dispatcher = createDispatcher(proxyUrl);
      proxy = proxyUrl;
      // DeepSeek is OpenAI-compatible. Default model deepseek-v4-flash (flash tier).
      const ds = await resolveDeepSeekModel('flash');
      const baseURL = ds.baseURL;
      endpoint = baseURL + "/chat/completions";

      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: input });

      const r = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: ds.model || DEEPSEEK_DEFAULT_MODEL,
          messages,
        }),
        dispatcher,
        signal: controller.signal
      }, log);
      clearTimeout(timeoutId);
      if (!r.ok) {
        const errBody = await r.text();
        const e = new Error(`deepseek_http_${r.status}`) as Error & Record<string, unknown>;
        e.status = r.status;
        e.body = errBody;
        e.provider = providerTrim;
        e.model = ds.model;
        e.task = task;
        e.endpoint = endpoint;
        e.proxy = proxy;
        throw e;
      }
      const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return String(j?.choices?.[0]?.message?.content || "").trim() || "抱歉，当前无法生成回复，请稍后再试。";
    } else {
      const apiKey = await getApiKey('gemini');
      if (!apiKey) {
        const e: any = new Error("GOOGLE_API_KEY missing");
        e.provider = providerTrim;
        e.model = modelTrim;
        e.task = task;
        throw e;
      }
      const proxyUrl = (await getProxyUrl('gemini')).trim();
      const dispatcher = createDispatcher(proxyUrl);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelTrim)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      proxy = proxyUrl;
      endpoint = url;
      
      const contents = [{ role: "user", parts: [{ text: systemPrompt ? `${systemPrompt}\n\nUser Input: ${input}` : input }]}]
      
      const r = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
        dispatcher,
        signal: controller.signal
      }, log);
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
        const e: any = new Error(`gemini_api_error: ${j.error.message || j.error.status}`);
        e.details = j.error;
        e.provider = providerTrim;
        e.model = modelTrim;
        throw e;
      }

      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      return String(text || "").trim() || "抱歉，当前无法生成回复，请稍后再试。";
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      log.error({
        provider: providerTrim,
        model: modelTrim,
        task,
        proxy,
        timeout: LLM_TIMEOUT_CONFIG.APPLICATION_TIMEOUT
      }, "LLM request timed out");
      throw new Error("AI 服务响应超时，请检查网络或重试。");
    }
    // 捕获 HeadersTimeoutError / BodyTimeoutError
    if (err.code === 'UND_ERR_HEADERS_TIMEOUT' || err.code === 'UND_ERR_BODY_TIMEOUT') {
      log.error({
        provider: providerTrim,
        model: modelTrim,
        task,
        proxy,
        errCode: err.code
      }, "LLM undici timeout error");
      throw new Error("AI 服务连接超时，请检查代理配置或稍后重试。");
    }
    log.error({ err, provider: providerTrim, model: modelTrim, task, endpoint, proxy }, "Unified generation error");
    throw err;
  }
}
