/**
 * T1 调试 fixture 类型（issue #53）。
 *
 * 一个 DebugScenario = 一个可一键加载的预置 UI 场景：
 *  - chat-card   ：走 uiHint 多态回路——数据直灌 ExerciseRenderer（PluginRegistry
 *                  按 uiHint.type 分发），与真实聊天气泡挂卡的渲染链路完全同源，
 *                  零 Agent 调用。
 *  - execution-card：走 exercise 分支——ExerciseRenderer 按 exercise.type 分发到
 *                  执行层插件卡（ResistanceCard / CardioCard / …）。
 *
 * `wireCard` 字段是「后端 Agent 真正会发到线上」的 uiHint 卡片原始形态，
 * fixtures.schema.test.ts 用 backend 的 UIHintSchema（校验回路的同一份 Zod）
 * 逐一验证——保证 fixture 不是「前端自嗨形态」，而是过得了现有校验的真源形态。
 */

/** 后端校验回路覆盖的卡型（backend UIHintSchema 的判别键） */
export type BackendValidatedCardType =
  | 'plan_card'
  | 'weekly_plan'
  | 'summary_card'
  | 'survey_card'
  | 'deviation_card'
  | 'audit_complete'
  | 'profile_update_confirm';

/** 仅前端存在渲染组件、后端不产出（或已拉黑）的卡型 */
export type FrontendOnlyCardType = 'survey_success' | 'hitl_confirm';

export interface DebugScenario {
  /** 稳定 id（测试与 URL 锚点用） */
  id: string;
  group: 'chat-card' | 'chat-card-frontend-only' | 'execution-card';
  /** 场景列表里的一行标题 */
  label: string;
  /** 一句话说明预览的是什么 */
  description: string;
  /** 卡片上方的 AI 气泡正文（模拟真实聊天上下文；可缺省） */
  bubbleText?: string;
  /**
   * uiHint 直灌载荷：wireCard 原样交给 ExerciseRenderer。
   * type 值 = PluginRegistry 分发键 = 后端线上帧的 card.type。
   */
  wireCard?: {
    type: BackendValidatedCardType | FrontendOnlyCardType;
    data: unknown;
    [key: string]: unknown;
  };
  /** execution-card 专用：动作卡数据（ExerciseRenderer exercise 分支） */
  exercise?: unknown;
  /** wireCard 是否受后端 UIHintSchema 约束（前端专属卡型为 false） */
  backendValidated?: boolean;
}

/** SSE 回放样例：一段原始 wire 字节流 + 说明（喂给调试台同一个解析-记录管线） */
export interface SseStreamFixture {
  id: string;
  label: string;
  description: string;
  /** 原始 SSE 文本（含 data: 帧、`: ping` 注释帧、异常帧），按 chunk 喂入 */
  raw: string;
}
