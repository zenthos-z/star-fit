/**
 * Agent 载荷快照服务（issue #96 Agent 输入可视化页）
 *
 * 职责：原始会话（sessions.raw_json 写链，即 load_history 的 live 行来源）
 * 落库时，冻结「交付时点」快照——归一化 payload + 交付硬校验结果 + 预处理
 * 标注。构造逻辑与 load_history 交付门卫**同一套真源**（shared/contracts/
 * agent-delivery.ts 的 normalize + validate + knownExerciseIds 全集），
 * 不新造第二套口径（分册4 §5.2「复用同源读取路径」）。
 *
 * 快照点选在原始会话写链（upsertSessions 消费端 sync push）而非
 * POST /api/sessions：后者收的是 workoutSummary 预聚合条目（exercises[].sets
 * 是组数计数字段，ExerciseEntrySchema），不携带逐组数据（feel/时间戳/状态），
 * 也无法过 #97 归一化（其输入形态是 legacy Session raw_json）——快照它得到的
 * 会是 Agent 从未收到的载荷。真实训练链路（训练完成 → 本地落账 → sync push）
 * 原样触发本快照。
 *
 * 红线：快照只读审计——归一/校验失败也照常落快照（payload 原样冻结 +
 * 失败明细），任何链路禁止修复/改写；快照失败绝不阻断存储主链（逐条
 * 捕获上浮日志，sync 请求照常成功）。
 */

import { getPostgresClient } from "../../db/postgresql/client/postgres-client.js";
import {
  createAgentPayloadSnapshotRepository,
  type AgentPayloadSnapshotWriteRow,
} from "../../db/postgresql/repository/agentPayloadSnapshot.repository.js";
import { createExerciseRepository } from "../../db/postgresql/repository/exercise.repository.js";
import {
  AgentDeliveryError,
  normalizeSessionForAgentDelivery,
  validateAgentSessionDelivery,
  type AgentDeliverySession,
} from "shared/contracts";
import type {
  AgentPayloadValidation,
  AgentSetPreprocessNote,
  AgentSetTimestampSource,
} from "shared/contracts";

// ============================================================================
// 纯函数：单会话 → 快照内容（可单测，无 IO）
// ============================================================================

/** 快照构造产物（写库前的内存形态） */
export interface DeliverySnapshotContent {
  payload: unknown;
  validation: AgentPayloadValidation;
  preprocess: AgentSetPreprocessNote[];
  start_time: Date | null;
  end_time: Date | null;
  title: string | null;
  exercise_count: number;
}

