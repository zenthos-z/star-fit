/**
 * uiHintFormat unit tests (M5a).
 *
 * Covers the `loadUiHintFormatSkill()` systemPrompt block: it must mention
 * all five allowed card types, their key schema rules, and the HC-4 HITL
 * blacklist. The validator + loop tests exercise the runtime contract; this
 * test pins the skill TEXT that teaches the agent to produce conforming cards.
 *
 * Runner: node:test via tsx.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadUiHintFormatSkill,
  ALLOWED_UIHINT_TYPES,
  BLACKLISTED_UIHINT_TYPES,
} from "../uiHintFormat.js";

describe("loadUiHintFormatSkill — M5a skill text", () => {
  const skill = loadUiHintFormatSkill();

  it("is a non-empty string (injectable into systemPrompt)", () => {
    assert.equal(typeof skill, "string");
    assert.ok(skill.length > 0);
  });

  it("is deterministic (pure producer)", () => {
    assert.equal(loadUiHintFormatSkill(), skill);
  });

  describe("mentions all five allowed card types", () => {
    for (const t of ALLOWED_UIHINT_TYPES) {
      it(`includes ${t}`, () => {
        assert.ok(
          skill.includes(`\`${t}\``) || skill.includes(t),
          `skill text must mention the allowed type ${t}`,
        );
      });
    }
  });

  it("does NOT advertise the blacklisted survey_card as an allowed type", () => {
    // survey_card appears only in the HC-4 blacklist warning, never as allowed.
    for (const t of BLACKLISTED_UIHINT_TYPES) {
      const allowedLine = skill
        .split("\n")
        .filter((l) => l.includes(t) && !/blacklist|NEVER|HC-4/i.test(l));
      assert.equal(
        allowedLine.length,
        0,
        `${t} must only appear in the HC-4 blacklist warning, not as an allowed type`,
      );
    }
  });

  it("documents the HC-4 HITL blacklist", () => {
    assert.match(skill, /HC-4/);
    assert.match(skill, /NEVER/i);
    for (const t of BLACKLISTED_UIHINT_TYPES) {
      assert.ok(skill.includes(t), `blacklist text must name ${t}`);
    }
  });

  it("documents key per-type schema rules", () => {
    // plan_card data-is-array rule (a classic LLM failure mode).
    assert.match(skill, /array/i);
    // summary_card required field.
    assert.match(skill, /summary/i);
  });

  it("documents profile_update_confirm consent-gate rules", () => {
    // proposals array + trigger enum + the never-write-in-the-same-turn rule.
    assert.match(skill, /proposals/i);
    assert.match(skill, /day_end/);
    assert.match(skill, /injury_report/);
    assert.match(skill, /NEVER call[\s\S]*?update_profile/i);
  });
});

describe("#151 S4 通道锁：survey/weekly_plan 恒 tool，双轨开关仅剩 plan_card", () => {
  const S4_DEFAULTS = {
    survey_card: "tool",
    weekly_plan: "tool",
    plan_card: "fence",
  } as const;
  const dual = loadUiHintFormatSkill(S4_DEFAULTS);

  it("缺省（无参 / 空 channels）= S4 默认通道输出（survey/weekly 工具文案，plan_card 围栏）", () => {
    const bare = loadUiHintFormatSkill();
    const empty = loadUiHintFormatSkill({});
    assert.equal(bare, empty, "无参与空对象输出一致");
    assert.equal(bare, dual, "无参与显式默认通道输出一致");
    assert.match(bare, /submit_survey/);
    assert.match(bare, /submit_weekly_plan/);
    assert.ok(!bare.includes("submit_plan_card"), "plan_card=fence 不点名工具");
    // fence 分流的通用规则行仍然在场（fenceTypes 非空时保留围栏主指令）。
    assert.match(bare, /```json fenced block/);
    assert.match(bare, /plan_card, summary_card/);
  });

  it("通道锁：channels 传 fence 也不回退围栏文案（S4 围栏退役红线）", () => {
    const flipped = loadUiHintFormatSkill({
      survey_card: "fence",
      weekly_plan: "fence",
      plan_card: "fence",
    });
    assert.match(flipped, /submit_weekly_plan[\s\S]*?ONLY delivery channel/);
    assert.match(flipped, /NEVER write survey JSON/);
    // 已退役的围栏时代文案在任何通道组合下都不得再现。
    assert.ok(!flipped.includes("there is NO save tool"));
    assert.ok(
      !/emit it\s*\n?\s*DIRECTLY in the reply/.test(flipped),
      "weekly_plan「围栏直出」文案已随 S4 退役",
    );
  });

  it("weekly_plan=tool → 「NO save tool」围栏文案被替换为工具提交指令", () => {
    assert.ok(
      !dual.includes("there is NO save tool"),
      "tool 通道下不得再教「没有保存工具所以围栏直出」",
    );
    assert.match(dual, /submit_weekly_plan[\s\S]*?ONLY delivery channel/);
    // data.apply 载荷契约（apply 落库语义）两通道共用，不得丢。
    assert.match(dual, /data\.apply/);
  });

  it("survey_card=tool → 意图参数指令（purpose + 题库 id，不写卡 JSON）", () => {
    assert.match(dual, /submit_survey[\s\S]*?intent-only params/);
    assert.match(dual, /NEVER write survey JSON/);
  });

  it("plan_card=tool（S4 预演形态）→ {data:[...]} 包装指令出现", () => {
    const allTool = loadUiHintFormatSkill({
      survey_card: "tool",
      weekly_plan: "tool",
      plan_card: "tool",
    });
    assert.match(allTool, /`submit_plan_card` with `\{ data: \[\.\.\.\] \}`/);
  });

  it("工具卡写在正文里 = 失败交付（双轨互斥红线）在通用规则中声明", () => {
    assert.match(
      dual,
      /a tool-channel card written as prose is a FAILED delivery/,
    );
  });
});
