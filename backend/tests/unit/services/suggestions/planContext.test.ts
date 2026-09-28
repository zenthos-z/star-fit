/**
 * Unit tests for suggestionPlanContext（计划上下文疲劳降载，issue #39 B6）。
 *
 * 钉死的行为：
 * - 因子有界：factor = max(floor, 1 - per_exercise_deload × prior)，第 1 个 1.0
 * - 排序语义：当日同肌群按计划顺序计 prior；不在计划内的动作取全部已排数
 * - 聚合：同动作多次出现去重计数、组数累加；skipped 已由 Repository 过滤
 * - 纯有氧（primary_muscles 空）不参与调制
 * - 应用因子只降容量通道（weight/duration/distance/reps），set_count 不动
 * - 配置 env 可调但有界钳制
 */

import { describe, it, expect, afterEach } from "@jest/globals";

import {
  aggregateDailyMuscleLoads,
  applyPlanContextFactor,
  planContextFactor,
  resolvePlanContextConfig,
  type PlanContextEntry,
} from "../../../../src/services/suggestions/suggestionPlanContext.js";

// ============================================================================
// Fixtures
// ============================================================================

function entry(
  id: string,
  name: string,
  muscles: string[],
  sortOrder = 0,
  sets = 3,
): PlanContextEntry {
  return {
    exercise_id: id,
    exercise_name: name,
    exercise_type: "resistance",
    primary_muscles: muscles,
    target_sets: sets,
    sort_order: sortOrder,
  };
}

const CHEST_PLAN: PlanContextEntry[] = [
  entry("e1", "bench press", ["chest"], 0, 4),
  entry("e2", "incline press", ["chest"], 1, 3),
  entry("e3", "cable fly", ["chest"], 2, 3),
];

// ============================================================================
// aggregateDailyMuscleLoads
// ============================================================================

describe("aggregateDailyMuscleLoads", () => {
  it("aggregates per first primary muscle with sets summed", () => {
    const loads = aggregateDailyMuscleLoads(CHEST_PLAN);
    expect(loads.get("chest")).toEqual({
      muscle: "chest",
      exercises: [
        { exercise_id: "e1", exercise_name: "bench press" },
        { exercise_id: "e2", exercise_name: "incline press" },
        { exercise_id: "e3", exercise_name: "cable fly" },
      ],
      totalSets: 10,
    });
  });

  it("dedupes repeated exercise ids but keeps sets summed", () => {
    const loads = aggregateDailyMuscleLoads([
      ...CHEST_PLAN,
      entry("e1", "bench press", ["chest"], 5, 2),
    ]);
    const chest = loads.get("chest")!;
    expect(chest.exercises).toHaveLength(3);
    expect(chest.exercises[0].exercise_id).toBe("e1");
    expect(chest.totalSets).toBe(12);
  });

  it("skips cardio entries without primary muscles", () => {
    const loads = aggregateDailyMuscleLoads([
      ...CHEST_PLAN,
      entry("run", "treadmill run", [], 3, 1),
    ]);
    expect(loads.size).toBe(1);
    expect(loads.has("cardio")).toBe(false);
  });
});

// ============================================================================
// planContextFactor
// ============================================================================

