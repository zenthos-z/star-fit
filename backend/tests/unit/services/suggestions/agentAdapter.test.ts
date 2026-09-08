/**
 * Unit tests for SuggestionAgentAdapter (fake AgentService, no LLM)。
 *
 * 钉死的行为：
 * - 合法围栏卡 → 意图列表返回（且过滤幻觉动作名）
 * - 独立 threadId='suggestions:<userId>'（绝不污染主聊天 checkpoint）
 * - 坏 JSON / 无围栏 → 带反馈重试，至多 2 次纠正后降级 null
 * - Agent error 事件 → 立即 null
 * - 超时 → null（放弃等待）
 */

import { describe, it, expect, afterEach } from '@jest/globals';

import type { AgentEvent, AgentService, ChatRequest } from 'shared/contracts';

import {
  SuggestionAgentAdapter,
  extractAdjustmentCard,
} from '../../../../src/services/suggestions/suggestionAgentAdapter.js';
import type { AgentAdjustmentInput } from '../../../../src/services/suggestions/suggestionService.js';

// ============================================================================
// Fake AgentService
// ============================================================================

interface RecordedCall {
  req: ChatRequest;
}

function fakeAgent(
  script: (callIndex: number, call: RecordedCall) => AgentEvent[] | Promise<AgentEvent[]>,
): AgentService & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
      const call = { req };
      calls.push(call);
      const events = await script(calls.length - 1, call);
      for (const event of events) yield event;
    },
  } as unknown as AgentService & { calls: RecordedCall[] };
}

const INPUT: AgentAdjustmentInput = {
  userId: 'user-1',
  profileSummary: {
    goal: 'muscle_gain',
    fitness_level: 'intermediate',
    training_age_months: 24,
    bodyweight_kg: 75,
    limitations: ['肩袖(severity 5)'],
    recovery: '{"total_score": 55}',
  },
  items: [
    {
      name: '杠铃卧推',
      type: 'resistance',
      baseline: { weight: 95, reps: 10, set_count: 4 },
      anchorSummary: '历史最佳推导 est_1rm 124.1kg（置信度 1）',
      injuryLimited: true,
    },
  ],
};

const VALID_CARD = [
  '前置废话一句',
  '```json',
  '{"type":"suggestion_adjustment","adjustments":[',
  '{"exercise_name":"杠铃卧推","actions":[{"field":"weight","mode":"multiply","value":0.9}],"reason":"肩袖伤恢复中，重量下调一档"}',
  ']}',
  '```',
  '后置废话',
].join('\n');

// ============================================================================
// extractAdjustmentCard（纯函数）
// ============================================================================

describe('extractAdjustmentCard', () => {
  it('strips ```json fence', () => {
    const card = extractAdjustmentCard(VALID_CARD) as { type: string };
    expect(card.type).toBe('suggestion_adjustment');
  });

  it('falls back to first balanced object without fence', () => {
    const card = extractAdjustmentCard('好的 {"type":"suggestion_adjustment","adjustments":[]} 完毕');
    expect(card).toEqual({ type: 'suggestion_adjustment', adjustments: [] });
  });

  it('returns null for prose', () => {
    expect(extractAdjustmentCard('没有任何结构化输出')).toBeNull();
  });
});

// ============================================================================
// Adapter 行为
// ============================================================================

