/**
 * surveyConvergence unit tests (#114 / B5c).
 *
 * Covers the survey_card → PROFILE_INTAKE_QUESTIONS convergence:
 *   - profile_intake → full bank (bank order), agent question content ignored;
 *   - plan_gap → canonical subset by id (bank order), off-bank ids dropped,
 *     condition dependency auto-included (age ← goal);
 *   - plan_gap with zero valid ids → structured error (SURVEY_OFF_BANK_CODE);
 *   - purpose-less / workout_feedback / non-survey cards pass through verbatim
 *     （旧卡零影响，练后反馈自由出题不动）；
 *   - loop integration: a paraphrased profile_intake card forwarded through
 *     chatWithValidationLoop arrives at the consumer with bank-verbatim
 *     questions (including equipment_venue children + notes textarea);
 *     an all-off-bank plan_gap card is rejected and retried through the
 *     existing feedback channel.
 *
 * Runner: node:test via tsx.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent, ChatRequest } from "shared/contracts";
import {
  PROFILE_INTAKE_QUESTIONS,
  type SurveyCardData,
} from "shared/contracts";
import type { AgentService } from "../AgentService.js";
import {
  canonicalizeSurveyCard,
  SURVEY_OFF_BANK_CODE,
} from "../surveyConvergence.js";
import { chatWithValidationLoop } from "../uiHintValidationLoop.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A paraphrased (deliberately WRONG wording) profile_intake card. */
const PARAPHRASED_INTAKE: unknown = {
  type: "survey_card",
  data: {
    purpose: "profile_intake",
    title: "先了解一下你",
    message: "回答完就给你排计划",
    questions: [
      {
        id: "goal",
        question: "你练肌肉还是减脂？", // WRONG wording — must be replaced
        inputType: "text", // WRONG type — must be replaced by select
      },
      { id: "weight_kg", question: "多重" }, // WRONG wording
      { id: "not_a_bank_id", question: "你喜欢的颜色？" }, // off-bank — ignored
    ],
  },
};

/** A plan_gap card with two valid ids + one off-bank id. */
const PLAN_GAP_MIXED: unknown = {
  type: "survey_card",
  data: {
    purpose: "plan_gap",
    title: "补两个信息",
    questions: [
      { id: "injuries", question: "伤哪了" }, // valid id, wrong wording
      { id: "made_up_id", question: "?" }, // off-bank — dropped
      { id: "weight_kg", question: "体重" }, // valid id
    ],
  },
};

/** A plan_gap card whose ids are ALL off-bank → structured error. */
const PLAN_GAP_ALL_OFF_BANK: unknown = {
  type: "survey_card",
  data: {
    purpose: "plan_gap",
    questions: [{ id: "mood_vibe", question: "今天心情如何？" }],
  },
};

/** A legacy free-form survey card (no purpose) — must pass through verbatim. */
const LEGACY_NO_PURPOSE: unknown = {
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
    ],
  },
};

/** A workout_feedback survey — free-form by design, passes verbatim. */
const WORKOUT_FEEDBACK: unknown = {
  type: "survey_card",
  data: {
    purpose: "workout_feedback",
    title: "训练反馈",
    questions: [
      {
        id: "sleep_quality",
        question: "昨晚睡眠质量如何？",
        options: [
          { label: "很好", value: "excellent" },
          { label: "一般", value: "average" },
        ],
      },
    ],
  },
};

/** Non-survey card — passes through (shape already schema-valid). */
const SUMMARY_CARD: unknown = {
  type: "summary_card",
  data: { summary: "训练完成", highlights: [], metrics: {} },
};

/** Bank questions keyed by id for assertions. */
const BANK_BY_ID = new Map(PROFILE_INTAKE_QUESTIONS.map((q) => [q.id, q]));

/** Extract the survey data face from a card object (loose cast). */
function surveyData(card: unknown): SurveyCardData {
  return (card as { data: SurveyCardData }).data;
}

// ---------------------------------------------------------------------------
// Pure function — canonicalizeSurveyCard
// ---------------------------------------------------------------------------

