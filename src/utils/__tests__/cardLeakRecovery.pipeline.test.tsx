/**
 * 泄漏卡复原 · 管线级回归（issue #56 验证门 3）——「长思考 mock 数据 → 正确
 * 渲染卡片，原始 JSON 不再裸露」。
 *
 * 复现场景：长思考轮（画像更新后续跑出计划）结束后，周计划气泡显示一串
 * 原始 JSON。mock SSE 帧序列对齐真实采集（t10-sse-round1 的形态真源：
 * thinking 逐 delta 流 + 终步 uiHint/token + done），泄漏轮把卡片 JSON 以
 * token 文本倾进正文（后端流层提取器漏剥——根因定位见 PR 描述，流层修复
 * 属 #73 批次，前端侧终态复原兜底在此锁定）。
 *
 * 管线段落 = useAICoach 定型路径的确定性重放：
 *   wire bytes → parseSSEChunk（真解析器）→ 事件循环归约（定型同款逻辑）→
 *   recoverLeakedCard（本轮新增兜底）→ ExerciseRenderer 渲染。
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseSSEChunk } from '../../services/agent/sseAgentClient';
import { synthesizeUiHint } from '../../services/agent/sseAgentClient';
import { recoverLeakedCard } from '../cardLeakRecovery';
import { ExerciseRenderer } from '../../components/execution/ExerciseRenderer';
import type { AgentEvent, UiHintCard } from 'shared/contracts';

vi.spyOn(console, 'info').mockImplementation(() => {});

/** 周计划卡载荷（对齐 shared/contracts/weekly-plan 契约的最小形态） */
const weeklyPlanData = {
  week_label: '第 1 周',
  phase_label: '增肌基础块',
  split_summary: '全身×3 · 每周三练 · 新手起步，动作标准优先',
  days: [
    {
      entry_date: '2026-09-30',
      split_label: '全身',
      focus: '胸肩三头',
      rest: false,
      exercises: [
        {
          exercise_id: 'V1StGXR8_Z5jdHi6',
          name: '杠铃卧推',
          sets: [{ set: 1, weight: 60, reps: 8 }],
        },
      ],
    },
    { entry_date: '2026-10-01', rest: true, exercises: [] },
  ],
  apply: {
    scope: 'week',
    split: 'full_body',
    dates: [],
    entries: [
      {
        entry_date: '2026-09-30',
        exercise_id: 'V1StGXR8_Z5jdHi6',
        target_sets: 1,
        target_load: { type: 'rpe', min: 4, max: 5 },
        sort_order: 0,
        day_focus: '胸肩三头',
        rationale: '新手以复合动作为主建立基础力量',
        category: 'main',
        sets: [{ set_no: 1, weight_kg: 60, reps: 8, rpe: 7 }],
      },
    ],
  },
};

