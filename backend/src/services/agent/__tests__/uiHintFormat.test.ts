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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadUiHintFormatSkill,
  ALLOWED_UIHINT_TYPES,
  BLACKLISTED_UIHINT_TYPES,
} from '../uiHintFormat.js';

describe('loadUiHintFormatSkill — M5a skill text', () => {
  const skill = loadUiHintFormatSkill();

  it('is a non-empty string (injectable into systemPrompt)', () => {
    assert.equal(typeof skill, 'string');
    assert.ok(skill.length > 0);
  });

  it('is deterministic (pure producer)', () => {
    assert.equal(loadUiHintFormatSkill(), skill);
  });

  describe('mentions all five allowed card types', () => {
    for (const t of ALLOWED_UIHINT_TYPES) {
      it(`includes ${t}`, () => {
        assert.ok(
          skill.includes(`\`${t}\``) || skill.includes(t),
          `skill text must mention the allowed type ${t}`,
        );
      });
    }
  });

  it('does NOT advertise the blacklisted survey_card as an allowed type', () => {
    // survey_card appears only in the HC-4 blacklist warning, never as allowed.
    for (const t of BLACKLISTED_UIHINT_TYPES) {
      const allowedLine = skill
        .split('\n')
        .filter((l) => l.includes(t) && !/blacklist|NEVER|HC-4/i.test(l));
      assert.equal(
        allowedLine.length,
        0,
        `${t} must only appear in the HC-4 blacklist warning, not as an allowed type`,
      );
    }
  });

  it('documents the HC-4 HITL blacklist', () => {
    assert.match(skill, /HC-4/);
    assert.match(skill, /NEVER/i);
    for (const t of BLACKLISTED_UIHINT_TYPES) {
      assert.ok(skill.includes(t), `blacklist text must name ${t}`);
    }
  });

  it('documents key per-type schema rules', () => {
    // plan_card data-is-array rule (a classic LLM failure mode).
    assert.match(skill, /array/i);
    // strategy_confirm required fields.
    assert.match(skill, /preview/i);
    assert.match(skill, /fullContent/i);
    // summary_card required field.
    assert.match(skill, /summary/i);
  });
});