describe("canonicalizeSurveyCard — profile_intake", () => {
  const result = canonicalizeSurveyCard(PARAPHRASED_INTAKE);

  it("succeeds and carries the FULL bank in bank order", () => {
    assert.ok(result.ok);
    const data = surveyData(result.card);
    assert.equal(data.purpose, "profile_intake");
    assert.deepEqual(
      data.questions.map((q) => q.id),
      PROFILE_INTAKE_QUESTIONS.map((q) => q.id),
      "profile_intake must converge to the full bank in bank order",
    );
  });

  it("replaces agent wording with bank-verbatim questions (incl. children)", () => {
    assert.ok(result.ok);
    const questions = surveyData(result.card).questions;
    const goal = questions.find((q) => q.id === "goal");
    const bankGoal = BANK_BY_ID.get("goal");
    assert.ok(goal && bankGoal);
    assert.equal(goal.question, bankGoal.question); // bank wording, not "你练肌肉还是减脂？"
    assert.equal(goal.inputType, "select"); // replaced, not the agent's "text"
    assert.equal(goal.options?.length, bankGoal.options?.length);

    // equipment_venue children (二级菜单) survive canonicalization verbatim.
    const venue = questions.find((q) => q.id === "equipment_venue");
    const bankVenue = BANK_BY_ID.get("equipment_venue");
    assert.ok(venue && bankVenue);
    assert.equal(venue.childKey, "equipment_items");
    assert.deepEqual(venue.options, bankVenue.options);
    const gym = venue.options?.find((o) => o.value === "gym");
    assert.equal(
      gym?.children?.length,
      12,
      "gym children = 12 equipment values",
    );

    // notes textarea also canonical.
    const notes = questions.find((q) => q.id === "notes");
    assert.equal(notes?.inputType, "textarea");
    assert.equal(notes?.maxLength, 500);
  });

  it("keeps the agent's prose fields (title/message) untouched", () => {
    assert.ok(result.ok);
    const data = surveyData(result.card);
    assert.equal(data.title, "先了解一下你");
    assert.equal(data.message, "回答完就给你排计划");
  });

  it("returns deep copies — mutating the output must not corrupt the bank", () => {
    assert.ok(result.ok);
    const questions = surveyData(result.card).questions;
    const goal = questions.find((q) => q.id === "goal");
    if (goal) goal.question = "MUTATED";
    const fresh = canonicalizeSurveyCard(PARAPHRASED_INTAKE);
    assert.ok(fresh.ok);
    assert.equal(
      surveyData(fresh.card).questions.find((q) => q.id === "goal")?.question,
      BANK_BY_ID.get("goal")?.question,
      "shared bank constant must never be mutated by consumers",
    );
  });
});

describe("canonicalizeSurveyCard — plan_gap subset", () => {
  it("keeps only valid bank ids, canonical content, bank order", () => {
    const result = canonicalizeSurveyCard(PLAN_GAP_MIXED);
    assert.ok(result.ok);
    const questions = surveyData(result.card).questions;
    assert.deepEqual(
      questions.map((q) => q.id),
      ["weight_kg", "injuries"], // bank order, off-bank made_up_id dropped
    );
    for (const q of questions) {
      assert.deepEqual(
        q,
        BANK_BY_ID.get(q.id),
        `question ${q.id} bank-verbatim`,
      );
    }
  });

  it("auto-includes condition dependencies (age pulls in goal)", () => {
    const result = canonicalizeSurveyCard({
      type: "survey_card",
      data: {
        purpose: "plan_gap",
        questions: [{ id: "age", question: "几岁" }],
      },
    });
    assert.ok(result.ok);
    assert.deepEqual(
      surveyData(result.card).questions.map((q) => q.id),
      ["goal", "age"], // age alone would never render (condition on goal)
    );
  });

  it("rejects with a structured error when NO id is on the bank", () => {
    const result = canonicalizeSurveyCard(PLAN_GAP_ALL_OFF_BANK);
    assert.ok(!result.ok);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, SURVEY_OFF_BANK_CODE);
    assert.deepEqual(result.errors[0].path, ["data", "questions"]);
    // The error names the valid ids so the retry round can correct course.
    assert.match(result.errors[0].message, /weight_kg/);
    assert.match(result.errors[0].message, /weekly_frequency/);
  });
});

