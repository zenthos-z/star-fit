/**
 * T1 调试台组件测试（issue #53）——数据直灌链路与 SSE 调试台渲染冒烟。
 *
 * 覆盖：
 * - ScenarioPanel：场景列表 → 点击 → 真实渲染组件出卡（卡片注册表分发）
 *   （plan-card / weekly-plan-card / survey-card / profile_update_confirm / 执行卡）
 * - SseConsolePanel：回放入账后 turn/帧可见；ping 帧与未知帧照常展示不炸；
 *   帧展开 payload JSON
 * - 确认回传日志：卡片按钮 onConfirm 载荷在调试台显式可见
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { ScenarioPanel } from '../ScenarioPanel';
import { SseConsolePanel } from '../SseConsolePanel';
import { sseRecorder, replayRawStream } from '../sse/recorder';

// jsdom 下不可用的原生能力与网络依赖，挂桩（与 WeeklyPlanCard.test 同款套路）
vi.mock('../../lib/nativeHaptics', () => ({ haptic: vi.fn() }));
vi.mock('../../hooks/useExerciseLibraryIndex', () => ({
  useExerciseLibraryIndex: () => ({ byId: new Map(), byName: new Map() }),
}));

beforeEach(() => {
  sseRecorder.clear();
});

describe('ScenarioPanel · 数据直灌渲染链路', () => {
  it('场景列表按三组渲染（后端卡型 / 前端专属 / 执行卡片），总数 ≥ 14', () => {
    render(<ScenarioPanel />);
    expect(screen.getByTestId('scenario-list')).toBeInTheDocument();
    expect(screen.getByText('对话卡片 · 后端卡型')).toBeInTheDocument();
    expect(screen.getByText('对话卡片 · 前端专属')).toBeInTheDocument();
    expect(screen.getByText('执行卡片 · 动作卡')).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^scenario-row-/);
    expect(rows.length).toBeGreaterThanOrEqual(14);
  });

  it('plan_card 场景：一键加载 → PlanCard 真实组件出卡（plan-card testid + 动作名）', () => {
    render(<ScenarioPanel />);
    fireEvent.click(screen.getByTestId('scenario-row-plan-card-session'));
    const card = screen.getByTestId('plan-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByText('杠铃卧推')).toBeInTheDocument();
    // 气泡正文同屏（模拟真实聊天上下文）
    expect(screen.getByText(/结合你近两次的训练表现/)).toBeInTheDocument();
  });

  it('weekly_plan 场景：WeeklyPlanCard 出卡 + 分化摘要可见', () => {
    render(<ScenarioPanel />);
    fireEvent.click(screen.getByTestId('scenario-row-weekly-plan-card'));
    expect(screen.getByTestId('weekly-plan-card')).toBeInTheDocument();
    expect(screen.getByText('推拉腿 · 每周 3 练 · 主项渐进 +1 档')).toBeInTheDocument();
  });

  it('survey_card 场景：SurveyCard 出卡，多题 + 预声明选项渲染', () => {
    render(<ScenarioPanel />);
    fireEvent.click(screen.getByTestId('scenario-row-survey-card-first-use'));
    expect(screen.getByTestId('survey-card')).toBeInTheDocument();
    expect(screen.getByText('训练画像调研')).toBeInTheDocument();
    expect(screen.getByText('完全新手')).toBeInTheDocument();
  });

  it('profile_update_confirm 场景：确认按钮组 + 提案条目渲染', () => {
    render(<ScenarioPanel />);
    fireEvent.click(screen.getByTestId('scenario-row-profile-confirm-day-end'));
    expect(screen.getByText('负荷锚点')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认更新' })).toBeInTheDocument();
  });

  it('执行卡场景：resistance_standard → ResistanceCard 出卡（动作名 + 组信息）', () => {
    render(<ScenarioPanel />);
    fireEvent.click(screen.getByTestId('scenario-row-exec-resistance'));
    expect(screen.getByTestId('scenario-view')).toBeInTheDocument();
    expect(screen.getAllByText('杠铃卧推').length).toBeGreaterThan(0);
  });

  it('返回列表后可再进另一场景（状态切换干净）', () => {
    render(<ScenarioPanel />);
    fireEvent.click(screen.getByTestId('scenario-row-plan-card-session'));
    expect(screen.getByTestId('plan-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('scenario-back'));
    expect(screen.getByTestId('scenario-list')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('scenario-row-summary-card-contract'));
    expect(screen.queryByTestId('plan-card')).not.toBeInTheDocument();
  });
});

describe('SseConsolePanel · 事件调试台', () => {
  it('初始空态提示可见', () => {
    render(<SseConsolePanel />);
    expect(screen.getByTestId('event-stream')).toBeInTheDocument();
    expect(screen.getByText(/暂无记录/)).toBeInTheDocument();
  });

  it('回放后轮次与帧可见；ping/未知/畸形帧照常展示（禁炸）', () => {
    const hostile = [
      ': ping\n\n',
      'data: {"type":"token","text":"事件帧"}\n\n',
      'data: {"type":"what_is_this","x":1}\n\n',
      'data: {"broken"\n\n',
      'data: {"type":"done"}\n\n',
    ].join('');
    replayRawStream(hostile, '回放 · 异常帧', sseRecorder, { chunkDelayMs: 0 });
    render(<SseConsolePanel />);
    const turn = screen.getAllByTestId('sse-turn-replay')[0];
    expect(turn).toBeInTheDocument();
    // 展开轮次
    fireEvent.click(within(turn).getByRole('button', { name: /回放 · 异常帧/ }));
    expect(within(turn).getByTestId('sse-frame-comment-1')).toBeInTheDocument();
    expect(within(turn).getByTestId('sse-frame-token-2')).toBeInTheDocument();
    expect(within(turn).getByTestId('sse-frame-unknown-3')).toBeInTheDocument();
    expect(within(turn).getByTestId('sse-frame-malformed-4')).toBeInTheDocument();
    expect(within(turn).getByTestId('sse-frame-done-5')).toBeInTheDocument();
  });

  it('帧行展开可见 payload JSON 与原始帧文本', () => {
    replayRawStream(
      'data: {"type":"uiHint","card":{"type":"plan_card","data":[]}}\n\ndata: {"type":"done"}\n\n',
      '回放 · 展开',
      sseRecorder,
      { chunkDelayMs: 0 },
    );
    render(<SseConsolePanel />);
    const turn = screen.getAllByTestId('sse-turn-replay')[0];
    fireEvent.click(within(turn).getByRole('button', { name: /回放 · 展开/ }));
    fireEvent.click(within(turn).getByTestId('sse-frame-uiHint-1'));
    const frameBox = within(turn).getByTestId('sse-frame-box-uiHint-1');
    expect(within(frameBox).getAllByText(/plan_card/).length).toBeGreaterThan(0);
    expect(within(frameBox).getByText(/receivedAt/)).toBeInTheDocument();
  });

  it('清空按钮清掉全部轮次', () => {
    replayRawStream('data: {"type":"done"}\n\n', '回放', sseRecorder, { chunkDelayMs: 0 });
    render(<SseConsolePanel />);
    fireEvent.click(screen.getByTestId('sse-clear'));
    expect(screen.getByText(/暂无记录/)).toBeInTheDocument();
  });
});
