import { ConfigRepo } from "./knowledgeRepo.js";
import { ProxyAgent, request } from "undici";

// L004: provider set is the single source of truth. DeepSeek added additively
// (P009); GLM (issue #35 / B4) is the default provider family with three
// protocol paths: glm = Coding Plan OpenAI 兼容端点（默认）, glm-anthropic =
// bigmodel Anthropic Messages 协议（B4 备选）, glm-legacy = z.ai OpenAI 兼容
// 端点（旧默认回退）. Gemini remains an ordinary selectable option but is no
// longer the default for anything.
export const KNOWN_PROVIDERS = [
  "gemini",
  "openai",
  "deepseek",
  "glm",
  "glm-anthropic",
  "glm-legacy",
] as const;
export type Provider = (typeof KNOWN_PROVIDERS)[number];

/**
 * Raised when a resolved provider is not in KNOWN_PROVIDERS (P012 vacuity probe).
 * Replaces the previous silent fallback to gemini for unknown provider strings.
 */
export class UnknownProviderError extends Error {
  readonly code = "UNKNOWN_PROVIDER" as const;
  constructor(provider: string) {
    super(
      `Unknown AI provider: "${provider}". Expected one of: ${KNOWN_PROVIDERS.join(", ")}`,
    );
    this.name = "UnknownProviderError";
  }
}

export function isKnownProvider(provider: string): provider is Provider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(provider);
}

/** GLM 家族成员（三种协议路径，共享 GLM_API_KEY 与 GLM_MODEL* 配置层级）。 */
export function isGLMFamilyProvider(provider: string): boolean {
  return (
    provider === "glm" ||
    provider === "glm-anthropic" ||
    provider === "glm-legacy"
  );
}

/** GLM 家族中走 Anthropic Messages 协议的成员（显式 ID，glm 不再是别名）。 */
export function isGLMAnthropicProvider(provider: string): boolean {
  return provider === "glm-anthropic";
}

/**
 * Raised when a provider is selected but its API key is missing (P012 vacuity
 * probe). Replaces silent fallback behavior with an explicit failure code.
 */
export class MissingApiKeyError extends Error {
  readonly code: string;
  constructor(provider: string) {
    const keyName =
      provider === "openai"
        ? "OPENAI_API_KEY"
        : provider === "deepseek"
          ? "DEEPSEEK_API_KEY"
          : isGLMFamilyProvider(provider)
            ? "GLM_API_KEY"
            : "GOOGLE_API_KEY";
    super(`${keyName} missing for provider "${provider}"`);
    this.name = "MissingApiKeyError";
    this.code = `${keyName}_MISSING`;
  }
}

export function assertKnownProvider(
  provider: string,
): asserts provider is Provider {
  if (!isKnownProvider(provider)) {
    throw new UnknownProviderError(provider);
  }
}

/**
 * Read a system config key from ConfigRepo without crashing when the DB is
 * unavailable (e.g. unit tests, transient outage). Returns null so callers can
 * fall through the DB > env > default hierarchy. New DeepSeek code uses this;
 * legacy gemini/openai reads keep their existing direct calls (P009).
 */
