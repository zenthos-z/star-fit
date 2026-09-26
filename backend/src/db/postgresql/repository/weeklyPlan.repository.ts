/**
 * Weekly Plan Repository
 *
 * 周计划持久化实体的唯一数据访问层（issue #10）。所有读写经由本 Repository，
 * 禁止绕过直连数据库。覆盖三组操作：
 *  - 创建周计划（计划 + 全部条目，事务内原子完成）
 *  - 按用户 + 周标识查询（默认复用的读取路径）
 *  - 条目状态更新（强制执行契约状态机 planned→adjusted→completed/skipped）
 *
 * 校验回路（CLAUDE.md 红线）：
 *  - 入库前：CreateWeeklyPlanInputSchema 经 validateOrThrow（失败即抛）
 *  - 出库后：WeeklyPlanSchema / PlanEntrySchema 经 validateOrThrow（失败即抛）
 *  - 状态机：PLAN_ENTRY_STATUS_TRANSITIONS（契约单一真源）在更新前强制
 */

import { PostgresClient } from "../client/postgres-client.js";
import { BaseRepository } from "./base.repository.js";
import {
  ServiceError,
  ServiceErrorCode,
} from "../../../services/errors/ServiceError.js";
import {
  validateOrThrow,
  CreateWeeklyPlanInputSchema,
  WeeklyPlanSchema,
  PlanEntrySchema,
  TodayScheduleEntrySchema,
  WeekIdSchema,
  PlanEntryStatusSchema,
  PLAN_ENTRY_DATE_PATTERN,
  UUIDSchema,
  canTransitionPlanEntryStatus,
  type CreateWeeklyPlanInput,
  type WeeklyPlan,
  type PlanEntry,
  type PlanEntryStatus,
  type WeeklyPlanWithEntries,
  type TodayScheduleEntry,
} from "../../../../../shared/dist/contracts/index.js";

/** weekly_plans 原始行（pg 驱动形态：timestamptz → Date） */
interface WeeklyPlanRow {
  id: string;
  user_id: string;
  week_id: string;
  split: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** plan_entries 原始行（entry_date 经 to_char 取回为 YYYY-MM-DD 文本；numeric → string） */
interface PlanEntryRow {
  id: string;
  weekly_plan_id: string;
  user_id: string;
  entry_date: string;
  exercise_id: string;
  target_sets: number;
  target_load_type: string;
  target_load_min: string;
  target_load_max: string;
  status: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/** 条目读取 SQL：日期列显式 to_char，规避 pg date 解析器的本地时区语义 */
const ENTRY_SELECT_SQL = `
  SELECT
    id, weekly_plan_id, user_id,
    to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
    exercise_id, target_sets,
    target_load_type, target_load_min, target_load_max,
    status, sort_order, created_at, updated_at
  FROM plan_entries
`;

/** weekly_plans 行 → 契约形态（出库校验，失败即抛） */
function mapPlanRow(row: WeeklyPlanRow): WeeklyPlan {
  return validateOrThrow(
    WeeklyPlanSchema,
    {
      id: row.id,
      user_id: row.user_id,
      week_id: row.week_id,
      split: row.split,
      status: row.status,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    },
    "WeeklyPlanRepository.mapPlanRow",
  );
}

/** plan_entries 行 → 契约形态（三列负荷 → 嵌套 target_load；出库校验，失败即抛） */
function mapEntryRow(row: PlanEntryRow): PlanEntry {
  return validateOrThrow(
    PlanEntrySchema,
    {
      id: row.id,
      weekly_plan_id: row.weekly_plan_id,
      user_id: row.user_id,
      entry_date: row.entry_date,
      exercise_id: row.exercise_id,
      target_sets: row.target_sets,
      target_load: {
        type: row.target_load_type,
        min: Number(row.target_load_min),
        max: Number(row.target_load_max),
      },
      status: row.status,
      sort_order: row.sort_order,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    },
    "WeeklyPlanRepository.mapEntryRow",
  );
}

/** 今日课表 join 行（plan_entries × exercises.name；numeric → string） */
interface TodayEntryJoinRow {
  entry_id: string;
  exercise_id: string;
  exercise_name: string;
  target_sets: number;
  target_load_type: string;
  target_load_min: string;
  target_load_max: string;
  status: string;
  sort_order: number;
}

/** 今日课表 join 行 → 契约形态（出库校验，失败即抛） */
function mapTodayEntryRow(row: TodayEntryJoinRow): TodayScheduleEntry {
  return validateOrThrow(
    TodayScheduleEntrySchema,
    {
      entry_id: row.entry_id,
      exercise_id: row.exercise_id,
      exercise_name: row.exercise_name,
      target_sets: row.target_sets,
      target_load: {
        type: row.target_load_type,
        min: Number(row.target_load_min),
        max: Number(row.target_load_max),
      },
      status: row.status,
      sort_order: row.sort_order,
    },
    "WeeklyPlanRepository.mapTodayEntryRow",
  );
}

export class WeeklyPlanRepository extends BaseRepository {
  constructor(client: PostgresClient) {
    super(client);
  }