/** 长思考 mock：GLM 深思考轮量级（数千 thinking delta）+ 终步事件 */
const buildLeakStream = (cardJson: string): string => {
  const frames: string[] = [': ping\n\n'];
  // 长思考：200 delta 的思考链（模拟画像读取 + 动作选配的推理流）
  for (let i = 0; i < 200; i += 1) {
    frames.push(`data: ${JSON.stringify({ type: 'thinking', text: `分析用户画像与动作库第${i}步。` })}\n\n`);
  }
  // 泄漏：卡片 JSON 被剥失败，以 token 文本进正文（含围栏 + 引导语 + 收尾）
  frames.push(`data: ${JSON.stringify({ type: 'token', text: '好的，这是为你定制的第 1 周计划：\n\n```json\n' })}\n\n`);
  // 大载荷按 4KB 分帧（对齐真实后端 chunkAnswerText 的分片节奏）
  for (let i = 0; i < cardJson.length; i += 4096) {
    frames.push(`data: ${JSON.stringify({ type: 'token', text: cardJson.slice(i, i + 4096) })}\n\n`);
  }
  frames.push(`data: ${JSON.stringify({ type: 'token', text: '\n```' })}\n\n`);
  frames.push(`data: ${JSON.stringify({ type: 'token', text: '\n\n确认后我帮你启用本周计划。' })}\n\n`);
  frames.push('data: {"type":"done"}\n\n');
  return frames.join('');
};

/**
 * useAICoach 事件循环 + 终态定型的确定性重放（定型逻辑见 useAICoach.ts
 * 主路径 for-await 块：token 进正文、thinking 进折叠区、uiHint 暂存、
 * 流终 recoverLeakedCard 复原）。
 */
const replayTurn = (wire: string): { text: string; card?: UiHintCard } => {
  let accumulated = '';
  let card: UiHintCard | undefined;
  const feed = (chunk: string) => {
    const { events, remainder } = parseSSEChunk(chunk);
    if (remainder) throw new Error(`unexpected remainder: ${remainder.slice(0, 60)}`);
    for (const ev of events) reduce(ev);
  };
  const reduce = (ev: AgentEvent) => {
    if (ev.type === 'token' && ev.text) accumulated += ev.text;
    else if (ev.type === 'uiHint' && ev.card) card = ev.card;
  };
  feed(wire);
  feed(''); // flush tail（parseSSEChunk 需显式补 \n\n 终界）
  const recovered = recoverLeakedCard(accumulated, card);
  return { text: recovered.text, card: card ?? recovered.card };
};

describe('issue #56 管线回归：泄漏周计划卡 → 卡片渲染，原始 JSON 不裸露', () => {
  it('泄漏轮（卡片 JSON 在 token 文本里）：复原成 weekly_plan 卡渲染，JSON 不进正文', () => {
    const cardJson = JSON.stringify({ type: 'weekly_plan', data: weeklyPlanData });
    const { text, card } = replayTurn(buildLeakStream(cardJson));

    // 定型结果：卡被复原、正文只剩散文
    expect(card?.type).toBe('weekly_plan');
    expect(text).not.toContain('```');
    expect(text).not.toContain('week_label');
    expect(text).toContain('好的，这是为你定制的第 1 周计划');
    expect(text).toContain('确认后我帮你启用本周计划');

    // 渲染：气泡正文（Markdown）无裸 JSON + 卡片组件真实挂载
    const uiHint = synthesizeUiHint(card);
    const { container } = render(
      <div>
        <div data-testid="bubble-text">{text}</div>
        {uiHint && <ExerciseRenderer uiHint={{ type: uiHint.type, data: uiHint.data }} />}
      </div>,
    );
    expect(screen.queryByText(/week_label/)).toBeNull();
    expect(container.querySelector('[data-testid="weekly-plan-card"]')).not.toBeNull();
    expect(container.textContent).toContain('第 1 周');
    expect(container.textContent).toContain('确认启用本周计划');
  });

  it('健康轮对照（卡片走 uiHint 帧）：定型零扰动，卡片照常渲染', () => {
    const wire = [
      'data: {"type":"thinking","text":"正在编排。"}\n\n',
      'data: {"type":"token","text":"计划来了："}\n\n',
      `data: {"type":"uiHint","card":${JSON.stringify({ type: 'weekly_plan', data: weeklyPlanData })}}\n\n`,
      'data: {"type":"token","text":"\\n\\n确认后我帮你启用。"}\n\n',
      'data: {"type":"done"}\n\n',
    ].join('');

    const { text, card } = replayTurn(wire);

    expect(card?.type).toBe('weekly_plan');
    expect(text).toBe('计划来了：\n\n确认后我帮你启用。'); // 健康正文零扰动
    const uiHint = synthesizeUiHint(card);
    const { container } = render(
      <ExerciseRenderer uiHint={{ type: uiHint!.type, data: uiHint!.data }} />,
    );
    expect(container.querySelector('[data-testid="weekly-plan-card"]')).not.toBeNull();
  });

  it('破损卡降级轮：原始 JSON 摘除 + 明确可读提示，不渲染破损卡', () => {
    // 括号平衡但语法破损（尾逗号）——流层「leave intact as prose」泄漏形态
    const broken =
      '{"type":"weekly_plan","data":{"week_label":"第 1 周","split_summary":"全身",' +
      '"days":[{"entry_date":"2026-09-30","rest":false,"exercises":[]}],}}';
    const wire = [
      'data: {"type":"token","text":"计划来了：\\n\\n```json\\n"}\n\n',
      `data: ${JSON.stringify({ type: 'token', text: broken })}\n\n`,
      'data: {"type":"token","text":"\\n```"}\n\n',
      'data: {"type":"done"}\n\n',
    ].join('');

    const { text, card } = replayTurn(wire);

    expect(card).toBeUndefined();
    expect(text).not.toContain('week_label');
    expect(text).toContain('⚠️');
    expect(text).toContain('重新生成');
    const uiHint = synthesizeUiHint(undefined);
    const { container } = render(
      <div>
        <div data-testid="bubble-text">{text}</div>
        {uiHint && <ExerciseRenderer uiHint={{ type: uiHint.type, data: uiHint.data }} />}
      </div>,
    );
    expect(screen.queryByText(/week_label/)).toBeNull();
    expect(container.querySelector('[data-testid="weekly-plan-card"]')).toBeNull();
  });
});
