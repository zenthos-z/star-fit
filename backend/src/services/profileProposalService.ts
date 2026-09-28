/**
 * Profile Proposal Service (画像提案确定性写入 — B5 / issue #37)
 *
 * 把 profile_update_confirm 卡片里 Agent 提案轮算好的最终值确定性写入
 * profile_dynamic —— 全程无 LLM。前端点「确认更新」直调本服务（经
 * POST /api/profile/apply-proposals），毫秒级完成；写入完成后前端才触发
 * 「续跑主线」（把待续意图发给 Agent 开新一轮对话）。
 *
 * 写入语义（按 field，见 shared/contracts/profile-proposals.ts）：
 *  - load_anchors      按_key合并（只覆盖提案里的键，不动其余锚点）
 *  - active_limitations 追加新条目（同 part 同 severity 已存在则跳过——重试幂等）
 *  - recovery_state    整体替换
 *  - memories          按_key合并
 *
 * AI 边界红线：时间盖章（expire_at = now+7d、logged_at = now、
 * last_assessed = now、auto_heal 默认 true）与全部合并算术在 Service 侧完成，
 * Agent 只产出判断型数值（severity / total_score / 锚点对象）。
 *
 * 数据访问经 Repository 层（UserScopedWriteRepository，B1 红线）；
 * 单请求一次读 + 一次合并写（单条 UPDATE，原子）。
 */

import { z } from "zod";
import type { UserScopedWriteRepository } from "./agent/mcpTools.js";
import type {
  ProfileApplyRequest,
  ProfileApplyResponse,
} from "shared/contracts";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** 提案 value 形状不合法（Agent 提案轮产出的最终值不符合字段契约） */
export class ProposalValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid profile proposal values: ${issues.join("; ")}`);
    this.name = "ProposalValidationError";
  }
}

// ---------------------------------------------------------------------------
// Deep value schemas (per field — 请求层只校验 field 枚举，此处深校验 value)
// ---------------------------------------------------------------------------

const loadAnchorsValueSchema = z
  .record(z.string().min(1), z.object({}).passthrough())
  .refine((m) => Object.keys(m).length > 0, {
    message: "load_anchors value 必须是非空对象（锚点 map 片段）",
  });

const limitationEntrySchema = z
  .object({
    part: z.string().min(1),
    severity: z.number().int().min(1).max(10),
  })
  .passthrough();

const activeLimitationsValueSchema = z
  .array(limitationEntrySchema)
  .min(1)
  .refine((xs) => xs.length > 0, {
    message: "active_limitations value 必须是非空数组（新条目）",
  });

const recoveryStateValueSchema = z
  .object({
    total_score: z.number().min(0).max(100),
  })
  .passthrough();

const memoriesValueSchema = z
  .record(z.string().min(1), z.string())
  .refine((m) => Object.keys(m).length > 0, {
    message: "memories value 必须是非空对象（key → content map）",
  });

// ---------------------------------------------------------------------------
// Repository seam（测试可注入内存实现）
// ---------------------------------------------------------------------------

/** 本服务需要的最小 Repository 能力（UserScopedWriteRepository 的结构子集） */
export type ProfileProposalRepo = Pick<
  UserScopedWriteRepository,
  "readProfileDynamic" | "mergeProfileDynamic"
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 活动限制默认自动过期时长：7 天（技能约定的保守缺省，Agent 可显式覆盖） */
const LIMITATION_DEFAULT_TTL_DAYS = 7;

function isoInDays(days: number, from = new Date()): string {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** 读当前 profile_dynamic 的某个对象型字段（缺失/形态异常回退空对象） */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 读当前 profile_dynamic 的某个数组型字段（缺失/形态异常回退空数组） */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * 确定性应用一批画像提案。任一提案 value 深校验失败 → 抛
 * {@link ProposalValidationError}（整体 400，不写半截）。
 */
export async function applyProfileProposals(
  repo: ProfileProposalRepo,
  userId: string,
  request: ProfileApplyRequest,
): Promise<ProfileApplyResponse> {
  // 1) 逐提案深校验 value 形状（全部通过才动库）
  const issues: string[] = [];
  for (const p of request.proposals) {
    const res =
      p.field === "load_anchors"
        ? loadAnchorsValueSchema.safeParse(p.value)
        : p.field === "active_limitations"
          ? activeLimitationsValueSchema.safeParse(p.value)
          : p.field === "recovery_state"
            ? recoveryStateValueSchema.safeParse(p.value)
            : memoriesValueSchema.safeParse(p.value);
    if (!res.success) {
      issues.push(
        `${p.field}: ${res.error.issues
          .map((i) => `${i.path.join(".") || "<root>"} ${i.message}`)
          .join(", ")}`,
      );
    }
  }
  if (issues.length > 0) throw new ProposalValidationError(issues);

  // 2) 读当前 profile_dynamic（锚点/限制/记忆的合并基线；recovery 是替换无需基线）
  const current = (await repo.readProfileDynamic(userId)) ?? {};

  // 3) 逐字段计算最终值（合并 + 时间盖章全部在 Service 侧；
  //    同请求多条同字段提案逐条叠加——基线取「已合并值 ?? 当前值」）
  const merged: Record<string, unknown> = {};
  const appliedFields: string[] = [];
  const now = new Date();

  for (const p of request.proposals) {
    switch (p.field) {
      case "load_anchors": {
        // 按键合并：保留未提及的锚点，只覆盖提案里的键
        const base = asRecord(
          merged.load_anchors !== undefined
            ? merged.load_anchors
            : current.load_anchors,
        );
        merged.load_anchors = { ...base, ...asRecord(p.value) };
        break;
      }
      case "active_limitations": {
        const base = asArray(
          merged.active_limitations !== undefined
            ? merged.active_limitations
            : current.active_limitations,
        );
        const result = [...base];
        for (const raw of asArray(p.value)) {
          const entry = raw as Record<string, unknown>;
          // 重试幂等：同 part 同 severity 的条目已存在则跳过，不重复追加
          const dup = result.some(
            (e) =>
              (e as Record<string, unknown>)?.part === entry.part &&
              (e as Record<string, unknown>)?.severity === entry.severity,
          );
          if (dup) continue;
          result.push({
            auto_heal: true,
            ...entry,
            expire_at:
              typeof entry.expire_at === "string"
                ? entry.expire_at
                : isoInDays(LIMITATION_DEFAULT_TTL_DAYS, now),
            logged_at:
              typeof entry.logged_at === "string"
                ? entry.logged_at
                : now.toISOString(),
          });
        }
        merged.active_limitations = result;
        break;
      }
      case "recovery_state": {
        // 整体替换；last_assessed 缺省由系统盖章
        merged.recovery_state = {
          ...(p.value as Record<string, unknown>),
          last_assessed:
            typeof (p.value as Record<string, unknown>)?.last_assessed ===
            "string"
              ? (p.value as Record<string, unknown>).last_assessed
              : now.toISOString(),
        };
        break;
      }
      case "memories": {
        const base = asRecord(
          merged.memories !== undefined ? merged.memories : current.memories,
        );
        merged.memories = { ...base, ...asRecord(p.value) };
        break;
      }
    }
    if (!appliedFields.includes(p.field)) appliedFields.push(p.field);
  }

  // 4) 单次合并写（原子：一条 UPDATE 覆盖全部变更字段）
  if (Object.keys(merged).length > 0) {
    await repo.mergeProfileDynamic(userId, merged);
  }

  return { ok: true, user_id: userId, applied_fields: appliedFields };
}