  /**
   * 创建周计划：计划行 + 全部条目，单事务原子完成。
   *
   * (user_id, week_id) 唯一约束冲突（该周已有计划）→ ServiceError(ALREADY_EXISTS)，
   * 由 ON CONFLICT DO NOTHING + RETURNING 空行判定，无需解析 pg 错误码。
   */
  async createWeeklyPlan(
    input: CreateWeeklyPlanInput,
  ): Promise<WeeklyPlanWithEntries> {
    // 入库前契约校验（Zod 失败即抛 —— 红线：禁止静默吞错）
    const data = validateOrThrow(
      CreateWeeklyPlanInputSchema,
      input,
      "WeeklyPlanRepository.createWeeklyPlan",
    );

    const { plan } = await this.client.transaction(async (tx) => {
      const planRow = await tx.queryOne<WeeklyPlanRow>(
        `INSERT INTO weekly_plans (user_id, week_id, split, status)
         VALUES ($userId::uuid, $weekId, $split::public.weekly_plan_split, $status::public.weekly_plan_status)
         ON CONFLICT (user_id, week_id) DO NOTHING
         RETURNING id, user_id, week_id, split, status, created_at, updated_at`,
        {
          userId: data.user_id,
          weekId: data.week_id,
          split: data.split,
          status: data.status,
        },
      );

      if (!planRow) {
        throw new ServiceError(
          ServiceErrorCode.ALREADY_EXISTS,
          `用户 ${data.user_id} 的周计划 ${data.week_id} 已存在（每周每用户一份，默认复用既有计划）`,
          { user_id: data.user_id, week_id: data.week_id },
        );
      }

      if (data.entries.length > 0) {
        // 条目批量落库：单命名参数 + jsonb_to_recordset（heartRate.insertBatch 同款惯例）
        const rows = data.entries.map((e) => ({
          weekly_plan_id: planRow.id,
          user_id: data.user_id,
          entry_date: e.entry_date,
          exercise_id: e.exercise_id,
          target_sets: e.target_sets,
          target_load_type: e.target_load.type,
          target_load_min: e.target_load.min,
          target_load_max: e.target_load.max,
          status: e.status,
          sort_order: e.sort_order,
        }));
        await tx.query(
          `INSERT INTO plan_entries (
             weekly_plan_id, user_id, entry_date, exercise_id,
             target_sets, target_load_type, target_load_min, target_load_max,
             status, sort_order
           )
           SELECT t.weekly_plan_id::uuid, t.user_id::uuid, t.entry_date::date, t.exercise_id::text,
                  t.target_sets::int, t.target_load_type::public.plan_load_type,
                  t.target_load_min::numeric, t.target_load_max::numeric,
                  t.status::public.plan_entry_status, t.sort_order::int
           FROM jsonb_to_recordset($entries::jsonb) AS t(
             weekly_plan_id text, user_id text, entry_date text, exercise_id text,
             target_sets int, target_load_type text,
             target_load_min numeric, target_load_max numeric,
             status text, sort_order int)`,
          { entries: JSON.stringify(rows) },
        );
      }

      return { plan: planRow };
    });

    const planRecord = mapPlanRow(plan);

    // 回读条目（取 DB 生成的 id / 时间戳，保证返回形态与库中一致）
    const entryRows = await this.queryMany<PlanEntryRow>(
      `${ENTRY_SELECT_SQL}
       WHERE weekly_plan_id = $weeklyPlanId
       ORDER BY entry_date ASC, sort_order ASC`,
      { weeklyPlanId: planRecord.id },
    );

    return { plan: planRecord, entries: entryRows.map(mapEntryRow) };
  }

