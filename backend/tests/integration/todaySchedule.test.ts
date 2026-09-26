/**
 * Today Schedule integration tests (E2 / issue #1).
 *
 * Validates against a REAL PostgreSQL (style mirrors weeklyPlanRepository.test.ts):
 *   - Repository: getTodayEntriesWithExercise (JOIN exercises 取名、按日过滤、
 *     排序、用户隔离、参数快速失败) + getWeeklyPlanMetaByUserAndWeek
 *   - Service: getTodaySchedule 三态（planned / rest_day / no_plan）、
 *     显式与缺省 date、非法参数、响应契约形状
 *   - 无计划兜底：no_plan 结构化返回（本路径无 LLM / AI 依赖 —— import 链即证）
 *
 * Skipped automatically when DATABASE_URL is unset (CI/PG-less machines).
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import pg from "pg";

import {
  getPostgresClient,
  closePostgresClient,
} from "../../src/db/postgresql/client/postgres-client.js";
import { createWeeklyPlanRepository } from "../../src/db/postgresql/repository/weeklyPlan.repository.js";
import {
  ScheduleService,
  utcToday,
} from "../../src/services/schedule/scheduleService.js";
import { ServiceErrorCode } from "../../src/services/errors/ServiceError.js";
import { getIsoWeekId, TodayScheduleResponseSchema } from "shared/contracts";

const connectionString = process.env.DATABASE_URL;
const describeOrSkip = connectionString ? describe : describe.skip;

let adminPool!: pg.Pool;
let userId!: string;
let otherUserId!: string;
let squatId!: string;
let rowId!: string;
const now = Date.now();

const today = utcToday();
const weekId = getIsoWeekId(today);

/** 本周一（ISO 周）日历日 */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const cal = new Date(Date.UTC(y, m - 1, d));
  const day = cal.getUTCDay() || 7;
  cal.setUTCDate(cal.getUTCDate() - (day - 1));
  return cal.toISOString().slice(0, 10);
}

