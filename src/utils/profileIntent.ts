/**
 * Profile Intent Utils (画像确认链路 — B5 / issue #37)
 *
 * 待续意图（pending_intent）的前端组装：画像确定性写入完成后，把 Agent
 * 在弹卡轮记录的用户原始意图包装成「续跑指令」作为新一轮对话输入发给
 * Agent，让主线自动恢复（不用用户再催一遍）。
 *
 * 契约真源：shared/contracts/profile-proposals.ts（ProfilePendingIntent）。
 */

import type { ProfilePendingIntent } from 'shared/contracts';

/** 续跑指令标记：后端 systemPrompt / profile-update-reviewer 技能据此识别
 *  「画像已写入、直接续跑」语义（不重提案、不重写入）。 */
export const PROFILE_RESUME_MARKER = '（系统续跑指令）';

/**
 * 组装续跑指令文本：告知写入已完成 + 用户原始请求原话 + 任务摘要。
 * 保持简短——Agent 拥有完整对话上下文，知道它自己提案过什么。
 */
export function buildProfileResumePrompt(intent: ProfilePendingIntent): string {
  return [
    `${PROFILE_RESUME_MARKER}用户已点击「确认更新」，确认的画像提案已由系统直接写入数据库——画像已是最新的，本轮不要重新提案画像更新，也不要调用 update_profile。`,
    `请继续完成用户的原始请求：「${intent.user_message}」`,
    `任务摘要：${intent.summary}`,
  ].join('\n');
}

/**
 * 宽松解析卡片 data.pending_intent（uiHint 是持久化 JSON，历史卡片可能缺字段）。
 * 形态不完整（无 user_message / summary）→ 返回 null（视为无待续意图，不续跑）。
 */
export function parsePendingIntent(raw: unknown): ProfilePendingIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const userMessage = typeof r.user_message === 'string' ? r.user_message.trim() : '';
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!userMessage || !summary) return null;
  const scenario = r.scenario === 'plan' ? ('plan' as const) : ('chat' as const);
  return { user_message: userMessage, summary, scenario };
}
