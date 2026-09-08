/**
 * Unit tests for suggestion pure functions (shared/contracts/suggestions.ts).
 *
 * 表值钉死 + 钳制边界 + derive 单调性 —— 「Service 算术」红线的回归防线：
 * 任何公式改动都应先改这里的期望值（并 bump SUGGESTION_FORMULA_VERSION）。
 */

import { describe, it, expect } from '@jest/globals';

import {
  SUGGESTION_FORMULA_VERSION,
  applyAdjustment,
  computeBaseline,
  computeContextFingerprint,
  deriveSuggestion,
  estimate1RM,
  finalizeValues,
  normalizeSuggestionExerciseType,
  repsForRpe,
  rpeToPercent1RM,
  type AdjustmentIntent,
  type CapabilityProfile,
} from 'shared/contracts';

const NEUTRAL_MODS = { injury_scale: 1, novice_cap: 1, recovery_scale: 1 };

function profile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    exercise_name: '杠铃卧推',
    exercise_type: 'resistance',
    data_basis: 'anchor',
    est_1rm: 100,
    modifiers: NEUTRAL_MODS,
    ...overrides,
  };
}

describe('normalizeSuggestionExerciseType', () => {
  it('canonical types pass through', () => {
    expect(normalizeSuggestionExerciseType('resistance')).toBe('resistance');
    expect(normalizeSuggestionExerciseType('Cardio')).toBe('cardio');
  });

  it('maps drifted vocabularies', () => {
    expect(normalizeSuggestionExerciseType('weight_only')).toBe('heavy_weight');
    expect(normalizeSuggestionExerciseType('reps_only')).toBe('rep_training');
    expect(normalizeSuggestionExerciseType('strength')).toBe('resistance');
    expect(normalizeSuggestionExerciseType('hiit')).toBe('cardio');
  });

  it('falls back to unknown', () => {
    expect(normalizeSuggestionExerciseType('')).toBe('unknown');
    expect(normalizeSuggestionExerciseType('yolo')).toBe('unknown');
  });
});

describe('rpeToPercent1RM (RTS 表值钉死)', () => {
  it('table anchors', () => {
    expect(rpeToPercent1RM(1, 10)).toBe(100);
    expect(rpeToPercent1RM(5, 8)).toBeCloseTo(84.5, 5);
    expect(rpeToPercent1RM(8, 8)).toBeCloseTo(80, 5);
    expect(rpeToPercent1RM(12, 7)).toBeCloseTo(71, 5);
    expect(rpeToPercent1RM(8, 7)).toBeCloseTo(77.5, 5);
  });

  it('half-step RPE interpolates linearly', () => {
    // (8 @ 7.5) = (77.5 + 80) / 2
    expect(rpeToPercent1RM(8, 7.5)).toBeCloseTo(78.75, 5);
  });

  it('extrapolates beyond 12 reps at -2%/rep with 40% floor', () => {
    expect(rpeToPercent1RM(15, 8)).toBeCloseTo(68, 5);
    expect(rpeToPercent1RM(30, 8)).toBe(40);
  });

  it('clamps RPE into [6,10]', () => {
    expect(rpeToPercent1RM(1, 11)).toBe(100);
    expect(rpeToPercent1RM(1, 5)).toBeCloseTo(86, 5);
  });

  it('cross-checks with project knowledge zones', () => {
    // 增肌 8-12 次 RPE 7-8 → 71-80%（knowledge 表 65-80%）
    for (let reps = 8; reps <= 12; reps++) {
      for (const rpe of [7, 7.5, 8]) {
        const pct = rpeToPercent1RM(reps, rpe);
        expect(pct).toBeGreaterThanOrEqual(71);
        expect(pct).toBeLessThanOrEqual(80.5);
      }
    }
    // 力量 3-6 次 RPE 8-9 → 83.5-90.5%（知识表 85-95%，宁轻勿重取下沿）
    for (let reps = 3; reps <= 6; reps++) {
      expect(rpeToPercent1RM(reps, 9)).toBeGreaterThanOrEqual(84);
    }
  });
});

describe('repsForRpe', () => {
  it('maps RPE within goal range (low RPE → high-rep end)', () => {
    expect(repsForRpe(7, 'muscle_gain')).toBe(11);
    expect(repsForRpe(8, 'muscle_gain')).toBe(10);
    expect(repsForRpe(9, 'muscle_gain')).toBe(9);
    expect(repsForRpe(8, 'strength')).toBe(4);
    expect(repsForRpe(6, 'strength')).toBe(6);
    expect(repsForRpe(8, 'fat_loss')).toBe(16);
  });

  it('defaults to muscle_gain for unknown goal', () => {
    expect(repsForRpe(8)).toBe(10);
    expect(repsForRpe(8, 'nonsense')).toBe(10);
  });
});

