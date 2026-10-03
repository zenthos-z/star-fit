/**
 * uiHintValidator unit tests (M5b).
 *
 * Covers:
 *   - B1 / AC1: valid cards of all 5 allowed types pass.
 *   - B2 / AC2: invalid cards (missing field / wrong shape / unknown type) are rejected.
 *   - B3 / AC3: HC-4 HITL blacklist (hitl_confirm / survey_card) is rejected.
 *   - B5 / AC5 + P012: vacuity probe — every violation class is asserted
 *     `ok:false` with `errors.length > 0`, so the gate cannot silently pass scope.
 *
 * Runner: node:test via tsx (same convention as backend/tests/contract-tests.ts).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateUiHint,
  HITL_BLACKLIST_CODE,
  type StructuredError,
} from "../uiHintValidator.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One minimal valid card per allowed type (AC6 schema, verbatim rules). */
const VALID_CARDS: Record<string, unknown> = {
  plan_card: {
    type: "plan_card",
    data: [
      {
        exerciseId: "sq-001",
        name: "Back Squat",
        exercise_type: "resistance",
        sets: 3,
        reps: 8,
        weight: 80,
      },
      {
        exerciseId: "bp-001",
        name: "Bench Press",
        exercise_type: "resistance",
        sets: 4,
        reps: 6,
        weight: 60,
      },
    ],
  },
  summary_card: {
    type: "summary_card",
    data: {
      summary: "Solid session",
      highlights: ["PR on squat"],
      metrics: { rpe: 8 },
    },
  },
  weekly_plan: {
    type: "weekly_plan",
    data: {
      week_label: "第 2 周",
      phase_label: "力量块",
      split_summary: "推拉腿 · 每周 3 练 · 主项渐进 +1 档",
      days: [
        {
          entry_date: "2026-09-21",
          split_label: "推",
          focus: "胸肩三头，4 动作",
          rest: false,
          exercises: [
            {
              exercise_id: "V1StGXR8_Z5jdHi6",
              name: "杠铃深蹲",
              sets: [
                { set: 1, weight: 60, reps: 8 },
                { set: 2, weight: 65, reps: 6 },
              ],
            },
          ],
        },
        { entry_date: "2026-09-22", rest: true, exercises: [] },
      ],
    },
  },
  deviation_card: {
    type: "deviation_card",
    data: {
      reason: "Knee discomfort detected",
      suggestion: "Swap to box squat",
    },
  },
  audit_complete: {
    type: "audit_complete",
    data: {
      message: "Profile audit finished",
      updates: [{ field: "loadAnchors", label: "Squat", count: 1 }],
    },
  },
  profile_update_confirm: {
    type: "profile_update_confirm",
    data: {
      message: "你提到右肩有刺痛感，建议更新训练画像。",
      trigger: "injury_report",
      proposals: [
        {
          field: "active_limitations",
          label: "活动限制",
          change: "新增右肩限制，严重度 4/10，7 天后自动过期",
          // B5/issue #37：提案必须携带最终值 value（确认后由 App 确定性写入）
          value: [{ part: "right_shoulder", severity: 4 }],
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// B1 / AC1 — valid cards pass
// ---------------------------------------------------------------------------

describe("validateUiHint — B1 valid cards pass", () => {
  for (const [typeName, card] of Object.entries(VALID_CARDS)) {
    it(`accepts a valid ${typeName}`, () => {
      const result = validateUiHint(card);
      assert.equal(result.ok, true, `${typeName} should be valid`);
      if (result.ok) {
        assert.equal(result.card.type, typeName);
      }
    });
  }

  it("preserves ExercisePlan business rules (sets/reps positive int) on valid input", () => {
    // AC6: the migrated ExercisePlanSchema business rules are exercised, not stripped.
    const result = validateUiHint(VALID_CARDS.plan_card);
    assert.equal(result.ok, true);
    if (result.ok) {
      const plan = result.card as {
        type: string;
        data: Array<{ sets: number; reps: number }>;
      };
      assert.equal(plan.data[0].sets, 3);
      assert.equal(plan.data[0].reps, 8);
    }
  });
});

// ---------------------------------------------------------------------------
// B2 / AC2 + B5 / AC5 (P012 vacuity probe) — invalid cards rejected
// ---------------------------------------------------------------------------

describe("validateUiHint — B2 invalid cards rejected (P012 vacuity probe)", () => {
  // Each entry is a distinct violation class; asserting every one fails is the
  // P012 vacuity probe (the gate cannot silently let scope through).
  const violations: Array<{ name: string; card: unknown }> = [
    {
      name: "plan_card missing required sets/reps",
      card: { type: "plan_card", data: [{ exerciseId: "sq", name: "Squat" }] },
    },
    {
      name: "plan_card data wrong shape (object, not array)",
      card: {
        type: "plan_card",
        data: { "0": { exerciseId: "sq", name: "Squat", sets: 3, reps: 5 } },
      },
    },
    {
      name: "plan_card empty data array",
      card: { type: "plan_card", data: [] },
    },
    {
      name: "plan_card sets/reps non-positive",
      card: {
        type: "plan_card",
        data: [{ exerciseId: "sq", name: "Squat", sets: 0, reps: 5 }],
      },
    },
    {
      name: "summary_card missing required summary",
      card: { type: "summary_card", data: { highlights: ["x"] } },
    },
    {
      name: "weekly_plan data wrong shape (array, not object)",
      card: { type: "weekly_plan", data: [{ week_label: "第 2 周" }] },
    },
    {
      name: "weekly_plan missing required split_summary",
      card: {
        type: "weekly_plan",
        data: {
          week_label: "第 2 周",
          days: [
            {
              entry_date: "2026-09-21",
              rest: false,
              exercises: [
                {
                  exercise_id: "V1StGXR8_Z5jdHi6",
                  name: "杠铃深蹲",
                  sets: [{ set: 1, weight: 60, reps: 8 }],
                },
              ],
            },
          ],
        },
      },
    },
    {
      name: "weekly_plan empty days array",
      card: {
        type: "weekly_plan",
        data: { week_label: "第 2 周", split_summary: "推拉腿", days: [] },
      },
    },
    {
      name: "weekly_plan day with malformed entry_date",
      card: {
        type: "weekly_plan",
        data: {
          week_label: "第 2 周",
          split_summary: "推拉腿",
          days: [
            {
              entry_date: "2026-9-21",
              rest: false,
              exercises: [],
            },
          ],
        },
      },
    },
    {
      name: "weekly_plan exercise with empty sets array",
      card: {
        type: "weekly_plan",
        data: {
          week_label: "第 2 周",
          split_summary: "推拉腿",
          days: [
            {
              entry_date: "2026-09-21",
              rest: false,
              exercises: [
                { exercise_id: "V1StGXR8_Z5jdHi6", name: "杠铃深蹲", sets: [] },
              ],
            },
          ],
        },
      },
    },
    {
      name: "weekly_plan set with all params empty",
      card: {
        type: "weekly_plan",
        data: {
          week_label: "第 2 周",
          split_summary: "推拉腿",
          days: [
            {
              entry_date: "2026-09-21",
              rest: false,
              exercises: [
                {
                  exercise_id: "V1StGXR8_Z5jdHi6",
                  name: "杠铃深蹲",
                  sets: [{ set: 1 }],
                },
              ],
            },
          ],
        },
      },
    },
    {
      name: "deviation_card missing required reason",
      card: { type: "deviation_card", data: { suggestion: "x" } },
    },
    {
      name: "audit_complete missing required message",
      card: { type: "audit_complete", data: { title: "t" } },
    },
    {
      name: "profile_update_confirm missing required proposals",
      card: {
        type: "profile_update_confirm",
        data: { message: "m", trigger: "day_end" },
      },
    },
    {
      name: "profile_update_confirm empty proposals array",
      card: {
        type: "profile_update_confirm",
        data: { message: "m", trigger: "day_end", proposals: [] },
      },
    },
    {
      name: "profile_update_confirm invalid trigger value",
      card: {
        type: "profile_update_confirm",
        data: {
          message: "m",
          trigger: "random_trigger",
          proposals: [{ field: "memories", label: "l", change: "c" }],
        },
      },
    },
    {
      name: "profile_update_confirm proposal with unknown field",
      card: {
        type: "profile_update_confirm",
        data: {
          message: "m",
          trigger: "day_end",
          proposals: [{ field: "not_a_field", label: "l", change: "c" }],
        },
      },
    },
    {
      name: "unknown type",
      card: { type: "mystery_card", data: {} },
    },
    {
      name: "missing type entirely",
      card: { data: { summary: "x" } },
    },
    {
      name: "not an object",
      card: "plan_card",
    },
    {
      name: "null",
      card: null,
    },
  ];

  for (const { name, card } of violations) {
    it(`rejects: ${name}`, () => {
      const result = validateUiHint(card);
      assert.equal(result.ok, false, `${name} must be rejected`);
      if (!result.ok) {
        assert.ok(
          result.errors.length > 0,
          `${name} must surface at least one error`,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// B3 / AC3 — HC-4 HITL blacklist
// ---------------------------------------------------------------------------

describe("validateUiHint — B3 HC-4 HITL blacklist", () => {
  it("accepts survey_card (v3 amendment: allowed for workout_complete)", () => {
    // v3: survey_card was un-blacklisted — the agent emits it after training.
    const surveyCard = {
      type: "survey_card",
      data: {
        title: "Feedback",
        questions: [{ id: "q1", question: "How was it?", required: false }],
      },
    };
    const result = validateUiHint(surveyCard);
    assert.equal(
      result.ok,
      true,
      JSON.stringify(result.ok ? [] : result.errors),
    );
  });

  it("rejects hitl_confirm", () => {
    const result = validateUiHint({ type: "hitl_confirm", data: {} });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const hitl = result.errors.find(
        (e: StructuredError) => e.code === HITL_BLACKLIST_CODE,
      );
      assert.ok(hitl, "must surface a hitl_blacklist error for hitl_confirm");
    }
  });

  it("blacklist fires before schema parsing (precise code, not generic enum error)", () => {
    const result = validateUiHint({ type: "hitl_confirm", data: {} });
    assert.equal(result.ok, false);
    if (!result.ok) {
      // HC-4 rejection, not a generic invalid_union/enum issue.
      assert.equal(result.errors[0].code, HITL_BLACKLIST_CODE);
    }
  });
});

// ---------------------------------------------------------------------------
// #114 B5c — survey_card 新字段（purpose/children/textarea）过校验回路，
// 旧卡（无 purpose、inputType 旧三枚举）照常通过（契约 optional 增量）。
// ---------------------------------------------------------------------------

describe("validateUiHint — #114 survey_card new optional fields", () => {
  it("accepts purpose + children two-level options + textarea/select inputType", () => {
    const card = {
      type: "survey_card",
      data: {
        purpose: "profile_intake",
        title: "首用调研",
        questions: [
          {
            id: "equipment_venue",
            section: "必答",
            question: "主要训练场地",
            required: true,
            inputType: "select",
            childKey: "equipment_items",
            options: [
              {
                label: "健身房",
                value: "gym",
                children: [
                  { label: "杠铃", value: "barbell" },
                  { label: "深蹲架", value: "rack" },
                ],
              },
              { label: "家里", value: "home" },
            ],
          },
          {
            id: "weight_kg",
            question: "体重（kg）",
            required: true,
            inputType: "number",
            unit: "kg",
            min: 30,
            max: 250,
            hint: "用于推算你的起步重量",
          },
          {
            id: "age",
            question: "年龄",
            inputType: "number",
            condition: {
              questionId: "goal",
              equals: ["fat_loss", "general_fitness"],
            },
          },
          {
            id: "notes",
            question: "还有什么想让教练知道的？",
            inputType: "textarea",
            maxLength: 500,
            placeholder: "夜班倒班、产后恢复……",
          },
        ],
      },
    };
    const result = validateUiHint(card);
    assert.equal(
      result.ok,
      true,
      JSON.stringify(result.ok ? [] : result.errors),
    );
    if (result.ok) {
      const data = result.card.data as {
        purpose?: string;
        questions: Array<{
          id: string;
          options?: Array<{ children?: unknown[] }>;
        }>;
      };
      assert.equal(data.purpose, "profile_intake");
      assert.equal(data.questions[0].options?.[0]?.children?.length, 2);
    }
  });

  it("accepts every purpose enum value; rejects an unknown purpose", () => {
    for (const purpose of ["profile_intake", "workout_feedback", "plan_gap"]) {
      const result = validateUiHint({
        type: "survey_card",
        data: { purpose, questions: [{ id: "q", question: "?" }] },
      });
      assert.equal(result.ok, true, `purpose=${purpose} must parse`);
    }
    const bad = validateUiHint({
      type: "survey_card",
      data: { purpose: "random_quiz", questions: [{ id: "q", question: "?" }] },
    });
    assert.equal(bad.ok, false, "unknown purpose must be rejected by the enum");
  });

  it("legacy cards (no purpose / old 3-enum inputType) still pass unchanged", () => {
    // 旧练后反馈卡：无 purpose、checkbox 多选、纯 label/value 选项。
    const legacy = {
      type: "survey_card",
      data: {
        title: "训练反馈",
        questions: [
          {
            id: "fatigue_level",
            question: "今天的训练感觉有多累？（1-10分）",
            required: false,
            inputType: "number",
            placeholder: "请输入 1-10 的分数",
          },
          {
            id: "sleep_quality",
            question: "昨晚睡眠质量如何？",
            options: [
              { label: "很好", value: "excellent" },
              { label: "一般", value: "average" },
              { label: "较差", value: "poor" },
            ],
          },
        ],
      },
    };
    const result = validateUiHint(legacy);
    assert.equal(
      result.ok,
      true,
      JSON.stringify(result.ok ? [] : result.errors),
    );
    if (result.ok) {
      const data = result.card.data as { purpose?: unknown };
      assert.equal(
        data.purpose,
        undefined,
        "no purpose synthesized for old cards",
      );
    }
  });
});
