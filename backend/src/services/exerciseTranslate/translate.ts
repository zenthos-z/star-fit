/**
 * A6 翻译核心（A6，issue #19）：prompt 构建 + LLM 响应 Zod 校验。
 *
 * 两条通道（术语表文本由调用方经 glossary.renderGlossaryForPrompt 预渲染注入）：
 *  - translateExerciseContent：单条动作四段（steps/form_cues/common_mistakes/
 *    breathing）→ 深化中译（教学口径扩写，步数与原文 1:1，不虚构）
 *  - translateNamesBatch：动作名兜底批量翻译（术语表未精确命中的名称；
 *    命中名称由脚本直接取 nameOverride，不走 LLM）
 *
 * 校验回路：callLlmJson（parseJSONSafe + Zod）→ 步数对齐复核 →
 * 对齐失败带错误反馈重试一次 → 仍失败即抛（不静默降级）。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { z } from "zod";
import type { TranslatedExercise, TranslationInput } from "./types.js";
import { callLlmJson, type LlmChannel } from "./llmClient.js";

const CJK_RE = /[一-鿿]/;

/** 中文字段口径：非空、含汉字（数字/标点/个别专名字母可共存） */
const zhString = z
  .string()
  .refine((s) => s.trim().length >= 2 && CJK_RE.test(s), {
    message: "必须为非空中文文本",
  });

/** 单条动作四段翻译响应 schema */
export const ContentTranslationSchema = z.object({
  name_zh: zhString,
  steps: z.array(zhString).min(1).max(15),
  cues: z.array(zhString).max(12).default([]),
  mistakes: z.array(zhString).max(12).default([]),
  breathing: zhString.nullable().default(null),
});

/** 动作名批量翻译响应 schema */
export const NamesBatchSchema = z.object({
  translations: z
    .array(z.object({ name: z.string().min(1), name_zh: zhString }))
    .min(1),
});

/** 内容翻译 system prompt（术语纪律 + 深化口径 + 输出契约） */
export function buildContentSystemPrompt(glossaryPrompt: string): string {
  return [
    "你是健身教学内容的中文本地化专家，为健身 App 动作库产出专业教学文案。",
    "任务：将英文动作教学内容翻译并深化为中文专业教学口径。",
    "",
    "【翻译纪律】",
    "1. 术语一致性最高优先级：下方术语表译名必须逐字采用，全库统一；动作名必须采用「全名定名表」中的定名。",
    "2. steps 不做逐字直译：按专业教学口径扩写每一步——补充发力细节（目标肌群收缩感受、关节角度、身体位置锚点）与通用安全提示（如控制下放速度、保持核心收紧），每步 1-2 句（40-90 字）。步数与原文严格一一对应，禁止增删合并步骤，禁止虚构原文没有的器材、动作环节或医疗建议。",
    "3. form_cues 译为完整要领短句：点明姿态锚点与发力感受，每条不超过 40 字，不复述步骤。",
    "4. common_mistakes 用纠错表述：指出错误 + 后果或纠正方法（例：避免耸肩借力——保持肩胛下沉，让目标肌群独立发力）。",
    "5. breathing 译为完整句，按「发力相呼气、退让相吸气」口径表达原文含义。",
    "6. 数字、次数、组数、重量、角度、百分比保持原样；除必要专名（如 Setu Bandhasana）外不保留英文。",
    "7. 源字段为空数组或缺失时，对应输出空数组（breathing 输出 null），不得虚构内容。",
    "8. 只输出 JSON 对象，无任何解释文字。",
    "",
    "【输出 JSON 结构】",
    '{"name_zh": "动作中文名", "steps": ["...", "..."], "cues": ["..."], "mistakes": ["..."], "breathing": "..." 或 null}',
    "",
    "【术语表】",
    glossaryPrompt,
  ].join("\n");
}

/** 名称兜底翻译 system prompt */
export function buildNamesSystemPrompt(glossaryPrompt: string): string {
  return [
    "你是健身动作名中译者。将给定的英文动作名译为中文健身社区通行名称。",
    "纪律：",
    "1. 「全名定名表」命中的一律逐字采用定名；未命中的按术语词表组合翻译，译名必须自然、符合健身社区习惯，不是字面直译。",
    "2. 保留器材/体位/握距前缀（如：哑铃上斜、跪姿、宽握）。",
    "3. 只输出 JSON，无解释。结构：",
    '{"translations": [{"name": "英文名", "name_zh": "中文名"}]}',
    "",
    "【术语表】",
    glossaryPrompt,
  ].join("\n");
}