describe("canonicalizeSurveyCard — pass-through (旧卡/练后反馈零影响)", () => {
  it("returns a purpose-less legacy survey card unchanged", () => {
    const result = canonicalizeSurveyCard(LEGACY_NO_PURPOSE);
    assert.ok(result.ok);
    assert.equal(result.card, LEGACY_NO_PURPOSE, "must be the SAME reference");
  });

  it("returns a workout_feedback survey unchanged", () => {
    const result = canonicalizeSurveyCard(WORKOUT_FEEDBACK);
    assert.ok(result.ok);
    assert.equal(result.card, WORKOUT_FEEDBACK);
  });

  it("returns non-survey cards unchanged", () => {
    const result = canonicalizeSurveyCard(SUMMARY_CARD);
    assert.ok(result.ok);
    assert.equal(result.card, SUMMARY_CARD);
  });
});

// ---------------------------------------------------------------------------
// Loop integration — convergence rides the validation seam
// ---------------------------------------------------------------------------

/** Scripted AgentService replaying one event list per chat() call. */
class ScriptedAgent implements AgentService {
  readonly calls: ChatRequest[] = [];
  private callCount = 0;
  constructor(private readonly scripts: AgentEvent[][]) {}

  async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
    this.calls.push(req);
    const idx = Math.min(this.callCount, this.scripts.length - 1);
    this.callCount += 1;
    for (const event of this.scripts[idx]) {
      yield event;
    }
  }
}

const baseReq: ChatRequest = {
  userId: "11111111-1111-1111-1111-111111111111",
  message: "我要建训练计划",
  threadId: "thread_survey_convergence",
};

function uiHint(card: unknown): AgentEvent {
  return { type: "uiHint", card: card as never };
}

async function drain(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) {
    out.push(e);
  }
  return out;
}

describe("chatWithValidationLoop — survey convergence integration", () => {
  it("forwards a paraphrased profile_intake card as the bank-verbatim full set", async () => {
    const agent = new ScriptedAgent([
      [uiHint(PARAPHRASED_INTAKE), { type: "done" }],
    ]);
    const events = await drain(chatWithValidationLoop(agent, baseReq));

    const cardEvents = events.filter((e) => e.type === "uiHint" && e.card);
    assert.equal(cardEvents.length, 1);
    const data = surveyData(cardEvents[0].card);
    assert.equal(data.purpose, "profile_intake");
    assert.equal(data.questions.length, PROFILE_INTAKE_QUESTIONS.length);
    for (const q of data.questions) {
      assert.deepEqual(
        q,
        BANK_BY_ID.get(q.id),
        `question ${q.id} bank-verbatim`,
      );
    }
    // No retry: one chat call only.
    assert.equal(agent.calls.length, 1);
  });

  it("retries an all-off-bank plan_gap card through the feedback channel", async () => {
    const corrected = {
      type: "survey_card",
      data: {
        purpose: "plan_gap",
        questions: [{ id: "weight_kg", question: "体重" }],
      },
    };
    const agent = new ScriptedAgent([
      [uiHint(PLAN_GAP_ALL_OFF_BANK)],
      [uiHint(corrected), { type: "done" }],
    ]);
    const events = await drain(
      chatWithValidationLoop(
        agent,
        { ...baseReq, message: "建计划" },
        {
          maxRetries: 2,
        },
      ),
    );

    assert.equal(agent.calls.length, 2, "off-bank card must trigger one retry");
    // Feedback request carries the structured off-bank error.
    const feedback = agent.calls[1].metadata?.uiHintValidationFeedback as {
      errors?: Array<{ code: string }>;
    };
    assert.equal(feedback?.errors?.[0]?.code, SURVEY_OFF_BANK_CODE);
    // The retried (valid, converging) card reaches the consumer canonicalized.
    const cardEvents = events.filter((e) => e.type === "uiHint" && e.card);
    assert.equal(cardEvents.length, 1);
    assert.deepEqual(
      surveyData(cardEvents[0].card).questions.map((q: { id: string }) => q.id),
      ["weight_kg"],
    );
    assert.ok(events.some((e) => e.type === "done"));
  });
});
