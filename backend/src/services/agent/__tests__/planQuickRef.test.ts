/**
 * plan 场景速查表预注入单测（2026-09-23）。
 *
 * 验证 buildSystemPrompt：
 * - scenario="plan" 时 systemPrompt 含 PLAN_SCENARIO_QUICKREF 的关键标记
 *   （五要素 / 新手空杆 20kg / target:next_day / 自检清单）——Agent 无需
 *   read_file plan-generation 技能即可走完主流路径；
 * - 其他场景（workout_complete / update_profile / default / undefined）不注入
 *   速查表（防泄漏）；
 * - 总长约束：注入后相对现状（base + 场景 guide + uiHint skill）增量 ≤ 70 行。
 *
 * Runner: node:test via tsx。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt } from "../DeepAgentService.js";

/** 速查表关键标记（逐条溯源 plan-generation/knowledge.md v3.1.0）。 */
const QUICKREF_MARKERS: Array<[string, RegExp]> = [
  [
    "五要素检查清单",
    /FIVE PREREQUISITES.*goal.*experience.*equipment.*frequency/i,
  ],
  ["缺任一→survey 卡", /survey_card/i],
  ["新手空杆起步", /empty bar 20kg|空杆 20kg|empty-bar/i],
  ["最小配重起步", /2\.5-5kg/],
  ["「第一次找感觉」备注", /第一次找感觉/],
  ["明日请求 target 标记", /next_day/],
  ["每轮必出卡（禁散文交付）", /never prose-only/i],
  ["禁幻影工具", /submit_plan/],
  ["动作 id 禁编造", /list_exercises/],
  ["出卡自检清单", /SELF-CHECK/i],
  ["格式打回重试语义", /re-emit the whole card|feedback retries/i],
];

describe("buildSystemPrompt — plan scenario quickref pre-injection", () => {
  const planPrompt = buildSystemPrompt("plan");

  it("injects the quickref into the plan-scenario systemPrompt", () => {
    assert.match(planPrompt, /Plan scenario quick reference/i);
  });

  for (const [name, marker] of QUICKREF_MARKERS) {
    it(`plan prompt carries: ${name}`, () => {
      assert.match(planPrompt, marker);
    });
  }

  it("keeps the base prompt + uiHint skill alongside the quickref", () => {
    // base 与 uiHint 技能段不被速查表挤掉。
    assert.match(planPrompt, /Starfit training agent/);
    assert.match(planPrompt, /uiHint output format/);
  });

  it("does NOT leak the quickref into other scenarios", () => {
    for (const scenario of [
      "workout_complete",
      "update_profile",
      "chat",
      "tutorial",
    ]) {
      const prompt = buildSystemPrompt(scenario);
      assert.doesNotMatch(
        prompt,
        /Plan scenario quick reference/i,
        `quickref must not leak into scenario=${scenario}`,
      );
    }
    // 无场景（undefined）也不注入。
    assert.doesNotMatch(buildSystemPrompt(), /Plan scenario quick reference/i);
    // 速查表独有标记（BASE_SYSTEM_PROMPT 中不存在）同样不泄漏。
    const workout = buildSystemPrompt("workout_complete");
    assert.doesNotMatch(workout, /SELF-CHECK/i);
    assert.doesNotMatch(workout, /30-90s retry/);
  });

  it("quickref adds at most 70 lines over the non-quickref prompt", () => {
    // 现状基线：同 scenario 的非速查 prompt 长度用 workout_complete 近似不严谨，
    // 这里直接对比：plan prompt 行数 - (去掉速查表段后的行数) ≤ 70。
    // 更直接：速查表段本身（从标题到 uiHint 段之前）行数 ≤ 70。
    const idx = planPrompt.indexOf("## Plan scenario quick reference");
    assert.ok(idx >= 0, "quickref section must exist in plan prompt");
    const rest = planPrompt.slice(idx);
    // 速查表段 = 标题行起，到下一个 "\n\n##"（uiHint 段）之前。
    const nextSection = rest.slice(1).indexOf("\n\n##");
    const section = nextSection === -1 ? rest : rest.slice(0, nextSection + 1);
    const lineCount = section.split("\n").length;
    assert.ok(
      lineCount <= 70,
      `quickref section is ${lineCount} lines, must be <= 70`,
    );
  });
});
