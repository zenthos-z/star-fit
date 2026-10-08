/**
 * [B3 #143] 结算卡本地直填——workout_complete 分支行为锁定
 *
 * 覆盖任务书验证门：
 *  1. 本地即时卡：训练结束首条消息即带 summary_card uiHint，数据逐字来自
 *     本地 payload（stats/exercises 透传零算术）；Agent 永不回复时卡片仍完整
 *  2. 失败兜底：Agent 请求失败 → 本地卡保留（uiHint 不丢），无「分析中」永久态
 *  3. Agent 降级为解读：survey_card 问卷以独立气泡追加，本地卡不被整卡替换
 *  4. summary 型卡增量并入：本地主体（stats/exercises）不重建，Agent 增量字段补进
 *  5. 纯函数装配：退化载荷（无动作/空载荷）不弹空卡，走文字概览兜底
 */

import React from 'react';
import { render, renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { agentChatMock } = vi.hoisted(() => ({ agentChatMock: vi.fn() }));

// agentClient 换桩（chat 行为可控）；流消费/合成纯函数保真
vi.mock('../../services/agent/sseAgentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/sseAgentClient')>();
  return { ...actual, agentClient: { chat: agentChatMock } };
});

// barrel 里本 hook 只消费 getUserId——最小桩避开 syncService/WebSocket 导入面
vi.mock('@/services', () => ({ getUserId: () => 'b3-local-card-user' }));

import { useAICoach, buildLocalSummaryCard } from '../useAICoach';
import { SummaryCard } from '../../components/execution/cards/SummaryCard';

/** Agent 永不回复的流：挂起不 yield（模拟网络黑洞/超时窗口内） */
const neverReply = () =>
  (async function* () {
    await new Promise(() => { /* 永不结算 */ });
  })();

const makeAttachment = () => ({
  type: 'workout_complete' as const,
  sessionId: 'sess-b3-1',
  data: {
    startTime: 1759900000000,
    endTime: 1759903000000,
    pausedDuration: 120000,
    stats: { totalVolume: 2400, setsCount: 12, durationMinutes: 48, avgHr: 132 },
    exercises: [
      {
        id: 'ex-1',
        name: '杠铃卧推',
        type: 'resistance',
        sets: [
          { id: 's1', weight: 60, reps: 8, completed: true },
          { id: 's2', weight: 65, reps: 8, completed: true },
        ],
      },
      {
        id: 'ex-2',
        name: '跑步机热身',
        type: 'cardio',
        sets: [{ id: 's3', duration: 600, completed: true }],
      },
    ],
    anomalies: { weightAdjustments: [], incompleteSets: [], formIssues: [], painReported: false },
  },
});

/**
 * 挂载并等线程引导完成再返——mount effect 异步 createNewThread 会
 * setChatHistory([])，真实训练结束流程必然晚于引导完成（先练完才结算），
 * 测试对齐该时序防竞态误报。
 */
const mountHook = async () => {
  const utils = renderHook(() => useAICoach(null, vi.fn()));
  await waitFor(() => expect(utils.result.current.currentThreadId).not.toBe(''));
  return utils;
};

