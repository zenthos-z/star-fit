/**
 * Integration tests for SuggestionService.generateBatch (full pipeline,
 * Repository/Agent 端口注入 fake — 不依赖真实 PG / LLM)。
 *
 * 覆盖：
 * - mode=off 纯公式路径（默认）：source='formula'、无 adjustment、schema 校验通过
 * - history 锚点推导 → est_1rm → weight（科学算术链路）
 * - hybrid：Agent 意图经 applyAdjustment 钳制后生效，source='hybrid'
 * - Agent 抛错 / 返回 null → 降级 formula + degraded_reason（绝不 5xx 哲学）
 * - 伤病限制：基准已被 injury_scale 下调，Agent 上调意图被抑制
 * - Repository 三项全挂 → 仍产出 type_default 保守建议（不阻塞）
 */

import { describe, it, expect, afterEach } from '@jest/globals';

import {
  SuggestionService,
  type AgentAdjustmentInput,
  type SuggestionAgentPort,
  type SuggestionUserRepoPort,
} from '../../src/services/suggestions/suggestionService.js';
import type { HistorySummary, ProfileDynamic, ProfileStatic } from 'shared/contracts';

// ============================================================================
// Fakes
// ============================================================================

function fakeRepo(overrides: {
  static?: Partial<ProfileStatic> | null;
  dynamic?: Record<string, unknown> | null;
  history?: Record<string, unknown> | null;
  reject?: boolean;
}): SuggestionUserRepoPort {
  return {
    getProfileStatic: async () => {
      if (overrides.reject) throw new Error('db down');
      return (overrides.static ?? null) as ProfileStatic | null;
    },
    getProfileDynamic: async () => {
      if (overrides.reject) throw new Error('db down');
      return (overrides.dynamic ?? null) as ProfileDynamic | null;
    },
    getHistorySummary: async () => {
      if (overrides.reject) throw new Error('db down');
      return (overrides.history ?? null) as HistorySummary | null;
    },
  };
}

function fakeAgent(
  behavior: (input: AgentAdjustmentInput) => Promise<ReturnType<SuggestionAgentPort['adjust']>>,
): SuggestionAgentPort & { calls: AgentAdjustmentInput[] } {
  const calls: AgentAdjustmentInput[] = [];
  return {
    calls,
    adjust: async (input) => {
      calls.push(input);
      return behavior(input);
    },
  };
}

const HISTORY = {
  sessions: [
    {
      date: '2026-08-10T00:00:00Z',
      exercises: [{ name: '杠铃卧推', sets: 4, reps: 8, weight: 100 }],
    },
  ],
};

const STATIC_INTERMEDIATE_MUSCLE = {
  fitness_level: 'intermediate',
  preferences: { goal: 'muscle_gain' },
} as Partial<ProfileStatic>;

const REQ = {
  exercises: [{ name: '杠铃卧推', type: 'resistance' }],
  target_rpe: 8,
};

// ============================================================================
// Tests
// ============================================================================

