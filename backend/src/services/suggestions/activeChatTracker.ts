/**
 * Active Chat Tracker - 用户级活跃对话流计数（issue #39 B6）
 *
 * 建议缓存空闲重算任务与对话请求隔离的判定依据：chatController 的 SSE 流
 * 生命周期经 {@link withChatTracking} 包裹（begin/end 引用计数），空闲调度器
 * 在重算前查询 {@link isChatActive} —— 对话进行中重算任务延后，绝不抢占
 * chat SSE 流（B6 验证门 c）。
 *
 * 计数而非布尔：同一用户可能并发多条 SSE（多窗口/多设备），全部关闭才算空闲。
 */

import type { AgentEvent } from "shared/contracts";

const activeCounts = new Map<string, number>();

/** 一条 chat SSE 流开始（chatController 进入 streamAgentSSE 时调用） */
export function beginChatStream(userId: string): void {
  activeCounts.set(userId, (activeCounts.get(userId) ?? 0) + 1);
}

/** 一条 chat SSE 流结束（正常完成/中断/异常都会走到；防御性钳到 0） */
export function endChatStream(userId: string): void {
  const current = activeCounts.get(userId) ?? 0;
  if (current <= 1) {
    activeCounts.delete(userId);
  } else {
    activeCounts.set(userId, current - 1);
  }
}

/** 该用户当前是否有进行中的 chat SSE 流 */
export function isChatActive(userId: string): boolean {
  return (activeCounts.get(userId) ?? 0) > 0;
}

/** 当前活跃用户数（监控/测试用） */
export function activeChatUserCount(): number {
  return activeCounts.size;
}

/**
 * 包裹 AgentEvent 异步迭代器：消费期间标记用户对话活跃，迭代结束
 * （return/throw/break 触发 finally）自动解除。流式语义零改动 ——
 * 只是给调度器一个可观察的窗口标记。
 */
export async function* withChatTracking(
  userId: string,
  events: AsyncIterable<AgentEvent>,
): AsyncIterable<AgentEvent> {
  beginChatStream(userId);
  try {
    yield* events;
  } finally {
    endChatStream(userId);
  }
}

/** 测试复位（生产代码禁用） */
export function __resetChatTrackerForTests(): void {
  activeCounts.clear();
}
