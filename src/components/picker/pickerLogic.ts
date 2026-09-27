/**
 * A8+A9 动作选择器纯逻辑（筛选 / 搜索兜底 / 排序 / 参数摘要）
 *
 * 全部为纯函数，便于单测；组件层只消费结果（智能排序只呈现结果，不在 UI 解释）。
 */

import type {
  PickerDraftSet,
  PickerExercise,
  PickerKind,
  PickerRegion,
  PickerSelectionItem,
  PickerSetPlan,
} from './pickerData';

// ---------------------------------------------------------------------------
// 筛选 + 排序
// ---------------------------------------------------------------------------

export interface PickerFilters {
  kind: PickerKind | 'all';
  region: PickerRegion | 'all';
  muscle: string | 'all';
}

/**
 * 搜索兜底：中文名 / 英文名 / 全拼 / 拼音首字母 均可命中。
 * 搜索词非空时跨全库检索（忽略三行筛选，搜索即兜底路径）。
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
 * 三行正交筛选 + 排序。
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
        (filters.kind === 'all' || ex.kind === filters.kind) &&
        (filters.region === 'all' || ex.region === filters.region) &&
        (filters.muscle === 'all' || ex.muscles.includes(filters.muscle)),
    );
  }

  return [...result].sort((a, b) => (hasHistory ? a.rank - b.rank : a.hotRank - b.hotRank));
}

/** 列表按主肌群分组；入参已排序，分组按首次出现顺序（即名次顺序）。 */
export function groupByMuscle(list: PickerExercise[]): Array<{ muscle: string; items: PickerExercise[] }> {
  const groups: Array<{ muscle: string; items: PickerExercise[] }> = [];
  const index = new Map<string, number>();
  for (const ex of list) {
    const key = ex.muscle;
    const i = index.get(key);
    if (i === undefined) {
      index.set(key, groups.length);
      groups.push({ muscle: key, items: [ex] });
    } else {
      groups[i].items.push(ex);
    }
  }
  return groups;
}

/** 「常用」徽标：有训练历史时智能排序前 3；新手态不出现。 */
export const COMMON_BADGE_MAX_RANK = 3;

export function showCommonBadge(ex: PickerExercise, hasHistory: boolean): boolean {
  return hasHistory && ex.rank <= COMMON_BADGE_MAX_RANK;
}

// ---------------------------------------------------------------------------
// 参数摘要 + 草稿组
// ---------------------------------------------------------------------------

let draftIdSeq = 0;

/** 稳定可测的草稿组 id（纯前端 mock，不引入 uuid 依赖） */
export function createDraftId(): string {
  draftIdSeq += 1;
  return `picker-set-${draftIdSeq}`;
}

export function resetDraftIdSeqForTest(): void {
  draftIdSeq = 0;
}

/** 建议值 → 可编辑草稿组（智能填充的填入来源） */
export function planToDraftSets(plans: PickerSetPlan[]): PickerDraftSet[] {
  return plans.map(p => ({
    id: createDraftId(),
    role: p.role,
    weight: p.weight,
    reps: p.reps,
    durationSec: p.durationSec ?? 0,
  }));
}

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
 * - 时长型（有氧/拉伸，全部组按秒计）：单组「20分钟 · RPE 5」，多组「3组×45秒 · RPE 6」
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