describe('estimate1RM', () => {
  it('Brzycki for reps <= 12', () => {
    // 100kg × 36 / (37-8) = 124.14
    expect(estimate1RM(100, 8)).toBeCloseTo(124.14, 1);
    expect(estimate1RM(100, 1)).toBe(100);
  });

  it('Epley for reps > 12', () => {
    expect(estimate1RM(60, 15)).toBeCloseTo(90, 5);
  });

  it('zero weight or reps → 0', () => {
    expect(estimate1RM(0, 8)).toBe(0);
    expect(estimate1RM(100, 0)).toBe(0);
  });
});

describe('computeBaseline', () => {
  it('resistance: weight = est_1rm × pct, reps from goal zone', () => {
    const values = computeBaseline(profile(), 'resistance', 8, 'muscle_gain');
    expect(values.reps).toBe(10);
    expect(values.weight).toBeCloseTo(100 * 0.77, 5);
    expect(values.set_count).toBe(4);
  });

  it('safety modifiers compound (injury × novice)', () => {
    const values = computeBaseline(
      profile({ modifiers: { injury_scale: 0.6, novice_cap: 0.7, recovery_scale: 1 } }),
      'resistance',
      8,
      'muscle_gain'
    );
    expect(values.weight).toBeCloseTo(100 * 0.77 * 0.42, 5);
  });

  it('falls back to best_set × 85-95% when no est_1rm', () => {
    const values = computeBaseline(
      profile({ est_1rm: undefined, best_set: { weight: 80, reps: 8 } }),
      'resistance',
      8,
      'muscle_gain'
    );
    expect(values.weight).toBeCloseTo(80 * 0.9, 5);
  });

  it('cardio zones duration/distance', () => {
    const base = computeBaseline(profile({ exercise_type: 'cardio' }), 'cardio', 8);
    expect(base.duration_sec).toBe(1800);
    expect(base.distance_m).toBe(5000);

    const easy = computeBaseline(profile({ exercise_type: 'cardio' }), 'cardio', 5.5);
    expect(easy.duration_sec).toBe(1200);

    const paced = computeBaseline(
      profile({ exercise_type: 'cardio', best_pace_sec_per_km: 300 }),
      'cardio',
      8
    );
    expect(paced.distance_m).toBeCloseTo(6000, 0);
  });

  it('isometric duration by RPE band', () => {
    expect(computeBaseline(profile({ exercise_type: 'isometric' }), 'isometric', 7).duration_sec).toBe(30);
    expect(computeBaseline(profile({ exercise_type: 'isometric' }), 'isometric', 8).duration_sec).toBe(45);
    expect(computeBaseline(profile({ exercise_type: 'isometric' }), 'isometric', 9).duration_sec).toBe(60);
  });

  it('bodyweight reps by RPE with progression bonus', () => {
    expect(computeBaseline(profile({ exercise_type: 'bodyweight' }), 'bodyweight', 8).reps).toBe(10);
    expect(
      computeBaseline(
        profile({ exercise_type: 'bodyweight', progression_level: 6 }),
        'bodyweight',
        8
      ).reps
    ).toBe(15);
  });
});

describe('applyAdjustment (Agent 意图钳制)', () => {
  const base = { weight: 80, reps: 10, set_count: 4, target_rpe: 8 };

  it('clamps out-of-bounds multiply to [0.7, 1.15]', () => {
    const up = applyAdjustment(base, intent([{ field: 'weight', mode: 'multiply', value: 1.5 }]));
    expect(up.weight).toBeCloseTo(80 * 1.15, 5);
    const down = applyAdjustment(base, intent([{ field: 'weight', mode: 'multiply', value: 0.5 }]));
    expect(down.weight).toBeCloseTo(80 * 0.7, 5);
  });

  it('clamps reps delta to [-3, 3] and set_count delta to [-2, 1]', () => {
    const out = applyAdjustment(base, intent([
      { field: 'reps', mode: 'delta', value: 5 },
      { field: 'set_count', mode: 'delta', value: 2 },
    ]));
    expect(out.reps).toBe(13);
    expect(out.set_count).toBe(5);
  });

  it('ignores multiply on set_count / delta on target_rpe only applies', () => {
    const out = applyAdjustment(base, intent([
      { field: 'set_count', mode: 'multiply', value: 1.1 },
      { field: 'target_rpe', mode: 'delta', value: -2 },
    ]));
    expect(out.set_count).toBe(4);
    expect(out.target_rpe).toBe(7);
  });

  it('injury-limited exercises only allow reductions', () => {
    const out = applyAdjustment(
      base,
      intent([{ field: 'weight', mode: 'multiply', value: 1.1 }]),
      { injuryLimited: true }
    );
    expect(out.weight).toBe(80);
    const cut = applyAdjustment(
      base,
      intent([{ field: 'weight', mode: 'delta', value: 2 }]),
      { injuryLimited: true }
    );
    expect(cut.weight).toBe(80);
  });

  it('no intent → unchanged', () => {
    expect(applyAdjustment(base, undefined)).toEqual(base);
  });

  function intent(actions: Array<{ field: string; mode: string; value: number }>): AdjustmentIntent {
    return {
      exercise_name: '杠铃卧推',
      actions: actions.map((a) => ({
        field: a.field as AdjustmentIntent['actions'][number]['field'],
        mode: a.mode as 'multiply' | 'delta',
        value: a.value,
      })),
      reason: '测试',
    };
  }
});

