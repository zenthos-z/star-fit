import { ConfigRepo } from "./knowledgeRepo.js";
// L004: Provider type is the single source of truth, owned by modelConfigService.
import { safeGetConfig, type Provider } from "./modelConfigService.js";

async function pick(envKey: string, dbKey: string, fallback?: string) {
  const dbVal = await ConfigRepo.getConfig('system', dbKey);
  if (dbVal) return dbVal;

  const raw = process.env[envKey];
  const v = typeof raw === "string" ? raw.trim() : raw;
  return v && v.length > 0 ? v : fallback;
}

export async function getProviderForTask(task: string) {
  const keyEnv = `AI_PROVIDER_${task.toUpperCase()}`;
  const keyDb = `AI_PROVIDER_${task.toUpperCase()}`; // We might not have task specific DB keys yet, but let's follow the pattern

  // First try task specific DB config, then task specific env, then global DB config, then global env
  let providerRaw = await ConfigRepo.getConfig('system', keyDb);
  if (!providerRaw) {
    providerRaw = process.env[keyEnv];
  }
  if (!providerRaw) {
    providerRaw = await ConfigRepo.getConfig('system', 'AI_PROVIDER');
  }
  if (!providerRaw) {
    providerRaw = process.env.AI_PROVIDER;
  }

  // glm is the final default (single source of truth with
  // modelConfigService.resolveDefaultedProvider / resolveTaskConfig).
  const provider = (providerRaw?.trim() || "glm") as Provider;

  let model = "";
  if (provider === "glm") {
    // GLM: task-scoped (GLM_MODEL_<TASK>) > global (GLM_MODEL, DB then env) >
    // default; mirrors modelConfigService.resolveGLMModel / DEFAULT_GLM_MODEL.
    const taskModelDb = await safeGetConfig(`GLM_MODEL_${task.toUpperCase()}`);
    const taskModelEnv = process.env[`GLM_MODEL_${task.toUpperCase()}`]?.trim();
    const globalModelDb = await safeGetConfig("GLM_MODEL");
    const globalModelEnv = process.env.GLM_MODEL?.trim();
    model = (taskModelDb || taskModelEnv || globalModelDb || globalModelEnv || "glm-5.3-flash").trim();
  } else if (provider === "gemini") {
    const globalModel = await ConfigRepo.getConfig('system', 'GEMINI_MODEL');
    model = (await pick(`GEMINI_MODEL_${task.toUpperCase()}`, `GEMINI_MODEL_${task.toUpperCase()}`, globalModel || (process.env.GOOGLE_GENAI_MODEL || "gemini-3-flash-preview").trim()))!;
  } else if (provider === "deepseek") {
    // L004: model id single source of truth via ConfigRepo key DEEPSEEK_MODEL_FLASH;
    // default literal mirrors modelConfigService.DEFAULT_DEEPSEEK_FLASH
    // (deepseek-v4-flash-ga-260731, the volcano ark coding-plan default).
    const globalModel = await safeGetConfig("DEEPSEEK_MODEL_FLASH");
    const fallback = (globalModel ?? process.env.DEEPSEEK_MODEL_FLASH ?? "deepseek-v4-flash-ga-260731").trim();
    model = (await pick(`DEEPSEEK_MODEL_${task.toUpperCase()}`, `DEEPSEEK_MODEL_${task.toUpperCase()}`, fallback))!;
  } else {
    const globalModel = await ConfigRepo.getConfig('system', 'OPENAI_MODEL');
    model = (await pick(`OPENAI_MODEL_${task.toUpperCase()}`, `OPENAI_MODEL_${task.toUpperCase()}`, globalModel || (process.env.OPENAI_MODEL || "gpt-4o-mini").trim()))!;
  }
  return { provider, model };
}
