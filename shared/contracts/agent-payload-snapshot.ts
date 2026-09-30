/**
 * Agent 交付载荷快照契约 —— issue #96（Agent 输入可视化页）。
 *
 * 定位：训练后审计（非实时流）。原始会话落库（sessions.raw_json 写链）时，
 * 用与 load_history **同一套** 归一化 + 硬校验（agent-delivery.ts）冻结一份
 * 「交付时点」快照：normalize 后的完整 payload + 校验结果 + 预处理标注。
 * 可视化页（调试台 Payload 审计 tab）经列表/详情 API 回看，解决
 * 「黑盒不知道喂了什么」的排障需求。
 *
 * 红线（#88 v2 spec · 分册4 §5）：
 *   - 快照是只读审计数据，**禁止任何修复/改写**——快照即交付时点的真实样子
 *     （校验失败也原样冻结，含失败明细）；
 *   - payload 构造复用 agent-delivery 单一真源，不新造第二套口径。
 *
 * 三块 JSON 的语义边界：
 *   - `payload`     交付候选载荷本体：归一成功 = normalize 后形态；
 *                   连归一都不行（unnormalizable）= 原始输入原样冻结。
 *   - `validation`  交付硬校验结果（过/拒 + 错误码 + 原因）。
 *   - `preprocess`  预处理标注（非载荷本体）：逐组 timestamp 来源
 *                   （explicit / completed_at / inferred）与 status 归一轨迹，
 *                   供「预处理结果」分区对账采集→预处理哪一环出错。
 */

import { z } from 'zod';
import { AgentDeliverySessionSchema } from './agent-delivery.js';

// ============================================================================
// 校验结果
// ============================================================================

/** 交付校验结果码：ok = 通过；其余 = agent-delivery 错误码原样透传 */
export const AgentPayloadValidationCodeSchema = z.enum([
  'ok',
  'unnormalizable',
  'schema',
  'reference',
  'set_indices',
  'timestamp_order',
]);

export type AgentPayloadValidationCode = z.infer<
  typeof AgentPayloadValidationCodeSchema
>;

/**
 * 快照冻结的交付校验结果。
 * `ok=false` 时 code/reason 为拒付依据；`reference_check='skipped'`
 * 表示快照时动作库全集不可读（与 load_history 同策略：跳过引用检查并留痕）。
 */
export const AgentPayloadValidationSchema = z.object({
  ok: z.boolean(),
  code: AgentPayloadValidationCodeSchema,
  reason: z.string().nullable(),
  /** applied = 引用完整性已检；skipped = 快照时动作库全集不可读，仅结构校验 */
  reference_check: z.enum(['applied', 'skipped']),
  checked_at: z.string().datetime(),
});

export type AgentPayloadValidation = z.infer<typeof AgentPayloadValidationSchema>;

// ============================================================================
// 预处理标注（载荷本体之外的推导轨迹）
// ============================================================================

/** 逐组 timestamp 推算来源（agent-delivery normalizeSet 优先级的读取侧标注） */
export const AgentSetTimestampSourceSchema = z.enum([
  'explicit', // 原始组自带合法 ISO timestamp
  'completed_at', // 原始组无 timestamp、有 completedAt → 转 ISO
  'inferred', // 两者皆无 → startTime + (index+1) × 60s 推算锚点
]);

export type AgentSetTimestampSource = z.infer<
  typeof AgentSetTimestampSourceSchema
>;

/** 单组预处理标注：timestamp 来源 + status 归一轨迹（原始值 → 契约枚举） */
export const AgentSetPreprocessNoteSchema = z.object({
  exercise_index: z.number().int().min(0),
  set_index: z.number().int().min(0),
  timestamp_source: AgentSetTimestampSourceSchema,
  /** 归一后的契约 status（unknown/planned/completed/skipped） */
  status_normalized: z.enum(['unknown', 'planned', 'completed', 'skipped']),
  /** 归一前的原始 status 值（UPPERCASE 协议值 / undefined / completed 布尔），原样记录 */
  status_original: z.unknown().nullable(),
});

export type AgentSetPreprocessNote = z.infer<typeof AgentSetPreprocessNoteSchema>;

// ============================================================================
// 快照行（API 载荷形态，snake_case 与数据库列一致）
// ============================================================================

/** 列表行（摘要，不含 payload 本体） */
export const AgentPayloadSnapshotListRowSchema = z.object({
  session_id: z.string().min(1),
  start_time: z.string().datetime().nullable(),
  end_time: z.string().datetime().nullable(),
  title: z.string().nullable(),
  exercise_count: z.number().int().min(0),
  validation_passed: z.boolean(),
  validation_code: AgentPayloadValidationCodeSchema,
  snapshotted_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type AgentPayloadSnapshotListRow = z.infer<
  typeof AgentPayloadSnapshotListRowSchema
>;

/** 详情行（完整快照：payload + 校验 + 预处理标注） */
export const AgentPayloadSnapshotDetailSchema = z.object({
  session_id: z.string().min(1),
  user_id: z.string().min(1),
  start_time: z.string().datetime().nullable(),
  end_time: z.string().datetime().nullable(),
  title: z.string().nullable(),
  exercise_count: z.number().int().min(0),
  validation_passed: z.boolean(),
  validation: AgentPayloadValidationSchema,
  /** 交付候选载荷（归一成功=AgentDeliverySession；unnormalizable=原始输入原样） */
  payload: z.unknown(),
  preprocess: z.array(AgentSetPreprocessNoteSchema),
  snapshotted_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type AgentPayloadSnapshotDetail = z.infer<
  typeof AgentPayloadSnapshotDetailSchema
>;

/** 归一成功时 payload 的窄化视图（运行时判别用，不做二次校验） */
export type AgentPayloadDetailNormalized = Omit<
  AgentPayloadSnapshotDetail,
  'payload'
> & {
  payload: z.infer<typeof AgentDeliverySessionSchema>;
};

// ============================================================================
// API 响应（GET /api/debug/agent-payloads[/(:sessionId)]）
// ============================================================================

export const AgentPayloadListResponseSchema = z.object({
  snapshots: z.array(AgentPayloadSnapshotListRowSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

export type AgentPayloadListResponse = z.infer<
  typeof AgentPayloadListResponseSchema
>;
