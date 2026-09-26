/**
 * progressionPolicy unit tests (E3 / issue #2).
 *
 * 锁定 program-progression 决策表代码化（纯函数，无 IO）：
 *   - selectSplit：天数 × 等级全表（含初学者降级行、≥7 天封顶）
 *   - selectProgressionStrategy：1RM/训练年龄/等级优先级
 *   - 步进算术：双重递进（下肢 5 / 上肢 2.5 / 女性上肢 1.25）与
 *     线性加重（+2.5%/+5% 对齐 2.5 步进）
 *   - shouldDeload：满足其一即触发，reasons 可转述
 */

import { describe, it, expect } from "@jest/globals";

import {
  selectSplit,
  selectProgressionStrategy,
  doubleProgressionStepKg,
  nextDoubleProgressionWeight,
  nextLinearProgressionWeight,
  shouldDeload,
} from "../../../../src/services/schedule/progressionPolicy.js";
import type { FitnessLevel } from "shared/contracts";

const LEVELS: FitnessLevel[] = ["beginner", "intermediate", "advanced"];

describe("selectSplit (split-selection 决策表)", () => {
  it("2-3 days → full_body for every level", () => {
    for (const level of LEVELS) {
      for (const days of [1, 2, 3]) {
        expect(selectSplit(days, level).value).toBe("full_body");
      }
    }
  });

  it("4 days → upper_lower for every level", () => {
    for (const level of LEVELS) {
      expect(selectSplit(4, level).value).toBe("upper_lower");
    }
  });

  it("5 days: beginner downgrades to upper_lower; intermediate+ get hybrid", () => {
    expect(selectSplit(5, "beginner").value).toBe("upper_lower");
    expect(selectSplit(5, "intermediate").value).toBe("hybrid");
    expect(selectSplit(5, "advanced").value).toBe("hybrid");
  });

  it("6 days: PPL for intermediate, PPL+weak-point (custom) for advanced; beginner is downgraded (禁止推拉腿)", () => {
    expect(selectSplit(6, "beginner").value).toBe("upper_lower");
    expect(selectSplit(6, "intermediate").value).toBe("push_pull_legs");
    expect(selectSplit(6, "advanced").value).toBe("custom");
  });

  it("≥7 days are capped at the 6-day decision (never a 7-day split)", () => {
    expect(selectSplit(7, "intermediate").value).toBe("push_pull_legs");
    expect(selectSplit(7, "advanced").value).toBe("custom");
    expect(selectSplit(14, "beginner").value).toBe("upper_lower");
  });

  it("every decision carries a rationale the agent can quote", () => {
    for (const level of LEVELS) {
      for (const days of [2, 4, 5, 6]) {
        const d = selectSplit(days, level);
        expect(d.rationale.length).toBeGreaterThan(5);
      }
    }
  });

  it("throws on out-of-range days (fail loudly)", () => {
    for (const bad of [0, -1, 2.5, 15]) {
      expect(() => selectSplit(bad, "beginner")).toThrow(/daysPerWeek/);
    }
  });

  it("throws on unknown level", () => {
    // @ts-expect-error 运行时防御：非法枚举值
    expect(() => selectSplit(4, "expert")).toThrow();
  });
});

describe("selectProgressionStrategy (progression-rules 策略表)", () => {
  it("non-beginner with a 1RM record → percent_1rm", () => {
    expect(selectProgressionStrategy("intermediate", 18, true).value).toBe(
      "percent_1rm",
    );
    expect(selectProgressionStrategy("advanced", 36, true).value).toBe(
      "percent_1rm",
    );
  });

  it("beginner keeps linear/double even with a 1RM record (百分比递进面向中高级)", () => {
    expect(selectProgressionStrategy("beginner", 2, true).value).toBe("linear");
    expect(selectProgressionStrategy("beginner", 12, true).value).toBe(
      "double_progression",
    );
  });

  it("first 6 months → linear; after that → double_progression (default)", () => {
    expect(selectProgressionStrategy("beginner", 0, false).value).toBe(
      "linear",
    );
    expect(selectProgressionStrategy("beginner", 6, false).value).toBe(
      "linear",
    );
    expect(selectProgressionStrategy("intermediate", 7, false).value).toBe(
      "double_progression",
    );
  });

  it("throws on negative / non-finite training age", () => {
    for (const bad of [-1, Number.NaN, 9999]) {
      expect(() => selectProgressionStrategy("beginner", bad, false)).toThrow(
        /trainingAgeMonths/,
      );
    }
  });
});