/** 单条动作内容翻译 user prompt（空教学字段标注「无」，禁止虚构） */
export function buildContentUserPrompt(
  input: TranslationInput,
  nameZhAnchored?: string,
): string {
  const list = (label: string, items: string[] | null): string => {
    if (!items || items.length === 0) {
      return `${label}: 无`;
    }
    return `${label}:\n${items.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
  };
  const lines = [
    `动作名（En）: ${input.name}`,
    nameZhAnchored
      ? `动作中文名（定名，必须逐字采用）: ${nameZhAnchored}`
      : null,
    list("steps（原文步骤）", input.instructions),
    list("form_cues（要领提示）", input.form_cues),
    list("common_mistakes（常见错误）", input.common_mistakes),
    `breathing（呼吸法）: ${input.breathing?.trim() || "无"}`,
    "",
    "请输出该动作的中文教学 JSON。",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export interface ContentTranslateResult {
  result: TranslatedExercise;
  attempts: number;
  usage: { in: number; out: number };
}

/**
 * 单条动作四段深化翻译。
 * 步数对齐复核：源 steps 非空时要求 1:1；失败带错误反馈重试一次，仍失败即抛。
 */
export async function translateExerciseContent(
  channel: LlmChannel,
  systemPrompt: string,
  input: TranslationInput,
  anchoredNameZh?: string,
): Promise<ContentTranslateResult> {
  const baseUser = buildContentUserPrompt(input, anchoredNameZh);
  const label = `translate:${input.name}`;

  let alignmentError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const feedback =
      attempt === 1
        ? ""
        : `\n\n【上一次输出未通过校验，必须修正】\n${alignmentError}\n请重新输出完整 JSON，严格保证 steps 条数与原文步骤一致。`;
    const { value, usage } = await callLlmJson(
      channel,
      systemPrompt,
      baseUser + feedback,
      ContentTranslationSchema,
      `${label}#${attempt}`,
    );

    const result: TranslatedExercise = {
      id: input.id,
      name: input.name,
      name_zh: value.name_zh.trim(),
      steps: value.steps.map((s) => s.trim()),
      cues: value.cues.map((s) => s.trim()),
      mistakes: value.mistakes.map((s) => s.trim()),
      breathing: value.breathing?.trim() || null,
    };
    const alignment = stepAlignment(result, input);
    if (alignment === null) {
      return { result, attempts: attempt, usage };
    }
    alignmentError = alignment;
  }
  throw new Error(
    `${label} 步数对齐校验两次失败：${alignmentError}（源 ${input.instructions?.length ?? 0} 步）`,
  );
}

/** 步数 1:1 复核；null = 通过；否则返回错误描述 */
function stepAlignment(
  result: TranslatedExercise,
  input: TranslationInput,
): string | null {
  const sourceSteps = input.instructions ?? [];
  if (sourceSteps.length === 0) {
    return null;
  }
  if (result.steps.length !== sourceSteps.length) {
    return `输出 steps ${result.steps.length} 条 ≠ 原文 ${sourceSteps.length} 步`;
  }
  return null;
}

/** 动作名兜底批量翻译（返回 en → zh 映射；缺名即抛） */
export async function translateNamesBatch(
  channel: LlmChannel,
  systemPrompt: string,
  names: string[],
): Promise<Map<string, string>> {
  const { value } = await callLlmJson(
    channel,
    systemPrompt,
    `请翻译以下 ${names.length} 个动作名：\n${names.join("\n")}`,
    NamesBatchSchema,
    `translateNames:${names.length}`,
  );
  const map = new Map<string, string>();
  for (const t of value.translations) {
    map.set(t.name, t.name_zh.trim());
  }
  const missing = names.filter((n) => !map.has(n));
  if (missing.length > 0) {
    throw new Error(
      `名称批量翻译缺 ${missing.length} 条: ${missing.slice(0, 5).join(", ")}`,
    );
  }
  return map;
}

// ============================================================================
// 批量内容翻译（限流主通道：请求数 = 条数/批次大小）
// ============================================================================

/** 批量内容翻译响应 schema：数组元素以原英文名回链 */
export const ContentBatchSchema = z.array(
  z.object({
    name: z.string().min(1),
    name_zh: zhString,
    steps: z.array(zhString).min(1).max(15),
    cues: z.array(zhString).max(12).default([]),
    mistakes: z.array(zhString).max(12).default([]),
    breathing: zhString.nullable().default(null),
  }),
);

