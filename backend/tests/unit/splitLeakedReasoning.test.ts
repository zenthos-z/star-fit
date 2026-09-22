import { describe, it, expect } from "@jest/globals";

import { splitLeakedReasoning } from "../../src/services/agent/splitLeakedReasoning.js";

describe("splitLeakedReasoning", () => {
  it("english deliberation stripped, chinese answer kept", () => {
    const leak = [
      'The user has asked "make a training plan for tomorrow" several times now.',
      "Looking at the data: the user history is full-body. Since the user keeps asking, I should deliver.",
      "我已经给你排好了明天的全身计划。",
      "- 深蹲 3×8×40kg｜卧推 3×8×20kg",
      "- 沿用你历史锚点。",
    ].join("\n\n");

    const r = splitLeakedReasoning(leak);
    expect(r.reasoning.startsWith("The user has asked")).toBe(true);
    expect(r.answer.startsWith("我已经给你排好了")).toBe(true);
    expect(r.answer.includes("Looking at the data")).toBe(false);
  });

  it("pure chinese message untouched", () => {
    const zh = "好的，这是为你安排的计划。\n\n- 深蹲 3×8";
    const r = splitLeakedReasoning(zh);
    expect(r.answer).toBe(zh);
    expect(r.reasoning).toBe("");
  });

  it("CHINESE deliberation stripped (2026-09-15 leak)", () => {
    const leak = [
      "用户想让我调整明天的计划。我需要先查看他的历史训练记录，看看他最近的容量和强度，然后决定是加强度还是减量。他上周刚加过重量，这次应该保持。",
      "好的，已为你调整明天的计划。",
      "- 深蹲 3×8×40kg",
    ].join("\n\n");
    const r = splitLeakedReasoning(leak);
    expect(r.reasoning.startsWith("用户想让我")).toBe(true);
    expect(r.answer.startsWith("好的，已为你")).toBe(true);
    expect(r.answer.includes("历史训练记录")).toBe(false);
  });

  it("direct advice with 我建议 is not false-positive", () => {
    const zh = "我建议你明天练推拉。\n\n- 卧推 3×8";
    const r = splitLeakedReasoning(zh);
    expect(r.reasoning).toBe("");
    expect(r.answer.startsWith("我建议你")).toBe(true);
  });

  it("fenced json card is always answer, never reasoning", () => {
    const leakWithCard = [
      "The user wants a plan for tomorrow. Looking at history, full-body fits.",
      "```json",
      '{"type":"plan_card","title":"明日计划","target":"next_day","data":{"actions":[]}}',
      "```",
    ].join("\n\n");
    const r = splitLeakedReasoning(leakWithCard);
    expect(r.answer.includes("```json")).toBe(true);
    expect(r.answer.includes("plan_card")).toBe(true);
    expect(r.reasoning).toBe(
      "The user wants a plan for tomorrow. Looking at history, full-body fits.",
    );
  });

  it("single block untouched", () => {
    const one = "Only one english paragraph, no split possible";
    const r = splitLeakedReasoning(one);
    expect(r.answer).toBe(one);
    expect(r.reasoning).toBe("");
  });
});