describe("load progression arithmetic (算术留 Service)", () => {
  it("double progression step: lower 5kg / upper 2.5kg / female upper 1.25kg", () => {
    expect(doubleProgressionStepKg("lower")).toBe(5);
    expect(doubleProgressionStepKg("upper")).toBe(2.5);
    expect(doubleProgressionStepKg("upper", "female")).toBe(1.25);
    expect(doubleProgressionStepKg("lower", "female")).toBe(5); // 下肢不分性别
  });

  it("nextDoubleProgressionWeight adds the step and stays on quarter-kg grid", () => {
    expect(nextDoubleProgressionWeight(60, "lower")).toBe(65);
    expect(nextDoubleProgressionWeight(60, "upper")).toBe(62.5);
    expect(nextDoubleProgressionWeight(40, "upper", "female")).toBe(41.25);
    // 浮点入参也收敛到 0.25kg 网格
    expect(nextDoubleProgressionWeight(52.27, "upper")).toBe(54.75);
  });

  it("nextLinearProgressionWeight: upper +2.5% / lower +5%, aligned to 2.5kg steps", () => {
    expect(nextLinearProgressionWeight(100, "lower")).toBe(105); // +5% → 105（2.5 倍数）
    expect(nextLinearProgressionWeight(80, "upper")).toBe(82); // 80×1.025=82（网格上）
    expect(nextLinearProgressionWeight(200, "upper")).toBe(205); // +5 → 205
    expect(nextLinearProgressionWeight(81, "upper")).toBe(83); // 83.025 → 0.25 网格收敛
  });

  it("throws on non-positive weights", () => {
    for (const bad of [0, -10, Number.NaN]) {
      expect(() => nextDoubleProgressionWeight(bad, "lower")).toThrow();
      expect(() => nextLinearProgressionWeight(bad, "upper")).toThrow();
    }
  });
});

describe("shouldDeload (deload 节拍判定)", () => {
  it("no signals → no deload", () => {
    expect(
      shouldDeload({
        weeksSinceDeload: 1,
        consecutivePerformanceDrops: 0,
        persistentFatigue: false,
        majorLifeStress: false,
      }),
    ).toEqual({ deload: false, reasons: [] });
  });

  it("each single trigger fires on its own", () => {
    const base = {
      weeksSinceDeload: 1,
      consecutivePerformanceDrops: 0,
      persistentFatigue: false,
      majorLifeStress: false,
    };
    expect(shouldDeload({ ...base, weeksSinceDeload: 4 }).deload).toBe(true);
    expect(shouldDeload({ ...base, weeksSinceDeload: 8 }).reasons[0]).toMatch(
      /4 周/,
    );
    expect(
      shouldDeload({ ...base, consecutivePerformanceDrops: 2 }).deload,
    ).toBe(true);
    expect(shouldDeload({ ...base, persistentFatigue: true }).deload).toBe(
      true,
    );
    expect(shouldDeload({ ...base, majorLifeStress: true }).deload).toBe(true);
  });

  it("3 weeks without deload is NOT a trigger (threshold is 4)", () => {
    expect(
      shouldDeload({
        weeksSinceDeload: 3,
        consecutivePerformanceDrops: 1,
        persistentFatigue: false,
        majorLifeStress: false,
      }).deload,
    ).toBe(false);
  });

  it("multiple hits accumulate into quotable reasons", () => {
    const d = shouldDeload({
      weeksSinceDeload: 6,
      consecutivePerformanceDrops: 2,
      persistentFatigue: true,
      majorLifeStress: false,
    });
    expect(d.deload).toBe(true);
    expect(d.reasons).toHaveLength(3);
  });
});
