/**
 * scheduleSummaryService unit tests (B2 / issue #22).
 *
 * 锁定开始运动路由判定（纯 DB 读 + 纯函数，无 IO——Repository 端口 fake 注入）：
 *   - today 三态映射复用 E2 口径：planned→scheduled / rest_day→rest / no_plan→none
 *   - today_entries 透传 E2 条目投影（动作名 + 组数，预填文案数据源）
 *   - user_stage 三条规则矩阵（计划 × 记录 → newcomer / veteran_no_plan / planner）
 *   - onboarding：无计划+无记录+无画像 → needed；其余一切形态 → done
 *   - 计划用户新周未排：has_plan=true + today=none（两口径不互相覆盖）
 *   - 非法 userId / date → ServiceError(INVALID_PARAMS)（Zod 红线：抛错不静默）
 *   - 出参经 ScheduleSummaryResponseSchema 校验回路（形态锁定不漂移）
 */

import { describe, it, expect } from "@jest/globals";

import {
  ScheduleSummaryService,
  deriveUserStage,
  deriveOnboarding,
  type ScheduleSummaryRepoPort,
} from "../../../../src/services/schedule/scheduleSummaryService.js";
import { ServiceErrorCode } from "../../../../src/services/errors/ServiceError.js";
import {
  ScheduleSummaryResponseSchema,
  getIsoWeekId,
  type TodayScheduleEntry,
  type WeeklyPlan,
} from "shared/contracts";

// ---------------------------------------------------------------------------
// 构造器（契约形态；id 用 UUID 保真）
// ---------------------------------------------------------------------------

const USER_ID = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-09-26"; // 固定日：周当日判定不受真实时钟影响
const WEEK_ID = getIsoWeekId(TODAY);

function planMeta(overrides: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: USER_ID,
    week_id: WEEK_ID,
    split: "upper_lower",
    status: "active",
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  } as WeeklyPlan;
}

function todayEntry(
  overrides: Partial<TodayScheduleEntry> = {},
): TodayScheduleEntry {
  return {
    entry_id: "33333333-3333-4333-8333-333333333333",
    exercise_id: "test-exercise-0001",
    exercise_name: "杠铃深蹲",
    target_sets: 4,
    target_load: { type: "percent_1rm", min: 70, max: 80 },
    status: "planned",
    sort_order: 0,
    ...overrides,
  } as TodayScheduleEntry;
}

interface FakeScenario {
  /** 本周计划元数据（null = 本周无计划 → E2 no_plan） */
  thisWeekPlan?: WeeklyPlan | null;
  /** 今日条目（E2 planned 判定输入；默认空 → rest_day） */
  todayEntries?: TodayScheduleEntry[];
  /** 是否持有任一周计划（has_plan 判定输入） */
  hasAnyWeeklyPlan?: boolean;
  /** 是否有训练记录（user_stage 判定输入） */
  hasAnySessions?: boolean;
  /** 画像是否已建档（onboarding 判定输入） */
  hasProfileStatic?: boolean;
}

/** fake 端口：纯内存实现，记录调用参数（断言 E2 复用链路按预期喂参） */
function buildFakeRepo(scenario: FakeScenario = {}) {
  const calls = {
    metaUserIds: [] as string[],
    metaWeekIds: [] as string[],
    entriesUserIds: [] as string[],
    entriesDates: [] as string[],
    hasPlanUserIds: [] as string[],
    hasSessionsUserIds: [] as string[],
    hasProfileUserIds: [] as string[],
  };
  const repo: ScheduleSummaryRepoPort = {
    getWeeklyPlanMetaByUserAndWeek: async (userId, weekId) => {
      calls.metaUserIds.push(userId);
      calls.metaWeekIds.push(weekId);
      return scenario.thisWeekPlan ?? null;
    },
    getTodayEntriesWithExercise: async (userId, entryDate) => {
      calls.entriesUserIds.push(userId);
      calls.entriesDates.push(entryDate);
      return scenario.todayEntries ?? [];
    },
    hasAnyWeeklyPlan: async (userId) => {
      calls.hasPlanUserIds.push(userId);
      return scenario.hasAnyWeeklyPlan ?? false;
    },
    hasAnySessions: async (userId) => {
      calls.hasSessionsUserIds.push(userId);
      return scenario.hasAnySessions ?? false;
    },
    hasProfileStatic: async (userId) => {
      calls.hasProfileUserIds.push(userId);
      return scenario.hasProfileStatic ?? false;
    },
  };
  return { repo, calls };
}