export async function safeGetConfig(key: string): Promise<string | null> {
  try {
    const v = await ConfigRepo.getConfig("system", key);
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export interface ModelConfig {
  provider: Provider;
  model: string;
  baseURL?: string; // For OpenAI-compatible endpoints
}

export interface ModelConfigWithSource extends ModelConfig {
  source: "db" | "env" | "default";
}

export interface AllModelConfigs {
  default: ModelConfigWithSource;
  // Image generation is a separate model category
}

// Image generation model configuration (separate from Agent LLM)
export const IMAGE_PROVIDERS = ["dmx", "openai", "gemini"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export interface ImageModelConfig {
  provider: ImageProvider;
  model: string;
  baseURL?: string;
}

export interface ImageModelConfigWithSource extends ImageModelConfig {
  source: "db" | "env" | "default";
}

// Supported model lists
const GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
];

const OPENAI_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
];

// Default configurations
const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// DeepSeek default model (flash tier). The default endpoint below points at the
// Volcano Engine (火山 ark) *coding plan* bundle the deployment actually pays for
// — it serves deepseek models through an OpenAI-compatible API. Official
// DeepSeek API users can override both via env (DEEPSEEK_MODEL_FLASH /
// DEEPSEEK_BASE_URL) or the admin DB config (DB > env > default).
export const DEFAULT_DEEPSEEK_FLASH = "deepseek-v4-flash-ga-260731";
const DEFAULT_DEEPSEEK_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/coding/v3";
const DEEPSEEK_MODELS = [DEFAULT_DEEPSEEK_FLASH, "deepseek-v4-pro"];

// ----------------------------------------------------------------------------
// GLM (智谱) — the default LLM provider family (issue #35 / B4). One key, three
// protocol paths, each with its OWN baseURL key so DB/env overrides never leak
// across paths:
//   glm           → GLM_BASE_URL            默认 Coding Plan OpenAI 兼容端点
//   glm-anthropic → GLM_ANTHROPIC_BASE_URL  bigmodel Anthropic Messages 端点（备选）
//   glm-legacy    → GLM_LEGACY_BASE_URL     z.ai OpenAI 兼容端点（旧默认回退）
// Model ids are shared across the three paths (GLM_MODEL* hierarchy). All
// overridable via env or DB config (DB > env > default).
// ----------------------------------------------------------------------------
export const DEFAULT_GLM_MODEL = "glm-5.3-flash";
/** GLM Coding Plan 官方 OpenAI 兼容端点（带 /coding/，同 key 实测 200）。 */
export const DEFAULT_GLM_BASE_URL =
  "https://open.bigmodel.cn/api/coding/paas/v4";
export const DEFAULT_GLM_ANTHROPIC_BASE_URL =
  "https://open.bigmodel.cn/api/anthropic";
export const DEFAULT_GLM_LEGACY_BASE_URL = "https://api.z.ai/api/paas/v4";
const GLM_MODELS = ["glm-5.3-flash", "glm-4.7", "glm-4.5-air"];

// Default image generation config (DMX API - OpenAI compatible)
const DEFAULT_IMAGE_MODEL = "";
// DMX is the default image-gen provider; its OpenAI-compatible base URL is
// baked in as a default (overridable via IMAGE_GEN_BASE_URL env/DB).
export const DEFAULT_DMX_BASE_URL = "https://www.dmxapi.cn/v1";
const DEFAULT_IMAGE_BASE_URL = "";
const DEFAULT_IMAGE_PROVIDER = "dmx";
const IMAGE_MODELS: Record<string, string[]> = {
  dmx: [],
  openai: ["dall-e-3", "dall-e-2"],
};

export interface DeepSeekModelConfig {
  model: string;
  baseURL: string;
}

export interface GLMModelConfig {
  model: string;
  baseURL: string;
}

/**
 * Resolve the GLM Coding Plan (OpenAI-compat) model config — the DEFAULT path.
 * Hierarchy: DB (ConfigRepo) > env > default. Keys: GLM_MODEL (default
 * "glm-5.3-flash"), GLM_BASE_URL (default the Coding Plan endpoint
 * https://open.bigmodel.cn/api/coding/paas/v4). Served via ChatOpenAI
 * chat/completions.
 */
export async function resolveGLMModel(
  task: string = "default",
): Promise<GLMModelConfig> {
  const taskUpper = task.toUpperCase();

  // DB > env, task-scoped first (GLM_MODEL_<TASK>), then global (GLM_MODEL).
  const taskModelDb = await safeGetConfig(`GLM_MODEL_${taskUpper}`);
  const taskModelEnv = process.env[`GLM_MODEL_${taskUpper}`]?.trim();
  const globalModelDb = await safeGetConfig("GLM_MODEL");
  const globalModelEnv = process.env.GLM_MODEL?.trim();

  const model =
    taskModelDb ||
    taskModelEnv ||
    globalModelDb ||
    globalModelEnv ||
    DEFAULT_GLM_MODEL;

  const baseURL =
    (await safeGetConfig("GLM_BASE_URL")) ||
    process.env.GLM_BASE_URL?.trim() ||
    DEFAULT_GLM_BASE_URL;

  return { model, baseURL };
}

/**
 * Resolve the GLM Anthropic-protocol model config (B4 备选路径). Same model-id
 * hierarchy as resolveGLMModel; only the baseURL key differs
 * (GLM_ANTHROPIC_BASE_URL, default https://open.bigmodel.cn/api/anthropic) so
 * coding-endpoint overrides never leak into the anthropic path.
 */
export async function resolveGLMAnthropicModel(
  task: string = "default",
): Promise<GLMModelConfig> {
  const { model } = await resolveGLMModel(task);
  const baseURL =
    (await safeGetConfig("GLM_ANTHROPIC_BASE_URL")) ||
    process.env.GLM_ANTHROPIC_BASE_URL?.trim() ||
    DEFAULT_GLM_ANTHROPIC_BASE_URL;
  return { model, baseURL };
}

/**
 * Resolve the GLM legacy (z.ai OpenAI-compat) model config — the old default
 * endpoint kept as a fallback. Model ids shared with the coding path; baseURL
 * key GLM_LEGACY_BASE_URL (default https://api.z.ai/api/paas/v4), isolated
 * from the coding/anthropic keys.
 */
export async function resolveGLMLegacyModel(
  task: string = "default",
): Promise<GLMModelConfig> {
  const { model } = await resolveGLMModel(task);
  const baseURL =
    (await safeGetConfig("GLM_LEGACY_BASE_URL")) ||
    process.env.GLM_LEGACY_BASE_URL?.trim() ||
    DEFAULT_GLM_LEGACY_BASE_URL;
  return { model, baseURL };
}

/**
 * Resolve the DeepSeek model for a tier. Hierarchy: DB (ConfigRepo) > env > default.
 * - flash (default tier): DEEPSEEK_MODEL_FLASH, default "deepseek-v4-flash"
 * - pro: DEEPSEEK_MODEL_PRO; if unset, falls back to the flash default so the
 *   pro tier is never silently bound to an expensive model.
 * thinking 不在此解析（#162：旧的常量 false 字段退役——它宣称"默认关思考"
 * 而 llm.ts deepseek 分支实际硬编码 enabled，正是断链病灶）；场景思考开关
 * 真源 = resolveThinkingConfig，由 loadModel 消费。
 */
export async function resolveDeepSeekModel(
  tier: "flash" | "pro" = "flash",
): Promise<DeepSeekModelConfig> {
  const modelKey =
    tier === "pro" ? "DEEPSEEK_MODEL_PRO" : "DEEPSEEK_MODEL_FLASH";

  const dbModel = await safeGetConfig(modelKey);
  const envModel = process.env[modelKey]?.trim();

  // pro without explicit config -> safe flash default (never bind to expensive pro)
  const model = dbModel || envModel || DEFAULT_DEEPSEEK_FLASH;

  const baseURL =
    (await safeGetConfig("DEEPSEEK_BASE_URL")) ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    DEFAULT_DEEPSEEK_BASE_URL;

  return { model, baseURL };
}

// ----------------------------------------------------------------------------
// Thinking 开关解析（#162 接通）——
// 配置层此前宣称"已关思考"但加载层从不消费，唯一生效开关是 llm.ts 硬编码
// 的场景集。本节把场景集降级为解析链的「场景默认层」，DB/env 配置自此真正
// 生效；默认值逐字保留（chat/plan 继续带思考，workout_complete 继续关）。
// ----------------------------------------------------------------------------

/**
 * [B5b SSE ③ / issue #38 → #162 收编] 快车道场景集：这些场景默认关闭思考
 * （thinking: disabled）缩短轮次时长。MVP 场景级开关——workout_complete
 * 汇报/数据写入类轮次不需要长思考链（实测 GLM 深思考轮 5-6 分钟，iOS
 * WKWebView 空闲连接被系统掐断的主因之一）。
 */
export const THINKING_DISABLED_SCENARIOS: ReadonlySet<string> = new Set([
  "workout_complete",
]);

/** thinking 解析结果。thinking=true 表示该场景带思考链。 */
export interface ThinkingConfig {
  thinking: boolean;
  source: "db" | "env" | "scenario-default" | "default";
}

/**
 * "true"/"false"（trim + 大小写不敏感）→ 布尔；其余值视为未配置（落到
 * 下一层，配置手误不至于把开关拍死在错误档位）。
 */
function parseDisabledFlag(raw: string | null | undefined): boolean | null {
  const v = raw?.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/**
 * Resolve the thinking switch for a scenario（#162）。
 * 优先级链（每档 DB > env）：
 *   1. THINKING_DISABLED_<TASK>（任务域）
 *   2. THINKING_DISABLED（全局）
 *   3. 场景默认层：THINKING_DISABLED_SCENARIOS（现仅 workout_complete）
 *   4. 现状行为：thinking 开（glm 不带 disabled kwargs，deepseek enabled）
 * 消费点：llm.ts loadModel 的 glm / glm-legacy / deepseek 分支。
 */
export async function resolveThinkingConfig(
  scenario: string = "default",
): Promise<ThinkingConfig> {
  const taskUpper = scenario.toUpperCase();

  const taskDb = parseDisabledFlag(
    await safeGetConfig(`THINKING_DISABLED_${taskUpper}`),
  );
  if (taskDb !== null) return { thinking: !taskDb, source: "db" };
  const taskEnv = parseDisabledFlag(
    process.env[`THINKING_DISABLED_${taskUpper}`],
  );
  if (taskEnv !== null) return { thinking: !taskEnv, source: "env" };

  const globalDb = parseDisabledFlag(await safeGetConfig("THINKING_DISABLED"));
  if (globalDb !== null) return { thinking: !globalDb, source: "db" };
  const globalEnv = parseDisabledFlag(process.env.THINKING_DISABLED);
  if (globalEnv !== null) return { thinking: !globalEnv, source: "env" };

  if (THINKING_DISABLED_SCENARIOS.has(scenario)) {
    return { thinking: false, source: "scenario-default" };
  }
  return { thinking: true, source: "default" };
}

// ----------------------------------------------------------------------------
// Vision（多模态）模型配置（#162 收编真源）——
// 解析链自 llm.ts loadVisionModel 原位收编，行为逐字对齐（含借用
// DEEPSEEK ark key/baseURL 的兜底）；llm.ts 不再自带硬编码默认模型串，
// 唯一默认值落点 = 本节。
// ----------------------------------------------------------------------------

/** 火山 ark 套餐内 doubao 视觉模型默认 id（日期快照版，会退役——届时改此处或经 VISION_MODEL 覆盖）。 */
export const DEFAULT_VISION_MODEL = "doubao-seed-2-1-turbo-260628";

export interface VisionModelConfig {
  model: string;
  baseURL: string;
  apiKey: string;
  source: "db" | "env" | "default";
}

/**
 * Resolve the vision (multimodal) model config. Hierarchy per field
 * (DB > env > default，与收编前 llm.ts 行为一致）：
 *   model:   VISION_MODEL(db) > VISION_MODEL(env) > DEFAULT_VISION_MODEL
 *   baseURL: VISION_BASE_URL(db) > VISION_BASE_URL(env) > DEEPSEEK_BASE_URL(env) > ""
 *   apiKey:  VISION_API_KEY(db)  > VISION_API_KEY(env)  > DEEPSEEK_API_KEY(env)  > ""
 * 与旧实现的唯一差异：DB 读取走 safeGetConfig（库不可用时落到 env 层而非
 * 抛错），与 GLM/DeepSeek 链路对齐。apiKey 为空由消费方（loadVisionModel）
 * 抛 MissingApiKeyError("vision")。
 */
export async function resolveVisionModelConfig(): Promise<VisionModelConfig> {
  // model
  const modelDb = await safeGetConfig("VISION_MODEL");
  const modelEnv = process.env.VISION_MODEL?.trim();
  let model: string;
  let modelSource: "db" | "env" | "default" = "default";
  if (modelDb) {
    model = modelDb;
    modelSource = "db";
  } else if (modelEnv) {
    model = modelEnv;
    modelSource = "env";
  } else {
    model = DEFAULT_VISION_MODEL;
  }

  // baseURL（含 ark 借用兜底：env DEEPSEEK_BASE_URL，不读 DB 侧——保持收编前行为）
  const baseURLDb = await safeGetConfig("VISION_BASE_URL");
  const baseURLEnv = process.env.VISION_BASE_URL?.trim();
  const baseURLArk = process.env.DEEPSEEK_BASE_URL?.trim();
  let baseURL: string;
  let baseURLSource: "db" | "env" | "default" = "default";
  if (baseURLDb) {
    baseURL = baseURLDb;
    baseURLSource = "db";
  } else if (baseURLEnv) {
    baseURL = baseURLEnv;
    baseURLSource = "env";
  } else if (baseURLArk) {
    baseURL = baseURLArk;
    baseURLSource = "env";
  } else {
    baseURL = "";
  }

  // apiKey（同构借用链：env DEEPSEEK_API_KEY 兜底）
  const apiKeyDb = await safeGetConfig("VISION_API_KEY");
  const apiKeyEnv = process.env.VISION_API_KEY?.trim();
  const apiKeyArk = process.env.DEEPSEEK_API_KEY?.trim();
  let apiKey: string;
  let apiKeySource: "db" | "env" | "default" = "default";
  if (apiKeyDb) {
    apiKey = apiKeyDb;
    apiKeySource = "db";
  } else if (apiKeyEnv) {
    apiKey = apiKeyEnv;
    apiKeySource = "env";
  } else if (apiKeyArk) {
    apiKey = apiKeyArk;
    apiKeySource = "env";
  } else {
    apiKey = "";
  }

  const sourcePriority = ["db", "env", "default"];
  const finalSource = sourcePriority[
    Math.min(
      sourcePriority.indexOf(modelSource),
      sourcePriority.indexOf(baseURLSource),
      sourcePriority.indexOf(apiKeySource),
    )
  ] as "db" | "env" | "default";

  return { model, baseURL, apiKey, source: finalSource };
}

/**
 * Resolve the effective provider for a scenario. GLM is the final fallback
 * (single source of truth with resolveTaskConfig / getProxyConfig).
 */
export async function resolveDefaultedProvider(
  scenario: string = "default",
): Promise<string> {
  const taskUpper = scenario.toUpperCase();
  const dbTask = await safeGetConfig(`AI_PROVIDER_${taskUpper}`);
  if (dbTask) {
    return dbTask.trim();
  }
  const envTask = process.env[`AI_PROVIDER_${taskUpper}`]?.trim();
  if (envTask) {
    return envTask;
  }
  const dbGlobal = await safeGetConfig("AI_PROVIDER");
  if (dbGlobal) {
    return dbGlobal.trim();
  }
  const envGlobal = process.env.AI_PROVIDER?.trim();
  if (envGlobal) {
    return envGlobal;
  }
  return "glm";
}

/**
 * Get API key for a provider (DB > Env)
 */
export async function getApiKey(provider: Provider): Promise<string> {
  const keyName =
    provider === "openai"
      ? "OPENAI_API_KEY"
      : provider === "deepseek"
        ? "DEEPSEEK_API_KEY"
        : isGLMFamilyProvider(provider)
          ? "GLM_API_KEY"
          : "GOOGLE_API_KEY";
  const dbKey = await ConfigRepo.getConfig("system", keyName);
  if (dbKey) return dbKey;
  return process.env[keyName] || "";
}

/**
 * Get Base URL for OpenAI-compatible endpoints (DB > Env > Default)
 */
async function getBaseURL(): Promise<string> {
  const dbBaseURL = await ConfigRepo.getConfig("system", "OPENAI_BASE_URL");
  if (dbBaseURL) return dbBaseURL;
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * Resolve configuration for a single task with source tracking
 * Priority: DB > Env > Default
 */
export async function resolveTaskConfig(
  task: string,
): Promise<ModelConfigWithSource> {
  const taskUpper = task.toUpperCase();

  // Provider resolution
  let provider: Provider;
  let providerSource: "db" | "env" | "default" = "default";

  const providerDbKey = `AI_PROVIDER_${taskUpper}`;
  const dbProvider = await ConfigRepo.getConfig("system", providerDbKey);
  if (dbProvider) {
    provider = dbProvider.trim() as Provider;
    providerSource = "db";
  } else if (process.env[providerDbKey]) {
    provider = process.env[providerDbKey]!.trim() as Provider;
    providerSource = "env";
  } else {
    const globalDbProvider = await ConfigRepo.getConfig(
      "system",
      "AI_PROVIDER",
    );
    if (globalDbProvider) {
      provider = globalDbProvider.trim() as Provider;
      providerSource = "db";
    } else if (process.env.AI_PROVIDER) {
      provider = process.env.AI_PROVIDER.trim() as Provider;
      providerSource = "env";
    } else {
      provider = "glm";
      providerSource = "default";
    }
  }

  // Model resolution
  let model: string;
  let modelSource: "db" | "env" | "default" = "default";

  if (provider === "gemini") {
    const modelDbKey = `GEMINI_MODEL_${taskUpper}`;
    const dbModel = await ConfigRepo.getConfig("system", modelDbKey);
    if (dbModel) {
      model = dbModel.trim();
      modelSource = "db";
    } else if (process.env[modelDbKey]) {
      model = process.env[modelDbKey]!.trim();
      modelSource = "env";
    } else {
      const globalDbModel = await ConfigRepo.getConfig(
        "system",
        "GEMINI_MODEL",
      );
      if (globalDbModel) {
        model = globalDbModel.trim();
        modelSource = "db";
      } else if (process.env.GEMINI_MODEL) {
        model = process.env.GEMINI_MODEL.trim();
        modelSource = "env";
      } else {
        model = DEFAULT_GEMINI_MODEL;
        modelSource = "default";
      }
    }
  } else if (provider === "deepseek") {
    // L004: model id single source of truth via ConfigRepo key DEEPSEEK_MODEL_FLASH;
    // default literal mirrors resolveDeepSeekModel / DEFAULT_DEEPSEEK_FLASH.
    const taskModelEnv = process.env[`DEEPSEEK_MODEL_${taskUpper}`]?.trim();
    const taskModelDb = await safeGetConfig(`DEEPSEEK_MODEL_${taskUpper}`);
    const globalModelEnv = process.env.DEEPSEEK_MODEL_FLASH?.trim();
    const globalModelDb = await safeGetConfig("DEEPSEEK_MODEL_FLASH");
    if (taskModelDb) {
      model = taskModelDb;
      modelSource = "db";
    } else if (taskModelEnv) {
      model = taskModelEnv;
      modelSource = "env";
    } else if (globalModelDb) {
      model = globalModelDb;
      modelSource = "db";
    } else if (globalModelEnv) {
      model = globalModelEnv;
      modelSource = "env";
    } else {
      model = DEFAULT_DEEPSEEK_FLASH;
      modelSource = "default";
    }
  } else if (isGLMFamilyProvider(provider)) {
    // GLM 家族 (glm / glm-anthropic / glm-legacy) 共用同一 model 键层级：
    // DB > env, task-scoped (GLM_MODEL_<TASK>) then global (GLM_MODEL);
    // mirrors resolveGLMModel / DEFAULT_GLM_MODEL.
    const taskModelDb = await safeGetConfig(`GLM_MODEL_${taskUpper}`);
    const taskModelEnv = process.env[`GLM_MODEL_${taskUpper}`]?.trim();
    const globalModelDb = await safeGetConfig("GLM_MODEL");
    const globalModelEnv = process.env.GLM_MODEL?.trim();
    if (taskModelDb) {
      model = taskModelDb;
      modelSource = "db";
    } else if (taskModelEnv) {
      model = taskModelEnv;
      modelSource = "env";
    } else if (globalModelDb) {
      model = globalModelDb;
      modelSource = "db";
    } else if (globalModelEnv) {
      model = globalModelEnv;
      modelSource = "env";
    } else {
      model = DEFAULT_GLM_MODEL;
      modelSource = "default";
    }
  } else {
    const modelDbKey = `OPENAI_MODEL_${taskUpper}`;
    const dbModel = await ConfigRepo.getConfig("system", modelDbKey);
    if (dbModel) {
      model = dbModel.trim();
      modelSource = "db";
    } else if (process.env[modelDbKey]) {
      model = process.env[modelDbKey]!.trim();
      modelSource = "env";
    } else {
      const globalDbModel = await ConfigRepo.getConfig(
        "system",
        "OPENAI_MODEL",
      );
      if (globalDbModel) {
        model = globalDbModel.trim();
        modelSource = "db";
      } else if (process.env.OPENAI_MODEL) {
        model = process.env.OPENAI_MODEL.trim();
        modelSource = "env";
      } else {
        model = DEFAULT_OPENAI_MODEL;
        modelSource = "default";
      }
    }
  }

  // Base URL for OpenAI-compatible endpoints (OpenAI and DeepSeek)
  let baseURL: string | undefined;
  let baseURLSource: "db" | "env" | "default" = "default";

  if (provider === "openai") {
    const dbBaseURL = await ConfigRepo.getConfig("system", "OPENAI_BASE_URL");
    if (dbBaseURL) {
      baseURL = dbBaseURL.trim();
      baseURLSource = "db";
    } else if (process.env.OPENAI_BASE_URL) {
      baseURL = process.env.OPENAI_BASE_URL.trim();
      baseURLSource = "env";
    } else {
      baseURL = DEFAULT_BASE_URL;
      baseURLSource = "default";
    }
  } else if (provider === "deepseek") {
    const dbBaseURL = await safeGetConfig("DEEPSEEK_BASE_URL");
    if (dbBaseURL) {
      baseURL = dbBaseURL;
      baseURLSource = "db";
    } else if (process.env.DEEPSEEK_BASE_URL) {
      baseURL = process.env.DEEPSEEK_BASE_URL.trim();
      baseURLSource = "env";
    } else {
      baseURL = DEFAULT_DEEPSEEK_BASE_URL;
      baseURLSource = "default";
    }
  } else if (provider === "glm") {
    // GLM coding 端点（默认路径）：GLM_BASE_URL。
    const dbBaseURL = await safeGetConfig("GLM_BASE_URL");
    if (dbBaseURL) {
      baseURL = dbBaseURL;
      baseURLSource = "db";
    } else if (process.env.GLM_BASE_URL) {
      baseURL = process.env.GLM_BASE_URL.trim();
      baseURLSource = "env";
    } else {
      baseURL = DEFAULT_GLM_BASE_URL;
      baseURLSource = "default";
    }
  } else if (provider === "glm-anthropic") {
    // GLM anthropic 备选路径：GLM_ANTHROPIC_BASE_URL（与 coding 键隔离）。
    const dbBaseURL = await safeGetConfig("GLM_ANTHROPIC_BASE_URL");
    if (dbBaseURL) {
      baseURL = dbBaseURL;
      baseURLSource = "db";
    } else if (process.env.GLM_ANTHROPIC_BASE_URL) {
      baseURL = process.env.GLM_ANTHROPIC_BASE_URL.trim();
      baseURLSource = "env";
    } else {
      baseURL = DEFAULT_GLM_ANTHROPIC_BASE_URL;
      baseURLSource = "default";
    }
  } else if (provider === "glm-legacy") {
    // GLM z.ai 回退路径：GLM_LEGACY_BASE_URL（与 coding 键隔离）。
    const dbBaseURL = await safeGetConfig("GLM_LEGACY_BASE_URL");
    if (dbBaseURL) {
      baseURL = dbBaseURL;
      baseURLSource = "db";
    } else if (process.env.GLM_LEGACY_BASE_URL) {
      baseURL = process.env.GLM_LEGACY_BASE_URL.trim();
      baseURLSource = "env";
    } else {
      baseURL = DEFAULT_GLM_LEGACY_BASE_URL;
      baseURLSource = "default";
    }
  }

  // Return with the highest priority source
  const sourcePriority = ["db", "env", "default"];
  const providerSourceIndex = sourcePriority.indexOf(providerSource);
  const modelSourceIndex = sourcePriority.indexOf(modelSource);
  const baseURLSourceIndex = sourcePriority.indexOf(baseURLSource);

  const finalSource = sourcePriority[
    Math.min(providerSourceIndex, modelSourceIndex, baseURLSourceIndex)
  ] as "db" | "env" | "default";

  return { provider, model, baseURL, source: finalSource };
}

/**
 * Get all model configurations
 */
export async function getAllConfigs(): Promise<AllModelConfigs> {
  console.log("[ModelConfigService] Getting all configs...");

  console.log("[ModelConfigService] Resolving default config...");
  const defaultConfig = await resolveTaskConfig("default");
  console.log("[ModelConfigService] Default config resolved:", defaultConfig);

  return { default: defaultConfig };
}

/**
 * Update task configuration in database
 */
export async function updateTaskConfig(
  task: string,
  config: ModelConfig,
): Promise<void> {
  const taskUpper = task.toUpperCase();

  // Update provider
  const providerDbKey = `AI_PROVIDER_${taskUpper}`;
  await ConfigRepo.setConfig("system", providerDbKey, config.provider);

  // Update model
  if (config.provider === "gemini") {
    const modelDbKey = `GEMINI_MODEL_${taskUpper}`;
    await ConfigRepo.setConfig("system", modelDbKey, config.model);
  } else if (config.provider === "deepseek") {
    const modelDbKey = `DEEPSEEK_MODEL_${taskUpper}`;
    await ConfigRepo.setConfig("system", modelDbKey, config.model);
  } else if (isGLMFamilyProvider(config.provider)) {
    const modelDbKey = `GLM_MODEL_${taskUpper}`;
    await ConfigRepo.setConfig("system", modelDbKey, config.model);
  } else {
    const modelDbKey = `OPENAI_MODEL_${taskUpper}`;
    await ConfigRepo.setConfig("system", modelDbKey, config.model);
  }

  // Update Base URL — 每个 GLM 协议路径写自己的 key（coding/anthropic/legacy
  // 互不串线），OpenAI/DeepSeek 各自维持原键。
  if (config.provider === "openai" && config.baseURL) {
    await ConfigRepo.setConfig("system", "OPENAI_BASE_URL", config.baseURL);
  } else if (config.provider === "deepseek" && config.baseURL) {
    await ConfigRepo.setConfig("system", "DEEPSEEK_BASE_URL", config.baseURL);
  } else if (config.provider === "glm" && config.baseURL) {
    await ConfigRepo.setConfig("system", "GLM_BASE_URL", config.baseURL);
  } else if (config.provider === "glm-anthropic" && config.baseURL) {
    await ConfigRepo.setConfig(
      "system",
      "GLM_ANTHROPIC_BASE_URL",
      config.baseURL,
    );
  } else if (config.provider === "glm-legacy" && config.baseURL) {
    await ConfigRepo.setConfig("system", "GLM_LEGACY_BASE_URL", config.baseURL);
  }
}

/**
 * Test connection to a model provider
 */
export async function testConnection(config: ModelConfig): Promise<{
  success: boolean;
  latency?: number;
  error?: string;
}> {
  const start = Date.now();

  try {
    // GLM anthropic 协议路径（B4 备选）：x-api-key + anthropic-version 鉴权，
    // 与 ChatAnthropic 同协议；默认指向 bigmodel /api/anthropic。
    if (isGLMAnthropicProvider(config.provider)) {
      const apiKey = await getApiKey(config.provider);
      if (!apiKey) {
        return { success: false, error: "GLM API Key not configured" };
      }
      const baseURL = config.baseURL || DEFAULT_GLM_ANTHROPIC_BASE_URL;
      const endpoint = `${baseURL.replace(/\/+$/, "")}/v1/messages`;
      const response = await request(endpoint, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        headersTimeout: 15000,
        bodyTimeout: 15000,
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (response.statusCode >= 400) {
        const body = await response.body.text();
        let errorMsg = `HTTP ${response.statusCode}`;
        try {
          const json = JSON.parse(body);
          errorMsg = json.error?.message || json.error || errorMsg;
        } catch {}
        return { success: false, error: errorMsg };
      }
      return { success: true, latency: Date.now() - start };
    }

    if (
      config.provider === "openai" ||
      config.provider === "deepseek" ||
      isGLMFamilyProvider(config.provider)
    ) {
      const isDeepSeek = config.provider === "deepseek";
      const isGLMCoding = config.provider === "glm";
      const isGLMLegacy = config.provider === "glm-legacy";
      const apiKey = await getApiKey(config.provider);
      if (!apiKey) {
        return {
          success: false,
          error: isDeepSeek
            ? "DeepSeek API Key not configured"
            : isGLMCoding || isGLMLegacy
              ? "GLM API Key not configured"
              : "OpenAI API Key not configured",
        };
      }

      const defaultBaseURL = isDeepSeek
        ? DEFAULT_DEEPSEEK_BASE_URL
        : isGLMCoding
          ? DEFAULT_GLM_BASE_URL
          : isGLMLegacy
            ? DEFAULT_GLM_LEGACY_BASE_URL
            : DEFAULT_BASE_URL;
      const baseURL = config.baseURL || defaultBaseURL;
      const endpoint = `${baseURL}/chat/completions`;

      const response = await request(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        headersTimeout: 15000,
        bodyTimeout: 15000,
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
      });

      if (response.statusCode >= 400) {
        const body = await response.body.text();
        let errorMsg = `HTTP ${response.statusCode}`;
        try {
          const json = JSON.parse(body);
          errorMsg = json.error?.message || json.error || errorMsg;
        } catch {}
        return { success: false, error: errorMsg };
      }

      return { success: true, latency: Date.now() - start };
    } else {
      const apiKey = await getApiKey("gemini");
      if (!apiKey) {
        return { success: false, error: "Google API Key not configured" };
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        headersTimeout: 15000,
        bodyTimeout: 15000,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
        }),
      });

      if (response.statusCode >= 400) {
        const body = await response.body.text();
        let errorMsg = `HTTP ${response.statusCode}`;
        try {
          const json = JSON.parse(body);
          errorMsg = json.error?.message || json.error?.status || errorMsg;
        } catch {}
        return { success: false, error: errorMsg };
      }

      return { success: true, latency: Date.now() - start };
    }
  } catch (e: any) {
    return { success: false, error: e.message || "Connection failed" };
  }
}