describe('B3 #143 结算卡本地直填（workout_complete 分支）', () => {
  beforeEach(() => {
    agentChatMock.mockReset();
    localStorage.clear();
  });

  it('本地即时卡：首条消息带 summary_card uiHint，数据逐字来自本地 payload；Agent 永不回复卡仍完整', async () => {
    agentChatMock.mockImplementation(neverReply);
    const attachment = makeAttachment();
    const { result } = await mountHook();

    await act(async () => {
      await result.current.openAiCoach(attachment);
    });

    const cardMsg = await waitFor(() => {
      const m = result.current.chatHistory.find(x => x.uiHint?.type === 'summary_card');
      expect(m).toBeDefined();
      return m as (typeof result.current.chatHistory)[number];
    });

    // 数据来自本地 payload：stats/exercises 逐字透传（零算术、AI 零参与）
    expect(cardMsg.uiHint.data.stats).toEqual(attachment.data.stats);
    expect(cardMsg.uiHint.data.exercises).toEqual(attachment.data.exercises);
    // _isAnalyzing 仅承担输入框 busy 语义，不再是卡片占位
    expect(cardMsg._isAnalyzing).toBe(true);

    // 组件级：该 uiHint 喂真 SummaryCard 渲染出完整数据（stats 三格 + 动作行）
    const { container } = render(<SummaryCard uiHint={cardMsg.uiHint} />);
    const text = container.textContent || '';
    expect(text).toContain('2400');
    expect(text).toContain('48');
    expect(text).toContain('12');
    expect(text).toContain('杠铃卧推');
    expect(text).toContain('跑步机热身');
  });

  it('失败兜底：Agent 请求失败 → 本地卡保留、标志收尾，不出现「分析中」永久态', async () => {
    agentChatMock.mockRejectedValue(new Error('agent down'));
    const { result } = await mountHook();

    await act(async () => {
      await result.current.openAiCoach(makeAttachment());
    });

    await waitFor(() => {
      const m = result.current.chatHistory.find(x => x._sessionId === 'sess-b3-1');
      expect(m?._isAnalyzing).toBe(false);
      expect(m?._analysisComplete).toBe(true);
      expect(m?.uiHint?.type).toBe('summary_card');
      expect(m?.uiHint?.data?.stats?.totalVolume).toBe(2400);
      expect(m?.text).toContain('教练解读暂时不可用');
    });
  });

  it('Agent 降级为解读（常规 survey_card）：本地卡不被替换，解读文字与问卷卡以独立气泡追加', async () => {
    agentChatMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'token', text: '本次推课完成度不错，最后一组接近力竭。' };
        yield {
          type: 'uiHint',
          card: {
            type: 'survey',
            data: {
              title: '训练反馈',
              questions: [{ id: 'q1', question: '强度感觉如何？', required: false }],
            },
          },
        };
        yield { type: 'done' };
      })(),
    );
    const attachment = makeAttachment();
    const { result } = await mountHook();

    await act(async () => {
      await result.current.openAiCoach(attachment);
    });

    await waitFor(() => {
      // 本地总结卡：原位保留、数据未动、标志收尾
      const local = result.current.chatHistory.find(x => x._sessionId === 'sess-b3-1');
      expect(local?.uiHint?.type).toBe('summary_card');
      expect(local?.uiHint?.data?.stats).toEqual(attachment.data.stats);
      expect(local?._isAnalyzing).toBe(false);
      // 问卷卡以独立气泡追加（不再挤占总结卡位）
      const survey = result.current.chatHistory.find(x => x.uiHint?.type === 'survey_card');
      expect(survey?.uiHint?.data?.title).toBe('训练反馈');
      // 解读文字以普通气泡追加
      const bubble = result.current.chatHistory.find(x => x.role === 'ai' && x.text.includes('完成度不错'));
      expect(bubble).toBeDefined();
      expect(bubble?.uiHint).toBeUndefined();
    });
  });

  it('Agent 回 summary 型卡：增量字段并入本地卡（主体不重建、同键本地赢），文字照常追加', async () => {
    agentChatMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'token', text: '容量较上周提升 8%。' };
        yield {
          type: 'uiHint',
          card: {
            type: 'summary',
            data: {
              summary: '趋势：总容量创近 4 周新高',
              highlights: ['卧推容量 +8%'],
              metrics: { volumeTrendPct: 8 },
            },
          },
        };
        yield { type: 'done' };
      })(),
    );
    const attachment = makeAttachment();
    const { result } = await mountHook();

    await act(async () => {
      await result.current.openAiCoach(attachment);
    });

    await waitFor(() => {
      const local = result.current.chatHistory.find(x => x._sessionId === 'sess-b3-1');
      // 主体不重建：stats/exercises 仍是本地真值
      expect(local?.uiHint?.data?.stats).toEqual(attachment.data.stats);
      expect(local?.uiHint?.data?.exercises).toEqual(attachment.data.exercises);
      // Agent 增量字段补进（趋势对比等）
      expect(local?.uiHint?.data?.summary).toBe('趋势：总容量创近 4 周新高');
      expect(local?.uiHint?.data?.metrics).toEqual({ volumeTrendPct: 8 });
      // 解读文字气泡存在；不再追加第二张总结卡
      expect(result.current.chatHistory.some(x => x.role === 'ai' && x.text.includes('提升 8%'))).toBe(true);
      const summaryCards = result.current.chatHistory.filter(x => x.uiHint?.type === 'summary_card');
      expect(summaryCards).toHaveLength(1);
    });
  });

  it('退化载荷兜底：无动作时不弹空卡，保留文字概览', async () => {
    agentChatMock.mockImplementation(neverReply);
    const { result } = await mountHook();

    await act(async () => {
      await result.current.openAiCoach({
        type: 'workout_complete',
        sessionId: 'sess-b3-2',
        data: {
          startTime: 1759900000000,
          endTime: 1759903000000,
          pausedDuration: 0,
          stats: { totalVolume: 0, setsCount: 0, durationMinutes: 0 },
          exercises: [],
          anomalies: { weightAdjustments: [], incompleteSets: [], formIssues: [], painReported: false },
        },
      });
    });

    await waitFor(() => {
      const m = result.current.chatHistory.find(x => x._sessionId === 'sess-b3-2');
      expect(m).toBeDefined();
      expect(m?.uiHint).toBeUndefined();
      expect(m?.text).toContain('本次训练概览');
    });
  });
});