// ---------------------------------------------------------------------------
// today 三态映射（E2 口径复用）
// ---------------------------------------------------------------------------

describe("ScheduleSummaryService today 三态（复用 E2 ScheduleService 判定）", () => {
  it("E2 planned → scheduled：条目透传（动作名+组数，预填文案数据源）", async () => {
    const entries = [
      todayEntry({ sort_order: 1, exercise_name: "引体向上", target_sets: 3 }),
      todayEntry({
        entry_id: "44444444-4444-4444-8444-444444444444",
        sort_order: 0,
        exercise_name: "杠铃深蹲",
        target_sets: 4,
      }),
    ];
    const { repo } = buildFakeRepo({
      thisWeekPlan: planMeta(),
      todayEntries: entries,
      hasAnyWeeklyPlan: true,
      hasAnySessions: true,
      hasProfileStatic: true,
    });
    const res = await new ScheduleSummaryService(repo).getSummary(
      USER_ID,
      TODAY,
    );
    expect(res.today).toBe("scheduled");
    expect(res.today_entries).toEqual(entries);
    expect(res.has_plan).toBe(true);
  });

  it("E2 rest_day → rest：本周有计划、今日无条目，entries 为空", async () => {
    const { repo } = buildFakeRepo({
      thisWeekPlan: planMeta(),
      todayEntries: [],
      hasAnyWeeklyPlan: true,
    });
    const res = await new ScheduleSummaryService(repo).getSummary(
      USER_ID,
      TODAY,
    );
    expect(res.today).toBe("rest");
    expect(res.today_entries).toEqual([]);
  });

  it("E2 no_plan → none：本周无计划，确定性兜底", async () => {
    const { repo } = buildFakeRepo({
      thisWeekPlan: null,
      todayEntries: [],
      hasAnyWeeklyPlan: false,
      hasAnySessions: false,
    });
    const res = await new ScheduleSummaryService(repo).getSummary(
      USER_ID,
      TODAY,
    );
    expect(res.today).toBe("none");
    expect(res.today_entries).toEqual([]);
  });

  it("计划用户新周未排：has_plan=true + today=none（任一周口径与本周口径不互斥）", async () => {
    // 上周有计划（hasAnyWeeklyPlan=true）但本周无计划 → E2 no_plan
    const { repo } = buildFakeRepo({
      thisWeekPlan: null,
      hasAnyWeeklyPlan: true,
      hasAnySessions: true,
    });
    const res = await new ScheduleSummaryService(repo).getSummary(
      USER_ID,
      TODAY,
    );
    expect(res.has_plan).toBe(true);
    expect(res.today).toBe("none");
    expect(res.user_stage).toBe("planner"); // 有计划即计划用户，不降级为老手
    // 契约锁定：该形态合法（onboarding 非 needed、stage=planner 与 has_plan 自洽）
    expect(ScheduleSummaryResponseSchema.safeParse(res).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// user_stage 三条规则矩阵（issue #22 判定表）
// ---------------------------------------------------------------------------

describe("deriveUserStage / user_stage 判定矩阵", () => {
  const cases: Array<[boolean, boolean, string]> = [
    // [hasPlan, hasRecords, expected]
    [false, false, "newcomer"], // 纯新手：无计划 + 无记录
    [false, true, "veteran_no_plan"], // 老手无计划：无计划 + 有记录
    [true, false, "planner"], // 计划用户：有计划（记录与否不影响）
    [true, true, "planner"],
  ];
  for (const [hasPlan, hasRecords, expected] of cases) {
    it(`hasPlan=${hasPlan} hasRecords=${hasRecords} → ${expected}`, async () => {
      expect(deriveUserStage(hasPlan, hasRecords)).toBe(expected);
      const { repo } = buildFakeRepo({
        hasAnyWeeklyPlan: hasPlan,
        hasAnySessions: hasRecords,
      });
      const res = await new ScheduleSummaryService(repo).getSummary(
        USER_ID,
        TODAY,
      );
      expect(res.user_stage).toBe(expected);
      expect(res.has_plan).toBe(hasPlan);
      // 出参形态锁定（契约校验回路，含跨字段 superRefine）
      expect(ScheduleSummaryResponseSchema.safeParse(res).success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// onboarding 判定（无计划 + 无记录 + 无画像 = needed）
// ---------------------------------------------------------------------------

describe("deriveOnboarding / onboarding 判定", () => {
  const cases: Array<[boolean, boolean, boolean, string]> = [
    // [hasPlan, hasRecords, hasProfile, expected]
    [false, false, false, "needed"], // 三无 → 首次使用
    [false, false, true, "done"], // 纯新手但已建档画像 → 非首次
    [false, true, false, "done"], // 有训练记录 → 非首次
    [true, false, false, "done"], // 有计划 → 非首次
    [true, true, true, "done"],
  ];
  for (const [hasPlan, hasRecords, hasProfile, expected] of cases) {
    it(`plan=${hasPlan} records=${hasRecords} profile=${hasProfile} → ${expected}`, () => {
      expect(deriveOnboarding(hasPlan, hasRecords, hasProfile)).toBe(expected);
    });
  }

  it("onboarding=needed 仅与 newcomer 同现（Service 组装自洽）", async () => {
    const { repo } = buildFakeRepo({
      hasAnyWeeklyPlan: false,
      hasAnySessions: false,
      hasProfileStatic: false,
    });
    const res = await new ScheduleSummaryService(repo).getSummary(
      USER_ID,
      TODAY,
    );
    expect(res.onboarding).toBe("needed");
    expect(res.user_stage).toBe("newcomer");
    expect(res.today).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// 参数校验与装配链路
// ---------------------------------------------------------------------------

describe("ScheduleSummaryService 参数校验与端口装配", () => {
  it("非法 userId → ServiceError(INVALID_PARAMS)，且不触达 Repository", async () => {
    const { repo, calls } = buildFakeRepo();
    await expect(
      new ScheduleSummaryService(repo).getSummary("not-a-uuid", TODAY),
    ).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_PARAMS });
    expect(calls.metaUserIds).toHaveLength(0);
    expect(calls.hasPlanUserIds).toHaveLength(0);
  });

  it("非法 date → ServiceError(INVALID_PARAMS)", async () => {
    const { repo } = buildFakeRepo();
    await expect(
      new ScheduleSummaryService(repo).getSummary(USER_ID, "2026-9-26"),
    ).rejects.toMatchObject({ code: ServiceErrorCode.INVALID_PARAMS });
  });

  it("date 缺省走服务器 UTC 当日（E2 同款缺省口径）", async () => {
    const { repo, calls } = buildFakeRepo({});
    await new ScheduleSummaryService(repo).getSummary(USER_ID);
    // 至少证明四路读全部触达（缺省日期合法、不抛）
    expect(calls.hasPlanUserIds).toEqual([USER_ID]);
    expect(calls.hasSessionsUserIds).toEqual([USER_ID]);
    expect(calls.hasProfileUserIds).toEqual([USER_ID]);
  });

  it("E2 复用链路：summary 与 getTodaySchedule 共用同一 Repository 端口", async () => {
    const { repo, calls } = buildFakeRepo({
      thisWeekPlan: planMeta(),
      todayEntries: [todayEntry()],
      hasAnyWeeklyPlan: true,
    });
    const res = await new ScheduleSummaryService(repo).getSummary(
      USER_ID,
      TODAY,
    );
    // E2 课表判定读（meta + entries）与路由判定读（三个 EXISTS）同端口发出
    expect(calls.metaUserIds).toEqual([USER_ID]);
    expect(calls.entriesUserIds).toEqual([USER_ID]);
    // week_id 推导走契约单一真源（getIsoWeekId 周四规则）
    expect(calls.metaWeekIds).toEqual([WEEK_ID]);
    expect(calls.entriesDates).toEqual([TODAY]);
    expect(res.today).toBe("scheduled");
    expect(res.today_entries[0].exercise_name).toBe("杠铃深蹲");
    expect(res.today_entries[0].target_sets).toBe(4);
  });
});
