/**
 * Agent 交付边界硬校验 —— issue #97（红线3「无缺漏无错误」落地）。
 *
 * 职责（#88 v2 spec 三红线 · 分册4 §4 预处理规则底线）：
 *   喂 Agent 的会话数据在交付边界过两道门，坏数据抛错拒交付，不许静默进 Agent：
 *   1. 全字段 Zod 校验（AgentDeliverySessionSchema，契约字段逐项强校验，
 *      未知字段透传保留——不丢数据，但契约字段必须合法）；
 *   2. 关系引用完整性：
 *      - exerciseId 引用存在（exercises[].exercise_id ∈ 已知动作库 id 全集）
 *      - sets 序号连续（index 严格等于 0..n-1）
 *      - 时间戳非倒序（同一动作内 timestamp 单调不减）
 *
 * 存量兼容（组时间戳必填化的读侧配套）：
 *   sessions.raw_json 的存量会话（legacy Session 形态）经
 *   normalizeSessionForAgentDelivery 归一后必然满足契约 timestamp 必填——
 *   无时间戳旧数据的推算规则（推算值仅保证时序锚定，不虚构精度）：
 *
 *     timestamp := set.timestamp                 当组已携带合法 ISO 时间戳
 *              := completedAt 转 ISO 8601 UTC    当组携带 completedAt（epoch ms）
 *              := startTime + (index+1) × 60s    当组无任何完成时刻（存量/计划组）
 *
 *   60s = 产品默认组间休息节奏（App.tsx DEFAULT_REST_TIME，分册5 §4.3 数据链
 *   同源缺省）。推算锚点间距恒等于默认节奏 → 由其导出的间隔不是测量值；
 *   休息推断仍以真实 completedAt / restEndTime 链为准（前端 workoutSummary
 *   对缺 completedAt 的段直接丢弃，不采推算值）。
 *
 * 注意（App.tsx 现状）：completedAt 仅力量类组落值，有氧/户外组至今无完成
 * 时刻 → 交付时走推算锚点（采集端统一落值属采集 UI 批，本批不动 UI）。
 *
 * 消费方：backend mcpTools load_history（live raw 行门卫）；
 * 单测：src/__tests__/agentDeliveryContract.test.ts（root vitest，源码别名直读）。
 */

import { z } from 'zod';
import { normalizeExerciseActionType } from './card-types.js';
import { ExerciseSetEntrySchema } from './exercise-set.js';
import { parseJSONSafe } from './validation.js';

// ============================================================================
// 推算规则常量
// ============================================================================

/** 组时间戳推算步长（ms）= 60s 默认组间休息节奏（分册5 §4.3 同源缺省） */
export const AGENT_SET_TIMESTAMP_STEP_MS = 60_000;

// ============================================================================
// 错误类型
// ============================================================================

export type AgentDeliveryErrorCode =
  | 'unnormalizable' // 原始行连基础形状都不具备（无 id / 无开始时间 / 结构坏）
  | 'schema' // 全字段 Zod 校验失败
  | 'reference' // exerciseId 引用不存在于动作库
  | 'set_indices' // sets 序号不连续
  | 'timestamp_order'; // 组时间戳倒序

/** 交付边界硬校验错误：抛出即拒交付（调用方逐会话捕获，扣下该条并上浮原因） */
export class AgentDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code: AgentDeliveryErrorCode,
    public readonly sessionId: string | null,
  ) {
    super(message);
    this.name = 'AgentDeliveryError';
  }
}

// ============================================================================
// 交付 Schema（契约字段强校验 + 未知字段透传）
// ============================================================================

/**
 * 交付组条目 = 契约 ExerciseSetEntrySchema + 透传存量附加键
 * （heartRate / completed / id 等——校验契约字段，不丢弃非契约数据）。
 */
export const AgentDeliverySetSchema = ExerciseSetEntrySchema.passthrough();

export type AgentDeliverySet = z.infer<typeof AgentDeliverySetSchema>;

/**
 * 交付动作条目：exercise_id（动作库引用）+ name + 归一 type + 契约组序列。
 * 透传 primaryMuscles / metadata 等存量键。
 */
