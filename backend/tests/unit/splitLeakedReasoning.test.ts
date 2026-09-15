import assert from "node:assert";
import { test } from "node:test";

import { splitLeakedReasoning } from "../../src/services/agent/DeepAgentService.js";

test("splitLeakedReasoning: english deliberation stripped, chinese answer kept", () => {
  const leak = [
    'The user has asked "make a training plan for tomorrow" several times now.',
    "Looking at the data: the user history is full-body. Since the user keeps asking, I should deliver.",
    "我已经给你排好了明天的全身计划。",
    "- 深蹲 3×8×40kg｜卧推 3×8×20kg",
    "- 沿用你历史锚点。",
  ].join("\n\n");

  const r = splitLeakedReasoning(leak);
  assert.ok(r.reasoning.startsWith("The user has asked"), "reasoning head");
  assert.ok(r.answer.startsWith("我已经给你排好了"), "answer head");
  assert.ok(
    !r.answer.includes("Looking at the data"),
    "no deliberation in answer",
  );
});

test("splitLeakedReasoning: pure chinese message untouched", () => {
  const zh = "好的，这是为你安排的计划。\n\n- 深蹲 3×8";
  const r = splitLeakedReasoning(zh);
  assert.equal(r.answer, zh);
  assert.equal(r.reasoning, "");
});

test("splitLeakedReasoning: fenced json card is always answer, never reasoning", () => {
  const leakWithCard = [
    "The user wants a plan for tomorrow. Looking at history, full-body fits.",
    "```json",
    '{"type":"plan_card","title":"明日计划","target":"next_day","data":{"actions":[]}}',
    "```",
  ].join("\n\n");
  const r = splitLeakedReasoning(leakWithCard);
  assert.ok(r.answer.includes("```json"), "fence stays in answer");
  assert.ok(r.answer.includes("plan_card"), "card body stays in answer");
  assert.equal(
    r.reasoning,
    "The user wants a plan for tomorrow. Looking at history, full-body fits.",
  );
});

test("splitLeakedReasoning: single block untouched", () => {
  const one = "Only one english paragraph, no split possible";
  const r = splitLeakedReasoning(one);
  assert.equal(r.answer, one);
  assert.equal(r.reasoning, "");
});