/**
 * Get available models for a provider
 */
export function getAvailableModels(provider: Provider): string[] {
  if (provider === "gemini") return GEMINI_MODELS;
  if (provider === "deepseek") return DEEPSEEK_MODELS;
  if (isGLMFamilyProvider(provider)) return GLM_MODELS;
  return OPENAI_MODELS;
}

/**
 * Check if a model name is a custom model (not in the predefined list)
 */
export function isCustomModel(provider: Provider, model: string): boolean {
  const models = getAvailableModels(provider);
  return !models.includes(model);
}

// ============================================================================
// Image Generation Model Config
// ============================================================================

export function isKnownImageProvider(
  provider: string,
): provider is ImageProvider {
  return (IMAGE_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Resolve image generation model config (DB > Env > Default)
 */
export async function resolveImageModelConfig(): Promise<ImageModelConfigWithSource> {
  let provider: ImageProvider;
  let providerSource: "db" | "env" | "default" = "default";

  const dbProvider = await ConfigRepo.getConfig("system", "IMAGE_GEN_PROVIDER");
  if (dbProvider && isKnownImageProvider(dbProvider.trim())) {
    provider = dbProvider.trim() as ImageProvider;
    providerSource = "db";
  } else if (
    process.env.IMAGE_GEN_PROVIDER?.trim() &&
    isKnownImageProvider(process.env.IMAGE_GEN_PROVIDER.trim())
  ) {
    provider = process.env.IMAGE_GEN_PROVIDER.trim() as ImageProvider;
    providerSource = "env";
  } else {
    provider = DEFAULT_IMAGE_PROVIDER;
    providerSource = "default";
  }

  let model: string;
  let modelSource: "db" | "env" | "default" = "default";

  const dbModel = await ConfigRepo.getConfig("system", "IMAGE_GEN_MODEL");
  if (dbModel) {
    model = dbModel.trim();
    modelSource = "db";
  } else if (process.env.IMAGE_GEN_MODEL?.trim()) {
    model = process.env.IMAGE_GEN_MODEL.trim();
    modelSource = "env";
  } else {
    model = DEFAULT_IMAGE_MODEL;
    modelSource = "default";
  }

  let baseURL: string | undefined;
  let baseURLSource: "db" | "env" | "default" = "default";

  const dbBaseURL = await ConfigRepo.getConfig("system", "IMAGE_GEN_BASE_URL");
  if (dbBaseURL) {
    baseURL = dbBaseURL.trim();
    baseURLSource = "db";
  } else if (process.env.IMAGE_GEN_BASE_URL?.trim()) {
    baseURL = process.env.IMAGE_GEN_BASE_URL.trim();
    baseURLSource = "env";
  } else if (provider === "dmx") {
    // DMX is the default provider; bake in its OpenAI-compatible endpoint so
    // generateImage() has a working default without any configuration.
    baseURL = DEFAULT_DMX_BASE_URL;
    baseURLSource = "default";
  } else {
    baseURL = DEFAULT_IMAGE_BASE_URL;
    baseURLSource = "default";
  }

  const sourcePriority = ["db", "env", "default"];
  const finalSource = sourcePriority[
    Math.min(
      sourcePriority.indexOf(providerSource),
      sourcePriority.indexOf(modelSource),
      sourcePriority.indexOf(baseURLSource),
    )
  ] as "db" | "env" | "default";

  return { provider, model, baseURL, source: finalSource };
}

/**
 * Update image generation model config in database
 */
export async function updateImageGenConfig(
  config: ImageModelConfig,
): Promise<void> {
  await ConfigRepo.setConfig("system", "IMAGE_GEN_PROVIDER", config.provider);
  await ConfigRepo.setConfig("system", "IMAGE_GEN_MODEL", config.model);
  if (config.baseURL) {
    await ConfigRepo.setConfig("system", "IMAGE_GEN_BASE_URL", config.baseURL);
  }
}

/**
 * Get available image models for a provider
 */
export function getAvailableImageModels(provider: ImageProvider): string[] {
  return IMAGE_MODELS[provider] || [];
}

/**
 * Get API key for image generation provider
 */
export async function getImageGenApiKey(): Promise<string> {
  const dbKey = await ConfigRepo.getConfig("system", "IMAGE_GEN_API_KEY");
  if (dbKey) return dbKey;
  return process.env.IMAGE_GEN_API_KEY || "";
}

/**
 * Test image generation provider connection
 */
export async function testImageGenConnection(
  config: ImageModelConfig,
): Promise<{
  success: boolean;
  latency?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const apiKey = await getImageGenApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: "Image Generation API Key not configured",
      };
    }

    const baseURL = config.baseURL || "";
    const endpoint = `${baseURL}/v1/images/generations`;

    const response = await request(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      headersTimeout: 15000,
      bodyTimeout: 15000,
      body: JSON.stringify({
        model: config.model || "dall-e-2",
        prompt: "ping",
        n: 1,
        size: "256x256",
      }),
    });

    if (response.statusCode >= 400) {
      const body = await response.body.text();
      let errorMsg = `HTTP ${response.statusCode}`;
      try {
        const json = JSON.parse(body);
        errorMsg = json.error?.message || json.error || errorMsg;
      } catch {}
      return { success: false, error: errorMsg };
    }

    return { success: true, latency: Date.now() - start };
  } catch (e: any) {
    return { success: false, error: e.message || "Connection failed" };
  }
}
