/**
 * 动作展示名解析（A6 中文优先，issue #19 PR 返工）
 *
 * 统一口径：展示层动作名「中文优先，英文回退」。
 *  - 存储名已含汉字（新选动作/中文自建/AI 计划）→ 原样使用
 *  - 携带 libraryId 且库索引命中 → name_zh（无则回退库英文名）
 *  - 仅英文名（历史会话/旧计划，无 id 关联）→ 按英文名查库索引 name_zh
 *  - 均未命中 → 原样返回存储名（不虚构、不炸）
 *
 * 只做展示解析，不改写任何存储数据（历史会话名称保留原值）。
 */

import type { Exercise } from '@/storage/schemas';

/** 库索引（id → 行 / 英文名 → 行），由 useExerciseLibraryIndex 构建 */
export interface ExerciseLibraryIndex {
  byId: Map<string, Exercise>;
  byName: Map<string, Exercise>;
}

export const EMPTY_LIBRARY_INDEX: ExerciseLibraryIndex = {
  byId: new Map(),
  byName: new Map(),
};

/** 是否含汉字（判定存储名已经是中文，无需再查库） */
export function hasCJK(text: string | null | undefined): boolean {
  if (!text) return false;
  return /[一-鿿]/.test(text);
}

/** 库行 → 展示名（name_zh 优先，trim 防空白串） */
export function libraryDisplayName(ex: Exercise | undefined): string | null {
  if (!ex) return null;
  const zh = ex.name_zh?.trim();
  return zh ? zh : ex.name;
}

export interface ResolveOptions {
  /** 动作库索引（可选——未注入时仅做汉字判定直通） */
  library?: ExerciseLibraryIndex | null;
  /** 库行 id（metadata.libraryId；优先于按名匹配） */
  libraryId?: string | null;
}

/**
 * 存储名 → 展示名（中文优先）。
 * 空名/未知名原样返回，由调用方决定占位文案。
 */
export function resolveExerciseDisplayName(
  storedName: string | null | undefined,
  options: ResolveOptions = {},
): string {
  const name = storedName?.trim() ?? '';
  if (name === '') return storedName ?? '';
  if (hasCJK(name)) return name;

  const lib = options.library;
  if (lib) {
    const byId = options.libraryId ? lib.byId.get(options.libraryId) : undefined;
    const hit = byId ?? lib.byName.get(name);
    const resolved = libraryDisplayName(hit);
    if (resolved) return resolved;
  }
  return name;
}