describe('SuggestionService.generateBatch', () => {
  const originalMode = process.env.SUGGESTION_AGENT_MODE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.SUGGESTION_AGENT_MODE;
    else process.env.SUGGESTION_AGENT_MODE = originalMode;
  });

  it('mode=off（默认）: 纯公式路径，source=formula，schema 校验通过', async () => {
    delete process.env.SUGGESTION_AGENT_MODE;
    const agent = fakeAgent(async () => []);
    const service = new SuggestionService(
      fakeRepo({ static: STATIC_INTERMEDIATE_MUSCLE, history: HISTORY }),
      agent,
    );

    const res = await service.generateBatch('user-1', REQ);

    expect(res.meta.agent_mode).toBe('off');
    expect(res.meta.degraded_reason).toBeUndefined();
    expect(agent.calls).toHaveLength(0); // off 模式根本不调 Agent
    expect(res.suggestions).toHaveLength(1);

    const s = res.suggestions[0];
    expect(s.exercise_name).toBe('杠铃卧推');
    expect(s.source).toBe('formula');
    expect(s.adjustment).toBeUndefined();
    expect(s.context_fingerprint).toBe(res.meta.context_fingerprint);
    // 历史锚点：100×8 → e1RM 124.14；muscle_gain RPE8 → 10 次 @77% → 95.58 → 2.5 网格 95
    expect(s.profile.data_basis).toBe('history');
    expect(s.profile.est_1rm).toBeCloseTo(124.14, 1);
    expect(s.values.weight).toBe(95);
    expect(s.values.reps).toBe(10);
    expect(s.values.set_count).toBe(4);
  });

  it('hybrid: Agent 有界意图生效，source=hybrid，reason 透传', async () => {
    process.env.SUGGESTION_AGENT_MODE = 'hybrid';
    const agent = fakeAgent(async (input) => [
      {
        exercise_name: input.items[0].name,
        actions: [{ field: 'weight', mode: 'multiply', value: 0.9 }],
        reason: '近期恢复偏弱，宁轻勿重',
      },
    ]);
    const service = new SuggestionService(
      fakeRepo({ static: STATIC_INTERMEDIATE_MUSCLE, history: HISTORY }),
      agent,
    );

    const res = await service.generateBatch('user-1', REQ);

    expect(agent.calls).toHaveLength(1);
    // Agent 输入携带 Service 算好的基准与画像摘要（AI 只读，不算术）
    expect(agent.calls[0].items[0].baseline.weight).toBeCloseTo(124.14 * 0.77, 1);
    expect(agent.calls[0].profileSummary.goal).toBe('muscle_gain');
    expect(agent.calls[0].userId).toBe('user-1');

    const s = res.suggestions[0];
    expect(s.source).toBe('hybrid');
    expect(s.adjustment?.reason).toBe('近期恢复偏弱，宁轻勿重');
    // 95.58 × 0.9 = 86.02 → 2.5 网格 85
    expect(s.values.weight).toBe(85);
    expect(res.meta.agent_mode).toBe('hybrid');
  });

  it('hybrid: Agent 抛错 → 降级 formula + degraded_reason，不向上抛', async () => {
    process.env.SUGGESTION_AGENT_MODE = 'hybrid';
    const warnings: unknown[] = [];
    const service = new SuggestionService(
      fakeRepo({ static: STATIC_INTERMEDIATE_MUSCLE, history: HISTORY }),
      fakeAgent(async () => {
        throw new Error('LLM timeout');
      }),
    );

    const res = await service.generateBatch('user-1', REQ, {
      warn: (obj) => warnings.push(obj),
    });

    expect(res.suggestions[0].source).toBe('formula');
    expect(res.meta.agent_mode).toBe('hybrid');
    expect(res.meta.degraded_reason).toBe('agent_adjustment_failed');
    expect(warnings).toHaveLength(1);
  });

  it('hybrid: Agent 返回 null（放弃）→ degraded_reason=agent_adjustment_unavailable', async () => {
    process.env.SUGGESTION_AGENT_MODE = 'hybrid';
    const service = new SuggestionService(
      fakeRepo({ static: STATIC_INTERMEDIATE_MUSCLE, history: HISTORY }),
      fakeAgent(async () => null),
    );

    const res = await service.generateBatch('user-1', REQ);

    expect(res.suggestions[0].source).toBe('formula');
    expect(res.meta.degraded_reason).toBe('agent_adjustment_unavailable');
  });

  it('伤病限制：基准按 injury_scale 下调，Agent 上调意图被抑制（只许下调）', async () => {
    process.env.SUGGESTION_AGENT_MODE = 'hybrid';
    const now = Date.now();
    const dynamic = {
      active_limitations: [
        { part: '肩袖', severity: 8, expire_at: new Date(now + 7 * 86400000).toISOString() },
      ],
    };
    const agent = fakeAgent(async (input) => [
      {
        exercise_name: input.items[0].name,
        actions: [
          { field: 'weight', mode: 'multiply', value: 1.1 },
          { field: 'reps', mode: 'delta', value: -2 },
        ],
        reason: '肩伤恢复期',
      },
    ]);
    const service = new SuggestionService(
      fakeRepo({ static: STATIC_INTERMEDIATE_MUSCLE, dynamic, history: HISTORY }),
      agent,
    );

    const res = await service.generateBatch('user-1', REQ);
    const s = res.suggestions[0];

    expect(agent.calls[0].items[0].injuryLimited).toBe(true);
    // severity 8 → injury_scale 0.5：95.58 × 0.5 = 47.79 → 47.5；上调被抑制，下调 reps 生效
    expect(s.profile.modifiers.injury_scale).toBe(0.5);
    expect(s.values.weight).toBe(47.5);
    expect(s.values.reps).toBe(8);
  });

  it('Repository 三项全挂 → 仍产出 type_default 保守建议（不阻塞）', async () => {
    delete process.env.SUGGESTION_AGENT_MODE;
    const service = new SuggestionService(fakeRepo({ reject: true }), null);

    const res = await service.generateBatch('user-1', {
      exercises: [
        { name: '杠铃卧推', type: 'resistance' },
        { name: '跑步', type: 'cardio' },
      ],
      target_rpe: 7,
    });

    expect(res.suggestions).toHaveLength(2);
    for (const s of res.suggestions) {
      expect(s.source).toBe('formula');
      expect(s.profile.data_basis).toBe('type_default');
    }
    // 有氧缺省 30min / 5km（RPE 7 档）
    const run = res.suggestions.find((s) => s.exercise_name === '跑步');
    expect(run?.values.duration_sec).toBe(1800);
    expect(run?.values.distance_m).toBe(5000);
  });

  it('同上下文两次调用 fingerprint 一致；goal 变化后失效', async () => {
    delete process.env.SUGGESTION_AGENT_MODE;
    const service = new SuggestionService(
      fakeRepo({ static: STATIC_INTERMEDIATE_MUSCLE, history: HISTORY }),
      null,
    );

    const a = await service.generateBatch('user-1', REQ);
    const b = await service.generateBatch('user-1', REQ);
    expect(a.meta.context_fingerprint).toBe(b.meta.context_fingerprint);

    const strengthService = new SuggestionService(
      fakeRepo({
        static: { fitness_level: 'intermediate', preferences: { goal: 'strength' } },
        history: HISTORY,
      }),
      null,
    );
    const c = await strengthService.generateBatch('user-1', REQ);
    expect(c.meta.context_fingerprint).not.toBe(a.meta.context_fingerprint);
    // strength RPE8 → 4 次，强度区间更高
    expect(c.suggestions[0].values.reps).toBe(4);
  });
});
