/**
 * weeklyPlanView — 周计划视图模型纯函数（D2 周计划卡 / C2 信息页共用）。
 *
 * 职责：把两类同构数据源归一到「当日详情」视图模型，供共用详情子页渲染：
 *   ① 后端确定性课表 GET /api/schedule/today（TodayScheduleResponse，
 *      T9 起条目随行携带 day_focus/rationale/category/sets；旧计划
 *      sets=null → 回落 target_sets × target_load 区间展开）
 *   ② AI weekly_plan 卡数据（WeeklyPlanCardData，sets 数组按组展开、
 *      每组参数独立：第1组 60kg×8 / 第2组 65kg×6）
 *
 * T10/#67：三段式归组（groupExercisesByCategory，旧数据回落 main）、
 * 当日说明（rationale，缺省整区隐藏）、逐组处方消费在此收敛。
 *
 * 红线对齐：本文件只做展示层推导（周几/标签/文案），不做训练算术；
 * 类型一律从 shared/contracts 导入。禁止引入进度/状态/执行率语义
 * （周计划卡是纯净新生成展示，issue #8 定稿）。
 */
import {
  resolvePlanEntryCategory,
  type PlanEntryCategory,
  type TargetLoad,
  type TodayScheduleEntry,
  type TodayScheduleResponse,
  type WeeklyPlanCardData,
  type WeeklyPlanDay,
  type WeeklyPlanSplit,
} from 'shared/contracts';

// ============================================================================
// 视图模型
// ============================================================================

/** 单组目标参数行。weightKg/reps/durationSec 来自 AI 卡；loadText 为区间文案；
 * rpe 为 T9 逐组处方的主观强度（金字塔/递减时逐组可不同）。 */
export interface PlanDaySetVM {
  setNo: number;
  weightKg?: number;
  reps?: number;
  durationSec?: number;
  /** 该组主观强度 RPE（T9 逐组处方；无配重动作作为负荷锚展示） */
  rpe?: number;
  /** 无具体配重时的负荷文案（「RPE 7–8」/「70–80% 1RM」，旧计划回落用） */
  loadText?: string;
  note?: string;
}

export interface PlanDayExerciseVM {
  exerciseId?: string;
  name: string;
  /** 段位（warmup/main/cooldown）：映射层已回落 main（T9 契约单一真源），渲染层免猜 */
  category: PlanEntryCategory;
  sets: PlanDaySetVM[];
  note?: string;
}

/** 当日详情子页视图模型（D2 卡 / C2 信息页共用渲染契约）。 */
export interface PlanDayDetailVM {
  entryDate: string;
  /** 大标题：「周五 · 腿」 */
  title: string;
  /** 分化标签 chip（腿臀 / 推拉腿…） */
  splitLabel?: string;
  /** 导航栏 meta（「第 2 周 · 力量块」） */
  metaLine?: string;
  /** 当日说明（安排原因/目标/注意要点，T9）：缺省=旧计划，说明区整区隐藏 */
  rationale?: string;
  rest: boolean;
  exercises: PlanDayExerciseVM[];
}

// ============================================================================
// 日历与文案
// ============================================================================

/** 本地日历日 → YYYY-MM-DD（无时区漂移，与 plan_entries.entry_date 同形态） */
export function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 今天（本地日历日） */
export function todayDateKey(): string {
  return formatDateKey(new Date());
}

const DOW_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const DOW_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** YYYY-MM-DD → 周几下标（0=周一 … 6=周日）；非法日期返回 null */
export function dowIndexOf(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return (d.getDay() + 6) % 7;
}

export function dowFullLabel(dateStr: string): string {
  const i = dowIndexOf(dateStr);
  return i === null ? '' : DOW_FULL[i];
}

export function dowShortLabel(dateStr: string): string {
  const i = dowIndexOf(dateStr);
  return i === null ? '' : DOW_SHORT[i];
}