describe("planContextFactor", () => {
  const config = resolvePlanContextConfig(); // defaults: 5%/floor 0.70

  it("first planned exercise gets factor 1.0, later ones degrade monotonically", () => {
    const loads = aggregateDailyMuscleLoads(CHEST_PLAN);
    const f1 = planContextFactor(
      { exercise_id: "e1", primary_muscles: ["chest"] },
      loads,
      config,
    );
    const f2 = planContextFactor(
      { exercise_id: "e2", primary_muscles: ["chest"] },
      loads,
      config,
    );
    const f3 = planContextFactor(
      { exercise_id: "e3", primary_muscles: ["chest"] },
      loads,
      config,
    );
    expect(f1.factor).toBe(1);
    expect(f2.factor).toBeCloseTo(0.95, 10);
    expect(f3.factor).toBeCloseTo(0.9, 10);
    expect(f1.prior_same_muscle_exercises).toBe(0);
    expect(f2.prior_same_muscle_exercises).toBe(1);
    expect(f3.prior_same_muscle_exercises).toBe(2);
  });

  it("B6 gate d: 4th chest exercise (not in plan) counts all 3 as prior and gets lower volume", () => {
    const loads = aggregateDailyMuscleLoads(CHEST_PLAN);
    const fourth = planContextFactor(
      { exercise_id: "e4", primary_muscles: ["chest"] },
      loads,
      config,
    );
    expect(fourth.prior_same_muscle_exercises).toBe(3);
    expect(fourth.factor).toBeCloseTo(0.85, 10);
    expect(fourth.today_planned_sets).toBe(10);
    expect(fourth.muscle).toBe("chest");
  });

  it("bounds the factor at the configured floor", () => {
    const loads = aggregateDailyMuscleLoads([
      ...CHEST_PLAN,
      entry("e4", "dumbbell fly", ["chest"], 3),
      entry("e5", "machine press", ["chest"], 4),
      entry("e6", "pushup", ["chest"], 5),
      entry("e7", "dip", ["chest"], 6),
    ]);
    const last = planContextFactor(
      { exercise_id: "e8", primary_muscles: ["chest"] },
      loads,
      config,
    );
    // 1 - 0.05×7 = 0.65 < floor 0.70 → clamped
    expect(last.factor).toBe(0.7);
  });

  it("unrelated muscle and cardio get factor 1.0", () => {
    const loads = aggregateDailyMuscleLoads(CHEST_PLAN);
    const squat = planContextFactor(
      { exercise_id: "sq", primary_muscles: ["quadriceps"] },
      loads,
      config,
    );
    const cardio = planContextFactor(
      { exercise_id: "run", primary_muscles: [] },
      loads,
      config,
    );
    expect(squat.factor).toBe(1);
    expect(cardio.factor).toBe(1);
    expect(cardio.muscle).toBeUndefined();
  });
});

// ============================================================================
// applyPlanContextFactor
// ============================================================================

describe("applyPlanContextFactor", () => {
  it("scales volume channels but leaves set_count/target_rpe untouched", () => {
    const out = applyPlanContextFactor(
      { weight: 100, reps: 10, set_count: 4, target_rpe: 7 },
      0.85,
    );
    expect(out.weight).toBeCloseTo(85, 10);
    expect(out.reps).toBe(9); // round(10×0.85)
    expect(out.set_count).toBe(4);
    expect(out.target_rpe).toBe(7);
  });

  it("factor 1 is an identity (no object mutation of absent fields)", () => {
    const values = { duration_sec: 1800, distance_m: 5000 };
    expect(applyPlanContextFactor(values, 1)).toEqual(values);
  });

  it("scales duration and distance for cardio channels", () => {
    const out = applyPlanContextFactor(
      { duration_sec: 1800, distance_m: 5000, set_count: 1 },
      0.9,
    );
    expect(out.duration_sec).toBe(1620);
    expect(out.distance_m).toBeCloseTo(4500, 10);
  });
});

// ============================================================================
// resolvePlanContextConfig
// ============================================================================

describe("resolvePlanContextConfig", () => {
  const ENV_KEYS = [
    "SUGGESTION_PLAN_DELOAD_PER_EXERCISE",
    "SUGGESTION_PLAN_DELOAD_FLOOR",
  ] as const;

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("defaults: 5% per exercise, floor 0.70", () => {
    const config = resolvePlanContextConfig({});
    expect(config.perExerciseDeload).toBe(0.05);
    expect(config.floor).toBe(0.7);
  });

  it("env override respected within bounds", () => {
    const config = resolvePlanContextConfig({
      SUGGESTION_PLAN_DELOAD_PER_EXERCISE: "0.1",
      SUGGESTION_PLAN_DELOAD_FLOOR: "0.6",
    });
    expect(config.perExerciseDeload).toBe(0.1);
    expect(config.floor).toBe(0.6);
  });

  it("out-of-range values are clamped into the safety band", () => {
    const config = resolvePlanContextConfig({
      SUGGESTION_PLAN_DELOAD_PER_EXERCISE: "0.9",
      SUGGESTION_PLAN_DELOAD_FLOOR: "0.1",
    });
    expect(config.perExerciseDeload).toBe(0.2);
    expect(config.floor).toBeGreaterThanOrEqual(0.5);
  });
});
