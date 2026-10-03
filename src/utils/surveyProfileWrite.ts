/**
 * surveyProfileWrite — 问卷答案 → 静态画像写库映射（issue #114 批 B5b）
 *
 * 纯确定性模块（spec docs/specs/survey-redesign-v2.md §2.2 末列 + §4 修法 3）：
 * 题库 value 即契约枚举值，按 id 直取直写，零中文映射、零文本换算。
 * 仅保留两条确定性转换：experience value→training_age 月数；
 * equipment_items 固定追加 'bodyweight'（EXERCISE_EQUIPMENT 隐式可用，
 * spec §2.3——不设题，写库时确定性代码追加）。
 *
 * 归一兜底（守「Zod 校验失败必须抛错或记录日志」红线）：写入前值不在契约
 * 枚举/数值域 → console.warn 并跳过该字段（失败可观测，不静默写错值）。
 * 未知键（旧 Agent 措辞卡、旧 4 题卡的 frequency/equipment 等）一律忽略，
 * 提交不 crash。
 *
 * 伤病（injuries）与自由补充（notes）刻意不进静态画像：原文随问卷提交
 * 交给 Agent（update_profile 登记 active_limitations / write_memory 记录，
 * spec §4 修法 2）——消灭顶层私造键 raw_injuries 的死代码路径。
 */

import { PreferencesSchema, BasicInfoSchema } from 'shared/contracts';

/** experience value → 训练年龄（月）。spec §2.2 定稿：纯新手 1 个月 */
export const EXPERIENCE_TO_TRAINING_AGE: Record<string, number> = {
  beginner_zero: 1,
  beginner: 3,
  intermediate: 12,
  advanced: 36,
};

/** 契约枚举运行时值（单一真源 = Zod schema，不手抄第二份） */
const GOAL_VALUES: readonly string[] = (PreferencesSchema.shape.goal as { unwrap: () => { options: readonly string[] } }).unwrap().options;
const GENDER_VALUES: readonly string[] = (BasicInfoSchema.shape.gender as { unwrap: () => { options: readonly string[] } }).unwrap().options;

/** 表单值 → 数值（字符串数字可过，非数值 undefined） */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * profile_intake 问卷答案 → PUT /profile/static 的嵌套 patch。
 * 只产 basic_info / preferences 两个嵌套键（控制器只转发这四键，
 * 顶层键会被静默丢弃——#114 缺口 3b/3c 的根因，不再重蹈）。
 * 无可写字段返回 null（调用方跳过请求）。
 */
export function buildProfileIntakeStaticPatch(
  responses: Record<string, unknown>,
): Record<string, unknown> | null {
  const basic: Record<string, unknown> = {};
  const prefs: Record<string, unknown> = {};

  // goal：value 直写，枚举外 warn+skip（不回退默认值，消灭静默写错值）
  const goal = responses['goal'];
  if (!isBlank(goal)) {
    if (GOAL_VALUES.includes(String(goal))) {
      prefs.goal = String(goal);
    } else {
      console.warn('[surveyProfileWrite] goal 值不在契约枚举，跳过写入:', goal);
    }
  }

  // experience → training_age 月数（确定性 map，非 AI）
  const experience = responses['experience'];
  if (!isBlank(experience)) {
    const months = EXPERIENCE_TO_TRAINING_AGE[String(experience)];
    if (months !== undefined) {
      basic.training_age = months;
    } else {
      console.warn('[surveyProfileWrite] experience 值不在题库枚举，跳过写入:', experience);
    }
  }

  // weight_kg / age / height_cm → basic_info（契约 z.coerce.number，直写数值）
  const weight = toNumber(responses['weight_kg']);
  if (weight !== undefined) basic.weight = weight;
  const age = toNumber(responses['age']);
  if (age !== undefined) basic.age = age;
  const height = toNumber(responses['height_cm']);
  if (height !== undefined) basic.height = height;

  // gender：契约枚举内才写
  const gender = responses['gender'];
  if (!isBlank(gender)) {
    if (GENDER_VALUES.includes(String(gender))) {
      basic.gender = String(gender);
    } else {
      console.warn('[surveyProfileWrite] gender 值不在契约枚举，跳过写入:', gender);
    }
  }

  // equipment_items（children 多选）→ preferences.equipment，固定追加 bodyweight
  const items = responses['equipment_items'];
  if (Array.isArray(items) && items.length > 0) {
    const equipment = items.map(String).filter(Boolean);
    if (!equipment.includes('bodyweight')) equipment.push('bodyweight');
    prefs.equipment = equipment;
  }

  // weekly_frequency：单值 1-6（契约 z.coerce.number().int().min(1).max(7)）。
  // 只传单值——区间字符串（旧 '3-4'）在此 warn+skip，不再 parseInt 静默取下界。
  const weeklyRaw = responses['weekly_frequency'];
  const weekly = toNumber(weeklyRaw);
  if (!isBlank(weeklyRaw)) {
    if (weekly !== undefined && Number.isInteger(weekly) && weekly >= 1 && weekly <= 7) {
      prefs.weekly_frequency_days = weekly;
    } else {
      console.warn('[surveyProfileWrite] weekly_frequency 非单值 1-7，跳过写入:', weeklyRaw);
    }
  }

  // session_minutes → preferences.time_constraint（分钟）
  const minutes = toNumber(responses['session_minutes']);
  if (minutes !== undefined) prefs.time_constraint = minutes;

  const patch: Record<string, unknown> = {};
  if (Object.keys(basic).length > 0) patch.basic_info = basic;
  if (Object.keys(prefs).length > 0) patch.preferences = prefs;
  return Object.keys(patch).length > 0 ? patch : null;
}