/** 本周内一个「无条目」的日期（rest_day 探针；避开 today） */
const restDay = (() => {
  const mon = mondayOf(today);
  if (mon === today) {
    // 今天是周一 → 用周二（仍在同一 ISO 周）
    const [y, m, d] = mon.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return mon;
})();

describeOrSkip("Today Schedule API path (real PG)", () => {
  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString });
    const user = await adminPool.query(
      `INSERT INTO users (device_id, display_name, protocol_version)
       VALUES ($1, 'today-schedule-test-user', '3.0.0') RETURNING id`,
      [`today-schedule-${now}`],
    );
    userId = user.rows[0].id;
    const otherUser = await adminPool.query(
      `INSERT INTO users (device_id, display_name, protocol_version)
       VALUES ($1, 'today-schedule-test-other', '3.0.0') RETURNING id`,
      [`today-schedule-other-${now}`],
    );
    otherUserId = otherUser.rows[0].id;
    const squat = await adminPool.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty, tutorials)
       VALUES ($1, $2, 'resistance', 'intermediate', '{}'::jsonb) RETURNING id`,
      [`ts-squat-${now}`.slice(0, 24), `今日课表深蹲-${now}`],
    );
    squatId = squat.rows[0].id;
    const row = await adminPool.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty, tutorials)
       VALUES ($1, $2, 'resistance', 'beginner', '{}'::jsonb) RETURNING id`,
      [`ts-row-${now}`.slice(0, 24), `今日课表划船-${now}`],
    );
    rowId = row.rows[0].id;

    // 本周计划：今天 2 条（sort_order 2 先插入、1 后插入 → 验证排序）、休息日 0 条
    const repo = createWeeklyPlanRepository(getPostgresClient());
    await repo.createWeeklyPlan({
      user_id: userId,
      week_id: weekId,
      split: "upper_lower",
      entries: [
        {
          entry_date: today,
          exercise_id: squatId,
          target_sets: 4,
          target_load: { type: "percent_1rm", min: 70, max: 80 },
          sort_order: 2,
        },
        {
          entry_date: today,
          exercise_id: rowId,
          target_sets: 3,
          target_load: { type: "rpe", min: 7, max: 8 },
          sort_order: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    if (userId)
      await adminPool.query("DELETE FROM users WHERE id = $1", [userId]);
    if (otherUserId)
      await adminPool.query("DELETE FROM users WHERE id = $1", [otherUserId]);
    for (const ex of [squatId, rowId]) {
      if (ex)
        await adminPool.query("DELETE FROM exercises WHERE id = $1", [ex]);
    }
    await adminPool.end();
    await closePostgresClient();
  });

  // ------------------------------------------------------------------
  // Repository: getTodayEntriesWithExercise
  // ------------------------------------------------------------------
  it("returns today's entries JOINed with exercise names, ordered by sort_order", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    const entries = await repo.getTodayEntriesWithExercise(userId, today);

    expect(entries).toHaveLength(2);
    // sort_order 升序（1 在前），join 名称正确
    expect(entries[0].sort_order).toBe(1);
    expect(entries[0].exercise_id).toBe(rowId);
    expect(entries[0].exercise_name).toBe(`今日课表划船-${now}`);
    expect(entries[1].sort_order).toBe(2);
    expect(entries[1].exercise_name).toBe(`今日课表深蹲-${now}`);
    // 负荷区间形态（三列 → 嵌套对象）
    expect(entries[0].target_load).toEqual({ type: "rpe", min: 7, max: 8 });
    expect(entries[1].target_load).toEqual({
      type: "percent_1rm",
      min: 70,
      max: 80,
    });
  });

  it("filters by calendar day (rest-day date yields no rows)", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    expect(await repo.getTodayEntriesWithExercise(userId, restDay)).toEqual([]);
  });

  it("is user-scoped (other user's plan invisible)", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    expect(await repo.getTodayEntriesWithExercise(otherUserId, today)).toEqual(
      [],
    );
  });

  it("fast-fails on malformed entryDate", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    await expect(
      repo.getTodayEntriesWithExercise(userId, "2026-9-28"),
    ).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_PARAMS });
  });

  // ------------------------------------------------------------------
  // Repository: getWeeklyPlanMetaByUserAndWeek
  // ------------------------------------------------------------------
  it("returns plan metadata only (no entries pulled)", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    const meta = await repo.getWeeklyPlanMetaByUserAndWeek(userId, weekId);
    expect(meta).not.toBeNull();
    expect(meta!.split).toBe("upper_lower");
    expect(meta!.week_id).toBe(weekId);
    expect(meta!.status).toBe("active");
    // 元数据形态即 WeeklyPlan（无 entries 字段）
    expect(meta!).not.toHaveProperty("entries");
  });

  it("returns null for a week without plan", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    expect(
      await repo.getWeeklyPlanMetaByUserAndWeek(userId, "2020-W01"),
    ).toBeNull();
  });

  // ------------------------------------------------------------------
  // Service: getTodaySchedule 三态
  // ------------------------------------------------------------------
  it("planned: today has entries, response matches the contract shape", async () => {
    const service = new ScheduleService(
      createWeeklyPlanRepository(getPostgresClient()),
    );
    const schedule = await service.getTodaySchedule(userId, today);

    expect(schedule.status).toBe("planned");
    expect(schedule.date).toBe(today);
    expect(schedule.week_id).toBe(weekId);
    expect(schedule.split).toBe("upper_lower");
    expect(schedule.entries).toHaveLength(2);
    expect(schedule.entries[0].exercise_name).toBe(`今日课表划船-${now}`);

    // 响应可整包通过契约校验（Service 内已 validateOrThrow，此处双保险）
    const check = TodayScheduleResponseSchema.safeParse(schedule);
    expect(check.success).toBe(true);
  });

  it("rest_day: plan exists for the week but the queried day has no entries", async () => {
    const service = new ScheduleService(
      createWeeklyPlanRepository(getPostgresClient()),
    );
    const schedule = await service.getTodaySchedule(userId, restDay);

    expect(schedule.status).toBe("rest_day");
    expect(schedule.date).toBe(restDay);
    expect(schedule.week_id).toBe(weekId); // 同一周（restDay 取自本周）
    expect(schedule.split).toBe("upper_lower"); // 计划元数据仍返回
    expect(schedule.entries).toEqual([]);
  });

  it("no_plan: deterministic fallback for a user with no weekly plan (no AI path)", async () => {
    const service = new ScheduleService(
      createWeeklyPlanRepository(getPostgresClient()),
    );
    const schedule = await service.getTodaySchedule(otherUserId, today);

    expect(schedule).toEqual({
      date: today,
      week_id: weekId,
      status: "no_plan",
      split: null,
      entries: [],
    });
  });

  it("default date resolves to server UTC today (same result as explicit today)", async () => {
    const service = new ScheduleService(
      createWeeklyPlanRepository(getPostgresClient()),
    );
    const implicit = await service.getTodaySchedule(userId);
    const explicit = await service.getTodaySchedule(userId, utcToday());
    expect(implicit).toEqual(explicit);
  });

  it("fast-fails on malformed date / userId", async () => {
    const service = new ScheduleService(
      createWeeklyPlanRepository(getPostgresClient()),
    );
    await expect(
      service.getTodaySchedule(userId, "not-a-date"),
    ).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_PARAMS });
    await expect(service.getTodaySchedule("not-a-uuid")).rejects.toMatchObject({
      code: ServiceErrorCode.INVALID_PARAMS,
    });
  });
});
