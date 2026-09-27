/**
 * A8+A9 动作选择器纯逻辑（筛选 / 搜索兜底 / 排序 / 参数摘要）
 *
 * 全部为纯函数，便于单测；组件层只消费结果（智能排序只呈现结果，不在 UI 解释）。
 */

import type {
  PickerDraftSet,
  PickerExercise,
  PickerExerciseType,
  PickerSelectionItem,
} from './pickerData';
import { TYPE_LABELS } from './pickerData';

// ---------------------------------------------------------------------------
// 筛选 + 排序
// ---------------------------------------------------------------------------

/** 三维正交筛选：维度间 AND，维度内多选 OR；空数组 = 该维度不限 */
export interface PickerFilters {
  types: PickerExerciseType[];
  muscles: string[];
  equipment: string[];
}

export const EMPTY_FILTERS: PickerFilters = { types: [], muscles: [], equipment: [] };

export function isFiltersEmpty(filters: PickerFilters): boolean {
  return filters.types.length === 0 && filters.muscles.length === 0 && filters.equipment.length === 0;
}

/**
 * 搜索兜底：中文名 / 英文名 / 全拼 / 拼音首字母 均可命中。
 * 搜索词非空时跨全库检索（忽略筛选维度，搜索即兜底路径）。
 */
export function matchSearch(ex: PickerExercise, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return (
    ex.name.toLowerCase().includes(t) ||
    ex.nameEn.toLowerCase().includes(t) ||
    ex.pinyin.includes(t) ||
    ex.pinyinInitials.includes(t)
  );
}

/**
 * 三维正交筛选 + 排序。
 * - hasHistory=true：按 rank（智能排序预置序）呈现，前 3 位由 UI 层加「常用」徽标；
 * - hasHistory=false（新手态）：降级热门排序（hotRank），无「常用」徽标，列表顶部出引导卡。
 */
export function filterAndSortExercises(
  list: PickerExercise[],
  filters: PickerFilters,
  searchTerm: string,
  hasHistory: boolean,
): PickerExercise[] {
  let result = list;

  if (searchTerm.trim()) {
    result = result.filter(ex => matchSearch(ex, searchTerm));
  } else {
    result = result.filter(
      ex =>
        (filters.types.length === 0 || filters.types.includes(ex.exerciseType)) &&
        (filters.muscles.length === 0 || filters.muscles.some(m => ex.muscles.includes(m))) &&
        (filters.equipment.length === 0 || filters.equipment.includes(ex.equipment)),
    );
  }

  return [...result].sort((a, b) => (hasHistory ? a.rank - b.rank : a.hotRank - b.hotRank));
}

/** 「常用」徽标：有训练历史时智能排序前 3；新手态不出现。 */
export const COMMON_BADGE_MAX_RANK = 3;

export function showCommonBadge(ex: PickerExercise, hasHistory: boolean): boolean {
  return hasHistory && ex.rank <= COMMON_BADGE_MAX_RANK;
}

/** 筛选胶囊回显文案：未选=「所有X」；1 个=其名；多个=「A等N项」 */
export function summarizeFilterDim(selected: string[], allText: string, labelOf: (v: string) => string): string {
  if (selected.length === 0) return allText;
  if (selected.length === 1) return labelOf(selected[0]);
  return `${labelOf(selected[0])}等${selected.length}项`;
}

/** 类型维度胶囊回显 */
export function summarizeTypeDim(selected: PickerExerciseType[]): string {
  return summarizeFilterDim(selected, '所有类型', v => TYPE_LABELS[v as PickerExerciseType]);
}

// ---------------------------------------------------------------------------
// 列表行副标题
// ---------------------------------------------------------------------------

/**
 * 列表行副标题：全类型统一口径——目标肌群 + 器械中文。
 * （时长语义不再进副标题：链路 A 化后参数建议由 SuggestionService 异步填充，
 * 列表行只呈现动作固有属性。）
 */
export function rowSubtitle(ex: PickerExercise): string {
  return `${ex.muscles.join(' · ')} · ${ex.equipmentLabel}`;
}

// ---------------------------------------------------------------------------
// 参数摘要 + 草稿组
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(1));
}

/** 秒 → 展示时长（≥120s 用分钟，其余用秒） */
export function formatDuration(sec: number): string {
  if (sec >= 120) return `${fmtNum(+(sec / 60).toFixed(1))}分钟`;
  return `${fmtNum(sec)}秒`;
}

function formatRange(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? fmtNum(min) : `${fmtNum(min)}-${fmtNum(max)}`;
}

/**
 * 清单页参数摘要一行，如「4组×8-10 · 60kg · RPE 7」。
 * - 时长型（有氧/拉伸/静态，全部组按秒计）：单组「20分钟 · RPE 5」，多组「3组×45秒 · RPE 6」
 * - 次数型：「N组×次区间 · 负荷 · RPE n」，负荷=kg 值/区间，全零为「自重」
 */
export function formatParamSummary(exercise: PickerExercise, sets: PickerDraftSet[], targetRpe: number): string {
  void exercise; // 保留入参位：摘要当前仅由参数决定，动作维度字段后续按需参与
  const n = sets.length;
  const rpePart = `RPE ${targetRpe}`;
  if (n === 0) return rpePart;

  const isDurationBased = sets.every(s => s.durationSec > 0);
  if (isDurationBased) {
    const secs = sets.map(s => s.durationSec);
    if (n === 1) return `${formatDuration(secs[0])} · ${rpePart}`;
    const allSame = secs.every(v => v === secs[0]);
    const durPart = allSame ? formatDuration(secs[0]) : formatRange(secs);
    return `${n}组×${durPart} · ${rpePart}`;
  }

  const reps = sets.map(s => s.reps).filter(v => v > 0);
  const weights = sets.map(s => s.weight).filter(v => v > 0);
  const uniqueWeights = [...new Set(weights)];

  const loadPart =
    uniqueWeights.length === 0
      ? '自重'
      : uniqueWeights.length === 1
        ? `${fmtNum(uniqueWeights[0])}kg`
        : `${formatRange(uniqueWeights)}kg`;

  const countPart = reps.length > 0 ? `${n}组×${formatRange(reps)}` : `${n}组`;
  return `${countPart} · ${loadPart} · ${rpePart}`;
}

/** 清单项便捷摘要 */
export function summaryOfItem(item: PickerSelectionItem): string {
  return formatParamSummary(item.exercise, item.sets, item.targetRpe);
}

export type { PickerDraftSet } from './pickerData';

// ---------------------------------------------------------------------------
// 草稿组 id
// ---------------------------------------------------------------------------

let draftIdSeq = 0;

/** 稳定可测的草稿组 id（纯前端 mock，不引入 uuid 依赖） */
export function createDraftId(): string {
  draftIdSeq += 1;
  return `picker-set-${draftIdSeq}`;
}

// ---------------------------------------------------------------------------
// 拖拽落位兜底（v5：Reorder 实时换位存在滞后，松手时按最终偏移确定性落位）
// ---------------------------------------------------------------------------

/**
 * 由拖拽纵向位移计算目标落位。
 * 行高等高时：目标 = 起始下标 + round(位移/行高)，夹紧到列表范围内。
 */
export function computeDragTarget(startIdx: number, offsetY: number, rowHeight: number, length: number): number {
  if (rowHeight <= 0 || length <= 1) return startIdx;
  const steps = Math.round(offsetY / rowHeight);
  return Math.max(0, Math.min(length - 1, startIdx + steps));
}
