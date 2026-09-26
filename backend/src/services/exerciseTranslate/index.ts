/**
 * exerciseTranslate — A6 动作库中文翻译管道服务（issue #19）。
 *
 * 模块组成：
 *  - types.ts     类型（术语表/翻译输入产物）
 *  - glossary.ts  术语表加载（Zod 校验）+ prompt 渲染 + 全名定名查询
 *  - llmClient.ts Anthropic Messages 兼容通道（glm-5.3-flash；重试退避；
 *                 parseJSONSafe + Zod 校验回路）
 *  - translate.ts prompt 构建 + 响应 schema + 步数对齐复核重试
 *
 * 编排入口（读库 → 翻译 → 回写）见 scripts/translateExerciseLibrary.ts。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

export * from "./types.js";
export {
  loadGlossary,
  nameOverride,
  renderGlossaryForPrompt,
  OVERRIDE_SECTION,
} from "./glossary.js";
export {
  resolveLlmChannelFromEnv,
  callLlmText,
  callLlmJson,
  stripCodeFence,
  DEFAULT_TRANSLATE_MODEL,
  DEFAULT_TRANSLATE_BASE_URL,
  type LlmChannel,
} from "./llmClient.js";
export {
  buildContentSystemPrompt,
  buildNamesSystemPrompt,
  buildContentUserPrompt,
  buildBatchUserPrompt,
  translateExerciseContent,
  translateExercisesBatch,
  translateNamesBatch,
  ContentTranslationSchema,
  ContentBatchSchema,
  NamesBatchSchema,
  type ContentTranslateResult,
  type BatchContentResult,
} from "./translate.js";
export {
  checkTermConsistency,
  checkNameOverrideHit,
  type TermCheckHit,
  type TermCheckResult,
} from "./consistency.js";
