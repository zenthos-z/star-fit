/**
 * planAdjustment unit tests (E3 / issue #2).
 *
 * 锁定缺勤顺延查表逻辑（纯函数，无 IO）：
 *   - 终态条目（completed/skipped）永不回改
 *   - 今日/未来条目照常执行（keep）
 *   - 错过条目 + 今日休息 → carry_over_today（顺延并入今日）
 *   - 错过条目 + 今日已有训练 → mark_skipped（不补课）
 *   - 「今日占座」只看非终态条目（今日已 skipped 不算训练日）
 *   - 非法 today 抛错（Zod 红线：抛错不静默）
 */

import { describe, it, expect } from "@jest/globals";

import {
  resolveMissedEntries,
  type MissedEntryResolution,
} from "../../../../src/services/schedule/planAdjustment.js";
import type { PlanEntry } from "shared/contracts";

// ---------------------------------------------------------------------------
// 构造器（PlanEntry 契约形态；id 用 UUID 保真）
// ---------------------------------------------------------------------------

function entry(overrides: Partial<PlanEntry>): PlanEntry {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    weekly_plan_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    entry_date: "2026-09-21",
    exercise_id: "test-exercise-0001",
    target_sets: 3,
    target_load: { type: "rpe", min: 7, max: 8 },
    status: "planned",
    sort_order: 0,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  } as PlanEntry;
}

function byAction(res: MissedEntryResolution[], action: string) {
  return res.filter((r) => r.action === action);
}

const TODAY = "2026-09-24"; // 周四（2026-W39 内）

describe("resolveMissedEntries (缺勤顺延查表)", () => {
  it("terminal entries (completed/skipped) are never revisited", () => {
    const res = resolveMissedEntries({
      today: TODAY,
      entries: [
        entry({ entry_date: "2026-09-21", status: "completed" }),
        entry({ entry_date: "2026-09-21", status: "skipped" }),
        entry({ entry_date: TODAY, status: "completed" }),
      ],
    });
    expect(res).toHaveLength(3);
    expect(res.every((r) => r.action === "keep")).toBe(true);
  });

  it("today's and future entries stay untouched (keep)", () => {
    const res = resolveMissedEntries({
      today: TODAY,
      entries: [
        entry({ entry_date: TODAY, status: "planned" }),
        entry({ entry_date: TODAY, status: "adjusted" }),
        entry({ entry_date: "2026-09-26", status: "planned" }),
      ],
    });
    expect(res.every((r) => r.action === "keep")).toBe(true);
  });

  it("missed entries carry over when today is a rest day", () => {
    // 周一/周二有条目但没练（仍 planned），今日（周四）无任何条目
    const res = resolveMissedEntries({
      today: TODAY,
      entries: [
        entry({ entry_date: "2026-09-21" }), // 周一 planned
        entry({ entry_date: "2026-09-22", status: "adjusted" }), // 周二 adjusted
      ],
    });
    const carry = byAction(res, "carry_over_today");
    expect(carry).toHaveLength(2);
    expect(carry.map((r) => r.entry_date)).toEqual([
      "2026-09-21",
      "2026-09-22",
    ]);
  });

  it("missed entries are skipped when today already has training (不补课)", () => {
    const res = resolveMissedEntries({
      today: TODAY,
      entries: [
        entry({ entry_date: "2026-09-21" }), // 错过
        entry({ entry_date: TODAY }), // 今日已有训练
      ],
    });
    const skipped = byAction(res, "mark_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].entry_date).toBe("2026-09-21");
    expect(skipped[0].reason).toBe("missed_and_day_full");
    expect(byAction(res, "keep")).toHaveLength(1); // 今日条目不动
    expect(byAction(res, "carry_over_today")).toHaveLength(0);
  });

  it("today's terminal-only rows do NOT count as an occupied training day", () => {
    // 今日条目已全部 skipped（终态）→ 今日视为空闲 → 错过条目顺延
    const res = resolveMissedEntries({
      today: TODAY,
      entries: [
        entry({ entry_date: "2026-09-21" }), // 错过
        entry({ entry_date: TODAY, status: "skipped" }), // 今日全终态
      ],
    });
    expect(byAction(res, "carry_over_today")).toHaveLength(1);
    expect(byAction(res, "mark_skipped")).toHaveLength(0);
  });

  it("empty week resolves to empty decisions", () => {
    expect(resolveMissedEntries({ today: TODAY, entries: [] })).toEqual([]);
  });

  it("throws on malformed today (fail loudly, never silent)", () => {
    expect(() =>
      resolveMissedEntries({ today: "2026-9-24", entries: [] }),
    ).toThrow(/YYYY-MM-DD/);
  });
});
