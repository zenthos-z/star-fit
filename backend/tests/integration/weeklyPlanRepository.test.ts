/**
 * WeeklyPlan Repository integration tests (issue #10).
 *
 * Validates against a REAL PostgreSQL: atomic plan+entries creation,
 * (user_id, week_id) uniqueness, user-scoped reads, entry state machine
 * enforcement, and FK integrity (exercises).
 * Skipped automatically when DATABASE_URL is unset (CI/PG-less machines).
 *
 * Run for real with:
 *   DATABASE_URL=postgresql://starfit:***@localhost:5432/starfit npx jest \
 *     tests/integration/weeklyPlanRepository.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import pg from "pg";

import {
  getPostgresClient,
  closePostgresClient,
} from "../../src/db/postgresql/client/postgres-client.js";
import { createWeeklyPlanRepository } from "../../src/db/postgresql/repository/weeklyPlan.repository.js";
import { ServiceErrorCode } from "../../src/services/errors/ServiceError.js";

const connectionString = process.env.DATABASE_URL;
const describeOrSkip = connectionString ? describe : describe.skip;

let adminPool!: pg.Pool;
let userId!: string;
let otherUserId!: string;
let exerciseId!: string;
const now = Date.now();

// 本测试周：取「当前时刻 + 8 天」所在 ISO 周，避开周界翻转导致的 week_id 重复干扰
function isoWeekId(d: Date): string {
  // ISO 周算法（周四规则）：将日期校准到本周四再取年与周号
  const cal = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = cal.getUTCDay() || 7; // 周日=7
  cal.setUTCDate(cal.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cal.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((cal.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${cal.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const weekId = isoWeekId(new Date(now + 8 * 86400000));

function entryDateFor(planWeekId: string, dayOffset: number): string {
  // 直接由输入构造（周一为 2026-W40 起点）；测试只要求落在合理日期
  const [y, w] = planWeekId.split("-W");
  const jan4 = new Date(Date.UTC(Number(y), 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const d = new Date(week1Mon);
  d.setUTCDate(d.getUTCDate() + (Number(w) - 1) * 7 + dayOffset);
  return d.toISOString().slice(0, 10);
}

describeOrSkip("WeeklyPlanRepository (real PG)", () => {
  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString });
    // Fresh users + exercise for the test (unique device_id/name to survive parallel runs).
    const user = await adminPool.query(
      `INSERT INTO users (device_id, display_name, protocol_version)
       VALUES ($1, 'weekly-plan-test-user', '3.0.0') RETURNING id`,
      [`weekly-plan-${now}`],
    );
    userId = user.rows[0].id;
    const otherUser = await adminPool.query(
      `INSERT INTO users (device_id, display_name, protocol_version)
       VALUES ($1, 'weekly-plan-test-other', '3.0.0') RETURNING id`,
      [`weekly-plan-other-${now}`],
    );
    otherUserId = otherUser.rows[0].id;
    const exercise = await adminPool.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty, tutorials)
       VALUES ($1, $2, 'resistance', 'beginner', '{}'::jsonb) RETURNING id`,
      [`wp-test-exercise-${now}`.slice(0, 24), `weekly-plan-test-bench-${now}`],
    );
    exerciseId = exercise.rows[0].id;
  });

  afterAll(async () => {
    if (userId)
      await adminPool.query("DELETE FROM users WHERE id = $1", [userId]);
    if (otherUserId)
      await adminPool.query("DELETE FROM users WHERE id = $1", [otherUserId]);
    if (exerciseId)
      await adminPool.query("DELETE FROM exercises WHERE id = $1", [
        exerciseId,
      ]);
    await adminPool.end();
    await closePostgresClient();
  });

  it("createWeeklyPlan atomically persists plan and entries, then reads back ordered", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    const created = await repo.createWeeklyPlan({
      user_id: userId,
      week_id: weekId,
      split: "upper_lower",
      entries: [
        {
          entry_date: entryDateFor(weekId, 1),
          exercise_id: exerciseId,
          target_sets: 4,
          target_load: { type: "percent_1rm", min: 70, max: 80 },
        },
        {
          entry_date: entryDateFor(weekId, 0),
          exercise_id: exerciseId,
          target_sets: 3,
          target_load: { type: "rpe", min: 7, max: 8 },
          sort_order: 2,
        },
        {
          entry_date: entryDateFor(weekId, 0),
          exercise_id: exerciseId,
          target_sets: 5,
          target_load: { type: "rpe", min: 6, max: 7 },
          sort_order: 1,
        },
      ],
    });

    expect(created.plan.id).toBeDefined();
    expect(created.plan.status).toBe("active");
    expect(created.plan.week_id).toBe(weekId);
    // 排序：entry_date 升序，同日按 sort_order 升序
    expect(created.entries).toHaveLength(3);
    expect(created.entries[0].sort_order).toBe(1);
    expect(created.entries[1].sort_order).toBe(2);
    expect(created.entries[2].entry_date > created.entries[1].entry_date).toBe(
      true,
    );
    expect(created.entries.every((e) => e.status === "planned")).toBe(true);
    expect(
      created.entries.every((e) => e.weekly_plan_id === created.plan.id),
    ).toBe(true);

    // 读路径与写路径一致
    const fetched = await repo.getWeeklyPlanByUserAndWeek(userId, weekId);
    expect(fetched).not.toBeNull();
    expect(fetched!.plan.id).toBe(created.plan.id);
    expect(fetched!.entries).toHaveLength(3);
  });

  it("createWeeklyPlan rejects duplicate (user_id, week_id) with ALREADY_EXISTS", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    await expect(
      repo.createWeeklyPlan({
        user_id: userId,
        week_id: weekId,
        split: "full_body",
        entries: [],
      }),
    ).rejects.toMatchObject({ code: ServiceErrorCode.ALREADY_EXISTS });
  });

  it("getWeeklyPlanByUserAndWeek is user-scoped and returns null for other users", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    expect(
      await repo.getWeeklyPlanByUserAndWeek(otherUserId, weekId),
    ).toBeNull();
    expect(
      await repo.getWeeklyPlanByUserAndWeek(userId, "2020-W01"),
    ).toBeNull();
  });

  it("getWeeklyPlanByUserAndWeek fast-fails on malformed week_id", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    await expect(
      repo.getWeeklyPlanByUserAndWeek(userId, "2026-W54"),
    ).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_PARAMS });
  });

  it("updateEntryStatus enforces the state machine and user scoping", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    const fetched = await repo.getWeeklyPlanByUserAndWeek(userId, weekId);
    const entry = fetched!.entries[0];

    // planned → adjusted
    const adjusted = await repo.updateEntryStatus(userId, entry.id, "adjusted");
    expect(adjusted?.status).toBe("adjusted");

    // adjusted → completed
    const completed = await repo.updateEntryStatus(
      userId,
      entry.id,
      "completed",
    );
    expect(completed?.status).toBe("completed");

    // completed 为终态：出边一律拒绝
    await expect(
      repo.updateEntryStatus(userId, entry.id, "adjusted"),
    ).rejects.toMatchObject({ code: ServiceErrorCode.BUSINESS_RULE_VIOLATION });

    // 同态幂等重放放行
    const replay = await repo.updateEntryStatus(userId, entry.id, "completed");
    expect(replay?.status).toBe("completed");

    // 其他用户不可见 → null
    expect(
      await repo.updateEntryStatus(otherUserId, entry.id, "skipped"),
    ).toBeNull();
    // 不存在的条目 → null
    expect(
      await repo.updateEntryStatus(
        userId,
        "00000000-0000-4000-8000-000000000000",
        "skipped",
      ),
    ).toBeNull();
  });

  it("createWeeklyPlan rejects entries referencing unknown exercises (FK)", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    await expect(
      repo.createWeeklyPlan({
        user_id: userId,
        week_id: isoWeekId(new Date(now + 30 * 86400000)),
        split: "full_body",
        entries: [
          {
            entry_date: "2026-10-05",
            exercise_id: "nonexistent-exercise-id", // 20 字符 NanoID 形态但不存在的动作
            target_sets: 3,
            target_load: { type: "rpe", min: 6, max: 7 },
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("createWeeklyPlan rejects contract-invalid input before touching the DB", async () => {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    await expect(
      repo.createWeeklyPlan({
        user_id: userId,
        week_id: "not-a-week",
        split: "full_body",
        entries: [],
      } as never),
    ).rejects.toThrow();
  });
});
