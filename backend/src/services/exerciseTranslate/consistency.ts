/**
 * 术语一致性检查（A6 抽检引擎，issue #19）——纯函数，无 DB / 无 LLM。
 *
 * 用途：译文回写后的抽检报告。对每条动作，取源文本中实际出现的术语词表
 * 词条（大小写不敏感精确词匹配），统计其统一译名是否出现在中文文本中：
 *  - hit：术语译名命中（含半角/全角括号、空格差异的宽松包含）
 *  - miss：术语在源文出现但译名未在译文出现（提示重写措辞漂移，非硬错误）
 *
 * 口径：miss 仅警示不改写——专业深化翻译允许重组句式，术语以语境为准；
 * 报告按动作聚合 miss 率，人工抽检时重点看 miss 集中的条目。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import type { LoadedGlossaryEntry, TerminologyGlossary } from "./types.js";

export interface TermCheckHit {
  en: string;
  zh: string;
  source: string;
  hit: boolean;
}

export interface TermCheckResult {
  /** 源文本命中的词表术语逐条结果（hit=true 的在前） */
  terms: TermCheckHit[];
  hitCount: number;
  missCount: number;
}

/** 源文本中出现的术语 → 译名是否出现在译文。
 *  源侧：词边界匹配（"ring" 不命中 "during"）；译侧：译名变体集任一命中
 *  即算（「胸大肌（胸肌）」接受 胸大肌 或 胸肌；忽略空白差异）。 */
export function checkTermConsistency(
  sourceEn: string,
  targetZh: string,
  glossary: TerminologyGlossary,
): TermCheckResult {
  const zhFlat = targetZh.replace(/\s+/g, "");

  const terms: TermCheckHit[] = [];
  for (const entry of glossary.vocabulary) {
    const key = entry.en.split(" / ")[0].trim().toLowerCase();
    if (key.length < 4) {
      continue;
    } // 过短词（Rep/Set 等）误报高，跳过
    if (!wordBoundaryMatch(sourceEn, key)) {
      continue;
    }
    const variants = zhVariants(entry.zh).filter((v) => v.length >= 2);
    const hit = variants.some((v) => zhFlat.includes(v));
    terms.push({ en: entry.en, zh: entry.zh, source: entry.source, hit });
  }
  return {
    terms,
    hitCount: terms.filter((t) => t.hit).length,
    missCount: terms.filter((t) => !t.hit).length,
  };
}

/** 词边界匹配：key 两侧不能紧邻 a-z 字母（大小写不敏感；其余字符均视为边界） */
function wordBoundaryMatch(source: string, key: string): boolean {
  const re = new RegExp(`(^|[^a-z])${escapeRegExp(key)}([^a-z]|$)`, "i");
  return re.test(source);
}

/** 译名 → 可接受变体集：主体按 ／/ 拆分；括注内容（并列译法）一并提取 */
function zhVariants(zh: string): string[] {
  const variants = new Set<string>();
  const notes = [...zh.matchAll(/（([^）]*)）/g)].map((m) => m[1]);
  const main = zh.replace(/（[^）]*）/g, "／");
  for (const part of main.split("／").flatMap((p) => p.split("/"))) {
    const v = part.replace(/\s+/g, "");
    if (v) {
      variants.add(v);
    }
  }
  for (const note of notes) {
    for (const part of note.split(/[／/、]/)) {
      const v = part.replace(/\s+/g, "");
      if (v) {
        variants.add(v);
      }
    }
  }
  return [...variants];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 动作名术语命中（术语表任意分节精确等值即定名；名称翻译应逐字一致） */
export function checkNameOverrideHit(
  name: string,
  nameZh: string,
  glossary: TerminologyGlossary,
): { override: LoadedGlossaryEntry | null; exact: boolean } {
  const hit = glossary.byName.get(name) ?? null;
  if (!hit) {
    return { override: null, exact: false };
  }
  return { override: hit, exact: nameZh === hit.zh };
}
