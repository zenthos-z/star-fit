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
 * @version 1.1.0
 * @created 2026-09-26
 * @history 1.1.0 2026-09-30 T9/#66 结构化契约：plan_entries 增加
 *          day_focus / rationale / category(warmup|main|cooldown) /
 *          sets 逐组处方（{set_no, weight_kg?, reps, rpe}）；全列可空，
 *          旧计划读取回落（category→main，sets→target_sets×target_load）。
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
// 结构化计划字段 (Structured Plan Fields) — T9 / issue #66
// ============================================================================

/**
 * 条目段位枚举：warmup 热身 / main 正式 / cooldown 收尾拉伸。
 * 三段式课表（热身→正式→收尾）的落库载体；同日内顺序由 sort_order 承载
 * （warmup 段靠前、cooldown 段靠后），category 标注段位语义。
 * 旧数据无该列（NULL）→ 读取侧经 resolvePlanEntryCategory 回落 'main'。
 */
export const PLAN_ENTRY_CATEGORY_VALUES = ['warmup', 'main', 'cooldown'] as const;

export const PlanEntryCategorySchema = z.enum(PLAN_ENTRY_CATEGORY_VALUES);

export type PlanEntryCategory = z.infer<typeof PlanEntryCategorySchema>;

/** 旧数据回落段位：无 category 的存量条目一律视作正式段（不炸、不猜热身） */
export const DEFAULT_PLAN_ENTRY_CATEGORY: PlanEntryCategory = 'main';

/**
 * 旧数据回落推导：category 为空（存量计划）时视作 'main'。
 * 展示层（TodayScheduleEntry 等）出库前调用，保证前端永远拿到三枚举之一。
 */
export function resolvePlanEntryCategory(
  category: PlanEntryCategory | null | undefined,
): PlanEntryCategory {
  return category ?? DEFAULT_PLAN_ENTRY_CATEGORY;
}

/**
 * 逐组处方单组（T9 / issue #66）：
 *  - set_no   组号，从 1 连续编号（跨字段约束：sets 在位时 1..N 与 target_sets 对齐）
 *  - weight_kg 该组目标重量 kg；可省（自重/弹力带/计时类动作）
 *  - reps     该组目标次数（正整数）
 *  - rpe      该组主观强度（0-10，支持 0.5 步进）——逐组可不同（金字塔/递减）
 * 与 target_load（条目级区间）分工：target_load 是「条目级负荷锚」，
 * sets 是「逐组展开的处方明细」；两者同源生成（sets 各组 rpe 应落在区间内，
 * 由生成侧技能保证，契约不重复校验——避免 Service 替 AI 做算术反被咬）。
 */
export const PlanSetPrescriptionSchema = z.object({
  set_no: z.number().int().positive(),
  weight_kg: z.number().optional(), // kg；assisted 沿用负值辅助约定
  reps: z.number().int().positive(),
  rpe: z.number().min(0).max(10),
});

export type PlanSetPrescription = z.infer<typeof PlanSetPrescriptionSchema>;

/**
 * 结构化字段跨字段校验（PlanEntrySchema / PlanEntryInputSchema 共用）：
 * sets 在位时必须与 target_sets 对齐（组数相等 + set_no 恰为 1..N 连续）。
 * 展示卡硬规则「sets.length = target_sets」在落库面的强制执行。
 */
function refinePlanEntryStructuredFields<
  T extends {
    target_sets: number;
    sets?: PlanSetPrescription[] | null;
  },
>(entry: T, ctx: z.RefinementCtx): void {
  const { sets, target_sets } = entry;
  if (sets === undefined || sets === null) return; // 旧数据/未携带：允许
  if (sets.length !== target_sets) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `sets 组数 (${sets.length}) 必须等于 target_sets (${target_sets})`,
      path: ['sets'],
    });
    return;
  }
  for (let i = 0; i < sets.length; i++) {
    if (sets[i].set_no !== i + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `sets[${i}].set_no 必须为 ${i + 1}（从 1 连续编号，当前: ${sets[i].set_no}）`,
        path: ['sets', i, 'set_no'],
      });
      return;
    }
  }
}