/** YYYY-MM-DD → 日号（横条里的 22 / 26） */
export function dayNumber(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return m ? Number(m[3]) : 0;
}

/**
 * 某日所在 ISO 周的 7 个本地日历日（周一 → 周日）。
 * 前端仅用于「本周横条」取日期范围；week_id 归属由服务器推导，前端不算术。
 */
export function getWeekDates(anchor: Date = new Date()): string[] {
  const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const mondayOffset = (base.getDay() + 6) % 7; // 0=周一
  base.setDate(base.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    return formatDateKey(d);
  });
}

/** 数值展示：整数不带小数点，小数最多 1 位（60 / 72.5） */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** 目标负荷区间 → 文案：「RPE 7–8」/「70–80% 1RM」（单点区间收成单值） */
export function formatTargetLoad(load: TargetLoad): string {
  const span = load.min === load.max
    ? trimNum(load.min)
    : `${trimNum(load.min)}–${trimNum(load.max)}`;
  return load.type === 'rpe' ? `RPE ${span}` : `${span}% 1RM`;
}

/** 分化枚举 → 中文标签（信息页横条 meta / 详情标题用） */
export function splitLabelZh(split: WeeklyPlanSplit): string {
  switch (split) {
    case 'full_body': return '全身';
    case 'upper_lower': return '上下';
    case 'push_pull_legs': return '推拉腿';
    case 'hybrid': return '混合';
    case 'custom': return '自定义';
  }
}

// ============================================================================
// 数据源 → 视图模型
// ============================================================================

/**
 * 今日课表条目 → 逐组行。T9 逐组处方在位（sets 非空）→ 按组展开真实参数
 * （配重可省＝自重/计时类，rpe 恒随行）；旧计划 sets 为 null → 回落
 * target_sets 行统一带条目级负荷区间文案（isUniformSetBlock 折叠为「第 1–N 组」）。
 */
function scheduleEntrySetsToVM(entry: TodayScheduleEntry): PlanDaySetVM[] {
  if (entry.sets && entry.sets.length > 0) {
    return entry.sets.map((s) => ({
      setNo: s.set_no,
      weightKg: s.weight_kg,
      reps: s.reps,
      rpe: s.rpe,
    }));
  }
  return Array.from({ length: entry.target_sets }, (_, i) => ({
    setNo: i + 1,
    loadText: formatTargetLoad(entry.target_load),
  }));
}

/** 后端课表响应 → 详情 VM（T9 结构化字段：rationale/category/sets 随行消费）。 */
export function todayScheduleDayToVM(resp: TodayScheduleResponse, metaLine?: string): PlanDayDetailVM {
  const dow = dowFullLabel(resp.date);
  if (resp.status === 'no_plan' || resp.entries.length === 0) {
    return {
      entryDate: resp.date,
      title: dow,
      splitLabel: resp.split ? splitLabelZh(resp.split) : undefined,
      metaLine,
      rest: true,
      exercises: [],
    };
  }
  return {
    entryDate: resp.date,
    title: resp.split ? `${dow} · ${splitLabelZh(resp.split)}` : dow,
    splitLabel: resp.split ? splitLabelZh(resp.split) : undefined,
    metaLine,
    // 同日条目冗余同值，取首个非空（旧计划全 null → undefined，说明区隐藏）
    rationale: resp.entries.find((e) => e.rationale)?.rationale ?? undefined,
    rest: false,
    exercises: resp.entries.map((e) => ({
      exerciseId: e.exercise_id,
      name: e.exercise_name,
      category: resolvePlanEntryCategory(e.category),
      sets: scheduleEntrySetsToVM(e),
    })),
  };
}

