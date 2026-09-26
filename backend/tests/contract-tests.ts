/**
 * Contract Tests: Exercises API & Video Protocol
 *
 * 批次3改造（2026-09-22）：删除本地手抄的 ExerciseSchema / VideoAssetSchema 镜像
 * （旧 L7-60 本地 z.object，契约改动后测试照样绿——失去镜像意义），改为直接断言
 * 真源契约：
 *  - ExerciseSchema       → shared/contracts（数据契约唯一定义源，NA-003 红线）
 *  - VideoAssetSchema     → backend/src/schemas/videoSchema.ts
 *    （shared/contracts 无视频资产导出；后端视频资产真源即此文件，
 *     视频处理链路 videoProcessingService.ts 亦从这里导入）
 *
 * 断言按真 schema 形状编写：Exercise 为 NanoID + attributes 嵌套结构；
 * VideoAsset 为 uuid id + 正数元数据 + quality 枚举 + type/sources 默认值。
 */
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { ExerciseSchema } from "../../shared/contracts/index.js";
import { VideoAssetSchema } from "../src/schemas/videoSchema.js";
import {
  CreateWeeklyPlanInputSchema,
  WeeklyPlanSchema,
  PlanEntrySchema,
  WeeklyPlanWithEntriesSchema,
  WeekIdSchema,
  canTransitionPlanEntryStatus,
  PLAN_ENTRY_STATUS_TRANSITIONS,
  TodayScheduleResponseSchema,
  TodayScheduleEntrySchema,
  getIsoWeekId,
  type PlanEntry,
  type WeeklyPlan,
} from "../../shared/contracts/index.js";

// ============================================================================
// 构造器：按真契约形状构造样本
// ============================================================================

/** 合法 NanoID（12-24 字符，如 nanoid 默认 21 位） */
const NANO_ID = "test-exercise-0001";

function buildExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: NANO_ID,
    name: "Test Exercise",
    exercise_type: "resistance",
    difficulty: "beginner",
    attributes: {
      targets: {
        primary: ["中下胸"],
        secondary: ["三头"],
      },
      equipment_required: ["杠铃", "卧推凳"],
    },
    ...overrides,
  };
}

function buildVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "9f8b7c6d-5e4a-4b3c-8d2e-1f0a9b8c7d6e",
    exerciseName: "bench_press",
    type: "local",
    baseUrl: "/uploads/videos/video-1",
    sources: [
      { quality: "360p", url: "/360p.mp4", size: 500000, bandwidth: 500000 },
      { quality: "720p", url: "/720p.mp4", size: 1500000, bandwidth: 1500000 },
    ],
    posterUrl: "/uploads/videos/video-1/poster.jpg",
    metadata: {
      originalFilename: "bench-press.mp4",
      duration: 45,
      width: 1920,
      height: 1080,
      codec: "h264",
      bitrate: 3000000,
      size: 1500000,
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Contract Tests: Exercises API（真源 shared/contracts ExerciseSchema）
// ============================================================================

describe("Contract Tests: Exercises API", () => {
  test("exercise response has valid structure", () => {
    const result = ExerciseSchema.safeParse(buildExercise());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.data.attributes.targets.primary.length > 0);
      assert.ok(Array.isArray(result.data.attributes.equipment_required));
    }
  });

  test("exercise id is NanoID-shaped (12-24 chars, no whitespace)", () => {
    // 合法：21 位默认 NanoID
    const ok = ExerciseSchema.safeParse(
      buildExercise({ id: "123456789012345678901" }),
    );
    assert.strictEqual(ok.success, true);

    // 非法：过短 / 含空白 —— 真契约必须拦截
    for (const bad of ["", "  ", "\t", "short"]) {
      const result = ExerciseSchema.safeParse(buildExercise({ id: bad }));
      assert.strictEqual(
        result.success,
        false,
        `id "${bad}" should be rejected`,
      );
      if (!result.success) {
        assert.ok(
          result.error.issues.some((i) => i.path.includes("id")),
          `failure should point at id, got ${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });

  test("exercise name must be a string (real contract: no min-length)", () => {
    // 真契约 name: z.string()——不强制非空（旧镜像的 .min(1) 是手抄件，不是真约束）
    const emptyOk = ExerciseSchema.safeParse(buildExercise({ name: "" }));
    assert.strictEqual(emptyOk.success, true);

    const nonString = ExerciseSchema.safeParse(buildExercise({ name: 123 }));
    assert.strictEqual(nonString.success, false);
    if (!nonString.success) {
      assert.ok(nonString.error.issues.some((i) => i.path.includes("name")));
    }
  });

  test("exercise_type must be a known enum value", () => {
    const result = ExerciseSchema.safeParse(
      buildExercise({ exercise_type: "yoga" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error.issues.some((i) => i.path.includes("exercise_type")),
      );
    }
  });

  test("difficulty must be a known enum value", () => {
    const result = ExerciseSchema.safeParse(
      buildExercise({ difficulty: "extreme" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("difficulty")));
    }
  });

  test("attributes is required and validates equipment_required as array", () => {
    const missing = ExerciseSchema.safeParse(
      buildExercise({ attributes: undefined }),
    );
    assert.strictEqual(missing.success, false);

    const badEquip = ExerciseSchema.safeParse(
      buildExercise({
        attributes: {
          targets: { primary: ["胸"] },
          equipment_required: "barbell",
        },
      }),
    );
    assert.strictEqual(badEquip.success, false);
    if (!badEquip.success) {
      assert.ok(
        badEquip.error.issues.some((i) =>
          i.path.includes("equipment_required"),
        ),
      );
    }
  });
});

// ============================================================================
// Contract Tests: Video Protocol（真源 backend/src/schemas/videoSchema.ts）
// ============================================================================

describe("Contract Tests: Video Protocol", () => {
  test("video asset matches VideoAssetSchema", () => {
    const result = VideoAssetSchema.safeParse(buildVideo());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.baseUrl, "/uploads/videos/video-1");
      assert.strictEqual(
        result.data.posterUrl,
        "/uploads/videos/video-1/poster.jpg",
      );
      assert.strictEqual(
        result.data.metadata.originalFilename,
        "bench-press.mp4",
      );
      assert.strictEqual(result.data.metadata.duration, 45);
      assert.strictEqual(Array.isArray(result.data.sources), true);
      assert.strictEqual(result.data.sources.length, 2);
    }
  });

  test("video id must be a UUID", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ id: "video-test-1" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("id")));
    }
  });

  test("exerciseName must be slug-shaped (no spaces / non-latin)", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ exerciseName: "卧推 bench press" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error.issues.some((i) => i.path.includes("exerciseName")),
      );
    }
  });

  test("type defaults to local when omitted", () => {
    const result = VideoAssetSchema.safeParse(buildVideo({ type: undefined }));
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.type, "local");
    }
  });

  test("sources defaults to empty array when omitted", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ sources: undefined }),
    );
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.sources.length, 0);
    }
  });

  test("sources quality must be a known enum", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({
        sources: [{ quality: "4k", url: "/4k.mp4", size: 1, bandwidth: 1 }],
      }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("quality")));
    }
  });

  test("metadata numeric fields reject non-positive values", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ metadata: { ...buildVideo().metadata, duration: -5 } }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("duration")));
    }
  });
});

// ============================================================================
// Contract Tests: Weekly Plan（真源 shared/contracts/weekly-plan.ts — issue #10）
// ============================================================================

const WP_USER_ID = "5f0c3e2a-1b4d-4c8e-9a7f-3d6b2e8c1a01";
const WP_PLAN_ID = "7a1e9c3b-5d2f-4b6a-8e0c-2f7d4a9b3e5c";
const WP_ENTRY_ID = "9c4a7e1d-3f8b-4d2c-b6a0-1e5f8d3c7b9a";
const WP_EXERCISE_ID = "bench-press-00001"; // NanoID 17 字符（12-24 合法区间）

function buildEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WP_ENTRY_ID,
    weekly_plan_id: WP_PLAN_ID,
    user_id: WP_USER_ID,
    entry_date: "2026-09-28",
    exercise_id: WP_EXERCISE_ID,
    target_sets: 4,
    target_load: { type: "rpe", min: 7, max: 8 },
    status: "planned",
    sort_order: 0,
    created_at: "2026-09-26T08:00:00.000Z",
    updated_at: "2026-09-26T08:00:00.000Z",
    ...overrides,
  };
}

function buildPlanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WP_PLAN_ID,
    user_id: WP_USER_ID,
    week_id: "2026-W40",
    split: "upper_lower",
    status: "active",
    created_at: "2026-09-26T08:00:00.000Z",
    updated_at: "2026-09-26T08:00:00.000Z",
    ...overrides,
  };
}

function buildCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    user_id: WP_USER_ID,
    week_id: "2026-W40",
    split: "push_pull_legs",
    entries: [
      {
        entry_date: "2026-09-28",
        exercise_id: WP_EXERCISE_ID,
        target_sets: 4,
        target_load: { type: "percent_1rm", min: 70, max: 80 },
      },
    ],
    ...overrides,
  };
}

describe("Contract Tests: Weekly Plan", () => {
  test("create input accepts a full plan with entries and applies defaults", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(buildCreateInput());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.status, "active"); // 周计划状态默认 active
      assert.strictEqual(result.data.entries.length, 1);
      assert.strictEqual(result.data.entries[0].status, "planned"); // 条目默认 planned
      assert.strictEqual(result.data.entries[0].sort_order, 0); // 排序默认 0
    }
  });

  test("create input defaults entries to empty array", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse({
      user_id: WP_USER_ID,
      week_id: "2026-W40",
      split: "full_body",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.entries, []);
    }
  });

  test("week_id must be ISO week format YYYY-Www (01-53)", () => {
    for (const ok of ["2026-W01", "2026-W40", "2026-W53", "2020-W07"]) {
      assert.strictEqual(
        WeekIdSchema.safeParse(ok).success,
        true,
        `${ok} 应合法`,
      );
    }
    // 非法：周号缺零 / 越界（00、54）/ 两位年 / 非法字符
    for (const bad of [
      "2026-W1",
      "2026-W00",
      "2026-W54",
      "26-W05",
      "2026-W4x",
      "",
    ]) {
      assert.strictEqual(
        WeekIdSchema.safeParse(bad).success,
        false,
        `"${bad}" 应被拒绝`,
      );
    }
    const badInput = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ week_id: "2026-W54" }),
    );
    assert.strictEqual(badInput.success, false);
    if (!badInput.success) {
      assert.ok(badInput.error.issues.some((i) => i.path.includes("week_id")));
    }
  });

  test("user_id must be a UUID", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ user_id: "not-a-uuid" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("user_id")));
    }
  });

  test("split must be a known enum value", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ split: "bro_split" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("split")));
    }
  });

  test("entry_date must be calendar day YYYY-MM-DD", () => {
    for (const bad of ["2026-9-28", "20260928", "2026-09-28T00:00:00Z"]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ entry_date: bad }),
      );
      assert.strictEqual(result.success, false, `entry_date "${bad}" 应被拒绝`);
    }
  });

  test("exercise_id must be NanoID-shaped (12-24 chars)", () => {
    assert.strictEqual(
      PlanEntrySchema.safeParse(buildEntryRow({ exercise_id: "short-id" }))
        .success,
      false,
    );
    assert.strictEqual(
      PlanEntrySchema.safeParse(buildEntryRow({ exercise_id: "x".repeat(25) }))
        .success,
      false,
    );
  });

  test("target_sets must be a positive integer", () => {
    for (const bad of [0, -1, 1.5, "4"]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ target_sets: bad }),
      );
      assert.strictEqual(
        result.success,
        false,
        `target_sets ${JSON.stringify(bad)} 应被拒绝`,
      );
    }
  });

  test("target_load rpe bounds are [0, 10]", () => {
    assert.strictEqual(
      PlanEntrySchema.safeParse(
        buildEntryRow({ target_load: { type: "rpe", min: 0, max: 10 } }),
      ).success,
      true,
    );
    for (const bad of [
      { type: "rpe", min: -1, max: 8 },
      { type: "rpe", min: 7, max: 11 },
    ]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ target_load: bad }),
      );
      assert.strictEqual(
        result.success,
        false,
        `rpe ${JSON.stringify(bad)} 应越界拒绝`,
      );
    }
  });

  test("target_load percent_1rm bounds are (0, 100]", () => {
    assert.strictEqual(
      PlanEntrySchema.safeParse(
        buildEntryRow({
          target_load: { type: "percent_1rm", min: 40, max: 95 },
        }),
      ).success,
      true,
    );
    for (const bad of [
      { type: "percent_1rm", min: 0, max: 80 }, // 0 非法（开区间下界）
      { type: "percent_1rm", min: 70, max: 101 }, // 101 越上界
    ]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ target_load: bad }),
      );
      assert.strictEqual(
        result.success,
        false,
        `percent_1rm ${JSON.stringify(bad)} 应越界拒绝`,
      );
    }
  });

  test("target_load rejects min > max and unknown type", () => {
    const reversed = PlanEntrySchema.safeParse(
      buildEntryRow({ target_load: { type: "rpe", min: 9, max: 7 } }),
    );
    assert.strictEqual(reversed.success, false);

    const badType = PlanEntrySchema.safeParse(
      buildEntryRow({ target_load: { type: "velocity", min: 1, max: 2 } }),
    );
    assert.strictEqual(badType.success, false);
  });

  test("row schemas validate persisted plan and entry shapes", () => {
    const plan: WeeklyPlan = WeeklyPlanSchema.parse(buildPlanRow());
    assert.strictEqual(plan.week_id, "2026-W40");

    const entry: PlanEntry = PlanEntrySchema.parse(buildEntryRow());
    assert.strictEqual(entry.target_load.type, "rpe");
    assert.strictEqual(entry.target_load.min, 7);

    const combined = WeeklyPlanWithEntriesSchema.safeParse({
      plan: buildPlanRow(),
      entries: [buildEntryRow()],
    });
    assert.strictEqual(combined.success, true);
  });

  test("entry status must be a known state machine value", () => {
    const result = PlanEntrySchema.safeParse(
      buildEntryRow({ status: "cancelled" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("status")));
    }
  });

  test("create input rejects entries over the 200 cap", () => {
    const entries = Array.from({ length: 201 }, () => ({
      entry_date: "2026-09-28",
      exercise_id: WP_EXERCISE_ID,
      target_sets: 1,
      target_load: { type: "rpe", min: 1, max: 2 },
    }));
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ entries }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("entries")));
    }
  });

  test("state machine: planned→adjusted→completed/skipped, terminals sealed", () => {
    // 合法前进
    assert.strictEqual(
      canTransitionPlanEntryStatus("planned", "adjusted"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("planned", "completed"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("planned", "skipped"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("adjusted", "adjusted"),
      true,
    ); // 再调整
    assert.strictEqual(
      canTransitionPlanEntryStatus("adjusted", "completed"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("adjusted", "skipped"),
      true,
    );

    // 终态封闭：completed / skipped 无出边
    assert.deepStrictEqual(PLAN_ENTRY_STATUS_TRANSITIONS.completed, []);
    assert.deepStrictEqual(PLAN_ENTRY_STATUS_TRANSITIONS.skipped, []);
    for (const terminal of ["completed", "skipped"] as const) {
      for (const to of [
        "planned",
        "adjusted",
        "completed",
        "skipped",
      ] as const) {
        if (to === terminal) continue; // 同态幂等放行
        assert.strictEqual(
          canTransitionPlanEntryStatus(terminal, to),
          false,
          `${terminal} → ${to} 应非法`,
        );
      }
    }

    // 同态迁移 = 幂等重放，恒放行
    for (const s of ["planned", "adjusted", "completed", "skipped"] as const) {
      assert.strictEqual(canTransitionPlanEntryStatus(s, s), true);
    }
  });
});

// ============================================================================
// Contract Tests: Today Schedule (E2) + ISO week derivation（真源 weekly-plan.ts）
// ============================================================================

describe("Contract Tests: Today Schedule & ISO Week", () => {
  const ENTRY = {
    entry_id: "3f2b1a00-0000-4000-8000-000000000001",
    exercise_id: "test-exercise-0001",
    exercise_name: "杠铃深蹲",
    target_sets: 4,
    target_load: { type: "percent_1rm", min: 70, max: 80 },
    status: "planned",
    sort_order: 1,
  };

  test("getIsoWeekId derives known anchors (ISO-8601, Monday start, Thursday rule)", () => {
    const anchors: Array<[string, string]> = [
      ["2026-01-01", "2026-W01"], // 元旦恰为周四
      ["2025-12-29", "2026-W01"], // 跨年向前：上年 12 月末属来年 W01
      ["2026-09-26", "2026-W39"],
      ["2026-12-31", "2026-W53"], // 2026 为 53 周长年
      ["2027-01-01", "2026-W53"], // 跨年向后：元旦周五属上年 W53
      ["2024-12-29", "2024-W52"], // 周日收尾一周
      ["2020-01-03", "2020-W01"],
      ["2021-01-01", "2020-W53"], // 闰年长周跨年
    ];
    for (const [date, week] of anchors) {
      assert.strictEqual(getIsoWeekId(date), week, `${date} → ${week}`);
    }
  });

  test("getIsoWeekId throws on malformed date", () => {
    for (const bad of ["2026-9-26", "20260926", "2026-09-26T00:00:00Z", ""]) {
      assert.throws(() => getIsoWeekId(bad), /YYYY-MM-DD/, `"${bad}" 应抛错`);
    }
  });

  test("TodayScheduleEntry rejects rows without the joined exercise_name", () => {
    const { exercise_name: _drop, ...withoutName } = ENTRY;
    assert.strictEqual(
      TodayScheduleEntrySchema.safeParse(withoutName).success,
      false,
    );
  });

  test("TodayScheduleResponse accepts all three statuses with correct shapes", () => {
    const base = { date: "2026-09-26", week_id: "2026-W39" };
    // planned：split + 非空 entries
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "planned",
        split: "upper_lower",
        entries: [ENTRY],
      }).success,
      true,
    );
    // rest_day：计划元数据仍在，entries 空
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "rest_day",
        split: "full_body",
        entries: [],
      }).success,
      true,
    );
    // no_plan：确定性兜底——split 必为 null、entries 必为空
    const noPlan = TodayScheduleResponseSchema.safeParse({
      ...base,
      status: "no_plan",
      split: null,
      entries: [],
    });
    assert.strictEqual(noPlan.success, true);
    // no_plan 带 split 或条目则拒（兜底形态不可漂移）
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "no_plan",
        split: "full_body",
        entries: [],
      }).success,
      false,
    );
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "no_plan",
        split: null,
        entries: [ENTRY],
      }).success,
      false,
    );
  });

  test("TodayScheduleResponse rejects malformed date / unknown status", () => {
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        date: "2026-9-26",
        week_id: "2026-W39",
        status: "planned",
        split: "full_body",
        entries: [ENTRY],
      }).success,
      false,
    );
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        date: "2026-09-26",
        week_id: "2026-W39",
        status: "maybe",
        split: null,
        entries: [],
      }).success,
      false,
    );
  });
});
