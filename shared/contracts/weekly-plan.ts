/**
 * Weekly Plan Contracts (周计划持久化实体)
 *
 * 架构拍板（AI 隐形体验架构 2026-09-24 / issue #10）：计划从「每次生成」
 * 变为持久化实体，默认复用、调整例外。本文件是周计划数据契约的唯一真源：
 *
 *  - weekly_plan  周计划：周标识(week_id) + 用户(user_id) + 分化(split) + 状态
 *  - plan_entry   每日条目：日期 + exercise_id 引用 + 目标组数
 *                  + 目标负荷区间(RPE 或 %1RM) + 条目状态机
 *
 * 状态机（plan_entry）：
 *      planned ──▶ adjusted ──▶ completed
 *         │            │
 *         └────────────┴──▶ skipped
 *  completed / skipped 为终态；同态迁移（from === to）视为幂等重放，放行。
 *  迁移表与判定函数在此定义（单一真源），Repository 层据此强制执行。
 *
 * 命名：数据库与应用层统一 snake_case（CLAUDE.md 红线），
 * 字段形态对齐 PostgreSQL 表 weekly_plans / plan_entries
 * （迁移 backend/src/db/postgresql/migrations/001_weekly_plans.sql）。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { z } from 'zod';

// ============================================================================
// 周标识 (Week Identifier)
// ============================================================================

/**
 * ISO-8601 周标识：YYYY-Www，周号 01-53（如 2026-W40）。
 * 与 weekly_plans 表的 (user_id, week_id) 唯一索引配套——每周每用户一份计划。
 */
export const WEEK_ID_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

export const WeekIdSchema = z
  .string()
  .regex(WEEK_ID_PATTERN, 'week_id 必须为 ISO 周格式 YYYY-Www（如 2026-W40，周号 01-53）');

export type WeekId = z.infer<typeof WeekIdSchema>;

// ============================================================================
// 分化 (Split)
// ============================================================================

/**
 * 训练分化——决定一周如何切分训练日。
 * 取值对齐领域知识 backend/src/services/mas/skills/program-progression/
 * knowledge/split-selection.md（全身 / 上下 / 推拉腿 / 混合 / 自定义）。
 */
export const WeeklyPlanSplitSchema = z.enum([
  'full_body',       // 全身分化（2-3 天）
  'upper_lower',     // 上下分化（4 天，Upper/Lower ×2）
  'push_pull_legs',  // 推拉腿（PPL，5-6 天）
  'hybrid',          // 混合编排（如 上下 + 推拉腿，5 天）
  'custom',          // 自定义（含「推拉腿 + 弱项日」等高级编排）
]);

export type WeeklyPlanSplit = z.infer<typeof WeeklyPlanSplitSchema>;

// ============================================================================
// 状态机 (Status)
// ============================================================================

/**
 * 周计划状态：active（本周生效，默认）/ archived（归档）。
 * 归档发生在周结束后或被新计划替代时，行保留作历史。
 */
export const WeeklyPlanStatusSchema = z.enum(['active', 'archived']).default('active');

export type WeeklyPlanStatus = z.infer<typeof WeeklyPlanStatusSchema>;

/**
 * 条目状态全集：planned → adjusted → completed / skipped。
 */
export const PLAN_ENTRY_STATUSES = ['planned', 'adjusted', 'completed', 'skipped'] as const;

export const PlanEntryStatusSchema = z.enum(PLAN_ENTRY_STATUSES).default('planned');

export type PlanEntryStatus = z.infer<typeof PlanEntryStatusSchema>;

/**
 * 合法迁移表（单向、终态封闭）：
 *  - planned  可迁 adjusted / completed / skipped
 *  - adjusted 可迁 adjusted（再调整）/ completed / skipped
 *  - completed / skipped 为终态，无出边
 * 同态迁移（from === to）由 canTransitionPlanEntryStatus 放行为幂等重放，
 * 不在本表中体现。
 */
export const PLAN_ENTRY_STATUS_TRANSITIONS: Readonly<
  Record<PlanEntryStatus, readonly PlanEntryStatus[]>
> = {
  planned: ['adjusted', 'completed', 'skipped'],
  adjusted: ['adjusted', 'completed', 'skipped'],
  completed: [],
  skipped: [],
};

/**
 * 判定条目状态迁移是否合法。
 * 同态（from === to）视为幂等重放，恒放行；其余按迁移表。
 */
export function canTransitionPlanEntryStatus(
  from: PlanEntryStatus,
  to: PlanEntryStatus,
): boolean {
  if (from === to) return true;
  return PLAN_ENTRY_STATUS_TRANSITIONS[from].includes(to);
}

// ============================================================================
// 目标负荷区间 (Target Load)
// ============================================================================

/**
 * 负荷表达方式：
 *  - rpe        主观强度区间（0-10，支持 0.5 步进如 7-8）
 *  - percent_1rm 估计 1RM 百分比区间（0-100，如 70-80）
 */