export const AgentDeliveryExerciseSchema = z
  .object({
    exercise_id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum([
      'resistance',
      'unilateral',
      'bodyweight',
      'assisted',
      'isometric',
      'cardio',
      'flexibility',
      'heavy_weight',
      'rep_training',
      'outdoor',
      'hiit',
      'unknown',
    ]),
    sets: z.array(AgentDeliverySetSchema),
  })
  .passthrough();

export type AgentDeliveryExercise = z.infer<typeof AgentDeliveryExerciseSchema>;

/**
 * 交付会话条目：顶层字段与 load_history 既有交付形态一致
 * （session_id / start_time / end_time / title / exercises / stats / notes）。
 */
export const AgentDeliverySessionSchema = z
  .object({
    session_id: z.string().min(1),
    start_time: z.string().datetime(),
    end_time: z.string().datetime().optional(),
    title: z.string().optional(),
    exercises: z.array(AgentDeliveryExerciseSchema),
    stats: z.record(z.string(), z.any()).optional(),
    notes: z.string().max(2000).optional(),
  })
  .passthrough();

export type AgentDeliverySession = z.infer<typeof AgentDeliverySessionSchema>;

// ============================================================================
// 归一化（存量兼容读取入口）
// ============================================================================

/** 宽松读取原始会话行基础字段（raw_json 可能是对象或 JSON 字符串） */
const RawSessionInputSchema = z.object({
  id: z.unknown().optional(),
  session_id: z.unknown().optional(),
  startTime: z.unknown().optional(),
  start_time: z.unknown().optional(),
  endTime: z.unknown().optional(),
  end_time: z.unknown().optional(),
  title: z.unknown().optional(),
  exercises: z.unknown().optional(),
  stats: z.unknown().optional(),
  notes: z.unknown().optional(),
});

/** epoch ms / ISO 字符串 → epoch ms；不可解析返回 null */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function toIsoOrUndefined(value: unknown): string | undefined {
  const ms = toEpochMs(value);
  return ms === null ? undefined : new Date(ms).toISOString();
}

/** 存量 status 值（UPPERCASE 协议值 / completed 布尔）→ 契约小写枚举 */
function normalizeSetStatus(raw: Record<string, unknown>): z.infer<typeof ExerciseSetEntrySchema>['status'] {
  const status = raw.status;
  if (typeof status === 'string') {
    const lower = status.toLowerCase();
    if (lower === 'completed') return 'completed';
    if (lower === 'skipped') return 'skipped';
    if (lower === 'planned' || lower === 'active') return 'planned'; // ACTIVE=执行中，未完成归 planned
    return 'unknown';
  }
  if (raw.completed === true) return 'completed';
  return 'unknown';
}

/**
 * 推算组时间戳（epoch ms）：startTime + (index+1) × 60s。
 * 导出供推算规则单测与文档对拍；调用方保证 startTimeMs 有限。
 */
export function inferSetTimestampMs(setIndex: number, sessionStartTimeMs: number): number {
  return sessionStartTimeMs + (setIndex + 1) * AGENT_SET_TIMESTAMP_STEP_MS;
}

/**
 * 归一单组：按推算规则解析 timestamp，补 index / status 契约字段。
 * @throws AgentDeliveryError('unnormalizable') 当 completedAt 存在但不可解析（坏数据 ≠ 缺失）
 */
function normalizeSet(
  raw: unknown,
  index: number,
  sessionStartTimeMs: number,
  sessionId: string,
): AgentDeliverySet {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentDeliveryError(
      `exercises.sets[${index}] 不是对象`,
      'unnormalizable',
      sessionId,
    );
  }
  const set = { ...(raw as Record<string, unknown>) };

  // timestamp 解析优先级：显式 ISO timestamp > completedAt > 推算锚点
  let timestampIso: string | undefined;
  if (typeof set.timestamp === 'string' && !Number.isNaN(Date.parse(set.timestamp))) {
    timestampIso = new Date(Date.parse(set.timestamp)).toISOString();
  } else if (set.completedAt !== undefined && set.completedAt !== null) {
    const ms = toEpochMs(set.completedAt);
    if (ms === null) {
      throw new AgentDeliveryError(
        `exercises.sets[${index}].completedAt 存在但不可解析: ${JSON.stringify(set.completedAt)}`,
        'unnormalizable',
        sessionId,
      );
    }
    timestampIso = new Date(ms).toISOString();
  }
  if (timestampIso === undefined) {
    timestampIso = new Date(inferSetTimestampMs(index, sessionStartTimeMs)).toISOString();
  }

  return {
    ...set,
    index,
    status: normalizeSetStatus(set),
    timestamp: timestampIso,
  } as AgentDeliverySet;
}

