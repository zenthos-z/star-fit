/**
 * Profile Proposals Contracts (画像确认纯程序化写入 — B5 / issue #37)
 *
 * POST /api/profile/apply-proposals 的请求/响应契约：前端把 Agent 在提案轮
 * （profile_update_confirm 卡片）算好的最终值原样回传，后端确定性写入
 * profile_dynamic —— 全程无 LLM 参与，毫秒级完成。
 *
 * AI 边界红线：Agent 只在提案轮产出「判断型」最终值（severity / total_score /
 * 锚点对象）；时间盖章（expire_at / logged_at / last_assessed）与合并算术
 * 全部由 Service 侧完成。
 *
 * 写入语义（按 field）：
 *  - load_anchors      value = 锚点 map 片段 → 按_key合并（只覆盖提案里的键）
 *  - active_limitations value = 新条目数组 → 追加（同 part 同 severity 去重）
 *  - recovery_state    value = 完整对象 → 整体替换
 *  - memories          value = { key: content } map → 按_key合并
 *
 * @version 1.0.0
 * @created 2026-09-28
 */

import { z } from 'zod';

// ============================================================================
// 请求 (Request)
// ============================================================================

/** 画像动态字段四态（与 profile-update-reviewer 技能的 proposals[].field 同源） */
export const ProfileProposalFieldSchema = z.enum([
  'load_anchors',
  'active_limitations',
  'recovery_state',
  'memories',
]);

export type ProfileProposalField = z.infer<typeof ProfileProposalFieldSchema>;

/** 单条提案回传：field + 该字段的最终值（Agent 提案轮已算好） */
export const ProfileApplyProposalSchema = z.object({
  field: ProfileProposalFieldSchema,
  /** 最终值，形状由后端 Service 按 field 深校验（本契约层不约束） */
  value: z.unknown(),
});

export type ProfileApplyProposal = z.infer<typeof ProfileApplyProposalSchema>;

export const ProfileApplyRequestSchema = z.object({
  proposals: z.array(ProfileApplyProposalSchema).min(1).max(20),
});

export type ProfileApplyRequest = z.infer<typeof ProfileApplyRequestSchema>;

// ============================================================================
// 响应 (Response)
// ============================================================================

export const ProfileApplyResponseSchema = z.object({
  ok: z.boolean(),
  user_id: z.string(),
  /** 成功写入的字段名列表（snake_case，与 profile_dynamic 键一致） */
  applied_fields: z.array(z.string()),
});

export type ProfileApplyResponse = z.infer<typeof ProfileApplyResponseSchema>;

// ============================================================================
// 待续意图 (Pending Intent — 卡片携带，前端据此续跑主线)
// ============================================================================

/**
 * profile_update_confirm 卡片 data.pending_intent：
 * Agent 在弹卡同一轮记录的用户原始意图。前端写入成功后把该意图组装成
 * 续跑指令发给 Agent（新一轮对话输入），Agent 无需用户再催一遍。
 * 无主任务的触发（如 day_end 收尾）省略该字段。
 */
export const ProfilePendingIntentSchema = z.object({
  /** 用户原话（触发本轮画像更新的原始请求） */
  user_message: z.string().min(1),
  /** 场景摘要：写入完成后 Agent 该继续做什么（一句话） */
  summary: z.string().min(1),
  /** 续跑轮 scenario（按原始意图选；默认 chat） */
  scenario: z.enum(['chat', 'plan']).optional(),
});

export type ProfilePendingIntent = z.infer<typeof ProfilePendingIntentSchema>;
