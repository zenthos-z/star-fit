/**
 * A6 翻译管道类型（issue #19）。
 *
 * 术语表（terminology-glossary.json）与翻译产物的形态定义；
 * Zod schema 见 glossary.ts / translate.ts（类型一律由 schema 推导，不在本文件重复）。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

/** 译名来源三档（issue #19 口径：通行/直译/存疑；存疑不强行定名） */
export type GlossarySource = "通行" | "直译" | "存疑";

/** 术语条目（术语表文件中的形态） */
export type GlossaryEntry = {
  en: string;
  zh: string;
  source: GlossarySource;
  note?: string;
};

/** 加载后的术语条目（附来源分节；full_name_overrides = 全名定名层） */
export type LoadedGlossaryEntry = GlossaryEntry & { section: string };

/** 术语表文件形态（meta + 分节条目数组） */
export type TerminologyGlossaryFile = {
  meta: {
    version: string;
    created: string;
    issue: number;
    purpose: string;
    translation_principles: string[];
    review_note: string;
  };
  sections: Record<string, GlossaryEntry[]>;
};

/** 加载后的术语表（附扁平化查找表与分层视图） */
export type TerminologyGlossary = {
  meta: TerminologyGlossaryFile["meta"];
  /** 全部分节条目（保持文件顺序；渲染/统计用） */
  entries: LoadedGlossaryEntry[];
  /** en（精确，区分大小写）→ 条目；full_name_overrides 分节最后写入（重名胜出） */
  byName: Map<string, LoadedGlossaryEntry>;
  /** 全名定名层（动作名翻译唯一依据） */
  overrides: LoadedGlossaryEntry[];
  /** 术语词表层（正文翻译锚定） */
  vocabulary: LoadedGlossaryEntry[];
};

/** 翻译输入（exercises 行的教学列子集；空数组/null = 源库无此字段） */
export interface TranslationInput {
  id: string;
  name: string;
  instructions: string[] | null;
  form_cues: string[] | null;
  common_mistakes: string[] | null;
  breathing: string | null;
}

/** 单条动作翻译产物（instructions_zh 编码前的结构化四段） */
export interface TranslatedExercise {
  id: string;
  name: string;
  name_zh: string;
  steps: string[];
  cues: string[];
  mistakes: string[];
  breathing: string | null;
}
