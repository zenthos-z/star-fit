/**
 * T1 fixture 注册表（issue #53）——src/debug/fixtures 的唯一出口。
 *
 * 场景分组（group）对应调试台「卡片场景」页的分区：
 *  - chat-card               后端校验回路认可的对话卡型（backend UIHintSchema 全覆盖）
 *  - chat-card-frontend-only 仅前端有渲染组件的卡型（survey_success / hitl_confirm）
 *  - execution-card          执行层动作卡（ExerciseRenderer exercise 分支）
 */
import type { DebugScenario, SseStreamFixture } from './types';
import { CHAT_CARD_SCENARIOS } from './chatCards';
import { EXECUTION_CARD_SCENARIOS } from './executionCards';
import { SSE_STREAM_FIXTURES } from './sseStreams';

export const DEBUG_SCENARIOS: DebugScenario[] = [
  ...CHAT_CARD_SCENARIOS,
  ...EXECUTION_CARD_SCENARIOS,
];

export const SSE_STREAMS: SseStreamFixture[] = SSE_STREAM_FIXTURES;

export const SCENARIO_GROUPS: Array<{
  key: DebugScenario['group'];
  label: string;
  hint: string;
}> = [
  { key: 'chat-card', label: '对话卡片 · 后端卡型', hint: '过 backend UIHintSchema 校验的线上真源形态' },
  { key: 'chat-card-frontend-only', label: '对话卡片 · 前端专属', hint: '后端不产出 / 已拉黑，仅前端渲染组件存在' },
  { key: 'execution-card', label: '执行卡片 · 动作卡', hint: 'ExerciseRenderer exercise 分支 → 执行插件' },
];

export function findScenario(id: string): DebugScenario | undefined {
  return DEBUG_SCENARIOS.find(s => s.id === id);
}

export type { DebugScenario, SseStreamFixture };