  /**
   * 按用户 + 周标识查询周计划（默认复用的读取路径）。
   * 未命中返回 null；条目按 entry_date、sort_order 升序。
   */
  async getWeeklyPlanByUserAndWeek(
    userId: string,
    weekId: string,
  ): Promise<WeeklyPlanWithEntries | null> {
    // 快速失败：参数形态先于数据库校验（Zod 失败即抛）
    if (!UUIDSchema.safeParse(userId).success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId 必须为 UUID（当前: ${userId}）`,
        { userId },
      );
    }
    const weekIdCheck = WeekIdSchema.safeParse(weekId);
    if (!weekIdCheck.success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `weekId 必须为 ISO 周格式 YYYY-Www（当前: ${weekId}）`,
        { weekId },
      );
    }

    const planRow = await this.queryOne<WeeklyPlanRow>(
      `SELECT id, user_id, week_id, split, status, created_at, updated_at
       FROM weekly_plans
       WHERE user_id = $userId::uuid AND week_id = $weekId`,
      { userId, weekId },
    );

    if (!planRow) return null;

    const entryRows = await this.queryMany<PlanEntryRow>(
      `${ENTRY_SELECT_SQL}
       WHERE weekly_plan_id = $weeklyPlanId
       ORDER BY entry_date ASC, sort_order ASC`,
      { weeklyPlanId: planRow.id },
    );

    return { plan: mapPlanRow(planRow), entries: entryRows.map(mapEntryRow) };
  }

  /**
   * 用户是否持有任一周计划（任意周、任意状态）——B2 开始运动路由的
   * has_plan / user_stage「计划用户」判定读。EXISTS 探针走
   * (user_id, week_id) 唯一索引前缀，不拉行数据。
   */
  async hasAnyWeeklyPlan(userId: string): Promise<boolean> {
    if (!UUIDSchema.safeParse(userId).success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId 必须为 UUID（当前: ${userId}）`,
        { userId },
      );
    }
    const row = await this.queryOne<{ one: number }>(
      `SELECT 1 AS one FROM weekly_plans
       WHERE user_id = $userId::uuid
       LIMIT 1`,
      { userId },
    );
    return row !== null;
  }