/** AI weekly_plan 卡的一天 → 详情 VM（逐组参数原样透传；rationale/category T9 可选随行）。 */
export function weeklyCardDayToVM(day: WeeklyPlanDay, metaLine?: string): PlanDayDetailVM {
  const dow = dowFullLabel(day.entry_date);
  const title = day.rest || !day.split_label
    ? dow
    : `${dow} · ${day.split_label}`;
  return {
    entryDate: day.entry_date,
    title,
    splitLabel: day.focus ?? day.split_label,
    metaLine,
    rationale: day.rationale,
    rest: day.rest || day.exercises.length === 0,
    exercises: day.exercises.map((e) => ({
      exerciseId: e.exercise_id,
      name: e.name,
      category: resolvePlanEntryCategory(e.category),
      note: e.note,
      sets: e.sets.map((s) => ({
        setNo: s.set,
        weightKg: s.weight,
        reps: s.reps,
        durationSec: s.duration,
        note: s.note,
      })),
    })),
  };
}

/** 选中日概览文案：「4 动作 · 13 组」（休息日返回 undefined） */
export function dayVolumeSummary(exercises: PlanDayExerciseVM[]): string | undefined {
  const exCount = exercises.length;
  const setCount = exercises.reduce((acc, e) => acc + e.sets.length, 0);
  if (exCount === 0) return undefined;
  return `${exCount} 动作 · ${setCount} 组`;
}

/** 动作名简列：「杠铃深蹲 · 罗马尼亚硬拉 · 腿举 · 坐姿腿弯举」
 * resolveName：可选展示名解析（A6 中文优先——存量英文名 → name_zh） */
export function exerciseNameLine(
  exercises: PlanDayExerciseVM[],
  resolveName?: (name: string) => string,
): string {
  return exercises.map((e) => (resolveName ? resolveName(e.name) : e.name)).join(' · ');
}

/**
 * 周计划卡 → 7 天纵列行模型（卡片列表渲染用；无进度/状态语义）。
 * days 不足 7 天时按 entry_date 升序原样返回（渲染端不补位）。
 * splitTag（分化短标签「推」）与 focus（肌群说明）分开携带——
 * 详情 chip 用 focus，列表橙块用 splitTag。
 */
export function weeklyCardRows(data: WeeklyPlanCardData): Array<
  PlanDayDetailVM & { splitTag?: string; focus?: string }
> {
  const metaLine = [data.week_label, data.phase_label].filter(Boolean).join(' · ');
  return [...data.days]
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    .map((d) => ({
      ...weeklyCardDayToVM(d, metaLine),
      splitTag: d.split_label,
      focus: d.focus,
    }));
}

/**
 * 三段式课表段落（T10/#67）：固定 warmup → main → cooldown 展示序，
 * 文案短小对仗；旧计划（category NULL）经映射层回落 main，落「正式动作」段。
 */
export const PLAN_CATEGORY_SECTIONS: ReadonlyArray<{
  category: PlanEntryCategory;
  label: string;
}> = [
  { category: 'warmup', label: '热身动作' },
  { category: 'main', label: '正式动作' },
  { category: 'cooldown', label: '收尾动作（拉伸）' },
];

/** 按段位归组：固定三段序、空段省略（全 main 的旧计划即单段，无空头部）。 */
export function groupExercisesByCategory(
  exercises: PlanDayExerciseVM[],
): Array<{ category: PlanEntryCategory; label: string; exercises: PlanDayExerciseVM[] }> {
  return PLAN_CATEGORY_SECTIONS
    .map((s) => ({
      ...s,
      exercises: exercises.filter((e) => e.category === s.category),
    }))
    .filter((g) => g.exercises.length > 0);
}

/**
 * 等参数折叠判定：组间无逐组差异（无配重/次数/时长/RPE 且负荷文案一致）时，
 * 详情页把 N 行折叠为一行「第 1–N 组」——排版工整（issue #8 修正 3）。
 */
export function isUniformSetBlock(sets: PlanDaySetVM[]): boolean {
  if (sets.length <= 1) return false;
  return sets.every((s) =>
    s.weightKg === undefined &&
    s.reps === undefined &&
    s.durationSec === undefined &&
    s.rpe === undefined &&
    !s.note &&
    s.loadText !== undefined &&
    s.loadText === sets[0].loadText
  );
}
