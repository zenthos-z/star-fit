/**
 * Plan Adjustment — 缺勤顺延规则（E3 / issue #2）
 *
 * program-progression 知识（progression-rules.md §三/§四）的代码化：
 * 「不补课」与「固定课表顺延而非跳过」的确定性查表逻辑。
 *
 * 红线：
 *  - 本模块是**纯函数**：只产出决策（decision），不写库、不调 LLM、
 *    绝不触发计划重新生成——错过的条目只在既有实体上顺延或置换。
 *  - 算术与查表留 Service（AI 绝对禁止介入算术计算）；
 *    Agent 只可向用户解释规则，执行由 Service/上层应用层完成。
 *
 * 决策表（输入：本周条目 + 今日日期；输出：每条目一个动作）：
 *
 * | 条目状态                    | 日期相对今日 | 今日已有条目? | 决策              |
 * | --------------------------- | ------------ | ------------- | ----------------- |
 * | completed / skipped（终态） | 任意         | —             | keep（不动）      |
 * | planned / adjusted          | 今日或未来    | —             | keep（照常执行）  |
 * | planned / adjusted          | 已过（错过）  | 否（休息日）   | carry_over_today  |
 * |                             |              |               | （顺延并入今日）  |
 * | planned / adjusted          | 已过（错过）  | 是（训练日）   | mark_skipped      |
 * |                             |              |               | （不补课：不把    |
 * |                             |              |               | 错过容量叠进今日）|
 *
 * 上层应用决策：carry_over_today → 更新 entry_date 为今日（sort_order 追加）；
 * mark_skipped → 条目状态迁移为 skipped（契约状态机 planned/adjusted → skipped）。
 */

import { PLAN_ENTRY_DATE_PATTERN, type PlanEntry } from "shared/contracts";

// ---------------------------------------------------------------------------
// 决策类型
// ---------------------------------------------------------------------------

/** 单条目的缺勤处置动作（查表结果） */
export type AbsenceAction =
  | "keep" // 终态 / 今日 / 未来条目：不动
  | "carry_over_today" // 错过且今日空闲：顺延并入今日
  | "mark_skipped"; // 错过且今日已有训练：置换跳过（不补课）

export interface MissedEntryResolution {
  entry_id: string;
  /** 条目原日期（决策上下文，应用层排查用） */
  entry_date: string;
  action: AbsenceAction;
  /** mark_skipped 时的原因码（其余动作为 null） */
  reason: "missed_and_day_full" | null;
}

export interface ResolveMissedInput {
  /** 今日日历日 YYYY-MM-DD（边界：entry_date === today 属于「今日条目」） */
  today: string;
  /** 本周全部条目（含各日、各状态；Service 从 Repository 取，本函数不查库） */
  entries: PlanEntry[];
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

/**
 * 缺勤顺延决策（纯查表，无 IO、无日期算术库依赖）。
 *
 * 「今日是否已有条目」按 entries 中 entry_date === today 的**非终态**条目
 * 判定（终态条目不算占座——今天还没练的计划条目才是今天的训练）。
 *
 * @throws Error today 形态非法（YYYY-MM-DD；Zod 红线：抛错不静默）
 */
export function resolveMissedEntries(
  input: ResolveMissedInput,
): MissedEntryResolution[] {
  if (!PLAN_ENTRY_DATE_PATTERN.test(input.today)) {
    throw new Error(
      `resolveMissedEntries: today 必须为 YYYY-MM-DD（当前: ${input.today}）`,
    );
  }

  const isTerminal = (e: PlanEntry) =>
    e.status === "completed" || e.status === "skipped";

  // 今日占座判定：今日存在未完成（planned/adjusted）条目 → 训练日
  const todayHasActiveTraining = input.entries.some(
    (e) => e.entry_date === input.today && !isTerminal(e),
  );

  return input.entries.map((entry) => {
    // ① 终态（completed/skipped）：历史事实，永不回改
    // ② 今日 / 未来条目：照常执行
    if (isTerminal(entry) || entry.entry_date >= input.today) {
      return {
        entry_id: entry.id,
        entry_date: entry.entry_date,
        action: "keep" as const,
        reason: null,
      };
    }
    // ③ 错过（entry_date < today 且未完成）：
    //    今日休息 → 顺延并入今日；今日已有训练 → 置换跳过（不补课）
    return todayHasActiveTraining
      ? {
          entry_id: entry.id,
          entry_date: entry.entry_date,
          action: "mark_skipped" as const,
          reason: "missed_and_day_full" as const,
        }
      : {
          entry_id: entry.id,
          entry_date: entry.entry_date,
          action: "carry_over_today" as const,
          reason: null,
        };
  });
}
