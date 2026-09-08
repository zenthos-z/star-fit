/**
 * workoutQualityGate (Q1) — Agent 生成质量检测：数据一致性校验
 *
 * 目标：防止 workout_complete 场景下 Agent 幻觉——在 summary/survey 卡片里
 * 编造与真实训练数据不符的数字（CLAUDE.md 红线：AI 禁止介入算术计算，
 * 数字必须来自 load_history 的真实库内数据）。
 *
 * 检查策略（纯函数，无 IO，完全可单测）：
 *   从卡片文本（prose + data 序列化）中提取「指标关键词 + 数字」对，与
 *   session 真实 stats 逐项比对。只有当「指标在 stats 中存在」且「数值
 *   偏差超出容差」时才报 issue——Agent 提到的其它数字（如百分比、PR 记录）
 *   不误伤。
 *
 * 容差：绝对值 <=1 或相对偏差 <=2%（四舍五入/单位换算的正常浮动）。
 */

import type { StructuredError } from './uiHintValidator.js';

/** 质量检测结果 */
export interface QualityReport {
  ok: boolean;
  issues: StructuredError[];
}

/** 检测用的会话数据形状（history_summary.sessions 的最后一条） */
export interface WorkoutSessionFacts {
  exercises?: Array<{ name?: string; type?: string; [k: string]: unknown }>;
  stats?: {
    totalVolume?: number;
    setsCount?: number;
    totalCardioDurationSec?: number;
    totalDistanceM?: number;
    durationMinutes?: number;
    avgHr?: number;
    [k: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// 指标提取规则：关键词（中英）→ stats 字段 + 单位换算
// ---------------------------------------------------------------------------

interface MetricRule {
  /** stats 字段名 */
  field: 'totalVolume' | 'setsCount' | 'totalCardioDurationSec' | 'totalDistanceM' | 'durationMinutes' | 'avgHr';
  /** 触发关键词（小写匹配） */
  keywords: string[];
  /** 提取值的换算：raw × factor 后与 stats 比较 */
  factor: number;
  /** 人类可读的指标名（错误消息用） */
  label: string;
  /**
   * 复合单位语境排除：数字后紧跟这些写法（如「分/公里」「min/km」）时，
   * 该数字是配速/速率，不是本指标的主张值，跳过校验。
   */
  compoundUnitExclusions?: string[];
}

const METRIC_RULES: MetricRule[] = [
  { field: 'totalVolume', keywords: ['总容量', '总负荷', '容量', 'total volume', 'volume'], factor: 1, label: '总容量(kg)' },
  { field: 'setsCount', keywords: ['完成组', '总组数', '组数', '完成了', 'sets'], factor: 1, label: '组数' },
  { field: 'totalCardioDurationSec', keywords: ['有氧时长', '运动时长', ' cardio'], factor: 1, label: '有氧时长(秒)' },
  {
    field: 'durationMinutes',
    keywords: ['分钟', 'minutes', 'min'],
    factor: 1,
    label: '时长(分钟)',
    // 「30 分钟」可能描述的是有氧动作时长（= totalCardioDurationSec/60），
    // 而不是 session 墙钟时长——两个真值都算合法候选（见 durationCandidates）。
    compoundUnitExclusions: ['分/公里', '分钟/公里', 'min/km'],
  },
  {
    field: 'totalDistanceM',
    keywords: ['总距离', '距离', 'distance', '公里', 'km'],
    factor: 1,
    label: '距离',
    // 「6 分/公里」是配速：数字6 的后窗口含「公里」会被误当距离主张。
    compoundUnitExclusions: ['分/公里', '分钟/公里', '分/km', 'min/km'],
  },
  { field: 'avgHr', keywords: ['平均心率', '心率', 'heart rate', 'bpm'], factor: 1, label: '平均心率(bpm)' },
];

/** 数字匹配：支持 1,200 / 1.5 / 30 等写法 */
const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?)/g;

const normalize = (s: string): string => s.toLowerCase();

/**
 * 从一段文本中提取某指标的所有 (数字, 关键词) 候选。
 * 关键词可出现在数字前 12 字符窗口（"总容量 1200kg"）或后 6 字符窗口
 * （中文量词后置："12 组"、"4 km"）。
 */
function extractMetricValues(text: string, rule: MetricRule): number[] {
  const lower = normalize(text);
  const values: number[] = [];
  for (const match of lower.matchAll(NUMBER_RE)) {
    const numStr = match[1].replace(/,/g, '');
    const value = Number(numStr) * rule.factor;
    const windowStart = Math.max(0, match.index - 12);
    const window = lower.slice(windowStart, match.index);
    const afterStart = match.index + match[0].length;
    const afterWindow = lower.slice(afterStart, afterStart + 6);
    // 复合单位排除：「6 分/公里」的 6 是配速不是距离/时长主张，跳过。
    if (rule.compoundUnitExclusions?.some((cu) => afterWindow.includes(cu))) {
      continue;
    }
    const keywordHit = rule.keywords.some((kw) => window.includes(kw) || afterWindow.includes(kw));
    // 中文后置量词「N 组」：组数语境（前缀非「第」序号写法）
    const bareSetCounter =
      rule.field === 'setsCount' && /^\s*组/.test(afterWindow) && !/第\s*$/.test(window);
    if (keywordHit || bareSetCounter) {
      values.push(value);
    }
  }
  return values;
}

/** 容差判定：绝对差 <=1 或相对偏差 <=2% */
function withinTolerance(actual: number, claimed: number): boolean {
  const absDiff = Math.abs(actual - claimed);
  if (absDiff <= 1) return true;
  const base = Math.max(Math.abs(actual), 1);
  return absDiff / base <= 0.02;
}

/** 公里/米 双向换算候选：距离类数字可能是 4.5km 或 4500m */
function distanceCandidates(value: number): number[] {
  return [value, value * 1000, value / 1000];
}

/**
 * 单项动作心率真值集合：正文提到某个单项动作的心率（如「户外跑 平均心率 138」）
 * 时，只要与任一单项真值一致即视为合法（全局 avgHr 不是唯一合法值）。
 */
function perExerciseHrValues(facts: WorkoutSessionFacts): number[] {
  const values: number[] = [];
  for (const ex of facts.exercises ?? []) {
    for (const key of ['avg_hr', 'heartRate', 'avgHr', 'hr']) {
      const v = (ex as Record<string, unknown>)?.[key];
      if (typeof v === 'number' && v > 0) {
        values.push(v);
        break;
      }
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// 核心检查
// ---------------------------------------------------------------------------

/**
 * 校验一张 uiHint 卡片引用的训练数据是否与真实 session 一致。
 *
 * @param cardText 卡片可见文本（含序列化后的 data 数值）
 * @param facts    从 DB 读出的本次训练真实数据；null 表示库内无 session
 *                 （此时跳过数值校验——没有真值就没有幻觉判据）
 */
export function checkWorkoutCardQuality(
  cardText: string,
  facts: WorkoutSessionFacts | null,
): QualityReport {
  const issues: StructuredError[] = [];

  if (!facts?.stats) {
    return { ok: true, issues };
  }
  const stats = facts.stats;

  for (const rule of METRIC_RULES) {
    const actual = stats[rule.field];
    // stats 里没有该指标（如本次没有有氧）→ 无真值，跳过
    if (typeof actual !== 'number' || (rule.field === 'setsCount' ? actual < 0 : actual <= 0)) {
      continue;
    }
    const claimed = extractMetricValues(cardText, rule);
    // 真值池：除本指标真值外，补充同类合法引用值——
    //   心率：单项动作心率（Agent 复述某动作的心率≠编造全局均值）
    //   分钟：「N 分钟」也可能描述有氧动作时长（totalCardioDurationSec/60）
    const extraActuals: number[] =
      rule.field === 'avgHr'
        ? perExerciseHrValues(facts)
        : rule.field === 'durationMinutes' && typeof stats.totalCardioDurationSec === 'number'
          ? [stats.totalCardioDurationSec / 60]
          : [];
    for (const value of claimed) {
      const candidates =
        rule.field === 'totalDistanceM' ? distanceCandidates(value) : [value];
      const actualPool = [actual, ...extraActuals];
      const match = actualPool.some((a) =>
        candidates.some((c) => withinTolerance(a, c)),
      );
      if (!match) {
        issues.push({
          code: 'data_mismatch',
          message:
            `卡片中的${rule.label}「${value}」与真实训练数据不符（实际: ${actual}）。` +
            '所有数字必须来自 load_history 返回的数据，禁止编造或估算。',
          path: ['data'],
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * 把格式化训练记录序列化为检测文本。
 * 卡片的 prose 由调用方拼接；这里负责把 data 的数值平铺进去，
 * 保证 Agent 在 data 里写的数字也会被校验。
 */
export function cardToCheckableText(card: unknown): string {
  return typeof card === 'string' ? card : JSON.stringify(card ?? '');
}

/**
 * 从最新 session（history_summary.sessions[-1]）提取检测用的 facts。
 * 返回 null 表示没有可校验的 session。
 */
export function extractSessionFacts(historySummary: unknown): WorkoutSessionFacts | null {
  const sessions = (historySummary as { sessions?: unknown[] })?.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }
  const latest = sessions[sessions.length - 1];
  if (!latest || typeof latest !== 'object') {
    return null;
  }
  return latest as WorkoutSessionFacts;
}
