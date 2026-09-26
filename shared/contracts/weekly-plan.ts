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

// ============================================================================
// 今日课表 (Today Schedule) — E2 确定性 API（issue #1）
// ============================================================================

/**
 * 今日课表三态（训练前零容忍等待路径的确定性响应形态）：
 *  - planned   今日有条目（正常训练日）
 *  - rest_day  本周有计划、今日无条目（休息日——前端按休息引导）
 *  - no_plan   本周无计划（确定性兜底：前端据此引导生成，本路径不调 AI）
 */
export const TodayScheduleStatusSchema = z.enum([
  'planned',
  'rest_day',
  'no_plan',
]);

export type TodayScheduleStatus = z.infer<typeof TodayScheduleStatusSchema>;

/**
 * 今日课表条目（展示形态）：plan_entries JOIN exercises.name 的投影。
 * 字段语义与 PlanEntrySchema 对齐，差异点：
 *  - 条目主键以 entry_id 暴露（与 exercise_id 区分，前端按它寻址条目状态）
 *  - exercise_name 来自 join（exercises.name NOT NULL，INNER JOIN 安全）
 */
export const TodayScheduleEntrySchema = z.object({
  entry_id: z.string().uuid(),
  exercise_id: z.string().min(12).max(24), // NanoID（对齐 ExerciseSchema.id）
  exercise_name: z.string().min(1),
  target_sets: z.number().int().positive(),
  target_load: TargetLoadSchema,
  status: PlanEntryStatusSchema,
  sort_order: z.number().int().min(0),
});

export type TodayScheduleEntry = z.infer<typeof TodayScheduleEntrySchema>;

/**
 * GET /api/schedule/today 响应契约（E2）：
 * 纯 DB 读、无 LLM、无网络外呼。date 为客户端日历日（可选 ?date= 传入，
 * 缺省服务器 UTC 当日）；week_id 由 date 推导（getIsoWeekId 单一真源）。
 * no_plan 时 split=null、entries=[]——前端据 status 引导，不在本路径生成。
 */
export const TodayScheduleResponseSchema = z
  .object({
    date: z.string().regex(PLAN_ENTRY_DATE_PATTERN, 'date 必须为 YYYY-MM-DD'),
    week_id: WeekIdSchema,
    status: TodayScheduleStatusSchema,
    split: WeeklyPlanSplitSchema.nullable(), // no_plan 时 null
    entries: z.array(TodayScheduleEntrySchema), // rest_day / no_plan 时空数组
  })
  .superRefine((res, ctx) => {
    // 三态形态锁定（兜底不漂移）：
    //  no_plan  → split 必为 null 且 entries 必为空（确定性兜底形态）
    //  非 no_plan（本周有计划）→ split 必有值（计划元数据随行）
    if (res.status === 'no_plan') {
      if (res.split !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'no_plan 时 split 必须为 null（本周无计划，无分化可言）',
          path: ['split'],
        });
      }
      if (res.entries.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'no_plan 时 entries 必须为空数组（不存在无计划的条目）',
          path: ['entries'],
        });
      }
    } else if (res.split === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${res.status} 时 split 不能为 null（本周存在计划，分化必随行）`,
        path: ['split'],
      });
    }
  });

export type TodayScheduleResponse = z.infer<typeof TodayScheduleResponseSchema>;

// ============================================================================
// ISO 周推导（单一真源）与调度策略输入域（E3）
// ============================================================================

/**
 * 经验等级——program-progression 分化决策表（split-selection）的输入域，
 * 与 exercises.difficulty 取值风格一致（beginner/intermediate/advanced）。
 */
export const FitnessLevelSchema = z.enum([
  'beginner',
  'intermediate',
  'advanced',
]);

export type FitnessLevel = z.infer<typeof FitnessLevelSchema>;

/**
 * ISO-8601 周推导：YYYY-MM-DD → YYYY-Www（周一为一周之始，周四规则定年）。
 *
 * week_id 推导的单一真源：Repository 参数校验、E2 今日课表 Service、
 * E3 周计划工具（mcpTools 的当前周缺省值）与前端共用，杜绝各处内联
 * 实现漂移（weeklyPlanRepository.test.ts 既有内联算法即由此提炼）。
 * 输入非法抛 Error（Zod 红线：抛错，不静默）。
 */
export function getIsoWeekId(dateStr: string): WeekId {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(
      `getIsoWeekId: date 必须为 YYYY-MM-DD（当前: ${dateStr}）`,
    );
  }
  // 周四规则：把日期校准到本周周四，取其年与周号（UTC 计算规避时区漂移）
  const cal = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  const day = cal.getUTCDay() || 7; // 周日=7
  cal.setUTCDate(cal.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cal.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((cal.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return WeekIdSchema.parse(
    `${cal.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
  );
}