describe('SuggestionAgentAdapter.adjust', () => {
  const originalTimeout = process.env.SUGGESTION_AGENT_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.SUGGESTION_AGENT_TIMEOUT_MS;
    else process.env.SUGGESTION_AGENT_TIMEOUT_MS = originalTimeout;
  });

  it('合法卡 → 返回意图；threadId 独立于主聊天；prompt 含基准与画像', async () => {
    const agent = fakeAgent(() => [
      { type: 'token', text: VALID_CARD },
      { type: 'done' },
    ]);
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);

    expect(intents).not.toBeNull();
    expect(intents).toHaveLength(1);
    expect(intents![0].exercise_name).toBe('杠铃卧推');
    expect(intents![0].reason).toBe('肩袖伤恢复中，重量下调一档');

    expect(agent.calls).toHaveLength(1);
    const req = agent.calls[0].req;
    expect(req.threadId).toBe('suggestions:user-1'); // 独立线程
    expect(req.userId).toBe('user-1');
    // prompt 携带 Service 压缩的输入（AI 只读参考）
    expect(req.message).toContain('动作建议调整顾问');
    expect(req.message).toContain('杠铃卧推');
    expect(req.message).toContain('muscle_gain');
  });

  it('过滤幻觉动作名（卡里有但请求没有的动作被丢弃）', async () => {
    const card = [
      '```json',
      '{"type":"suggestion_adjustment","adjustments":[',
      '{"exercise_name":"不存在的动作","actions":[{"field":"weight","mode":"multiply","value":0.8}],"reason":"幻觉"},',
      '{"exercise_name":"杠铃 卧推","actions":[{"field":"reps","mode":"delta","value":-1}],"reason":"空格变体归一"}',
      ']}',
      '```',
    ].join('\n');
    const agent = fakeAgent(() => [{ type: 'token', text: card }, { type: 'done' }]);
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);

    // 幻觉名丢弃；空格差异归一后保留（跨语言别名不在归一化能力内，保守丢弃是对的）
    expect(intents).toHaveLength(1);
    expect(intents![0].exercise_name).toBe('杠铃 卧推');
  });

  it('坏 JSON → 反馈重试 → 第二轮合法则成功', async () => {
    const agent = fakeAgent((callIndex) => {
      if (callIndex === 0) return [{ type: 'token', text: '抱歉我不会输出 JSON' }, { type: 'done' }];
      return [{ type: 'token', text: VALID_CARD }, { type: 'done' }];
    });
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);

    expect(intents).not.toBeNull();
    expect(agent.calls).toHaveLength(2);
    // 重试 prompt 携带结构化反馈
    expect(agent.calls[1].req.message).toContain('围栏');
    expect(agent.calls[1].req.message).toContain('上一轮问题');
  });

  it('持续坏卡 → 至多 1+2 次尝试后降级 null', async () => {
    const agent = fakeAgent(() => [{ type: 'token', text: '还是不输出' }, { type: 'done' }]);
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);

    expect(intents).toBeNull();
    expect(agent.calls).toHaveLength(3); // 1 + 2 retries
  });

  it('schema 违规（reason 超长 / 非法 field）→ 反馈后修正', async () => {
    const badCard = [
      '```json',
      '{"type":"suggestion_adjustment","adjustments":[',
      `{"exercise_name":"杠铃卧推","actions":[{"field":"calories","mode":"delta","value":1}],"reason":"${'长'.repeat(90)}"}`,
      ']}',
      '```',
    ].join('\n');
    const agent = fakeAgent((callIndex) => {
      if (callIndex === 0) return [{ type: 'token', text: badCard }, { type: 'done' }];
      return [{ type: 'token', text: VALID_CARD }, { type: 'done' }];
    });
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);

    expect(intents).not.toBeNull();
    expect(agent.calls[1].req.message).toContain('校验失败');
  });

  it('error 事件 → 立即 null 不重试', async () => {
    const agent = fakeAgent(() => [
      { type: 'error', error: { code: 'MODEL_ERROR', message: 'boom' } },
    ]);
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);

    expect(intents).toBeNull();
    expect(agent.calls).toHaveLength(1);
  });

  it('chat 抛异常 → 吞掉返回 null（不向路由层传播）', async () => {
    const agent = {
      async *chat(): AsyncIterable<AgentEvent> {
        throw new Error('network down');
      },
    } as unknown as AgentService;
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);
    expect(intents).toBeNull();
  });

  it('超时（env 覆写 50ms）→ null，不等待慢 Agent', async () => {
    process.env.SUGGESTION_AGENT_TIMEOUT_MS = '50';
    const agent = fakeAgent(
      () =>
        new Promise<AgentEvent[]>((resolve) => {
          // 慢但有限（250ms），避免泄漏长定时器挂住 jest 退出
          setTimeout(() => resolve([{ type: 'token', text: VALID_CARD }, { type: 'done' }]), 250);
        }),
    );
    const start = Date.now();
    const intents = await new SuggestionAgentAdapter(agent).adjust(INPUT);

    expect(intents).toBeNull();
    expect(Date.now() - start).toBeLessThan(200);
  });
});
