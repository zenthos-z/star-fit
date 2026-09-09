/**
 * Admin Agent Client — 管理界面专用的 Agent SSE 客户端
 *
 * 与 App 端的区别（仅身份层，传输/解析层 100% 复用 `parseSSEChunk`）：
 * - `X-User-Id` = **管理员正在查看的目标用户**（Agent 的 MCP 写工具按此注入
 *   UUID，因此「让 Agent 改画像」会真实写到该用户头上）。
 * - `threadId` = `admin-console-<targetUserId>`：与 App 端对话线程完全隔离，
 *   避免管理台调试对话污染用户在 App 里的 checkpoint（E2E 踩过的坑）。
 *
 * 后端契约（chatController.postChat）：POST /api/chat → SSE
 * `token | uiHint | done | error | thinking`。
 *
 * @module adminAgentClient
 */

import { parseSSEChunk } from '../../../v2/services/agent/sseAgentClient';
import type { AgentEvent } from 'shared/contracts';
import { API_BASE } from '../services/geminiService';
import { getAccessToken } from '../../../services/geminiService';

export interface AdminChatRequest {
  /** 目标用户 UUID（Agent 的读写都以他为对象） */
  targetUserId: string;
  message: string;
  /** 管理台固定走 chat 场景（update_profile 由 Agent 自己按语义触发） */
  scenario?: 'chat' | 'plan' | 'workout_complete' | 'update_profile';
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'network error';
}

/**
 * 发起一轮管理台 Agent 对话，流式产出 AgentEvent。
 * 用法与 App 端 `agentClient.chat` 一致：`for await (const ev of ...)`。
 */
export async function* adminAgentChat(req: AdminChatRequest): AsyncIterable<AgentEvent> {
  const threadId = `admin-console-${req.targetUserId}`;
  let response: Response;
  try {
    // ★ admin 场景不共用 App 端 getHeaders()：它从 localStorage.starfit_user_id
    // 取身份，admin 页面没走 App 登录会拿到兜底 'global'，而 /api/chat 的
    // X-User-Id 会被后端 getUserId() 当作 uuid 数据库 key 直接入 SQL（'global'
    // → PostgreSQL invalid input syntax for type uuid，实测踩坑）。身份唯一
    // 真源 = 正在被查看的目标用户。
    response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': encodeURIComponent(req.targetUserId),
        ...(getAccessToken() ? { 'X-Access-Token': getAccessToken()! } : {}),
      },
      body: JSON.stringify({
        userId: req.targetUserId,
        message: req.message,
        scenario: req.scenario ?? 'chat',
        threadId,
      }),
    });
  } catch (err) {
    yield { type: 'error', error: { code: 'INTERNAL', message: toErrorMessage(err) } };
    return;
  }

  if (!response.ok || !response.body) {
    yield { type: 'error', error: { code: 'INTERNAL', message: `HTTP ${response.status} @ ${API_BASE}/chat` } };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSEChunk(buffer);
      buffer = parsed.remainder;
      for (const ev of parsed.events) yield ev;
    }
    buffer += decoder.decode();
    const tail = parseSSEChunk(buffer + '\n\n');
    for (const ev of tail.events) yield ev;
  } catch (err) {
    yield { type: 'error', error: { code: 'INTERNAL', message: toErrorMessage(err) } };
  }
}
