/**
 * Progression Policy — program-progression 决策表代码化（E3 / issue #2）
 *
 * 领域知识（backend/src/services/mas/skills/program-progression/knowledge/
 * split-selection.md §一 与 progression-rules.md §一/§二）的**代码真源**：
 * 分化选择、渐进超负荷策略、加重步进与 deload 节拍从 Markdown 说明性
 * 知识收敛为确定性纯函数（查表 + 算术），供 Service 与测试直接引用。
 * skill 的 .md 保留为 Agent 的解释性知识，决策口径以本文件为准。
 *
 * 红线：算术永远留 Service（AI 绝对禁止介入算术计算）——本模块是
 * Service 侧纯函数集合，无 IO、无 LLM、无日期库依赖。
 */

import {
  FitnessLevelSchema,
  type FitnessLevel,
  type WeeklyPlanSplit,
} from "shared/contracts";

// ---------------------------------------------------------------------------
// 输入域
// ---------------------------------------------------------------------------

/** 训练部位带（加重步进随部位切换：上肢小步 / 下肢大步） */
export type LimbZone = "upper" | "lower";

/** 生物性别（加重步进修正：女性上肢可降至 1-2.5kg） */
export type BiologicalSex = "male" | "female";

/** 渐进超负荷策略（progression-rules.md §一 策略表） */
export type ProgressionStrategy =
  | "double_progression" // 双重递进（初学者-中级，默认）
  | "linear" // 线性加重（初学者前 3-6 个月）
  | "percent_1rm"; // 百分比递进（有 1RM 记录的中高级）

/** 决策结果统一形态：值 + 依据（Agent 可原样转述，无需自行推演） */
export interface PolicyDecision<T> {
  value: T;
  /** 为什么（决策表行号/规则条目的人类可读引用） */
  rationale: string;
}

// ---------------------------------------------------------------------------
// ① 分化决策表（split-selection.md §一）
// ---------------------------------------------------------------------------

/**
 * 按每周可用天数 + 经验等级选分化（决策表代码化）。
 *
 * | 天数 | beginner        | intermediate      | advanced           |
 * | ---- | --------------- | ----------------- | ------------------ |
 * | ≤3   | full_body       | full_body         | full_body          |
 * | 4    | upper_lower     | upper_lower       | upper_lower        |
 * | 5    | upper_lower*    | hybrid            | hybrid             |
 * | 6    | upper_lower*    | push_pull_legs    | custom（PPL+弱项）|
 * | ≥7   | upper_lower*    | push_pull_legs    | custom（PPL+弱项）|
 *
 * *降级行（表中「初学者禁止」的显式处理）：推拉腿 ×2 容量大、要求恢复
 * 到位，初学者请求 5-6 天时降级为上下分化（恢复优先），绝不排出超出
 * 恢复能力的分化；≥7 天按 6 天口径处理（任何分化都不排满 7 天）。
 */
export function selectSplit(
  daysPerWeek: number,
  fitnessLevel: FitnessLevel,
): PolicyDecision<WeeklyPlanSplit> {
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 14) {
    throw new Error(
      `selectSplit: daysPerWeek 必须为 1-14 的整数（当前: ${daysPerWeek}）`,
    );
  }
  const level = FitnessLevelSchema.parse(fitnessLevel);
  const days = Math.min(daysPerWeek, 7); // ≥7 天按 7 天口径封顶

  if (days <= 3) {
    return {
      value: "full_body",
      rationale: "split-selection §一：2-3 天全身分化，频率与恢复天然平衡",
    };
  }
  if (days === 4) {
    return {
      value: "upper_lower",
      rationale: "split-selection §一：4 天上下分化，每肌群一周 2 次刺激",
    };
  }
  if (days === 5) {
    if (level === "beginner") {
      return {
        value: "upper_lower",
        rationale:
          "split-selection §一降级：5 天混合分化面向中级；初学者恢复优先，" +
          "维持上下分化（富余日可作轻量有氧/技术日）",
      };
    }
    return {
      value: "hybrid",
      rationale: "split-selection §一：5 天上下 + 推拉腿混合编排",
    };
  }
  // days 6-7
  if (level === "beginner") {
    return {
      value: "upper_lower",
      rationale:
        "split-selection §一：推拉腿 ×2 初学者禁止（恢复不到位）；降级上下分化",
    };
  }
  if (level === "intermediate") {
    return {
      value: "push_pull_legs",
      rationale: "split-selection §一：6 天推拉腿 ×2，容量大要求恢复到位",
    };
  }
  return {
    value: "custom",
    rationale:
      "split-selection §一：5-6 天 + 想练多于恢复 → 推拉腿 + 弱项日（高级）",
  };
}

// ---------------------------------------------------------------------------
// ② 渐进超负荷策略选择（progression-rules.md §一 策略表）
// ---------------------------------------------------------------------------

/**
 * 按经验等级 / 训练年龄 / 1RM 记录选进阶策略（决策表代码化）：
 *  - 有 1RM 记录且非初学者 → percent_1rm
 *  - 否则训练年龄 ≤ 6 个月 → linear（初学者前 3-6 个月）
 *  - 否则 → double_progression（初学者-中级默认）
 */