/**
 * 归一会话：sessions.raw_json 存量形态 → Agent 交付契约形态。
 * - 组 index 按数组位次补齐（0 起）；status 归一小写枚举
 * - 无完成时刻的组按推算规则填充 timestamp（见模块头）
 * - type 经 normalizeExerciseActionType 归一（weight_only 等漂移值兼容读取）
 * - 非契约字段全部透传保留（无缺漏）
 * @throws AgentDeliveryError('unnormalizable') 基础形状不具备（无 id / 无开始时间 / 结构坏）
 */
export function normalizeSessionForAgentDelivery(raw: unknown): AgentDeliverySession {
  const parsedRaw = typeof raw === 'string' ? parseJSONSafe<unknown>(raw, 'agent-delivery raw_json') : raw;
  if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
    throw new AgentDeliveryError('raw_json 非对象', 'unnormalizable', null);
  }

  const input = RawSessionInputSchema.parse(parsedRaw);
  const sessionIdRaw = input.id ?? input.session_id;
  if (typeof sessionIdRaw !== 'string' || sessionIdRaw.length === 0) {
    throw new AgentDeliveryError('会话缺少 id/session_id', 'unnormalizable', null);
  }
  const sessionId = sessionIdRaw;

  const startMs = toEpochMs(input.startTime ?? input.start_time);
  if (startMs === null) {
    throw new AgentDeliveryError(
      `会话缺少可解析的开始时间 (startTime/start_time): ${JSON.stringify(input.startTime ?? input.start_time)}`,
      'unnormalizable',
      sessionId,
    );
  }

  const source = parsedRaw as Record<string, unknown>;
  const rawExercises = source.exercises;
  if (rawExercises !== undefined && rawExercises !== null && !Array.isArray(rawExercises)) {
    throw new AgentDeliveryError('exercises 存在但不是数组', 'unnormalizable', sessionId);
  }

  const exercises: AgentDeliveryExercise[] = ((rawExercises as unknown[]) ?? []).map(
    (rawEx, exIdx) => {
      if (!rawEx || typeof rawEx !== 'object' || Array.isArray(rawEx)) {
        throw new AgentDeliveryError(
          `exercises[${exIdx}] 不是对象`,
          'unnormalizable',
          sessionId,
        );
      }
      const ex = rawEx as Record<string, unknown>;
      const exerciseId = ex.id ?? ex.libraryId ?? ex.exerciseId;
      if (typeof exerciseId !== 'string' || exerciseId.length === 0) {
        throw new AgentDeliveryError(
          `exercises[${exIdx}] 缺少动作库引用 (id/libraryId/exerciseId)`,
          'unnormalizable',
          sessionId,
        );
      }
      if (typeof ex.name !== 'string' || ex.name.length === 0) {
        throw new AgentDeliveryError(
          `exercises[${exIdx}] 缺少 name`,
          'unnormalizable',
          sessionId,
        );
      }
      const rawSets = ex.sets;
      if (rawSets !== undefined && rawSets !== null && !Array.isArray(rawSets)) {
        throw new AgentDeliveryError(
          `exercises[${exIdx}].sets 存在但不是数组`,
          'unnormalizable',
          sessionId,
        );
      }
      const sets = ((rawSets as unknown[]) ?? []).map((s, setIdx) =>
        normalizeSet(s, setIdx, startMs, sessionId),
      );

      return {
        ...ex,
        exercise_id: exerciseId,
        type: normalizeExerciseActionType(String(ex.type ?? 'unknown')),
        sets,
      } as AgentDeliveryExercise;
    },
  );

  const normalized: Record<string, unknown> = {
    ...source,
    session_id: sessionId,
    start_time: new Date(startMs).toISOString(),
    exercises,
  };
  const endIso = toIsoOrUndefined(input.endTime ?? input.end_time);
  if (endIso !== undefined) {
    normalized.end_time = endIso;
  } else {
    delete normalized.end_time;
  }
  return normalized as AgentDeliverySession;
}

// ============================================================================
// 硬校验（红线3：坏数据抛错拒交付）
// ============================================================================

