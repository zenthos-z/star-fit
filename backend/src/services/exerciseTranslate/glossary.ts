/**
 * 术语表加载与 prompt 渲染（A6，issue #19）。
 *
 * 职责（纯数据，无 DB / 无 LLM）：
 *  - loadGlossary：读 terminology-glossary.json（红线：parseJSONSafe + Zod 校验，
 *    失败即抛不静默），构建全名定名层 / 术语词表层
 *  - renderGlossaryForPrompt：术语表 → system prompt 锚定文本，供名称与正文
 *    翻译共用，锁定全文一致性
 *  - nameOverride：动作名 → 全名定名层精确命中（名称翻译第一优先级；
 *    未命中走 LLM 兜底，见 translate.ts）
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseJSONSafe } from "../../../../shared/dist/contracts/index.js";
import type {
  LoadedGlossaryEntry,
  TerminologyGlossary,
  TerminologyGlossaryFile,
} from "./types.js";

/** 全名定名分节名（该层条目即「动作名翻译唯一依据」） */
export const OVERRIDE_SECTION = "full_name_overrides";

/** 术语条目 schema（source 三档受控） */
const GlossaryEntrySchema = z.object({
  en: z.string().min(1),
  zh: z.string().min(1),
  source: z.enum(["通行", "直译", "存疑"]),
  note: z.string().optional(),
});

const GlossaryFileSchema = z.object({
  meta: z.object({
    version: z.string(),
    created: z.string(),
    issue: z.number(),
    purpose: z.string(),
    translation_principles: z.array(z.string()),
    review_note: z.string(),
  }),
  sections: z.record(z.string(), z.array(GlossaryEntrySchema)),
});

/**
 * 加载术语表（术语表先行——管道启动第一步，失败即中止）。
 * 分节写入顺序：普通分节先写、full_name_overrides 最后写（byName 重名胜出
 * = 全名定名优先级最高）。
 */
export function loadGlossary(path: string): TerminologyGlossary {
  const text = readFileSync(path, "utf8");
  const parsed = parseJSONSafe<TerminologyGlossaryFile>(
    text,
    "exerciseTranslate.loadGlossary",
  );
  if (!parsed) {
    throw new Error(`术语表不是合法 JSON: ${path}`);
  }
  const file = GlossaryFileSchema.parse(parsed);

  const sections = Object.entries(file.sections).sort(
    ([a], [b]) => sectionRank(a) - sectionRank(b),
  );
  const entries: LoadedGlossaryEntry[] = [];
  const byName = new Map<string, LoadedGlossaryEntry>();
  for (const [section, list] of sections) {
    for (const entry of list) {
      const loaded = { ...entry, section };
      entries.push(loaded);
      byName.set(loaded.en, loaded);
    }
  }
  if (entries.length === 0) {
    throw new Error(`术语表为空: ${path}`);
  }

  return {
    meta: file.meta,
    entries,
    byName,
    overrides: entries.filter((e) => e.section === OVERRIDE_SECTION),
    vocabulary: entries.filter((e) => e.section !== OVERRIDE_SECTION),
  };
}

function sectionRank(section: string): number {
  return section === OVERRIDE_SECTION ? 1 : 0;
}

/**
 * 动作名 → 术语表精确命中（区分大小写；未命中返回 null 走 LLM 兜底）。
 * 术语表任意分节的 en 精确等值即为人工定名（词表层也含完整动作名，如
 * Burpee / Farmer's Walk）；跨层重名时 byName 已按全名定名层优先解析。
 */
export function nameOverride(
  glossary: TerminologyGlossary,
  name: string,
): LoadedGlossaryEntry | null {
  return glossary.byName.get(name) ?? null;
}

/**
 * 术语表 → prompt 锚定文本。结构：
 *   一、动作全名定名表（动作名翻译的唯一依据，逐字采用，不得改写）
 *   二、术语词表（正文翻译遇到下列术语必须采用统一译名）
 * 非通行条目显式标注来源（存疑条目保持表内译法，待人工复核，模型不得改写）。
 */
export function renderGlossaryForPrompt(glossary: TerminologyGlossary): string {
  const lines: string[] = [];
  lines.push(
    "【一、动作全名定名表】（动作名翻译的唯一依据，逐字采用，不得改写）",
  );
  for (const e of glossary.overrides) {
    lines.push(`${e.en} = ${e.zh}${markSource(e)}`);
  }
  lines.push("");
  lines.push("【二、术语词表】（正文翻译遇到下列术语必须采用统一译名）");
  for (const e of glossary.vocabulary) {
    lines.push(`${e.en} = ${e.zh}${markSource(e)}`);
  }
  return lines.join("\n");
}

function markSource(entry: LoadedGlossaryEntry): string {
  if (entry.source === "通行") {
    return "";
  }
  return entry.source === "存疑"
    ? `〔存疑，按此译名，不得改写〕`
    : `〔直译口径，按此译名〕`;
}
