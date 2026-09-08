/**
 * Unit tests for buildCapabilityProfile (suggestionProfiles.ts).
 *
 * 四级锚点降级（anchor > history > bodyweight_estimate > type_default）
 * 与画像调制因子（伤病/新手/恢复）的行为钉死。
 */

import { describe, it, expect } from '@jest/globals';

import {
  buildCapabilityProfile,
  collectFingerprintInput,
  computeModifiers,
  deriveHistoryBest,
  recencyConfidence,
  type SuggestionUserContext,
} from '../../../../src/services/suggestions/suggestionProfiles.js';
import type { ProfileDynamic, ProfileStatic } from 'shared/contracts';

const NOW = new Date('2026-08-19T00:00:00Z').getTime();

function ctx(overrides: {
  static?: Partial<ProfileStatic>;
  dynamic?: Record<string, unknown>;
  history?: Record<string, unknown>;
}): SuggestionUserContext {
  return {
    profileStatic: (overrides.static ?? {}) as ProfileStatic,
    profileDynamic: (overrides.dynamic ?? {}) as ProfileDynamic,
    history: overrides.history ?? null,
  };
}

describe('deriveHistoryBest', () => {
  const sessions = [
    {
      date: '2026-08-01T00:00:00Z',
      exercises: [{ name: '杠铃卧推', sets: 4, reps: 8, weight: 70 }],
    },
    {
      date: '2026-08-10T00:00:00Z',
      exercises: [
        { name: '杠铃卧推', sets: 4, reps: 5, weight: 85 },
        { name: '深蹲', sets: 4, reps: 8, weight: 100 },
      ],
    },
  ];

  it('picks the record with the highest e1RM', () => {
    const best = deriveHistoryBest(sessions, '杠铃卧推');
    // 70×8 → e1RM 86.9 vs 85×5 → 97.1
    expect(best).not.toBeNull();
    expect(best!.bestWeight).toBe(85);
    expect(best!.bestReps).toBe(5);
    expect(best!.lastDate).toBe('2026-08-10T00:00:00Z');
  });

  it('matches names case/space-insensitively', () => {
    const mixed = [{ date: '2026-08-10', exercises: [{ name: 'Bench  Press', reps: 8, weight: 60 }] }];
    expect(deriveHistoryBest(mixed, 'bench press')).not.toBeNull();
  });

  it('returns null when no loaded record exists', () => {
    expect(deriveHistoryBest(sessions, '不存在的动作')).toBeNull();
  });
});

describe('recencyConfidence', () => {
  it('decays with age', () => {
    expect(recencyConfidence(undefined, NOW)).toBe(0.4);
    expect(recencyConfidence(new Date(NOW - 5 * 86400000).toISOString(), NOW)).toBe(1);
    expect(recencyConfidence(new Date(NOW - 20 * 86400000).toISOString(), NOW)).toBe(0.8);
    expect(recencyConfidence(new Date(NOW - 60 * 86400000).toISOString(), NOW)).toBe(0.6);
    expect(recencyConfidence(new Date(NOW - 200 * 86400000).toISOString(), NOW)).toBe(0.4);
  });
});

describe('computeModifiers', () => {
  it('injury scale from unexpired limitations; expired ignored', () => {
    const dynamic = {
      active_limitations: [
        { part: 'knee', severity: 5, expire_at: new Date(NOW + 86400000).toISOString() },
        { part: 'elbow', severity: 2, expire_at: new Date(NOW - 86400000).toISOString() },
      ],
    };
    const mods = computeModifiers(null, dynamic as unknown as ProfileDynamic, true, NOW);
    expect(mods.injury_scale).toBe(0.6);
    const healed = computeModifiers(
      null,
      { active_limitations: [dynamic.active_limitations[1]] } as unknown as ProfileDynamic,
      true,
      NOW
    );
    expect(healed.injury_scale).toBe(1);
  });

  it('recovery poor → 0.85', () => {
    const mods = computeModifiers(
      null,
      { recovery_state: { total_score: 40 } } as unknown as ProfileDynamic,
      true
    );
    expect(mods.recovery_scale).toBe(0.85);
    const ok = computeModifiers(
      null,
      { recovery_state: { total_score: 80 } } as unknown as ProfileDynamic,
      true
    );
    expect(ok.recovery_scale).toBe(1);
  });

  it('novice caps: beginner 0.7 / unknown+history 0.85 / unknown+no-history 0.7', () => {
    expect(computeModifiers({ fitness_level: 'beginner' } as ProfileStatic, null, true).novice_cap).toBe(0.7);
    expect(computeModifiers({ fitness_level: 'UNKNOWN' } as ProfileStatic, null, true).novice_cap).toBe(0.85);
    expect(computeModifiers({ fitness_level: 'UNKNOWN' } as ProfileStatic, null, false).novice_cap).toBe(0.7);
    expect(computeModifiers({ fitness_level: 'advanced' } as ProfileStatic, null, false).novice_cap).toBe(1);
  });
});