/** 结构化日/组字段片段（行形态：库列可空，出库带 null） */
const planEntryStructuredRowFields = {
  /** 当日聚焦短标签（腿/胸/背/肩/全身…）——同日条目冗余同值（无日表的降级设计） */
  day_focus: z.string().nullable(),
  /** 当日说明（安排原因/目标/注意要点）——同日条目冗余同值 */
  rationale: z.string().nullable(),
  /** 段位（warmup/main/cooldown）；旧数据 NULL → 读取侧回落 'main' */
  category: PlanEntryCategorySchema.nullable(),
  /** 逐组处方（T9）；旧数据 NULL → 消费方回落 target_sets × target_load 展示 */
  sets: z.array(PlanSetPrescriptionSchema).nullable(),
};

/** 结构化日/组字段片段（输入形态：全部可选，存量提案载荷不带也过） */
const planEntryStructuredInputFields = {
  day_focus: z.string().optional(),
  rationale: z.string().optional(),
  category: PlanEntryCategorySchema.optional(),
  sets: z.array(PlanSetPrescriptionSchema).optional(),
};

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
 * [T9 #66] 结构化字段 day_focus / rationale / category / sets：库列全部可空
 * （004 迁移），旧行读出为 null——category 由读取侧 resolvePlanEntryCategory
 * 回落 'main'，sets 为 null 时消费方回落 target_sets × target_load 展示。
 */
export const PlanEntrySchema = z
  .object({
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
    ...planEntryStructuredRowFields,
  })
  .superRefine(refinePlanEntryStructuredFields);

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
 * [T9 #66] 结构化字段全部可选：存量提案载荷（无这些字段）照常通过；
 * 新生成计划按 plan-generation 技能模板一次成型携带全字段。
 */
export const PlanEntryInputSchema = z
  .object({
    entry_date: z.string().regex(PLAN_ENTRY_DATE_PATTERN, 'entry_date 必须为 YYYY-MM-DD'),
    exercise_id: z.string().min(12).max(24), // NanoID（对齐 ExerciseSchema.id）
    target_sets: z.number().int().positive(),
    target_load: TargetLoadSchema,
    status: PlanEntryStatusSchema, // 缺省 planned
    sort_order: z.number().int().min(0).default(0),
    ...planEntryStructuredInputFields,
  })
  .superRefine(refinePlanEntryStructuredFields);

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
 *  - [T9 #66] 结构化字段 category 已过回落推导（旧数据 NULL → 'main'），
 *    day_focus / rationale / sets 随行透出（详情页三段分组与逐组处方的
 *    读取面；旧计划 sets=null，前端回落 target_sets × target_load 展示）。
 *    本批（契约批）四个新字段在**类型层可选**（后端出库恒携带——repo 映射
 *    必填生成；可选仅为存量前端 fixture 零改动），详情页 UI 批落地时收紧。
 */
export const TodayScheduleEntrySchema = z.object({
  entry_id: z.string().uuid(),
  exercise_id: z.string().min(12).max(24), // NanoID（对齐 ExerciseSchema.id）
  exercise_name: z.string().min(1),
  target_sets: z.number().int().positive(),
  target_load: TargetLoadSchema,
  status: PlanEntryStatusSchema,
  sort_order: z.number().int().min(0),
  day_focus: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  category: PlanEntryCategorySchema.optional(), // 出库即回落推导后值（'main' 兜底）
  sets: z.array(PlanSetPrescriptionSchema).nullable().optional(),
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

// ============================================================================
// 周计划卡 (Weekly Plan Card) — uiHint weekly_plan 卡数据契约（issue #9 / D2）
// ============================================================================

/**
 * 对话周计划卡（uiHint `type: "weekly_plan"` 的 data 契约）。
 *
 * 职责划分：weekly_plan/plan_entries 实体是数据真源（上方 Schema），
 * 本卡是 AI 落库后输出的**对话展示层**——整周 × 动作 × 按组展开，
 * 每组参数可独立（第1组 60kg×8 / 第2组 65kg×6）。
 * 纯净新生成：无进度/状态/执行率字段（issue #8 定稿）。
 * 后端校验回路（M5b）与本前端渲染共用本契约。
 */

/**
 * set_type 组类型契约（issue #31 / data-contract-check 流程扩展）。
 *
 * 枚举全集盘点自 picker 实际用法（ExercisePickerModal / PickerConfigSheet /
 * pickerAdapter 的组角色标注），非闭门造枚举：
 *   warmup     热身组
 *   working    正式组（= straight set 直排组；旧数据缺省值）
 *   ramp_up    递增组（前端旧值 rampUp，契约统一 snake_case）
 *   ramp_down  递减组（drop set；前端旧值 rampDown）
 *   amrap      AMRAP 组（尽力组）
 * 缺省 working 兼容存量数据（无 set_type 的旧组读出即正式组）。
 */
export const SET_TYPE_VALUES = [
  'warmup',
  'working',
  'ramp_up',
  'ramp_down',
  'amrap',
] as const;

export const SetTypeSchema = z.enum(SET_TYPE_VALUES);

export type SetType = z.infer<typeof SetTypeSchema>;

/** 旧数据缺省组类型（正式组；任务书「默认 straight」在库内口径即 working） */
export const DEFAULT_SET_TYPE: SetType = 'working';

/** 单组目标：weight/reps/duration 按动作类型至少给一项（或 note 说明）；
 *  set_type 缺省 working（存量组数据无该字段，解析时补缺省——向后兼容）。 */
export const WeeklyPlanSetSchema = z
  .object({
    set: z.number().int().positive(),
    weight: z.number().optional(), // kg；assisted 沿用负值辅助约定
    reps: z.number().int().positive().optional(),
    duration: z.number().positive().optional(), // 秒（isometric/cardio）
    note: z.string().optional(),
    set_type: SetTypeSchema.optional().default(DEFAULT_SET_TYPE),
  })
  .superRefine((s, ctx) => {
    const hasMetric =
      s.weight !== undefined || s.reps !== undefined || s.duration !== undefined;
    if (!hasMetric && !s.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `第 ${s.set} 组参数全空：weight/reps/duration 至少给一项（或 note 说明）`,
        path: ['set'],
      });
    }
  });

export type WeeklyPlanSet = z.infer<typeof WeeklyPlanSetSchema>;

/** 单日动作条目：exercise_id 为 NanoID（引用 exercises.id，对齐 plan_entries）。 */
export const WeeklyPlanExerciseSchema = z.object({
  exercise_id: z.string().min(12).max(24),
  name: z.string().min(1),
  sets: z.array(WeeklyPlanSetSchema).min(1),
  note: z.string().optional(),
  /**
   * [T9 #66] 段位（warmup/main/cooldown）——三段式课表的展示分组依据，
   * 与 apply.entries[].category 同源；可选（存量卡无此字段，展示归 main 组）。
   */
  category: PlanEntryCategorySchema.optional(),
});

export type WeeklyPlanExercise = z.infer<typeof WeeklyPlanExerciseSchema>;

/** 周计划卡的一天：rest=true 时 exercises 缺省为空（休息日弱化展示）。 */
export const WeeklyPlanDaySchema = z.object({
  entry_date: z.string().regex(PLAN_ENTRY_DATE_PATTERN, 'entry_date 必须为 YYYY-MM-DD'),
  split_label: z.string().optional(), // 分化日短标签（推/拉/腿/上/下…）
  focus: z.string().optional(), // 肌群说明（胸肩三头…）
  /**
   * [T9 #66] 当日说明（安排原因/目标/注意要点），与 apply.entries[].rationale
   * 同源；可选（存量卡无此字段）。
   */
  rationale: z.string().optional(),
  rest: z.boolean().default(false),
  exercises: z.array(WeeklyPlanExerciseSchema).default([]),
});

export type WeeklyPlanDay = z.infer<typeof WeeklyPlanDaySchema>;

// ============================================================================
// 确认落库载荷 (Apply Payload) — B5b / issue #38
// ============================================================================

/**
 * weekly_plan 卡的确认落库载荷（提案轮由 Agent 算好，确认后由前端直调
 * 确定性端点写入，AI 零参与写入时刻）。
 *
 * scope 语义（周/日粒度判断规则的落库面）：
 *  - week  整周：upsert 周计划行（split 更新）+ 替换该周全部条目
 *               （新框架 / 框架级原因整周重算 / 常规整周更新）
 *  - days  单日覆盖：只替换 dates 所列日期的条目（临时原因只改某天，
 *               如雨天改居家；要求该周已有计划行）
 *
 * week_id 缺省 = 当前周（服务器推导，Agent 不做日历算术）。
 */
export const WeeklyPlanApplyPayloadSchema = z
  .object({
    week_id: WeekIdSchema.optional(),
    scope: z.enum(['week', 'days']),
    /** scope=week 必填（整周 upsert 需要分化）；scope=days 忽略 */
    split: WeeklyPlanSplitSchema.optional(),
    /** scope=days 必填：被覆盖的日历日（该周内）；scope=week 忽略 */
    dates: z
      .array(z.string().regex(PLAN_ENTRY_DATE_PATTERN, 'dates 内元素必须为 YYYY-MM-DD'))
      .max(7)
      .default([]),
    /** 落库条目（PlanEntryInput 形态；status/sort_order 缺省 planned/0） */
    entries: z.array(PlanEntryInputSchema).max(200).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.scope === 'week') {
      if (!p.split) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scope=week（整周）必须携带 split',
          path: ['split'],
        });
      }
    } else {
      if (p.dates.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scope=days（单日覆盖）必须携带 dates（被替换的日期）',
          path: ['dates'],
        });
      }
    }
    if (p.entries.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'entries 不能为空（至少一条计划条目）',
        path: ['entries'],
      });
    }
    // scope=days：条目日期必须全部落在 dates 内（落库面=被替换面，防漏删/误删）
    if (p.scope === 'days') {
      const dateSet = new Set(p.dates);
      for (const e of p.entries) {
        if (!dateSet.has(e.entry_date)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `scope=days 时条目日期 ${e.entry_date} 必须包含在 dates 内`,
            path: ['entries'],
          });
        }
      }
    }
  });

