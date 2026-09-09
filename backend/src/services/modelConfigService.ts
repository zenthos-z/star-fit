import { ConfigRepo } from "./knowledgeRepo.js";
import { ProxyAgent, request } from "undici";

// L004: provider set is the single source of truth. DeepSeek added additively
// (P009); GLM (Z.ai, OpenAI-compatible chat/completions) added as the new
// default provider. Gemini remains an ordinary selectable option but is no
// longer the default for anything.
export const KNOWN_PROVIDERS = ["gemini", "openai", "deepseek", "glm"] as const;
export type Provider = typeof KNOWN_PROVIDERS[number];

/**
 * Raised when a resolved provider is not in KNOWN_PROVIDERS (P012 vacuity probe).
 * Replaces the previous silent fallback to gemini for unknown provider strings.
 */
export class UnknownProviderError extends Error {
  readonly code = "UNKNOWN_PROVIDER" as const;
  constructor(provider: string) {
    super(`Unknown AI provider: "${provider}". Expected one of: ${KNOWN_PROVIDERS.join(", ")}`);
    this.name = "UnknownProviderError";
  }
}

export function isKnownProvider(provider: string): provider is Provider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(provider);
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
          : provider === "glm"
            ? "GLM_API_KEY"
            : "GOOGLE_API_KEY";
    super(`${keyName} missing for provider "${provider}"`);
    this.name = "MissingApiKeyError";
    this.code = `${keyName}_MISSING`;
  }
}

export function assertKnownProvider(provider: string): asserts provider is Provider {
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
export const IMAGE_PROVIDERS = ["dmx", "openai"] as const;
export type ImageProvider = typeof IMAGE_PROVIDERS[number];

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
  "gemini-1.5-flash"
];

const OPENAI_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo"
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
const DEFAULT_DEEPSEEK_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";
const DEEPSEEK_MODELS = [DEFAULT_DEEPSEEK_FLASH, "deepseek-v4-pro"];

// ----------------------------------------------------------------------------
// GLM (Z.ai) — the default LLM provider. OpenAI-compatible chat/completions.
// All three defaults are overridable via env or DB config (DB > env > default).
// ----------------------------------------------------------------------------
export const DEFAULT_GLM_MODEL = "glm-5.3-flash";
export const DEFAULT_GLM_BASE_URL = "https://api.z.ai/api/paas/v4";
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
  openai: ["dall-e-3", "dall-e-2"]
};

export interface DeepSeekModelConfig {
  model: string;
  baseURL: string;
  thinking: false; // B3: thinking disabled by default for both tiers
}

export interface GLMModelConfig {
  model: string;
  baseURL: string;
}

/**
 * Resolve the GLM (Z.ai) model config. Hierarchy: DB (ConfigRepo) > env > default.
 * Keys: GLM_MODEL (default "glm-5.3-flash"), GLM_BASE_URL
 * (default https://api.z.ai/api/paas/v4). OpenAI-compatible chat/completions.
 */
export async function resolveGLMModel(task: string = "default"): Promise<GLMModelConfig> {
  const taskUpper = task.toUpperCase();

  // DB > env, task-scoped first (GLM_MODEL_<TASK>), then global (GLM_MODEL).
  const taskModelDb = await safeGetConfig(`GLM_MODEL_${taskUpper}`);
  const taskModelEnv = process.env[`GLM_MODEL_${taskUpper}`]?.trim();
  const globalModelDb = await safeGetConfig("GLM_MODEL");
  const globalModelEnv = process.env.GLM_MODEL?.trim();

  const model = taskModelDb || taskModelEnv || globalModelDb || globalModelEnv || DEFAULT_GLM_MODEL;

  const baseURL =
    (await safeGetConfig("GLM_BASE_URL")) ||
    process.env.GLM_BASE_URL?.trim() ||
    DEFAULT_GLM_BASE_URL;

  return { model, baseURL };
}

/**
 * Resolve the DeepSeek model for a tier. Hierarchy: DB (ConfigRepo) > env > default.
 * - flash (default tier): DEEPSEEK_MODEL_FLASH, default "deepseek-v4-flash"
 * - pro: DEEPSEEK_MODEL_PRO; if unset, falls back to the flash default so the
 *   pro tier is never silently bound to an expensive model.
 * thinking is always false (DeepSeek reasoning toggled off by default).
 */
export async function resolveDeepSeekModel(
  tier: "flash" | "pro" = "flash"
): Promise<DeepSeekModelConfig> {
  const modelKey = tier === "pro" ? "DEEPSEEK_MODEL_PRO" : "DEEPSEEK_MODEL_FLASH";

  const dbModel = await safeGetConfig(modelKey);
  const envModel = process.env[modelKey]?.trim();

  // pro without explicit config -> safe flash default (never bind to expensive pro)
  const model = dbModel || envModel || DEFAULT_DEEPSEEK_FLASH;

  const baseURL =
    (await safeGetConfig("DEEPSEEK_BASE_URL")) ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    DEFAULT_DEEPSEEK_BASE_URL;

  return { model, baseURL, thinking: false };
}

/**
 * Resolve the effective provider for a scenario. GLM is the final fallback
 * (single source of truth with resolveTaskConfig / modelRouter / getProxyConfig).
 */
