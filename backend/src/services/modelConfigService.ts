import { ConfigRepo } from "./knowledgeRepo.js";
import { ProxyAgent, request } from "undici";

// L004: provider set is the single source of truth. DeepSeek added additively
// (P009) — existing gemini/openai default behavior is unchanged.
export const KNOWN_PROVIDERS = ["gemini", "openai", "deepseek"] as const;
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

// DeepSeek default model (flash tier). New default to dodge the 2026/07/24
// deprecation of the old legacy DeepSeek model ids. Pro tier is
// opt-in only (DEEPSEEK_MODEL_PRO) — never bound to an expensive default.
export const DEFAULT_DEEPSEEK_FLASH = "deepseek-v4-flash";
// L015: official DeepSeek base URL (no /v1). DeepSeek is OpenAI-compatible and
// accepts both forms, but https://api.deepseek.com is the documented canonical
// value (api-docs.deepseek.com, 2026/07). testConnection appends /chat/completions.
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

// Default image generation config (DMX API - OpenAI compatible)
const DEFAULT_IMAGE_MODEL = "";
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
 * Resolve the effective provider for a scenario. Defaults to "deepseek" (the new
 * default for the loadModel entry point) when neither DB nor env sets AI_PROVIDER.
 * Legacy resolveTaskConfig() still defaults to "gemini" (P009: unchanged).
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
  return "deepseek";
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
      provider = "gemini";
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
  } else {
    const modelDbKey = `OPENAI_MODEL_${taskUpper}`;
    await ConfigRepo.setConfig("system", modelDbKey, config.model);
  }

  // Update Base URL for OpenAI-compatible providers (OpenAI and DeepSeek)
  if (config.provider === "openai" && config.baseURL) {
    await ConfigRepo.setConfig("system", "OPENAI_BASE_URL", config.baseURL);
  } else if (config.provider === "deepseek" && config.baseURL) {
    await ConfigRepo.setConfig("system", "DEEPSEEK_BASE_URL", config.baseURL);
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
    if (config.provider === "openai" || config.provider === "deepseek") {
      const isDeepSeek = config.provider === "deepseek";
      const apiKey = await getApiKey(config.provider);
      if (!apiKey) {
        return {
          success: false,
          error: isDeepSeek ? "DeepSeek API Key not configured" : "OpenAI API Key not configured"
        };
      }

      const baseURL = config.baseURL || (isDeepSeek ? DEFAULT_DEEPSEEK_BASE_URL : DEFAULT_BASE_URL);
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