export function selectProgressionStrategy(
  fitnessLevel: FitnessLevel,
  trainingAgeMonths: number,
  has1RMRecord: boolean,
): PolicyDecision<ProgressionStrategy> {
  const level = FitnessLevelSchema.parse(fitnessLevel);
  if (
    !Number.isFinite(trainingAgeMonths) ||
    trainingAgeMonths < 0 ||
    trainingAgeMonths > 720
  ) {
    throw new Error(
      `selectProgressionStrategy: trainingAgeMonths 必须为 0-720（当前: ${trainingAgeMonths}）`,
    );
  }

  if (has1RMRecord && level !== "beginner") {
    return {
      value: "percent_1rm",
      rationale: "progression-rules §一：有 1RM 记录的中高级走百分比递进",
    };
  }
  if (trainingAgeMonths <= 6) {
    return {
      value: "linear",
      rationale:
        "progression-rules §一：初学者前 3-6 个月线性加重（每周上肢 +2.5% / 下肢 +5%）",
    };
  }
  return {
    value: "double_progression",
    rationale: "progression-rules §一：双重递进为初学者-中级默认策略",
  };
}

// ---------------------------------------------------------------------------
// ③ 加重步进算术（progression-rules §一 执行细则）
// ---------------------------------------------------------------------------

/**
 * 双重递进加重步进（kg）：次数顶到范围上限后的加重值。
 * 查表：下肢 5kg；上肢 2.5kg；女性上肢降至 1.25kg（「可降至 1-2.5kg」
 * 的确定性取值 = 2.5 步进折半，保证 2.5kg 步进的整数半步）。
 */
export function doubleProgressionStepKg(
  limbZone: LimbZone,
  sex: BiologicalSex = "male",
): number {
  if (limbZone === "lower") return 5;
  return sex === "female" ? 1.25 : 2.5;
}

/**
 * 双重递进下一次重量（kg）= 当前重量 + 步进。纯算术，无随机。
 */
export function nextDoubleProgressionWeight(
  currentWeightKg: number,
  limbZone: LimbZone,
  sex: BiologicalSex = "male",
): number {
  assertPositiveWeight(currentWeightKg);
  return roundToQuarterKg(
    currentWeightKg + doubleProgressionStepKg(limbZone, sex),
  );
}

/**
 * 线性加重下一次重量（kg）：每周上肢 +2.5% / 下肢 +5%，对齐 2.5kg 步进
 * （progression-rules §一：重量保持整数或 2.5kg 步进）。
 */
export function nextLinearProgressionWeight(
  currentWeightKg: number,
  limbZone: LimbZone,
): number {
  assertPositiveWeight(currentWeightKg);
  const pct = limbZone === "lower" ? 0.05 : 0.025;
  return roundToQuarterKg(currentWeightKg * (1 + pct));
}

// ---------------------------------------------------------------------------
// ④ Deload 节拍判定（progression-rules.md §二）
// ---------------------------------------------------------------------------

/** Deload 触发信号（满足其一即建议减载） */
export interface DeloadSignals {
  /** 距上次减载的连续训练周数 */
  weeksSinceDeload: number;
  /** 连续表现明显下滑的次数（同重量次数下降 >20% 为一次） */
  consecutivePerformanceDrops: number;
  /** 持续疲劳/睡眠变差/关节隐隐不适（非急性伤痛） */
  persistentFatigue: boolean;
  /** 生活重大压力期（考试、加班季、搬家） */
  majorLifeStress: boolean;
}

export interface DeloadDecision {
  deload: boolean;
  /** 命中的触发条目（Agent/前端可原样转述） */
  reasons: string[];
}

/**
 * Deload 判定（决策表代码化，满足其一即 true）：
 *  - 连续训练 ≥ 4 周未减载（progression-rules §二取保守下界）
 *  - 连续 2 次训练表现明显下滑
 *  - 持续疲劳信号
 *  - 生活重大压力期（「主动减载好过被迫断练」）
 */
export function shouldDeload(signals: DeloadSignals): DeloadDecision {
  const reasons: string[] = [];
  if (
    Number.isFinite(signals.weeksSinceDeload) &&
    signals.weeksSinceDeload >= 4
  ) {
    reasons.push("连续训练 ≥ 4 周未减载");
  }
  if (
    Number.isFinite(signals.consecutivePerformanceDrops) &&
    signals.consecutivePerformanceDrops >= 2
  ) {
    reasons.push("连续 2 次训练表现明显下滑");
  }
  if (signals.persistentFatigue) {
    reasons.push("持续疲劳 / 睡眠变差 / 关节隐隐不适");
  }
  if (signals.majorLifeStress) {
    reasons.push("生活重大压力期（主动减载好过被迫断练）");
  }
  return { deload: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// 内部算术
// ---------------------------------------------------------------------------

function assertPositiveWeight(weightKg: number): void {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error(`progressionPolicy: 重量必须为正数（当前: ${weightKg}）`);
  }
}

/** 对齐 0.25kg（2.5 步进的折半粒度），规避浮点尾差 */
function roundToQuarterKg(weightKg: number): number {
  return Math.round(weightKg * 4) / 4;
}
