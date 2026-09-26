/**
 * weeklyPlanView — 周计划视图模型纯函数（D2 周计划卡 / C2 信息页共用）。
 *
 * 职责：把两类同构数据源归一到「当日详情」视图模型，供共用详情子页渲染：
 *   ① 后端确定性课表 GET /api/schedule/today（TodayScheduleResponse，
 *      条目只有 target_sets + target_load 区间，无逐组配重）
 *   ② AI weekly_plan 卡数据（WeeklyPlanCardData，sets 数组按组展开、
 *      每组参数独立：第1组 60kg×8 / 第2组 65kg×6）
 *
 * 红线对齐：本文件只做展示层推导（周几/标签/文案），不做训练算术；
 * 类型一律从 shared/contracts 导入。禁止引入进度/状态/执行率语义
 * （周计划卡是纯净新生成展示，issue #8 定稿）。
 */
import type {
  TargetLoad,
  TodayScheduleResponse,
  WeeklyPlanCardData,
  WeeklyPlanDay,
  WeeklyPlanSplit,
} from 'shared/contracts';

// ============================================================================
// 视图模型
// ============================================================================

/** 单组目标参数行。weightKg/reps/durationSec 来自 AI 卡；loadText 为区间文案。 */
export interface PlanDaySetVM {
  setNo: number;
  weightKg?: number;
  reps?: number;
  durationSec?: number;
  /** 无具体配重时的负荷文案（「RPE 7–8」/「70–80% 1RM」） */
  loadText?: string;
  note?: string;
}

export interface PlanDayExerciseVM {
  exerciseId?: string;
  name: string;
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

/** 后端课表响应 → 详情 VM。条目无逐组配重，按组展开行统一带区间文案。 */
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
    rest: false,
    exercises: resp.entries.map((e) => ({
      exerciseId: e.exercise_id,
      name: e.exercise_name,
      sets: Array.from({ length: e.target_sets }, (_, i) => ({
        setNo: i + 1,
        loadText: formatTargetLoad(e.target_load),
      })),
    })),
  };
}

/** AI weekly_plan 卡的一天 → 详情 VM（逐组参数原样透传）。 */
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
    rest: day.rest || day.exercises.length === 0,
    exercises: day.exercises.map((e) => ({
      exerciseId: e.exercise_id,
      name: e.name,
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

/** 动作名简列：「杠铃深蹲 · 罗马尼亚硬拉 · 腿举 · 坐姿腿弯举」 */
export function exerciseNameLine(exercises: PlanDayExerciseVM[]): string {
  return exercises.map((e) => e.name).join(' · ');
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
 * 等参数折叠判定：组间无逐组差异（无配重/次数/时长且负荷文案一致）时，
 * 详情页把 N 行折叠为一行「第 1–N 组」——排版工整（issue #8 修正 3）。
 */
export function isUniformSetBlock(sets: PlanDaySetVM[]): boolean {
  if (sets.length <= 1) return false;
  return sets.every((s) =>
    s.weightKg === undefined &&
    s.reps === undefined &&
    s.durationSec === undefined &&
    !s.note &&
    s.loadText !== undefined &&
    s.loadText === sets[0].loadText
  );
}