/** epoch ms / ISO 字符串 → Date；不可解析返回 null（容忍坏数据，不虚构） */
function toDateOrNull(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

/** 原始组时间戳来源判定（agent-delivery normalizeSet 优先级的读取侧标注） */
function resolveTimestampSource(rawSet: unknown): AgentSetTimestampSource {
  if (!rawSet || typeof rawSet !== "object" || Array.isArray(rawSet)) {
    return "inferred";
  }
  const set = rawSet as Record<string, unknown>;
  if (
    typeof set.timestamp === "string" &&
    !Number.isNaN(Date.parse(set.timestamp))
  ) {
    return "explicit";
  }
  if (set.completedAt !== undefined && set.completedAt !== null) {
    return "completed_at";
  }
  return "inferred";
}

/** 归一前 status 原始值（原样冻结：UPPERCASE 协议值 / undefined / 布尔 completed） */
function originalStatusOf(rawSet: unknown): unknown {
  if (!rawSet || typeof rawSet !== "object" || Array.isArray(rawSet))
    return null;
  const set = rawSet as Record<string, unknown>;
  return set.status !== undefined ? set.status : null;
}

/**
 * 构造单会话的交付快照内容：归一 → 硬校验 → 冻结。
 * @param rawSession sessions.raw_json 原始会话（legacy Session 形态）
 * @param knownExerciseIds 动作库 id 全集；undefined = 跳过引用检查并留痕
 *   （与 load_history 同策略：库扫描失败 ≠ 会话数据坏，拒付必须有据）
 */
export function buildDeliverySnapshotContent(
  rawSession: unknown,
  knownExerciseIds?: ReadonlySet<string>,
): DeliverySnapshotContent {
  const checkedAt = new Date().toISOString();
  const referenceCheck: AgentPayloadValidation["reference_check"] =
    knownExerciseIds ? "applied" : "skipped";

  const fail = (
    err: AgentDeliveryError,
    payload: unknown,
  ): DeliverySnapshotContent => {
    const src = rawSession as Record<string, unknown> | null;
    return {
      payload,
      validation: {
        ok: false,
        code: err.code,
        reason: err.message,
        reference_check: referenceCheck,
        checked_at: checkedAt,
      },
      preprocess: [],
      start_time: toDateOrNull(src?.startTime ?? src?.start_time),
      end_time: toDateOrNull(src?.endTime ?? src?.end_time),
      title: deriveTitle(src),
      exercise_count: countExercises(src?.exercises),
    };
  };

  let normalized: AgentDeliverySession;
  try {
    normalized = normalizeSessionForAgentDelivery(rawSession);
  } catch (err) {
    // 连归一都不行：原始输入原样冻结（快照即交付时点的真实样子，禁改写）
    if (err instanceof AgentDeliveryError) {
      return fail(err, rawSession);
    }
    throw err;
  }

  // 预处理标注：逐组 timestamp 来源 + status 归一轨迹（载荷之外的推导轨迹）
  const preprocess: AgentSetPreprocessNote[] = [];
  const rawExercises = Array.isArray(
    (rawSession as Record<string, unknown>)?.exercises,
  )
    ? ((rawSession as Record<string, unknown>).exercises as unknown[])
    : [];
  normalized.exercises.forEach((ex, exIdx) => {
    const rawSets = Array.isArray(
      (rawExercises[exIdx] as Record<string, unknown>)?.sets,
    )
      ? ((rawExercises[exIdx] as Record<string, unknown>).sets as unknown[])
      : [];
    ex.sets.forEach((set, setIdx) => {
      preprocess.push({
        exercise_index: exIdx,
        set_index: setIdx,
        timestamp_source: resolveTimestampSource(rawSets[setIdx]),
        status_normalized: set.status,
        status_original: originalStatusOf(rawSets[setIdx]),
      });
    });
  });

  try {
    validateAgentSessionDelivery(normalized, { knownExerciseIds });
  } catch (err) {
    // 归一成功但硬校验拒付：payload = 归一形态（被拒的交付候选），明细冻结
    if (err instanceof AgentDeliveryError) {
      return fail(err, normalized);
    }
    throw err;
  }

  const src = rawSession as Record<string, unknown>;
  return {
    payload: normalized,
    validation: {
      ok: true,
      code: "ok",
      reason: null,
      reference_check: referenceCheck,
      checked_at: checkedAt,
    },
    preprocess,
    start_time: toDateOrNull(src.startTime ?? src.start_time),
    end_time: toDateOrNull(src.endTime ?? src.end_time),
    title: deriveTitle(src),
    exercise_count: normalized.exercises.length,
  };
}

/** exercises 数量防御性统计（unnormalizable 行的列表摘要也不炸） */
function countExercises(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * 快照标题：raw 自带 title 用之；缺省按 sessionRepo.upsertSessions 同一
 * 规则派生（前两个动作名 join），仅作列表摘要显示，不进 payload 本体。
 */
function deriveTitle(src: Record<string, unknown> | null): string | null {
  if (typeof src?.title === "string" && src.title.length > 0) return src.title;
  const exercises = src?.exercises;
  if (!Array.isArray(exercises)) return null;
  const joined = exercises
    .map((e) => (e as Record<string, unknown> | null)?.name)
    .filter((n): n is string => typeof n === "string")
    .slice(0, 2)
    .join("/");
  return joined.length > 0 ? joined : null;
}

// ============================================================================
// 落库入口（ingestion 链消费）
// ============================================================================

export interface SnapshotSessionDeliveriesResult {
  snapshotted: number;
  failed: number;
}

/**
 * 批量冻结交付快照（sync push 链消费端调用）：
 * 1. 读动作库 id 全集（一次；读不到 = 跳过引用检查并在快照内留痕，不阻断）；
 * 2. 逐会话 buildDeliverySnapshotContent → repo.upsertSnapshot；
 * 3. 逐条 try/catch——快照是旁路观测，任何失败只记日志绝不炸存储主链。
 */
export async function snapshotSessionDeliveries(
  userId: string,
  rawSessions: ReadonlyArray<unknown>,
): Promise<SnapshotSessionDeliveriesResult> {
  const result: SnapshotSessionDeliveriesResult = { snapshotted: 0, failed: 0 };
  if (!Array.isArray(rawSessions) || rawSessions.length === 0) return result;

  const client = getPostgresClient();
  let knownExerciseIds: Set<string> | undefined;
  try {
    knownExerciseIds = await createExerciseRepository(client).listAllIds();
  } catch (err) {
    console.error(
      "[payloadSnapshot] exercise id universe unavailable, reference check skipped:",
      err,
    );
  }

  const repo = createAgentPayloadSnapshotRepository(client);
  for (const raw of rawSessions) {
    try {
      const content = buildDeliverySnapshotContent(raw, knownExerciseIds);
      const sessionId = extractSessionId(raw);
      if (!sessionId) {
        // 无 id 的原始行连 sessions 表都进不来（uuid 主键），防御性跳过
        result.failed += 1;
        continue;
      }
      const writeRow: AgentPayloadSnapshotWriteRow = {
        user_id: userId,
        session_id: sessionId,
        start_time: content.start_time,
        end_time: content.end_time,
        title: content.title,
        exercise_count: content.exercise_count,
        validation_passed: content.validation.ok,
        payload: content.payload,
        validation: content.validation,
        preprocess: content.preprocess,
      };
      await repo.upsertSnapshot(writeRow);
      result.snapshotted += 1;
    } catch (err) {
      result.failed += 1;
      console.error(
        `[payloadSnapshot] failed to snapshot session for user ${userId}:`,
        err,
      );
    }
  }
  return result;
}

/** 从原始行提取会话 id（normalize 同源口径：id ?? session_id，须为字符串） */
function extractSessionId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const id =
    (raw as Record<string, unknown>).id ??
    (raw as Record<string, unknown>).session_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