export const PlanLoadTypeSchema = z.enum(['rpe', 'percent_1rm']);

export type PlanLoadType = z.infer<typeof PlanLoadTypeSchema>;

/**
 * 目标负荷区间：[min, max] 闭区间，边界语义随 type 切换。
 * 跨字段约束（min ≤ max、按 type 的取值边界）在 superRefine 中校验。
 */
export const TargetLoadSchema = z
  .object({
    type: PlanLoadTypeSchema,
    min: z.number(),
    max: z.number(),
  })
  .superRefine((load, ctx) => {
    if (load.min > load.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `target_load.min (${load.min}) 不能大于 max (${load.max})`,
        path: ['min'],
      });
    }
    if (load.type === 'rpe' && (load.min < 0 || load.max > 10)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rpe 区间必须在 [0, 10]（当前: ${load.min}-${load.max}）`,
        path: ['min'],
      });
    }
    if (load.type === 'percent_1rm' && (load.min <= 0 || load.max > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `percent_1rm 区间必须在 (0, 100]（当前: ${load.min}-${load.max}）`,
        path: ['min'],
      });
    }
  });

export type TargetLoad = z.infer<typeof TargetLoadSchema>;

// ============================================================================
// 实体 (Database Row Shape)
// ============================================================================

/**
 * 条目日期格式：ISO 日历日 YYYY-MM-DD（无时区，避免跨时区漂移）。
 */
export const PLAN_ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * weekly_plan 行形态（表 weekly_plans）。
 * (user_id, week_id) 唯一——每周每用户一份计划。
 */
export const WeeklyPlanSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  week_id: WeekIdSchema,
  split: WeeklyPlanSplitSchema,
  status: WeeklyPlanStatusSchema,
  created_at: z.string().datetime(), // ISO 8601 UTC
  updated_at: z.string().datetime(), // ISO 8601 UTC
});

export type WeeklyPlan = z.infer<typeof WeeklyPlanSchema>;

/**
 * plan_entry 行形态（表 plan_entries）。
 * exercise_id 为 NanoID（12-24 字符），引用 exercises.id。
 * 目标负荷在应用层为嵌套对象 target_load，数据库为
 * target_load_type / target_load_min / target_load_max 三列（Repository 负责映射）。
 */
export const PlanEntrySchema = z.object({
  id: z.string().uuid(),
  weekly_plan_id: z.string().uuid(),
  user_id: z.string().uuid(), // 冗余用户列：按用户隔离查询，不依赖联表
  entry_date: z.string().regex(PLAN_ENTRY_DATE_PATTERN, 'entry_date 必须为 YYYY-MM-DD'),
  exercise_id: z.string().min(12).max(24), // NanoID（对齐 ExerciseSchema.id）
  target_sets: z.number().int().positive(),
  target_load: TargetLoadSchema,
  status: PlanEntryStatusSchema,
  sort_order: z.number().int().min(0).default(0), // 同日内条目排序
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type PlanEntry = z.infer<typeof PlanEntrySchema>;

/**
 * 周计划 + 全部条目（按用户+周查询的返回形态）。
 */
export const WeeklyPlanWithEntriesSchema = z.object({
  plan: WeeklyPlanSchema,
  entries: z.array(PlanEntrySchema),
});

export type WeeklyPlanWithEntries = z.infer<typeof WeeklyPlanWithEntriesSchema>;

// ============================================================================
// 创建输入 (Repository Input)
// ============================================================================

/**
 * 单条目创建输入：不含 id / weekly_plan_id / user_id（由计划创建统一注入），
 * status / sort_order 缺省（planned / 0）。
 */
export const PlanEntryInputSchema = z.object({
  entry_date: z.string().regex(PLAN_ENTRY_DATE_PATTERN, 'entry_date 必须为 YYYY-MM-DD'),
  exercise_id: z.string().min(12).max(24), // NanoID（对齐 ExerciseSchema.id）
  target_sets: z.number().int().positive(),
  target_load: TargetLoadSchema,
  status: PlanEntryStatusSchema, // 缺省 planned
  sort_order: z.number().int().min(0).default(0),
});

export type PlanEntryInput = z.infer<typeof PlanEntryInputSchema>;

/**
 * 周计划创建输入：一次建计划 + 全部条目（事务内完成）。
 * 200 条上限 = 7 天 × ~28 条/天的宽松护栏，防异常载荷。
 */
export const CreateWeeklyPlanInputSchema = z.object({
  user_id: z.string().uuid(),
  week_id: WeekIdSchema,
  split: WeeklyPlanSplitSchema,
  status: WeeklyPlanStatusSchema, // 缺省 active
  entries: z.array(PlanEntryInputSchema).max(200).default([]),
});

export type CreateWeeklyPlanInput = z.infer<typeof CreateWeeklyPlanInputSchema>;