describe('finalizeValues', () => {
  it('rounds weight to 2.5kg (min 2.5 when > 0), duration to 30s, distance to 100m', () => {
    const out = finalizeValues(
      { weight: 76.9, duration_sec: 1843, distance_m: 4959, reps: 9.6, set_count: 3.4 },
      'cardio'
    );
    // cardio strips weight/reps；1843 → 15s 网格 1845
    expect(out).toEqual({ duration_sec: 1845, distance_m: 5000, set_count: 3 });
    const strength = finalizeValues({ weight: 76.9, reps: 9.6 }, 'resistance');
    expect(strength.weight).toBe(77.5);
    expect(strength.reps).toBe(10);
    expect(finalizeValues({ weight: 3 }, 'resistance').weight).toBe(2.5);
    expect(finalizeValues({ weight: 0 }, 'resistance').weight).toBe(0);
  });

  it('strips fields not allowed per type', () => {
    expect(finalizeValues({ weight: 50, reps: 10 }, 'bodyweight')).toEqual({ reps: 10 });
    expect(finalizeValues({ weight: 50, duration_sec: 45 }, 'isometric')).toEqual({ duration_sec: 45 });
  });

  it('clamps set_count to [1,10]', () => {
    expect(finalizeValues({ set_count: 12 }, 'resistance').set_count).toBe(10);
    expect(finalizeValues({ set_count: 0 }, 'resistance').set_count).toBe(1);
  });
});

describe('deriveSuggestion (离线导出)', () => {
  const entry = {
    exercise_type: 'resistance',
    profile: profile(),
    adjustment: {
      exercise_name: '杠铃卧推',
      actions: [{ field: 'weight', mode: 'multiply', value: 0.9 }],
      reason: '肩伤恢复中',
    } satisfies AdjustmentIntent,
  };

  it('replays proportional adjustment on a fresh RPE baseline (after finalize rounding)', () => {
    const v8 = deriveSuggestion(entry, 8, 'muscle_gain');
    const v9 = deriveSuggestion(entry, 9, 'muscle_gain');
    // rpe8: est_1rm 100 × 77% × 0.9 = 69.3 → 2.5kg 网格 70；rpe9: 81.5% × 0.9 = 73.35 → 72.5
    expect(v8.weight).toBe(70);
    expect(v9.weight).toBe(72.5);
  });

  it('weight is monotonic non-decreasing in RPE', () => {
    let prev = 0;
    for (let rpe = 6; rpe <= 10; rpe += 0.5) {
      const w = deriveSuggestion(entry, rpe, 'muscle_gain').weight ?? 0;
      expect(w).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = w;
    }
  });
});

describe('computeContextFingerprint', () => {
  it('stable for identical input, sensitive to goal/limitations/anchors', () => {
    const base = {
      goal: 'muscle_gain',
      fitness_level: 'intermediate',
      bodyweight_kg: 75,
      limitations: ['knee:5'],
      anchorUpdates: { '杠铃卧推': 1737000000000 },
      exercises: ['杠铃卧推:resistance', '深蹲:resistance'],
      agent_mode: 'hybrid' as const,
    };
    const a = computeContextFingerprint(base);
    const b = computeContextFingerprint({ ...base, exercises: [...base.exercises].reverse() });
    expect(a).toBe(b); // exercises 排序后参与
    expect(computeContextFingerprint({ ...base, goal: 'strength' })).not.toBe(a);
    expect(computeContextFingerprint({ ...base, limitations: [] })).not.toBe(a);
    expect(
      computeContextFingerprint({ ...base, anchorUpdates: { '杠铃卧推': 1737000005000 } })
    ).not.toBe(a);
  });

  it('formula version participates', () => {
    expect(SUGGESTION_FORMULA_VERSION).toBeGreaterThanOrEqual(1);
  });
});