  /**
   * 按用户 + 周标识查询周计划元数据（plan 行，不含条目）。
   * E2 今日课表路径的轻量读取：只需判定「本周是否有计划」与分化，
   * 不拉整周条目。未命中返回 null。
   */
  async getWeeklyPlanMetaByUserAndWeek(
    userId: string,
    weekId: string,
  ): Promise<WeeklyPlan | null> {
    if (!UUIDSchema.safeParse(userId).success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId 必须为 UUID（当前: ${userId}）`,
        { userId },
      );
    }
    const weekIdCheck = WeekIdSchema.safeParse(weekId);
    if (!weekIdCheck.success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `weekId 必须为 ISO 周格式 YYYY-Www（当前: ${weekId}）`,
        { weekId },
      );
    }

    const planRow = await this.queryOne<WeeklyPlanRow>(
      `SELECT id, user_id, week_id, split, status, created_at, updated_at
       FROM weekly_plans
       WHERE user_id = $userId::uuid AND week_id = $weekId`,
      { userId, weekId },
    );

    return planRow ? mapPlanRow(planRow) : null;
  }

  /**
   * 按用户 + 日历日查当日条目（JOIN exercises 取动作名）——E2「今天练什么」路径。
   * 走 idx_plan_entries_user_date 索引（user_id, entry_date）；exercises.name
   * 非空 + FK 级联（ON DELETE CASCADE）保证 INNER JOIN 不丢行、不null名。
   * 返回按 sort_order 升序的展示形态（TodayScheduleEntry）。
   */
  async getTodayEntriesWithExercise(
    userId: string,
    entryDate: string,
  ): Promise<TodayScheduleEntry[]> {
    if (!UUIDSchema.safeParse(userId).success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId 必须为 UUID（当前: ${userId}）`,
        { userId },
      );
    }
    if (!PLAN_ENTRY_DATE_PATTERN.test(entryDate)) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `entryDate 必须为 YYYY-MM-DD（当前: ${entryDate}）`,
        { entryDate },
      );
    }

    const rows = await this.queryMany<TodayEntryJoinRow>(
      `SELECT
         pe.id AS entry_id, pe.exercise_id, e.name AS exercise_name,
         pe.target_sets,
         pe.target_load_type, pe.target_load_min, pe.target_load_max,
         pe.status, pe.sort_order
       FROM plan_entries pe
       JOIN exercises e ON e.id = pe.exercise_id
       WHERE pe.user_id = $userId::uuid AND pe.entry_date = $entryDate::date
       ORDER BY pe.sort_order ASC`,
      { userId, entryDate },
    );

    return rows.map(mapTodayEntryRow);
  }

  /**
   * 更新条目状态（planned→adjusted→completed/skipped）。
   *
   * 返回更新后的条目；条目不存在或不属于该用户 → null（用户隔离查询）。
   * 非法迁移（终态出边、跨态跳跃）→ ServiceError(BUSINESS_RULE_VIOLATION)，
   * 同态迁移视为幂等重放放行。
   */
  async updateEntryStatus(
    userId: string,
    entryId: string,
    status: PlanEntryStatus,
  ): Promise<PlanEntry | null> {
    if (
      !UUIDSchema.safeParse(userId).success ||
      !UUIDSchema.safeParse(entryId).success
    ) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId / entryId 必须为 UUID（当前: ${userId} / ${entryId}）`,
        { userId, entryId },
      );
    }
    const statusCheck = PlanEntryStatusSchema.safeParse(status);
    if (!statusCheck.success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `status 必须为 plan_entry 状态之一（当前: ${String(status)}）`,
        { status },
      );
    }
    const nextStatus = statusCheck.data;

    // 现态读取（按用户隔离，取整行用于幂等路径回传）；不存在 → null
    const row = await this.queryOne<PlanEntryRow>(
      `${ENTRY_SELECT_SQL}
       WHERE id = $entryId::uuid AND user_id = $userId::uuid`,
      { entryId, userId },
    );
    if (!row) return null;

    // 契约状态机强制（迁移表单一真源在 shared/contracts）
    const currentStatus = PlanEntryStatusSchema.parse(row.status);
    if (!canTransitionPlanEntryStatus(currentStatus, nextStatus)) {
      throw new ServiceError(
        ServiceErrorCode.BUSINESS_RULE_VIOLATION,
        `条目 ${entryId} 状态迁移非法: ${currentStatus} → ${nextStatus}` +
          `（合法迁移: planned→adjusted→completed/skipped，completed/skipped 为终态）`,
        { entryId, from: currentStatus, to: nextStatus },
      );
    }

    if (currentStatus === nextStatus) {
      // 幂等重放：状态不变，原样返回（不触发 updated_at）
      return mapEntryRow(row);
    }

    const updated = await this.queryOne<PlanEntryRow>(
      `UPDATE plan_entries
       SET status = $status::public.plan_entry_status
       WHERE id = $entryId::uuid AND user_id = $userId::uuid
       RETURNING id, weekly_plan_id, user_id,
         to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
         exercise_id, target_sets,
         target_load_type, target_load_min, target_load_max,
         status, sort_order, created_at, updated_at`,
      { entryId, userId, status: nextStatus },
    );

    if (!updated) return null;
    return mapEntryRow(updated);
  }
}

export function createWeeklyPlanRepository(
  client: PostgresClient,
): WeeklyPlanRepository {
  return new WeeklyPlanRepository(client);
}
