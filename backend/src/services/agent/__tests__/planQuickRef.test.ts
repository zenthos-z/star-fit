/**
 * plan 场景速查表预注入单测（2026-09-23 建立；2026-09-28 随 42a 规则收敛重写）。
 *
 * 验证 buildSystemPrompt：
 * - scenario="plan" 时 systemPrompt 含收敛后的速查表（幻影工具禁令 / 自检清单 /
 *   校验重试语义）+ 指向 plan-generation 技能单一真源的指针；
 * - 周/日粒度规则、新手起步重量、name_zh 等重复规则全文已从 BASE/QUICKREF
 *   删除（单一真源 = plan-generation/SKILL.md 判定表 + knowledge.md §3.2.0
 *   + list_exercises 工具描述），plan prompt 不再复述；
 * - 其他场景（workout_complete / update_profile / default / undefined）不注入
 *   速查表（防泄漏）；
 * - 总长约束：速查表段 ≤ 70 行。
 *
 * Runner: node:test via tsx。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt } from "../DeepAgentService.js";

/** 收敛后速查表仍保留的标记（QUICKREF 独有 reminder，未收敛走技能文件）。 */
const QUICKREF_MARKERS: Array<[string, RegExp]> = [
  ["明日请求 target 标记（uiHintFormat 承载）", /next_day/],
  ["每轮必出卡（禁散文交付）", /never prose-only|failed delivery/i],
  ["禁幻影工具", /submit_plan/],
  ["动作 id 禁编造", /list_exercises/],
  ["出卡自检清单", /SELF-CHECK/i],
  ["格式打回重试语义", /re-emit the whole card|feedback retries/i],
];

/** 已收敛到技能单一真源的规则全文标记——plan prompt 不得再复述。 */
const CONVERGED_AWAY_MARKERS: Array<[string, RegExp]> = [
  ["速查表五要素复述", /FIVE PREREQUISITES/],
  ["速查表新手起步复述", /BEGINNER STARTER LOADS/],
  ["BASE 新手空杆复述", /empty bar \(20kg\)|empty bar 20kg|空杆 20kg/],
  ["最小配重数字复述", /2\.5-5kg/],
  ["「第一次找感觉」复述", /第一次找感觉/],
  ["五规则编号全文", /NO plan this week|AMBIGUOUS adjust requests/],
  ["split 枚举复述（QUICKREF 旧文）", /apply\.split legal values ONLY/],
  ["PREREQ TEST 旧标题", /PREREQ TEST/],
  ["BEGINNER branch 旧分支全文", /BEGINNER branch/],
  ["BASE uiHint 格式节（已删，uiHintFormat 承载）", /uiHint output format/],
  [
    "BASE target marker 节（已删，uiHintFormat 承载）",
    /plan_card target marker/,
  ],
  [
    "BASE tomorrow-plan 节（已删，delivery rule 合并承载）",
    /Tomorrow-plan requests MUST produce a card/,
  ],
  ["BASE name_zh 规则复述", /NEVER translate exercise names/],
];

describe("buildSystemPrompt — plan scenario quickref (42a 收敛后)", () => {
  const planPrompt = buildSystemPrompt("plan");

  it("injects the condensed quickref into the plan-scenario systemPrompt", () => {
    assert.match(planPrompt, /Plan scenario quick reference/i);
  });

  for (const [name, marker] of QUICKREF_MARKERS) {
    it(`plan prompt carries: ${name}`, () => {
      assert.match(planPrompt, marker);
    });
  }

  it("points to the plan-generation skill as the single rule source", () => {
    assert.match(planPrompt, /plan-generation skill/);
    assert.match(planPrompt, /single source/i);
  });

  it("no longer restates rules converged into the skill (42a dedup)", () => {
    for (const [name, marker] of CONVERGED_AWAY_MARKERS) {
      assert.doesNotMatch(
        planPrompt,
        marker,
        `converged rule text must NOT reappear in the plan prompt: ${name}`,
      );
    }
  });

  it("keeps the base prompt + uiHint card-format skill alongside the quickref", () => {
    // base 与 uiHint 技能段不被速查表挤掉。
    assert.match(planPrompt, /Starfit training agent/);
    assert.match(planPrompt, /uiHint Card Format/);
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
