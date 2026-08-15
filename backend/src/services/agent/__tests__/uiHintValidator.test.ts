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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUiHint,
  HITL_BLACKLIST_CODE,
  type StructuredError,
} from '../uiHintValidator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One minimal valid card per allowed type (AC6 schema, verbatim rules). */
const VALID_CARDS: Record<string, unknown> = {
  plan_card: {
    type: 'plan_card',
    data: [
      { exerciseId: 'sq-001', name: 'Back Squat', sets: 3, reps: 8 },
      { exerciseId: 'bp-001', name: 'Bench Press', sets: 4, reps: 6, weight: 60 },
    ],
  },
  summary_card: {
    type: 'summary_card',
    data: { summary: 'Solid session', highlights: ['PR on squat'], metrics: { rpe: 8 } },
  },
  deviation_card: {
    type: 'deviation_card',
    data: { reason: 'Knee discomfort detected', suggestion: 'Swap to box squat' },
  },
  audit_complete: {
    type: 'audit_complete',
    data: {
      message: 'Profile audit finished',
      updates: [{ field: 'loadAnchors', label: 'Squat', count: 1 }],
    },
  },
  strategy_confirm: {
    type: 'strategy_confirm',
    data: {
      preview: 'New mesocycle emphasising posterior chain.',
      fullContent: '# Mesocycle 3\nFocus: posterior chain progression.',
    },
  },
};

// ---------------------------------------------------------------------------
// B1 / AC1 — valid cards pass
// ---------------------------------------------------------------------------

describe('validateUiHint — B1 valid cards pass', () => {
  for (const [typeName, card] of Object.entries(VALID_CARDS)) {
    it(`accepts a valid ${typeName}`, () => {
      const result = validateUiHint(card);
      assert.equal(result.ok, true, `${typeName} should be valid`);
      if (result.ok) {
        assert.equal(result.card.type, typeName);
      }
    });
  }

  it('preserves ExercisePlan business rules (sets/reps positive int) on valid input', () => {
    // AC6: the migrated ExercisePlanSchema business rules are exercised, not stripped.
    const result = validateUiHint(VALID_CARDS.plan_card);
    assert.equal(result.ok, true);
    if (result.ok) {
      const plan = result.card as { type: string; data: Array<{ sets: number; reps: number }> };
      assert.equal(plan.data[0].sets, 3);
      assert.equal(plan.data[0].reps, 8);
    }
  });
});

// ---------------------------------------------------------------------------
// B2 / AC2 + B5 / AC5 (P012 vacuity probe) — invalid cards rejected
// ---------------------------------------------------------------------------

describe('validateUiHint — B2 invalid cards rejected (P012 vacuity probe)', () => {
  // Each entry is a distinct violation class; asserting every one fails is the
  // P012 vacuity probe (the gate cannot silently let scope through).
  const violations: Array<{ name: string; card: unknown }> = [
    {
      name: 'plan_card missing required sets/reps',
      card: { type: 'plan_card', data: [{ exerciseId: 'sq', name: 'Squat' }] },
    },
    {
      name: 'plan_card data wrong shape (object, not array)',
      card: { type: 'plan_card', data: { '0': { exerciseId: 'sq', name: 'Squat', sets: 3, reps: 5 } } },
    },
    {
      name: 'plan_card empty data array',
      card: { type: 'plan_card', data: [] },
    },
    {
      name: 'plan_card sets/reps non-positive',
      card: { type: 'plan_card', data: [{ exerciseId: 'sq', name: 'Squat', sets: 0, reps: 5 }] },
    },
    {
      name: 'summary_card missing required summary',
      card: { type: 'summary_card', data: { highlights: ['x'] } },
    },
    {
      name: 'deviation_card missing required reason',
      card: { type: 'deviation_card', data: { suggestion: 'x' } },
    },
    {
      name: 'audit_complete missing required message',
      card: { type: 'audit_complete', data: { title: 't' } },
    },
    {
      name: 'strategy_confirm missing required preview',
      card: { type: 'strategy_confirm', data: { fullContent: 'f' } },
    },
    {
      name: 'strategy_confirm missing required fullContent',
      card: { type: 'strategy_confirm', data: { preview: 'p' } },
    },
    {
      name: 'unknown type',
      card: { type: 'mystery_card', data: {} },
    },
    {
      name: 'missing type entirely',
      card: { data: { summary: 'x' } },
    },
    {
      name: 'not an object',
      card: 'plan_card',
    },
    {
      name: 'null',
      card: null,
    },
  ];

  for (const { name, card } of violations) {
    it(`rejects: ${name}`, () => {
      const result = validateUiHint(card);
      assert.equal(result.ok, false, `${name} must be rejected`);
      if (!result.ok) {
        assert.ok(result.errors.length > 0, `${name} must surface at least one error`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// B3 / AC3 — HC-4 HITL blacklist
// ---------------------------------------------------------------------------

describe('validateUiHint — B3 HC-4 HITL blacklist', () => {
  it('rejects survey_card even though it is schema-valid', () => {
    // survey_card IS a valid member of UIHintSchema; HC-4 must refuse it anyway.
    const surveyCard = {
      type: 'survey_card',
      data: {
        title: 'Feedback',
        questions: [{ id: 'q1', question: 'How was it?', required: false }],
      },
    };
    const result = validateUiHint(surveyCard);
    assert.equal(result.ok, false, 'survey_card must be blacklisted (HC-4)');
    if (!result.ok) {
      const hitl = result.errors.find((e: StructuredError) => e.code === HITL_BLACKLIST_CODE);
      assert.ok(hitl, 'must surface a hitl_blacklist error');
      assert.deepEqual(hitl.path, ['type']);
    }
  });

  it('rejects hitl_confirm', () => {
    const result = validateUiHint({ type: 'hitl_confirm', data: {} });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const hitl = result.errors.find((e: StructuredError) => e.code === HITL_BLACKLIST_CODE);
      assert.ok(hitl, 'must surface a hitl_blacklist error for hitl_confirm');
    }
  });

  it('blacklist fires before schema parsing (precise code, not generic enum error)', () => {
    const result = validateUiHint({ type: 'survey_card', data: { questions: [] } });
    assert.equal(result.ok, false);
    if (!result.ok) {
      // HC-4 rejection, not a generic invalid_union/enum issue.
      assert.equal(result.errors[0].code, HITL_BLACKLIST_CODE);
    }
  });
});