describe('buildCapabilityProfile (四级降级)', () => {
  it('level 1: anchor — est_1rm from anchor best set (Brzycki)', () => {
    const dynamic = {
      load_anchors: {
        '杠铃卧推': {
          best_weight: 80,
          best_reps: 8,
          last_updated: NOW - 3 * 86400000,
        },
      },
    };
    const p = buildCapabilityProfile('杠铃卧推', 'resistance', ctx({ dynamic }), NOW);
    expect(p.data_basis).toBe('anchor');
    // 80 × 36/(37-8) = 99.31
    expect(p.est_1rm).toBeCloseTo(99.31, 1);
    expect(p.anchor_confidence).toBe(1);
    expect(p.modifiers.injury_scale).toBe(1);
  });

  it('level 2: history — best record when no anchor', () => {
    const history = {
      sessions: [
        { date: '2026-08-10T00:00:00Z', exercises: [{ name: '杠铃卧推', reps: 5, weight: 85 }] },
      ],
    };
    const p = buildCapabilityProfile('杠铃卧推', 'resistance', ctx({ history }), NOW);
    expect(p.data_basis).toBe('history');
    expect(p.est_1rm).toBeCloseTo(85 * 36 / 32, 1);
    expect(p.best_set).toEqual({ weight: 85, reps: 5 });
  });

  it('level 3: bodyweight coefficient (beginner takes lower bound)', () => {
    const p = buildCapabilityProfile(
      '杠铃深蹲',
      'resistance',
      ctx({ static: { weight: 80, fitness_level: 'beginner' } }),
      NOW
    );
    expect(p.data_basis).toBe('bodyweight_estimate');
    // 80 × 0.4 / 0.78 = 41.03
    expect(p.est_1rm).toBeCloseTo(41.03, 1);
    expect(p.modifiers.novice_cap).toBe(0.7);
  });

  it('level 4: type_default when nothing matches', () => {
    const p = buildCapabilityProfile('神秘动作', 'resistance', ctx({}), NOW);
    expect(p.data_basis).toBe('type_default');
    expect(p.est_1rm).toBeUndefined();
    expect(p.modifiers.novice_cap).toBe(0.7); // 无等级无历史
  });

  it('anchor preferred over history', () => {
    const dynamic = { load_anchors: { '杠铃卧推': { best_weight: 60, best_reps: 5 } } };
    const history = {
      sessions: [{ date: '2026-08-10', exercises: [{ name: '杠铃卧推', reps: 8, weight: 100 }] }],
    };
    const p = buildCapabilityProfile('杠铃卧推', 'resistance', ctx({ dynamic, history }), NOW);
    expect(p.data_basis).toBe('anchor');
    expect(p.est_1rm).toBeCloseTo(60 * 36 / 32, 1);
  });

  it('cardio profile carries anchor pace', () => {
    const dynamic = { load_anchors: { '跑步': { best_pace: 300 } } };
    const p = buildCapabilityProfile('跑步', 'cardio', ctx({ dynamic }), NOW);
    expect(p.best_pace_sec_per_km).toBe(300);
    expect(p.data_basis).toBe('anchor');
  });

  it('type normalization applies (weight_only → heavy_weight)', () => {
    const p = buildCapabilityProfile('硬拉', 'weight_only', ctx({}), NOW);
    expect(p.exercise_type).toBe('heavy_weight');
    // 硬拉命中体重系数表
    expect(p.data_basis).toBe('type_default'); // 无体重输入 → 系数表不可用
  });
});

describe('collectFingerprintInput', () => {
  it('filters expired limitations and gathers anchor updates', () => {
    const dynamic = {
      load_anchors: { '杠铃卧推': { best_weight: 80, best_reps: 8, last_updated: 1234567890123 } },
      active_limitations: [
        { part: 'knee', severity: 5, expire_at: new Date(NOW + 86400000).toISOString() },
        { part: 'old', severity: 3, expire_at: new Date(NOW - 86400000).toISOString() },
      ],
    };
    const input = collectFingerprintInput(
      ctx({ static: { fitness_level: 'beginner', preferences: { goal: 'muscle_gain' } }, dynamic }),
      [{ name: '杠铃卧推', type: 'resistance' }],
      'off',
      NOW
    );
    expect(input.limitations).toEqual(['knee:5']);
    expect(input.anchorUpdates).toEqual({ '杠铃卧推': 1234567890123 });
    expect(input.goal).toBe('muscle_gain');
    expect(input.agent_mode).toBe('off');
  });
});