/**
 * [#157] 问卷静态画像写入——所有问卷上传场景都触发 PUT profile/static。
 * 根因：原实现包在 `if (!hasWorkoutData)` 里，workout_complete 训练后问卷
 * 填的 weight_kg 两头都不写（update_profile 动态通道无静态字段路径）。
 */
describe('#157 问卷上传 → 静态画像确定性写入（解除 hasWorkoutData 条件）', () => {
  // URL 路由 fetch 桩：被测/依赖端点放行 ok，其余沿用 setup 的离线快败语义
  const makeFetchMock = () =>
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/profile/static') || url.includes('/api/sessions')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      return Promise.reject(new TypeError('offline (test env)'));
    });

  const doneStream = () =>
    (async function* () {
      yield { type: 'done' };
    })();

  /** Agent 流必须走完（analysisInProgressRef 清除）才能交问卷，否则 guard 拦截 */
  const staticPutCalls = (fetchMock: ReturnType<typeof makeFetchMock>) =>
    fetchMock.mock.calls.filter(([u]) => String(u).includes('/profile/static'));

  afterEach(() => {
    // 恢复 setup.ts 的离线快败桩语义（vi.stubGlobal 会遮蔽它）
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline (test env)'))));
  });

  it('workout_complete 场景问卷上传 → PUT profile/static 被调用且 body 含 basic_info.weight', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    agentChatMock.mockImplementation(doneStream);
    const { result } = await mountHook();

    // 训练结束 → workoutDataRef 挂上（workout_complete 场景成立）
    await act(async () => {
      await result.current.openAiCoach(makeAttachment());
    });
    await waitFor(() => {
      const local = result.current.chatHistory.find(x => x._sessionId === 'sess-b3-1');
      expect(local?._analysisComplete).toBe(true);
    });

    // SurveyCard onConfirm 同构载荷（responses 嵌套）
    await act(async () => {
      await result.current.handleChatSubmit(
        undefined,
        `[UPLOAD_SURVEY_DATA]:${JSON.stringify({ responses: { weight_kg: 70, age: 30 } })}`,
      );
    });

    await waitFor(() => {
      const calls = staticPutCalls(fetchMock);
      expect(calls).toHaveLength(1);
      const [url, init] = calls[0] as unknown as [string, RequestInit];
      expect(String(url)).toContain('/admin/users/b3-local-card-user/profile/static');
      expect(init.method).toBe('PUT');
      const body = JSON.parse(String(init.body));
      expect(body.basic_info.weight).toBe(70);
      expect(body.basic_info.age).toBe(30);
    });
  });

  it('plan 场景问卷上传 → 静态写入保持（解除条件后不回归）', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    agentChatMock.mockImplementation(doneStream);
    const { result } = await mountHook();

    await act(async () => {
      await result.current.handleChatSubmit(
        undefined,
        `[UPLOAD_SURVEY_DATA]:${JSON.stringify({ responses: { weight_kg: 62 } })}`,
      );
    });

    await waitFor(() => {
      const calls = staticPutCalls(fetchMock);
      expect(calls).toHaveLength(1);
      const body = JSON.parse(String((calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.basic_info.weight).toBe(62);
    });
  });
});

describe('buildLocalSummaryCard 纯函数装配（零算术）', () => {
  it('空载荷/无动作 → undefined（不弹空卡）', () => {
    expect(buildLocalSummaryCard(undefined)).toBeUndefined();
    expect(buildLocalSummaryCard(null)).toBeUndefined();
    expect(buildLocalSummaryCard({ exercises: [] })).toBeUndefined();
    expect(buildLocalSummaryCard({ exercises: 'not-array' as unknown as unknown[] })).toBeUndefined();
  });

  it('stats 缺项 → 零缺省；exercises 原样透传（不重算）', () => {
    const exercises = [{ name: '引体向上', type: 'bodyweight', sets: [] }];
    expect(buildLocalSummaryCard({ exercises })).toEqual({
      type: 'summary_card',
      data: { stats: { totalVolume: 0, setsCount: 0, durationMinutes: 0 }, exercises },
    });
    // 透传不克隆：本地数据引用直通（防「装配层偷偷算术/变形」）
    expect(buildLocalSummaryCard({ exercises })?.data.exercises).toBe(exercises);
  });
});