export async function resolveDefaultedProvider(scenario: string = "default"): Promise<string> {
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
        : provider === "glm"
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
export async function resolveTaskConfig(task: string): Promise<ModelConfigWithSource> {
  const taskUpper = task.toUpperCase();

  // Provider resolution
  let provider: Provider;
  let providerSource: "db" | "env" | "default" = "default";

  const providerDbKey = `AI_PROVIDER_${taskUpper}`;
  const dbProvider = await ConfigRepo.getConfig("system", providerDbKey);
  if (dbProvider) {
    provider = (dbProvider.trim() as Provider);
    providerSource = "db";
  } else if (process.env[providerDbKey]) {
    provider = (process.env[providerDbKey]!.trim() as Provider);
    providerSource = "env";
  } else {
    const globalDbProvider = await ConfigRepo.getConfig("system", "AI_PROVIDER");
    if (globalDbProvider) {
      provider = (globalDbProvider.trim() as Provider);
      providerSource = "db";
    } else if (process.env.AI_PROVIDER) {
      provider = (process.env.AI_PROVIDER.trim() as Provider);
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
      const globalDbModel = await ConfigRepo.getConfig("system", "GEMINI_MODEL");
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
  } else if (provider === "glm") {
    // GLM model: DB > env, task-scoped (GLM_MODEL_<TASK>) then global
    // (GLM_MODEL); mirrors resolveGLMModel / DEFAULT_GLM_MODEL.
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
      const globalDbModel = await ConfigRepo.getConfig("system", "OPENAI_MODEL");
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
  console.log('[ModelConfigService] Getting all configs...');

  console.log('[ModelConfigService] Resolving default config...');
  const defaultConfig = await resolveTaskConfig("default");
  console.log('[ModelConfigService] Default config resolved:', defaultConfig);

  return { default: defaultConfig };
}

/**
 * Update task configuration in database
 */
export async function updateTaskConfig(
  task: string,
  config: ModelConfig
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
  } else if (config.provider === "glm") {
    const modelDbKey = `GLM_MODEL_${taskUpper}`;
    await ConfigRepo.setConfig("system", modelDbKey, config.model);
  } else {
    const modelDbKey = `OPENAI_MODEL_${taskUpper}`;
    await ConfigRepo.setConfig("system", modelDbKey, config.model);
  }

  // Update Base URL for OpenAI-compatible providers (OpenAI / DeepSeek / GLM)
  if (config.provider === "openai" && config.baseURL) {
    await ConfigRepo.setConfig("system", "OPENAI_BASE_URL", config.baseURL);
  } else if (config.provider === "deepseek" && config.baseURL) {
    await ConfigRepo.setConfig("system", "DEEPSEEK_BASE_URL", config.baseURL);
  } else if (config.provider === "glm" && config.baseURL) {
    await ConfigRepo.setConfig("system", "GLM_BASE_URL", config.baseURL);
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
    if (config.provider === "openai" || config.provider === "deepseek" || config.provider === "glm") {
      const isDeepSeek = config.provider === "deepseek";
      const isGLM = config.provider === "glm";
      const apiKey = await getApiKey(config.provider);
      if (!apiKey) {
        return {
          success: false,
          error: isDeepSeek
            ? "DeepSeek API Key not configured"
            : isGLM
              ? "GLM API Key not configured"
              : "OpenAI API Key not configured"
        };
      }

      const defaultBaseURL = isDeepSeek
        ? DEFAULT_DEEPSEEK_BASE_URL
        : isGLM
          ? DEFAULT_GLM_BASE_URL
          : DEFAULT_BASE_URL;
      const baseURL = config.baseURL || defaultBaseURL;
      const endpoint = `${baseURL}/chat/completions`;

      const response = await request(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        headersTimeout: 15000,
        bodyTimeout: 15000,
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5
        })
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
          contents: [{ role: "user", parts: [{ text: "ping" }] }]
        })
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
  if (provider === "glm") return GLM_MODELS;
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

export function isKnownImageProvider(provider: string): provider is ImageProvider {
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
  } else if (process.env.IMAGE_GEN_PROVIDER?.trim() && isKnownImageProvider(process.env.IMAGE_GEN_PROVIDER.trim())) {
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
      sourcePriority.indexOf(baseURLSource)
    )
  ] as "db" | "env" | "default";

  return { provider, model, baseURL, source: finalSource };
}

/**
 * Update image generation model config in database
 */
export async function updateImageGenConfig(config: ImageModelConfig): Promise<void> {
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
export async function testImageGenConnection(config: ImageModelConfig): Promise<{
  success: boolean;
  latency?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const apiKey = await getImageGenApiKey();
    if (!apiKey) {
      return { success: false, error: "Image Generation API Key not configured" };
    }

    const baseURL = config.baseURL || "";
    const endpoint = `${baseURL}/v1/images/generations`;

    const response = await request(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      headersTimeout: 15000,
      bodyTimeout: 15000,
      body: JSON.stringify({
        model: config.model || "dall-e-2",
        prompt: "ping",
        n: 1,
        size: "256x256"
      })
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