export interface AgentDeliveryValidationOptions {
  /**
   * 动作库 id 全集（关系引用完整性判据）。
   * 缺省 = 跳过引用检查（仅校验结构完整性）——load_history 生产接线必传。
   */
  knownExerciseIds?: ReadonlySet<string>;
}

/**
 * 交付硬校验：全字段 Zod + 关系引用完整性。
 * 通过返回 void；失败抛 AgentDeliveryError（拒交付）。
 */
export function validateAgentSessionDelivery(
  session: unknown,
  options: AgentDeliveryValidationOptions = {},
): void {
  const probe = AgentDeliverySessionSchema.safeParse(session);
  if (!probe.success) {
    const issues = probe.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    const rawSid = (session as { session_id?: unknown } | null | undefined)?.session_id;
    const sid = typeof rawSid === 'string' ? rawSid : null;
    throw new AgentDeliveryError(`Zod 全字段校验失败: ${issues}`, 'schema', sid);
  }
  const valid = probe.data;
  const sessionId = valid.session_id;

  // 关系引用完整性 ①：exerciseId 引用存在
  if (options.knownExerciseIds) {
    for (const ex of valid.exercises) {
      if (!options.knownExerciseIds.has(ex.exercise_id)) {
        throw new AgentDeliveryError(
          `动作引用不在动作库内: exercise_id=${ex.exercise_id} (name=${ex.name})`,
          'reference',
          sessionId,
        );
      }
    }
  }

  for (const ex of valid.exercises) {
    // 关系引用完整性 ②：sets 序号连续（0..n-1）
    for (let i = 0; i < ex.sets.length; i++) {
      if (ex.sets[i].index !== i) {
        throw new AgentDeliveryError(
          `组序号不连续: exercises[name=${ex.name}].sets[${i}].index=${ex.sets[i].index}（期望 ${i}）`,
          'set_indices',
          sessionId,
        );
      }
    }
    // 关系引用完整性 ③：时间戳非倒序（单调不减）
    for (let i = 1; i < ex.sets.length; i++) {
      if (Date.parse(ex.sets[i].timestamp) < Date.parse(ex.sets[i - 1].timestamp)) {
        throw new AgentDeliveryError(
          `组时间戳倒序: exercises[name=${ex.name}].sets[${i - 1}].timestamp=${ex.sets[i - 1].timestamp} > sets[${i}].timestamp=${ex.sets[i].timestamp}`,
          'timestamp_order',
          sessionId,
        );
      }
    }
  }
}

/** 归一 + 硬校验一步到位（load_history live 行的标准通道） */
export function normalizeAndValidateAgentSession(
  raw: unknown,
  options: AgentDeliveryValidationOptions = {},
): AgentDeliverySession {
  const normalized = normalizeSessionForAgentDelivery(raw);
  validateAgentSessionDelivery(normalized, options);
  return normalized;
}

// ============================================================================
// 门卫助手（逐会话拒付，聚合原因——单条坏数据不炸整批）
// ============================================================================

export interface AgentDeliveryRejection {
  session_id: string | null;
  code: AgentDeliveryErrorCode;
  reason: string;
}

export interface AgentDeliveryGateResult {
  delivered: AgentDeliverySession[];
  rejected: AgentDeliveryRejection[];
}

/**
 * 批量门卫：逐行归一 + 硬校验，坏行扣下并把原因上浮（拒付可见，不静默）。
 * 接受 load_history 既有行形态 `{ raw_json }` 或裸会话对象。
 */
export function gateSessionsForAgentDelivery(
  rows: ReadonlyArray<{ raw_json?: unknown } | unknown>,
  options: AgentDeliveryValidationOptions = {},
): AgentDeliveryGateResult {
  const delivered: AgentDeliverySession[] = [];
  const rejected: AgentDeliveryRejection[] = [];
  for (const row of rows) {
    const raw = (row as { raw_json?: unknown } | null | undefined)?.raw_json ?? row;
    try {
      delivered.push(normalizeAndValidateAgentSession(raw, options));
    } catch (err) {
      if (err instanceof AgentDeliveryError) {
        rejected.push({ session_id: err.sessionId, code: err.code, reason: err.message });
      } else {
        throw err; // 非门卫错误（如 parseJSONSafe 抛出的 JSONParseError）不吞
      }
    }
  }
  return { delivered, rejected };
}