export type WeeklyPlanApplyPayload = z.infer<typeof WeeklyPlanApplyPayloadSchema>;

/**
 * POST /api/schedule/weekly-plan/apply 请求体（server 侧完整输入）：
 * payload + user_id（由 X-User-Id 注入，客户端不可伪造）。Repository 落库前
 * 以本 Schema 校验（Zod 失败即抛，红线：禁止静默吞错）。
 */
export const WeeklyPlanApplyInputSchema = z.object({
  user_id: z.string().uuid(),
  payload: WeeklyPlanApplyPayloadSchema,
});

export type WeeklyPlanApplyInput = z.infer<typeof WeeklyPlanApplyInputSchema>;

/** weekly_plan 卡 data：展示文案 + 整周 days（≥1 天，覆盖周一至周日为宜）。 */
export const WeeklyPlanCardDataSchema = z.object({
  week_label: z.string().min(1), // 「第 2 周」
  phase_label: z.string().optional(), // 「力量块」
  split_summary: z.string().min(1), // 「推拉腿 · 每周 3 练 · 主项渐进 +1 档」
  days: z.array(WeeklyPlanDaySchema).min(1),
  /**
   * [B5b issue#38] 确认落库载荷：Agent 提案轮算好最终 entries，随卡携带；
   * 用户点「确认」后前端直调确定性写入端点（POST /api/schedule/weekly-plan/apply，
   * 无 LLM）落库——确认前计划不进数据库（对齐 B5a profile 提案-确认模式）。
   * 缺省 = 纯展示卡（兼容存量线程的已落库周计划展示）。
   */
  apply: WeeklyPlanApplyPayloadSchema.optional(),
});

export type WeeklyPlanCardData = z.infer<typeof WeeklyPlanCardDataSchema>;