/** 批量内容翻译 user prompt：多动作分块，输出 JSON 数组 */
export function buildBatchUserPrompt(
  inputs: TranslationInput[],
  anchorMap: Map<string, string>,
): string {
  const list = (label: string, items: string[] | null): string => {
    if (!items || items.length === 0) {
      return `${label}: 无`;
    }
    return `${label}:\n${items.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
  };
  const blocks = inputs.map((input, idx) => {
    const anchor = anchorMap.get(input.name);
    return [
      `### 动作 ${idx + 1}: ${input.name}`,
      anchor ? `动作中文名（定名，必须逐字采用）: ${anchor}` : null,
      list("steps（原文步骤）", input.instructions),
      list("form_cues（要领提示）", input.form_cues),
      list("common_mistakes（常见错误）", input.common_mistakes),
      `breathing（呼吸法）: ${input.breathing?.trim() || "无"}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  });
  return [
    `共 ${inputs.length} 个动作。逐个翻译并深化，输出 JSON 数组（顺序与输入一致）：`,
    '[{"name": "原英文名（原样返回）", "name_zh": "中文名", "steps": ["..."], "cues": ["..."], "mistakes": ["..."], "breathing": "..."} 或 null]',
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

export interface BatchContentResult {
  /** 校验通过（含步数对齐与名称回链） */
  ok: TranslatedExercise[];
  /** 两轮后仍未通过校验的输入（调用方走单条兜底） */
  failed: TranslationInput[];
  usage: { in: number; out: number };
}

/**
 * 批量四段深化翻译（两轮制）：
 *   第一轮全量批 → 逐条校验（schema 由 callLlmJson 保证，此处复核名称回链
 *   与步数对齐）；未过项带错误反馈进第二轮小批重试；仍失败返回 failed。
 * Zod 整体解析失败同样走第二轮（带「输出必须是 JSON 数组」反馈）。
 */
export async function translateExercisesBatch(
  channel: LlmChannel,
  systemPrompt: string,
  inputs: TranslationInput[],
  anchorMap: Map<string, string>,
): Promise<BatchContentResult> {
  const label = `translateBatch:${inputs.length}`;
  const usage = { in: 0, out: 0 };
  let pendingInputs = inputs;
  const okMap = new Map<string, TranslatedExercise>();
  let carryError = "";

  for (let attempt = 1; attempt <= 2 && pendingInputs.length > 0; attempt++) {
    const feedback =
      attempt === 1
        ? ""
        : `\n\n【上一轮部分输出未通过校验，本轮只重译下列动作，必须修正】\n${carryError}\n严格保证：输出为 JSON 数组；name 为原英文名原样；steps 条数与该动作原文步骤一致。`;
    try {
      const { value, usage: u } = await callLlmJson(
        channel,
        systemPrompt,
        buildBatchUserPrompt(pendingInputs, anchorMap) + feedback,
        ContentBatchSchema,
        `${label}#${attempt}`,
      );
      usage.in += u.in;
      usage.out += u.out;

      const errors: string[] = [];
      const byName = new Map(value.map((el) => [el.name, el]));
      const nextPending: TranslationInput[] = [];
      for (const input of pendingInputs) {
        const el = byName.get(input.name);
        if (!el) {
          nextPending.push(input);
          errors.push(`${input.name}: 输出缺失`);
          continue;
        }
        const result: TranslatedExercise = {
          id: input.id,
          name: input.name,
          name_zh: el.name_zh.trim(),
          steps: el.steps.map((s) => s.trim()),
          cues: el.cues.map((s) => s.trim()),
          mistakes: el.mistakes.map((s) => s.trim()),
          breathing: el.breathing?.trim() || null,
        };
        const alignment = stepAlignment(result, input);
        if (alignment !== null) {
          nextPending.push(input);
          errors.push(`${input.name}: ${alignment}`);
          continue;
        }
        okMap.set(input.name, result);
      }
      pendingInputs = nextPending;
      carryError = errors.join("\n");
    } catch (error) {
      // 整批 Zod 解析失败：带错误进下一轮（第二轮仍失败则已得成果照常返回，
      // 全部剩余项归 failed 交调用方单条兜底，不丢弃一轮已通过项）
      carryError = `${label}#${attempt} 整批解析失败：${(error as Error).message.slice(0, 200)}`;
    }
  }

  return {
    ok: inputs.filter((i) => okMap.has(i.name)).map((i) => okMap.get(i.name)!),
    failed: pendingInputs,
    usage,
  };
}
