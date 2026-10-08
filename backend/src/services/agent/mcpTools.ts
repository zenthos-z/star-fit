/**
 * MCP-style domain tools for the Deep Agent (R3, enhanced).
 *
 * `buildMcpTools()` turns the existing Repository / `users` + `exercises`
 * tables into a set of LangChain `DynamicStructuredTool`s that the deepagents
 * runtime can call. This is the **Agent-only data adapter** — the database's
 * MCP interface. It sits ON TOP of the existing Repository layer; it does not
 * change the DB schema, does not modify GOLD Repository methods, and does not
 * touch the fixed-workflow pipelines (action CRUD, tutorial, media, video),
 * which keep their own controller→Repository paths.
 *
 * ## Tool set (11)
 * - `load_history`        (read)  history_summary + profile_static + profile_dynamic
 * - `list_exercises`      (read)  the exercise library, FILTERED + PAGINATED (42b,
 *                                 issue #42): optional body_part / equipment /
 *                                 keyword filters, limit (default 30) + offset;
 *                                 response carries total / has_more. Each row is
 *                                 {id, name, name_zh, exercise_type, description}
 *                                 (B5b: name_zh is the official Chinese display
 *                                 name — user-facing plan output uses it, never
 *                                 translate names in-model). `description`
 *                                 carries pattern/targets/equipment/impact so the agent can
 *                                 respect the user equipment + injuries in-context.
 * - `find_exercises`      (read)  COMBINED-criteria search + RANKED short list
 *                                 (T2, issue #54): muscle_groups[] (primary/
 *                                 secondary) + optional movement_pattern (server-
 *                                 derived from category+name) / equipment[] /
 *                                 difficulty / exclude_ids[] / limit (default 10).
 *                                 Rows ranked by target-muscle match; total=0
 *                                 returns a relax_hint naming the single
 *                                 dimension to drop. No offset — plan flows
 *                                 converge in ≤3 calls instead of paging.
 * - `get_exercise_detail` (read)  full record of one exercise (deepened
 *                                 teaching columns, tutorials, content)
 * - `write_session`       (write) append a completed session to history_summary
 * - `write_memory`        (write) keyed free-text memory note under profile_dynamic.memories
 * - `update_profile`      (write) structured update of profile_dynamic
 *                                 (load_anchors / active_limitations / recovery_state)
 *                                 + profile_static.psychological
 *                                 (neurotype / risk_preference / accountability)
 * - `create_exercise`     (write) insert a USER-BOUND custom exercise into the
 *                                 library. User-binding rides the dedicated
 *                                 `owner_user_id` column (promoted from the
 *                                 old attributes JSONB in 002) — the row stays
 *                                 invisible to other users' queries and the
 *                                 admin console filters can adopt it later. A
 *                                 NanoID is generated server-side (never
 *                                 LLM-supplied).
 * - `get_current_plan`    (read)  the user's persisted weekly plan (E3: plans
 *                                 are entities, reuse-by-default — one per user
 *                                 per week; week_id defaults to the CURRENT
 *                                 week resolved server-side, the agent never
 *                                 does calendar math).
 *
 * [B5b issue#38] `save_weekly_plan` (write) REMOVED: weekly-plan persistence is
 * proposal-confirm now — the agent computes entries in the proposal round and
 * carries them on the weekly_plan card (data.apply); the app writes them
 * deterministically via POST /api/schedule/weekly-plan/apply AFTER the user
 * confirms. Nothing lands in weekly_plans/plan_entries without that confirm.
 *
 * ## Red lines honoured
 * - **Repository boundary (B1)**: tools reach data ONLY through the Repository
 *   layer — `UserRepository` (GOLD reads) plus two thin `BaseRepository`
 *   subclasses defined here (`UserScopedWriteRepository`, `ExerciseQuery`).
 *   No tool body imports the `pg` driver, calls `new Pool(...)`, or invokes
 *   `client.query(...)` directly. Everything goes through `BaseRepository`
 *   protected query helpers (`this.execute` / `this.queryOne` / `this.queryMany`).
 * - **Write userId scope (B2/B3, P012)**: the principal `userId` is resolved
 *   per-request from the LangGraph runnable config (`configurable.userId`),
 *   NEVER from an LLM-supplied parameter. Write tools never expose a `userId`
 *   parameter, so the LLM cannot forge a different target row. The non-vacuous
 *   `assertUserScope` guard stays on the real write path and is independently
 *   driveable by tests.
 * - **No schema change (HC-2)**: no migration, no new table, no new column.
 *   `sessions`/`memories`/anchors live as JSONB on the existing `users` row.
 * - **Version boundary (P005)**: tool schemas are authored with the project's
 *   zod3 (3.25.76). `@langchain/core` accepts `^3.25.76 || ^4`, so a zod3
 *   `ZodObject` crosses into `DynamicStructuredTool` without dragging deepagents'
 *   zod4 across the boundary.
 *
 * ## Why the write tools use UserScopedWriteRepository (not UserRepository.write*)
 * The GOLD `UserRepository` write methods (`updateProfileDynamic` /
 * `updateHistorySummary` / `updateProfileStatic`) were removed in cleanup-batch2:
 * they were dead code, and the first two emitted a 2-argument
 * `jsonb_set(target, $updates::jsonb)` that Postgres rejects at runtime
 * (`function jsonb_set(jsonb, jsonb) does not exist`, verified against the live
 * DB). Write tools therefore implement the CORRECT `||`-concat shallow merge in
 * the derived `UserScopedWriteRepository` below (B1: allowed derivation; HC-2:
 * no schema change). Reads still use `UserRepository` unchanged. The B2/B3
 * userId-scope guard (`assertUserScope`) is enforced on every real write path.
 *
 * ## userId resolution (per-request, ALS)
 * Production (`buildMcpTools()`) is built once at agent-assembly time with no
 * userId; each tool func resolves the calling user from the LangGraph
 * AsyncLocalStorage context (`getConfig().configurable.userId`), which the
 * ToolNode propagates. `buildMcpToolsWith(client, injectedUserId)` keeps an
 * explicit fallback for the real-PG test suite (which runs outside LangGraph).
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { getConfig } from "@langchain/langgraph";
import { createMiddleware } from "langchain";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// B1: data access is via the Repository layer only. These imports reach the
// `pg` driver indirectly through PostgresClient inside BaseRepository; the tool
// bodies themselves hold no `pg` / `Pool` / `client.query` handle.
import {
  BaseRepository,
  createUserRepository,
  createHeartRateRepository,
} from "../../db/postgresql/repository/index.js";
import { getPostgresClient } from "../../db/postgresql/index.js";
// #151 S2：卡片 submit 工具内核（通道开关解析在 DeepAgentService；此处只组装）。
import { buildCardSubmitTools, type CardChannels } from "./cardSubmit.js";
import { mergeHistorySources } from "./historyMerger.js";
import { generateExerciseNanoId } from "../../utils/nanoid.js";
import { createWeeklyPlanRepository } from "../../db/postgresql/repository/weeklyPlan.repository.js";
import {
  WEEK_ID_PATTERN,
  getIsoWeekId,
  // T2 (issue #54): find_exercises 参数词表直接复用数据契约真源（17 肌群 / 15 器材）
  ExerciseMuscleSchema,
  ExerciseEquipmentSchema,
  // #88 分册1：动作类型枚举复用 card-types 单一真源（10 细类，与
  // exercise-type-guide 技能知识库 / DB exercise_type_enum 同源）
  ExerciseTypeEnum,
  // #97 红线3：Agent 交付边界门卫（归一 + 全字段 Zod + 关系引用完整性）
  gateSessionsForAgentDelivery,
} from "shared/contracts";
import { utcToday } from "../schedule/scheduleService.js";
// [B6 issue#39] 写路径心跳：画像/计划/训练完成 → 静默登记建议缓存空闲重算
// （notify 为纯内存操作，绝不阻塞工具返回；重算由独立调度器执行）
import { notifySuggestionCacheInvalidation } from "../suggestions/suggestionCacheScheduler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The PostgresClient type, derived from the accessor to avoid an extra import. */
type DbClient = ReturnType<typeof getPostgresClient>;

/** One exercises row for the list tool (new 002 columns are synthesized into a description). */
interface ExerciseListRow {
  id: string;
  name: string;
  /** [B5b] 中文展示名（002 列，翻译脚本已 354/354 回填；NULL 兜底英文名） */
  name_zh: string | null;
  exercise_type: string | null;
  difficulty: string | null;
  /** 002 深化列：compound/isolation（行级 description 一并携带，供计划编排筛选用） */
  mechanic: string | null;
  equipment: string | null;
  category: string | null;
  body_part: string | null;
  primary_muscles: string[] | null;
}

/** Full exercise row for the detail tool. */
interface ExerciseDetailRow {
  id: string;
  name: string;
  name_zh: string | null;
  exercise_type: string | null;
  difficulty: string | null;
  tutorials: unknown;
  content_html: string | null;
  // ---- A2/A3 深化列（A4：get_exercise_detail 一并透出，Agent 教学问答直读库数据）----
  equipment: string | null;
  category: string | null;
  body_part: string | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  force_type: string | null;
  mechanic: string | null;
  instructions: string[] | null;
  form_cues: string[] | null;
  common_mistakes: string[] | null;
  breathing: string | null;
}

// ---------------------------------------------------------------------------
// userId scope guard (B2 / B3 / P012)
// ---------------------------------------------------------------------------

/**
 * Error raised when a write tool is asked to act on a `userId` other than the
 * resolved principal. Deliberately a distinct class so the vacuity probe (B3)
 * can assert the guard *fires* rather than silently passing.
 */
export class McpScopeError extends Error {
  constructor(
    public readonly injectedUserId: string,
    public readonly targetUserId: string,
  ) {
    super(
      `mcpTools scope violation: write targeted userId=${targetUserId} but the tool is scoped to userId=${injectedUserId}`,
    );
    this.name = "McpScopeError";
  }
}

/**
 * P012 build-gate: a write may only touch the resolved principal's own row.
 * Throws `McpScopeError` on mismatch. The write tools call this with
 * `target === injected` (secure by construction — no userId param is exposed to
 * the LLM); the exported scoped-write helpers let tests drive mismatched inputs
 * to prove the guard is not a perpetually-green no-op.
 */
export function assertUserScope(
  injectedUserId: string,
  targetUserId: string,
): void {
  if (injectedUserId !== targetUserId) {
    throw new McpScopeError(injectedUserId, targetUserId);
  }
}

// ---------------------------------------------------------------------------
// per-request userId resolution (LangGraph ALS + fallbacks)
// ---------------------------------------------------------------------------

/**
 * Resolve the calling user's id for one tool invocation.
 *
 * Order:
 *  1. LangGraph AsyncLocalStorage context (`getConfig().configurable.userId`)
 *     — the production path; the ToolNode propagates the runnable config into
 *     the ALS scope that wraps tool execution.
 *  2. An explicitly-injected userId (test fallback, via `buildMcpToolsWith`).
 *  3. The `config` argument passed to a `DynamicStructuredTool` func — a second
 *     production fallback if ALS is unavailable in some host.
 *
 * Throws if no userId can be resolved — tools must NEVER guess or default.
 */
// userId 必须是合法 UUID（users.id 为 uuid 列）。2026-09-17 实锤：非 UUID 字符串
// （如测试脚本传入 "survey-test-0917"）会直插 SQL 触发 `invalid input syntax for type
// uuid` 的 PostgresClient 裸崩。在此入口统一校验，非法值抛结构化错误 → Agent 工具层
// 可捕获并告知用户，而不是数据库层崩栈。
const MCP_USER_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertValidUserId(userId: string): string {
  if (!MCP_USER_ID_UUID_RE.test(userId)) {
    throw new Error(
      `mcpTools: userId "${userId}" is not a valid UUID (users.id is uuid-typed). ` +
        `Check the caller that sets configurable.userId.`,
    );
  }
  return userId;
}

export function getUserIdFromContext(
  opts: {
    explicitConfig?: unknown;
    injectedUserId?: string;
  } = {},
): string {
  // 1. LangGraph ALS context (production primary).
  let alsUserId: string | undefined;
  try {
    const cfg = getConfig() as
      { configurable?: { userId?: string } } | undefined;
    alsUserId = cfg?.configurable?.userId;
  } catch {
    // getConfig() can throw when invoked outside a LangGraph run; that's fine,
    // we fall through to the explicit fallbacks.
    alsUserId = undefined;
  }
  if (alsUserId) {
    return assertValidUserId(alsUserId);
  }

  // 2. Test-injected principal.
  if (opts.injectedUserId) {
    return assertValidUserId(opts.injectedUserId);
  }

  // 3. DynamicStructuredTool func config argument (RunnableConfig).
  const cfg = opts.explicitConfig as
    | { configurable?: { userId?: string } }
    | { config?: { configurable?: { userId?: string } } }
    | undefined;
  const fromExplicit =
    (cfg as { configurable?: { userId?: string } } | undefined)?.configurable
      ?.userId ??
    (cfg as { config?: { configurable?: { userId?: string } } } | undefined)
      ?.config?.configurable?.userId;
  if (fromExplicit) {
    return assertValidUserId(fromExplicit);
  }

  throw new Error(
    "mcpTools: userId not found — expected LangGraph configurable.userId (set by DeepAgentService.chat) or an injected test principal",
  );
}

// ---------------------------------------------------------------------------
// BaseRepository subclasses (B1: allowed derivations; HC-2: no schema change)
// ---------------------------------------------------------------------------

/**
 * Write path for the agent tools. Extends `BaseRepository` (B1) and implements a
 * CORRECT jsonb shallow-merge (`COALESCE(col,'{}') || $updates::jsonb`) that the
 * removed GOLD `UserRepository` write methods had broken (see module header).
 */
export class UserScopedWriteRepository extends BaseRepository {
  /** Shallow-merge `data` into the `history_summary` JSONB of user `userId`. */
  async mergeHistorySummary(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.execute(
      `UPDATE users
         SET history_summary = COALESCE(history_summary, '{}'::jsonb) || $updates::jsonb,
             updated_at = NOW()
       WHERE id = $userId`,
      { userId, updates: this.stringifyJSONB(data) },
    );
  }

  /** Shallow-merge `data` into the `profile_dynamic` JSONB of user `userId`. */
  async mergeProfileDynamic(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.execute(
      `UPDATE users
         SET profile_dynamic = COALESCE(profile_dynamic, '{}'::jsonb) || $updates::jsonb,
             updated_at = NOW()
       WHERE id = $userId`,
      { userId, updates: this.stringifyJSONB(data) },
    );
  }

  /** Shallow-merge `data` into the `profile_static` JSONB of user `userId`. */
  async mergeProfileStatic(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.execute(
      `UPDATE users
         SET profile_static = COALESCE(profile_static, '{}'::jsonb) || $updates::jsonb,
             updated_at = NOW()
       WHERE id = $userId`,
      { userId, updates: this.stringifyJSONB(data) },
    );
  }

  /** Raw `history_summary` for the append-read in `write_session`. */
  async readHistorySummary(
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.queryOne<{ history_summary: unknown }>(
      `SELECT history_summary FROM users WHERE id = $userId`,
      { userId },
    );
    const hs = row?.history_summary;
    return hs && typeof hs === "object"
      ? (hs as Record<string, unknown>)
      : null;
  }

  /** Raw `profile_dynamic` for the read-modify-write in `write_memory`. */
  async readProfileDynamic(
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.queryOne<{ profile_dynamic: unknown }>(
      `SELECT profile_dynamic FROM users WHERE id = $userId`,
      { userId },
    );
    const pd = row?.profile_dynamic;
    return pd && typeof pd === "object"
      ? (pd as Record<string, unknown>)
      : null;
  }

  /**
   * Recent `sessions.raw_json` rows for `load_history` (batch4-4: the tool
   * body previously ran this SQL via the raw DbClient — the only remaining
   * direct-query seam. Goes through BaseRepository like every other read).
   * Newest first; JSONB arrives pre-parsed, legacy string values pass through
   * unchanged (mergeHistorySources/trimSessions tolerate both shapes).
   */
  async getRecentSessionRaws(
    userId: string,
    limit: number,
  ): Promise<Array<{ raw_json: unknown }>> {
    return this.queryMany<{ raw_json: unknown }>(
      `SELECT raw_json FROM sessions
        WHERE user_id = $userId
        ORDER BY start_time DESC
        LIMIT $limit`,
      { userId, limit },
    );
  }
}

// ---------------------------------------------------------------------------
// movement_pattern 派生（T2 / issue #54）
// ---------------------------------------------------------------------------

/**
 * 动作模式词表（find_exercises 的 movement_pattern 参数；随库派生）。
 * push/pull/squat/hinge/carry/core 为力量计划推拉蹲铰链行走核心六模式，
 * cardio/stretch 为有氧与拉伸两个非力量桶，NULL = 未归类（孤立配件动作）。
 */
export const MOVEMENT_PATTERN_VALUES = [
  "push",
  "pull",
  "squat",
  "hinge",
  "carry",
  "core",
  "cardio",
  "stretch",
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERN_VALUES)[number];

/**
 * movement_pattern 派生 SQL 片段（查询期派生，一次性口径——真源即本片段）。
 *
 * exercises 表没有动作模式列（HC-2 不加列、不回填）：模式由现有列
 * category + name/name_zh + force_type 在查询期派生，A3 再导入的新动作
 * 自动随库生效，无迁移漂移风险。2026-09-29 全库 369 行实测标定
 * （push 84 / pull 78 / core 59 / stretch 55 / NULL 33 / squat 24 /
 * hinge 22 / cardio 11 / carry 3）。
 *
 * 派生规则（首个命中生效；匹配文本 = lower(name || ' ' || name_zh)）：
 *   1. category='cardio'     → cardio
 *   2. category='stretching' → stretch
 *   3. carry  ：walk / carry / 农夫 / 行走
 *   4. core   ：crunch / sit-up / plank / leg raise / twist / rotation /
 *              rollout / v-up / jackknife / side bend / standing lift /
 *              卷腹 / 仰卧起坐 / 平板支撑 / 举腿 / 虫 / 转体 / 扭转 / 侧弯
 *              （用 standing lift 而非裸 lift——裸 lift 误吞 dead**lift**；
 *              用平板支撑而非平板——平板杠铃卧推=平凳卧推）
 *   5. squat  ：squat / lunge / step-up / leg press / wall sit / pistol /
 *              sissy / 蹲 / 弓步（leg press 先于 push 分支拦截）
 *   6. hinge  ：deadlift / bridge / hyperextension / back·hip extension /
 *              pull-through / swing / good morning / hip thrust / rear kick /
 *              硬拉 / 臀桥 / 桥 / 髋伸展
 *   7. push   ：push / press / fly / dip / slam / throw / front·lateral raise /
 *              triceps extension / pushdown / kickback / 推 / 飞鸟 / 臂屈伸 / 下压
 *   8. pull   ：pull-up / chin-up / pulldown / row / curl / shrug / rear delt /
 *              inverted / t-bar / 引体 / 下拉 / 划船 / 弯举 / 耸肩 / 后束
 *              （中文词表禁裸「拉」——阿特拉斯石球等音译误吞）
 *   9. force_type 兜底（push/pull；static→core；全库仅 36/369 行有值）
 *  10. 其余 → NULL（孤立配件：提踵/髋外展内收/腿屈伸/壶铃花式等；
 *      计划编排用 muscle_groups 维度覆盖，不强行归类）
 */
export const MOVEMENT_PATTERN_SQL = `CASE
      WHEN category::text = 'cardio' THEN 'cardio'
      WHEN category::text = 'stretching' THEN 'stretch'
      WHEN lower(name || ' ' || coalesce(name_zh, '')) ~ '(walk|carry|农夫|行走)' THEN 'carry'
      WHEN lower(name || ' ' || coalesce(name_zh, '')) ~ '(crunch|sit.?up|plank|leg raise|hip raise|hip lift|rollout|ab roller|hollow|dead.?bug|v.?up|jackknife|twist|rotation|otis|hundred|corkscrew|scissor|standing lift|bicycle|superman|side bend|卷腹|仰卧起坐|平板支撑|举腿|虫|转体|扭转|侧弯)' THEN 'core'
      WHEN lower(name || ' ' || coalesce(name_zh, '')) ~ '(squat|lunge|step.?up|leg press|wall sit|pistol|sissy|蹲|弓步)' THEN 'squat'
      WHEN lower(name || ' ' || coalesce(name_zh, '')) ~ '(deadlift|good morning|hip thrust|bridge|hyperextension|back extension|hip extension|pull.?through|swing|romanian|rear kick|硬拉|臀桥|桥|髋伸展)' THEN 'hinge'
      WHEN lower(name || ' ' || coalesce(name_zh, '')) ~ '(push|press|fly|dip|slam|throw|front raise|lateral raise|triceps extension|pushdown|kickback|推|飞鸟|臂屈伸|下压)' THEN 'push'
      WHEN lower(name || ' ' || coalesce(name_zh, '')) ~ '(pull.?up|chin.?up|pulldown|row|curl|shrug|face.?pull|rear delt|rear lateral|inverted|t.?bar|引体|下拉|划船|弯举|耸肩|后束)' THEN 'pull'
      WHEN force_type::text = 'push' THEN 'push'
      WHEN force_type::text = 'pull' THEN 'pull'
      WHEN force_type::text = 'static' THEN 'core'
      ELSE NULL END`;

/**
 * One ranked exercise row for find_exercises (superset of ExerciseListRow).
 */
export interface RankedExerciseRow extends ExerciseListRow {
  secondary_muscles: string[] | null;
  /** 服务端派生的动作模式（NULL = 未归类配件）。 */
  movement_pattern: string | null;
  /** 精排得分：主肌群命中×3 + 协同肌群命中×1。 */
  score: number;
  /** 主肌群命中数（排序主键；>0 即 matched=primary）。 */
  primary_matches: number;
}

/**
 * Read-only accessor for the `exercises` table (HC-2: thin read-only wrapper;
 * no `ExerciseRepository` exists yet). SELECT only — no writes.
 */
export class ExerciseQuery extends BaseRepository {
  /**
   * Filtered + paginated library read (42b, issue #42). All filters are
   * optional and AND-combined; `keyword` does a case-insensitive contains
   * across name / name_zh / category / body_part / primary+secondary muscles.
   * Returns the matching page plus `total` so the tool can compute has_more —
   * the agent filters by body_part per muscle group instead of paging blindly.
   */
  async listPage(filters: {
    body_part?: string;
    equipment?: string;
    keyword?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: ExerciseListRow[]; total: number }> {
    const kw = filters.keyword ? `%${filters.keyword}%` : null;
    // body_part/equipment/category 是 enum 类型 —— ILIKE 前须 ::text 显式转列。
    const where = `
      WHERE ($bodyPart::text IS NULL OR body_part::text ILIKE '%' || $bodyPart || '%')
        AND ($equipment::text IS NULL OR equipment::text ILIKE '%' || $equipment || '%')
        AND ($kw::text IS NULL OR name ILIKE $kw OR name_zh ILIKE $kw
             OR category::text ILIKE $kw OR body_part::text ILIKE $kw
             OR array_to_string(primary_muscles, ',') ILIKE $kw
             OR array_to_string(secondary_muscles, ',') ILIKE $kw)`;
    const params = {
      bodyPart: filters.body_part ?? null,
      equipment: filters.equipment ?? null,
      kw,
      limit: filters.limit,
      offset: filters.offset,
    };
    const rows = await this.queryMany<ExerciseListRow>(
      `SELECT id, name, name_zh, exercise_type, difficulty, mechanic, equipment, category, body_part, primary_muscles
         FROM exercises
         ${where}
         ORDER BY name
         LIMIT $limit OFFSET $offset`,
      params,
    );
    const countRow = await this.queryOne<{ total: string | number }>(
      `SELECT count(*) AS total FROM exercises ${where}`,
      params,
    );
    return { rows, total: Number(countRow?.total ?? 0) };
  }

  /**
   * All exercise ids (#97): the referential-integrity universe for the Agent
   * delivery gate (load_history validates every session exercise reference
   * against this set). Read-only full id scan — the library is a few hundred
   * rows, no pagination needed.
   */
  async listAllIds(): Promise<Set<string>> {
    const rows = await this.queryMany<{ id: string }>(
      "SELECT id FROM exercises",
      {},
    );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * COMBINED-criteria search + RANKED short list (T2, issue #54). All filters
   * AND-combined; rows scored by target-muscle match (primary hits ×3 +
   * secondary hits ×1) so the agent gets a ready-to-use short list instead of
   * paging the whole library. `movement_pattern` filters on the query-time
   * derivation in MOVEMENT_PATTERN_SQL (no schema column — HC-2).
   */
  async findRanked(filters: {
    muscle_groups: string[];
    movement_pattern?: string;
    equipment?: string[];
    difficulty?: string;
    exclude_ids?: string[];
    limit: number;
  }): Promise<{ rows: RankedExerciseRow[]; total: number }> {
    const { where, params } = buildFindConditions(filters);
    params.limit = filters.limit;
    const scoreExpr = `
        (SELECT count(*) FROM unnest(primary_muscles) AS m
          WHERE m = ANY($muscleGroups::text[])) * 3
        + (SELECT count(*) FROM unnest(secondary_muscles) AS m
          WHERE m = ANY($muscleGroups::text[]))`;
    const rows = await this.queryMany<RankedExerciseRow>(
      `SELECT id, name, name_zh, exercise_type, difficulty, mechanic, equipment,
              category, body_part, primary_muscles, secondary_muscles,
              ${MOVEMENT_PATTERN_SQL} AS movement_pattern,
              (SELECT count(*) FROM unnest(primary_muscles) AS m
                WHERE m = ANY($muscleGroups::text[])) AS primary_matches,
              ${scoreExpr} AS score
         FROM exercises
         ${where}
         ORDER BY score DESC, name
         LIMIT $limit`,
      params,
    );
    const countRow = await this.queryOne<{ total: string | number }>(
      `SELECT count(*) AS total FROM exercises ${where}`,
      params,
    );
    return { rows, total: Number(countRow?.total ?? 0) };
  }

  /**
   * Empty-result guidance (T2, issue #54): re-count with EACH optional
   * dimension dropped one at a time, so the agent knows exactly which single
   * relaxation yields hits (instead of guessing across more paging calls).
   * Keys are present only for the dimensions that were actually applied.
   */
  async relaxCounts(filters: {
    muscle_groups: string[];
    movement_pattern?: string;
    equipment?: string[];
    difficulty?: string;
    exclude_ids?: string[];
  }): Promise<{
    drop_movement_pattern?: number;
    drop_difficulty?: number;
    drop_equipment?: number;
    drop_muscle_groups?: number;
  }> {
    const hint: Awaited<ReturnType<ExerciseQuery["relaxCounts"]>> = {};
    const variants: Array<{
      key:
        | "drop_movement_pattern"
        | "drop_difficulty"
        | "drop_equipment"
        | "drop_muscle_groups";
      patch: Partial<typeof filters>;
    }> = [];
    if (filters.movement_pattern) {
      variants.push({
        key: "drop_movement_pattern",
        patch: { movement_pattern: undefined },
      });
    }
    if (filters.difficulty) {
      variants.push({
        key: "drop_difficulty",
        patch: { difficulty: undefined },
      });
    }
    if (filters.equipment) {
      variants.push({ key: "drop_equipment", patch: { equipment: undefined } });
    }
    variants.push({ key: "drop_muscle_groups", patch: { muscle_groups: [] } });
    for (const { key, patch } of variants) {
      const { where, params } = buildFindConditions({ ...filters, ...patch });
      const row = await this.queryOne<{ total: string | number }>(
        `SELECT count(*) AS total FROM exercises ${where}`,
        params,
      );
      hint[key] = Number(row?.total ?? 0);
    }
    return hint;
  }

  /** Full record for one exercise by id (tutorials, content_html, deepened teaching columns). */
  async findByIdFull(id: string): Promise<ExerciseDetailRow | null> {
    return this.queryOne<ExerciseDetailRow>(
      `SELECT id, name, name_zh, exercise_type, difficulty, tutorials, content_html,
              equipment, category, body_part, primary_muscles, secondary_muscles,
              force_type, mechanic, instructions, form_cues, common_mistakes, breathing
         FROM exercises
        WHERE id = $id`,
      { id },
    );
  }

  /**
   * True when a (case-insensitive) exercise name already exists. Used by
   * create_exercise to fail loudly instead of hitting the UNIQUE(name)
   * constraint with a raw driver error.
   */
  async nameExists(name: string): Promise<boolean> {
    const row = await this.queryOne<{ id: string }>(
      `SELECT id FROM exercises WHERE lower(name) = lower($name) LIMIT 1`,
      { name },
    );
    return row != null;
  }

  /**
   * Insert a user-bound custom exercise. Ownership rides the dedicated
   * `owner_user_id` column (promoted from the old attributes JSONB in 002).
   * The 002 deepening columns are deliberately left at defaults: they carry
   * CHECK/enum-controlled vocabularies (primary_muscles ⊆ 17-muscle snake_case
   * word list, equipment/category are enums) that free-form agent input would
   * violate — agent-supplied targets/description live in the tool response and
   * the tutorial (content_html), not in the vocab columns.
   */
  async insertUserExercise(row: {
    id: string;
    name: string;
    exercise_type: string;
    owner_user_id: string;
    content_html: string | null;
    modified_by: string;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO exercises (id, name, exercise_type, difficulty, owner_user_id, content_html, modified_by, updated_at)
       VALUES ($id, $name, $exerciseType, 'beginner', $ownerUserId, $contentHtml, $modifiedBy, NOW())`,
      {
        id: row.id,
        name: row.name,
        exerciseType: row.exercise_type,
        ownerUserId: row.owner_user_id,
        contentHtml: row.content_html,
        modifiedBy: row.modified_by,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// find_exercises filter composition (T2 / issue #54)
// ---------------------------------------------------------------------------

/** Shared filter shape for findRanked / relaxCounts (limit handled by caller). */
interface FindFilters {
  muscle_groups: string[];
  movement_pattern?: string;
  equipment?: string[];
  difficulty?: string;
  exclude_ids?: string[];
}

/**
 AND-compose the find_exercises conditions. All dimensions are optional except
 the muscle groups; `drop_muscle_groups` relax-passes an empty array, so the
 muscle condition is the only conditional-required one.
 */
function buildFindConditions(f: FindFilters): {
  where: string;
  params: Record<string, unknown>;
} {
  const conditions: string[] = [];
  const params: Record<string, unknown> = { muscleGroups: f.muscle_groups };
  if (f.muscle_groups.length > 0) {
    // 主/协同肌群任一命中（&& 数组重叠，两列均有 GIN 索引）。
    conditions.push(
      "(primary_muscles && $muscleGroups::text[] OR secondary_muscles && $muscleGroups::text[])",
    );
  }
  if (f.movement_pattern) {
    conditions.push(`(${MOVEMENT_PATTERN_SQL}) = $movementPattern`);
    params.movementPattern = f.movement_pattern;
  }
  if (f.equipment && f.equipment.length > 0) {
    // equipment IS NULL = 002 口径的「未知器材」，展示层一律视同 bodyweight
    // （describeExercise 同口径）——用户可用器械含 bodyweight 时一并计入。
    conditions.push(
      "(equipment::text = ANY($equipments::text[]) OR (equipment IS NULL AND 'bodyweight' = ANY($equipments::text[])))",
    );
    params.equipments = f.equipment;
  }
  if (f.difficulty) {
    conditions.push("difficulty::text = $difficulty");
    params.difficulty = f.difficulty;
  }
  if (f.exclude_ids && f.exclude_ids.length > 0) {
    conditions.push("id::text != ALL($excludeIds::text[])");
    params.excludeIds = f.exclude_ids;
  }
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

// ---------------------------------------------------------------------------
// Tool schemas (P005: project zod3; crosses cleanly into DynamicStructuredTool)
// ---------------------------------------------------------------------------

const loadHistorySchema = z
  .object({
    include_profile: z
      .boolean()
      .optional()
      .describe("Also return the static profile. Defaults to true."),
    include_dynamic: z
      .boolean()
      .optional()
      .describe(
        "Also return profile_dynamic (load_anchors, active_limitations, recovery_state). Defaults to true. " +
          "These are hard constraints for plan generation — load them.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe("Max recent sessions to return from history_summary.sessions."),
  })
  .describe(
    "Read the current user training history + static + dynamic profile. Read-only. Scoped to the calling user.",
  );

const listExercisesSchema = z
  .object({
    body_part: z
      .string()
      .max(40)
      .optional()
      .describe(
        'Filter by body part (case-insensitive contains): "chest", "back", "shoulders", "waist", "upper_arms", "lower_arms", "upper_legs", "lower_legs", "hips", "cardio". PREFERRED filter for plan flows — one call per needed muscle group.',
      ),
    equipment: z
      .string()
      .max(40)
      .optional()
      .describe(
        'Filter by equipment (case-insensitive contains): "barbell", "dumbbell", "machine", "cable", "band", "bodyweight", "kettlebell", "stability_ball", "medicine_ball".',
      ),
    keyword: z
      .string()
      .max(60)
      .optional()
      .describe(
        'Free-text search across name / name_zh / category / body_part / muscles, e.g. "squat", "卧推", "glutes".',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .describe(
        "Page size (default 30, max 100). Prefer body_part/equipment/keyword filters over paging.",
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "Rows to skip (default 0). Page with offset only when has_more=true.",
      ),
  })
  .describe(
    "Browse the exercise library with filters + pagination (read-only). The full library " +
      "(~355 moves) NEVER fits in one call: default page is 30 rows. Returns {total, count, " +
      "offset, limit, has_more, exercises:[{id, name, name_zh, exercise_type, description}]}. " +
      "Filter first (body_part / equipment / keyword), page only when has_more=true. " +
      "`name_zh` is the official Chinese display name (user-facing output MUST use it; never " +
      "translate names yourself); `description` carries pattern / targets / equipment / " +
      "joint-impact so you can respect the user equipment and active injuries. Never invent " +
      "an exercise that is not in a returned page. " +
      "For plan/选动作 flows prefer find_exercises (combined criteria, ranked short list).",
  );

const findExercisesSchema = z
  .object({
    muscle_groups: z
      .array(ExerciseMuscleSchema)
      .min(1)
      .max(6)
      .describe(
        "Target muscles (1-6, 17-muscle controlled vocab). Primary-OR-secondary match; " +
          "rows whose PRIMARY muscles hit rank first (score = primary×3 + secondary×1).",
      ),
    movement_pattern: z
      .enum(MOVEMENT_PATTERN_VALUES)
      .optional()
      .describe(
        "Server-derived movement pattern: push/pull/squat/hinge/carry/core (strength " +
          "patterns, derived from name+category+force) / cardio / stretch. " +
          "NULL-classified accessory moves are excluded by this filter — omit it when " +
          "hunting accessories (calf raises, hip abduction...).",
      ),
    equipment: z
      .array(ExerciseEquipmentSchema)
      .min(1)
      .max(5)
      .optional()
      .describe(
        "User-available equipment (up to 5 of the 15-vocab). Rows whose primary equipment " +
          "is in the list match; NULL-equipment rows count as bodyweight.",
      ),
    difficulty: z
      .enum(["beginner", "intermediate", "advanced"])
      .optional()
      .describe(
        "User fitness level (DB difficulty_level; novice ≈ beginner). Exact match — " +
          "beginner plans should pass beginner.",
      ),
    exclude_ids: z
      .array(z.string().min(1).max(24))
      .max(50)
      .optional()
      .describe(
        "Exercise ids to EXCLUDE (already planned this week / user dislikes). Keep total " +
          "filters in mind: excluding from a small pool may zero out results.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .describe(
        "Short-list size (default 10, max 30). A ranked TOP slice — no pagination, no offset.",
      ),
  })
  .describe(
    "Combined-criteria exercise search returning a RANKED short list (read-only). Plan-flow " +
      "replacement for per-body-part paging: one call narrows 肌群×模式×器械×难度 at once. " +
      "Returns {total, count, limit, filters_applied, exercises:[{id, name, name_zh, " +
      "exercise_type, difficulty, equipment, movement_pattern, matched, description}]} — " +
      "total = whole-library matches before the limit slice. total=0 → relax_hint counts " +
      "which SINGLE dimension to drop (try the highest-yield one). Converge in ≤3 calls.",
  );

const getExerciseDetailSchema = z
  .object({
    id: z.string().min(1).max(24).describe("Exact exercise id."),
  })
  .describe(
    "Fetch the full record of one exercise (deepened teaching columns, tutorials, content_html). Read-only.",
  );

const getSessionHrCurveSchema = z
  .object({
    session_id: z
      .string()
      .uuid()
      .describe(
        "Session uuid (fit://session/{sid}/...). Must belong to the calling user.",
      ),
  })
  .describe(
    "Read the heart-rate curve of one workout session: 5s-resolution samples + avg/max/min stats. " +
      "Read-only, scoped to the calling user. Use AFTER a workout to interpret pacing, " +
      "intensity zones, or recovery — do NOT ask the user to type HR values.",
  );

const getHrTrendSchema = z
  .object({
    days: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .describe("Look-back window in days (default 30)."),
    min_samples: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Minimum samples per session to include (noise guard, default 10).",
      ),
  })
  .describe(
    "Cross-session heart-rate trend: per-session avg/max/min + a coarse direction " +
      "(rising/stable/falling/insufficient). Read-only, scoped to the calling user. " +
      "Use for weekly/monthly load and recovery discussion.",
  );

const exerciseEntrySchema = z
  .object({
    name: z.string().max(120).describe('Exercise name, e.g. "Back Squat".'),
    sets: z.number().int().positive().optional(),
    reps: z.number().int().positive().optional(),
    weight: z
      .number()
      .optional()
      .describe("Weight used (kg or lb, as configured)."),
    rpe: z.number().min(0).max(10).optional(),
  })
  .passthrough();

const writeSessionSchema = z
  .object({
    summary: z
      .string()
      .min(1)
      .max(500)
      .describe("One-line summary of the completed session."),
    date: z
      .string()
      .max(20)
      .optional()
      .describe('ISO date of the session, e.g. "2026-07-11".'),
    exercises: z
      .array(exerciseEntrySchema)
      .max(50)
      .optional()
      .describe("Exercises performed in this session."),
    notes: z.string().max(1000).optional(),
  })
  .passthrough()
  .describe("Append a completed training session to the current user history.");

const writeMemorySchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .describe('Stable key for this memory, e.g. "knee_irritation_2026".'),
    content: z
      .string()
      .min(1)
      .max(2000)
      .describe("Free-text memory content to remember about the user."),
  })
  .passthrough()
  .describe(
    "Write/overwrite a memory note keyed under the current user profile.",
  );

const createExerciseSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .describe(
        'Exercise name in the user\'s language, e.g. "单臂哑铃划船（左）". Must not duplicate an existing library name.',
      ),
    exercise_type: ExerciseTypeEnum.describe(
      "Pick by how the movement is measured (assisted uses NEGATIVE assistance weight).",
    ),
    targets_primary: z
      .array(z.string().max(40))
      .max(6)
      .optional()
      .describe('Primary muscle groups, e.g. ["背阔肌", "斜方肌"].'),
    equipment_required: z
      .array(z.string().max(40))
      .max(8)
      .optional()
      .describe(
        'Equipment needed, e.g. ["哑铃", "平凳"]. Empty for bodyweight.',
      ),
    description: z
      .string()
      .max(300)
      .optional()
      .describe(
        "One-line description: movement pattern + target muscles + equipment, same style as list_exercises descriptions.",
      ),
    tutorial_md: z
      .string()
      .max(8000)
      .optional()
      .describe(
        "Optional Markdown tutorial in the SAME 4-section format the frontend coach generates (### 动作作用 / ### 发力心法 / ### 注意事项 / ### 容易做错的地方). Generate it for custom moves the library does not cover.",
      ),
  })
  .passthrough()
  .describe(
    "Create a NEW user-bound exercise when the library has no suitable match. The exercise is visible ONLY to the calling user (bound server-side via the owner_user_id column). The id is generated server-side and returned — use it in plan cards. Check list_exercises FIRST; do not create a near-duplicate of an existing exercise.",
  );

const updateProfileSchema = z
  .object({
    load_anchors: z
      .record(z.string(), z.any())
      .optional()
      .describe(
        "Replacement load_anchors map (exercise name -> anchor object, e.g. {type,best_weight,best_reps}). REPLACES the whole map — to update one anchor, load_history first, merge, then pass the full map.",
      ),
    active_limitations: z
      .array(
        z
          .object({
            part: z.string().describe('Body part, e.g. "left_knee".'),
            severity: z.number().min(1).max(10).describe("1-10 severity."),
            expire_at: z.string().describe("ISO 8601 UTC auto-heal timestamp."),
            logged_at: z.string().describe("ISO 8601 UTC when logged."),
            auto_heal: z
              .boolean()
              .optional()
              .describe(
                "false = long-term/chronic injury that must NOT auto-expire " +
                  "(survey-reported old injuries); omit/true = self-healing window.",
              ),
            note: z
              .string()
              .optional()
              .describe(
                "Injury free-text as reported by the user (e.g. survey 原文、旧伤细节). " +
                  "Carries the original wording; severity alone cannot hold it.",
              ),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        "Replacement active_limitations array. To ADD a limitation, load_history first, append it, then pass the full array here. " +
          "Long-term/chronic injuries: auto_heal:false + note with the user's original wording.",
      ),
    recovery_state: z
      .object({
        total_score: z
          .number()
          .min(0)
          .max(100)
          .describe("0-100 recovery score."),
        last_assessed: z.string().describe("ISO 8601 UTC."),
        cns_fusing: z.boolean().optional(),
        acute_load: z.number().optional(),
        chronic_load: z.number().optional(),
      })
      .passthrough()
      .optional()
      .describe("Replacement recovery_state."),
    psychological: z
      .object({
        neurotype: z
          .enum(["type_1", "type_2a", "type_2b", "type_3"])
          .optional()
          .describe(
            "Neuro type (PsychoOS) inferred from coaching conversations. Only set it when the user explicitly aligns with the type description during the chat — never guess.",
          ),
        risk_preference: z
          .enum(["conservative", "moderate", "aggressive"])
          .optional()
          .describe("User's stated risk preference for load progression."),
        accountability: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("User's self-reported accountability level."),
      })
      .passthrough()
      .optional()
      .describe(
        "Replacement psychological sub-object inside profile_static (neurotype / risk_preference / accountability). Only write what the user explicitly stated.",
      ),
  })
  .passthrough()
  .describe(
    "Structured update to the current user profile (profile_dynamic: load_anchors / active_limitations / recovery_state; profile_static.psychological: neurotype / risk_preference / accountability). Shallow-merges into the target JSONB; always targets the calling user. Use after a workout to record new anchors, limitations, recovery, or after a conversation to record explicitly stated psychological traits.",
  );

export type SessionInput = z.infer<typeof writeSessionSchema>;
export type MemoryInput = z.infer<typeof writeMemorySchema>;
export type ProfileUpdateInput = z.infer<typeof updateProfileSchema>;

// ---------------------------------------------------------------------------
// Weekly plan tool schemas (E3: 计划为持久化实体，每周一次语义)
// ---------------------------------------------------------------------------

const getCurrentPlanSchema = z
  .object({
    week_id: z
      .string()
      .regex(WEEK_ID_PATTERN, "ISO week YYYY-Www (e.g. 2026-W40)")
      .optional()
      .describe(
        "ISO week id YYYY-Www. OMIT it to read the CURRENT week " +
          "(resolved server-side — never compute calendar math yourself).",
      ),
  })
  .describe(
    "Read the user's persisted weekly plan (weekly_plans + plan_entries). " +
      "Read-only, scoped to the calling user. ALWAYS call this BEFORE generating " +
      "a weekly plan: plans are persisted entities with reuse-by-default semantics " +
      "(one plan per user per week) — if a plan already exists for the week, " +
      "REUSE it and adjust entries on request instead of regenerating.",
  );

// [B5b issue#38] save_weekly_plan 工具已移除：周计划写入改为提案-确认架构——
// Agent 提案轮算好 entries 随 weekly_plan 卡携带（data.apply 载荷），用户点
// 「确认启用」后前端直调 POST /api/schedule/weekly-plan/apply 确定性落库。
// 确认前计划不进数据库（根治「计划不知什么时候就出现了」）。读取仍走
// get_current_plan；调整/重算同经确认端点（scope=days / week）。
// [T9 #66] apply 载荷 entries 单条形态（含 day_focus/rationale/category/sets
// 结构化字段）契约真源 = shared/contracts PlanEntryInputSchema——此处不再
// 维护本地副本（旧 save_weekly_plan 时代的 weeklyPlanEntryInputSchema 已删，
// 防双源漂移），Agent 侧字段速查见 /data-schema/knowledge/plan.md。

// ---------------------------------------------------------------------------
// Scoped write helpers (exposed so B2/B3 can drive the guard with real PG)
// ---------------------------------------------------------------------------

/**
 * Append one session to `history_summary.sessions` for `targetUserId`, but only
 * if `targetUserId === injectedUserId`. The tool always calls this with the two
 * equal; tests call it with them unequal to prove the guard rejects (B2/B3).
 */
export async function writeSessionForUser(
  writeRepo: UserScopedWriteRepository,
  injectedUserId: string,
  targetUserId: string,
  session: SessionInput,
): Promise<{ ok: true; userId: string; sessions_count: number }> {
  assertUserScope(injectedUserId, targetUserId); // B2/B3: rejects cross-user write
  const current = (await writeRepo.readHistorySummary(targetUserId)) ?? {};
  const sessions = Array.isArray(current.sessions)
    ? (current.sessions as unknown[])
    : [];
  sessions.push({ ...session, recorded_at: new Date().toISOString() });
  await writeRepo.mergeHistorySummary(targetUserId, { sessions });
  return { ok: true, userId: targetUserId, sessions_count: sessions.length };
}

/**
 * Write/overwrite one memory note at `profile_dynamic.memories[key]` for
 * `targetUserId`, scoped to `injectedUserId`.
 */
export async function writeMemoryForUser(
  writeRepo: UserScopedWriteRepository,
  injectedUserId: string,
  targetUserId: string,
  memory: MemoryInput,
): Promise<{ ok: true; userId: string; key: string }> {
  assertUserScope(injectedUserId, targetUserId); // B2/B3: rejects cross-user write
  const existing = await readProfileDynamicMemories(writeRepo, targetUserId);
  const memories = { ...existing, [memory.key]: memory.content };
  await writeRepo.mergeProfileDynamic(targetUserId, { memories });
  return { ok: true, userId: targetUserId, key: memory.key };
}

/**
 * Shallow-merge a structured `update` into `profile_dynamic` for `targetUserId`,
 * scoped to `injectedUserId`.
 */
export async function updateProfileForUser(
  writeRepo: UserScopedWriteRepository,
  injectedUserId: string,
  targetUserId: string,
  update: ProfileUpdateInput,
): Promise<{ ok: true; userId: string; updated_fields: string[] }> {
  assertUserScope(injectedUserId, targetUserId); // B2/B3: rejects cross-user write
  const filtered = Object.fromEntries(
    Object.entries(update).filter(([, v]) => v !== undefined),
  );
  // 分流：psychological 写入 profile_static（neuro_type 等低频画像字段），
  // 其余字段写入 profile_dynamic（load_anchors / active_limitations / recovery_state）
  const { psychological, ...dynamicPart } = filtered;
  if (psychological !== undefined) {
    await writeRepo.mergeProfileStatic(targetUserId, {
      psychological,
    });
  }
  if (Object.keys(dynamicPart).length > 0) {
    await writeRepo.mergeProfileDynamic(targetUserId, dynamicPart);
  }
  return {
    ok: true,
    userId: targetUserId,
    updated_fields: Object.keys(filtered),
  };
}

/** Read just the `memories` map from `profile_dynamic` (used for read-modify-write). */
async function readProfileDynamicMemories(
  repo: UserScopedWriteRepository,
  userId: string,
): Promise<Record<string, string>> {
  const pd = await repo.readProfileDynamic(userId);
  const memories = pd?.memories;
  return memories && typeof memories === "object"
    ? (memories as Record<string, string>)
    : {};
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Assemble the agent's domain tools on top of an explicit DB client. The
 * optional `injectedUserId` is a TEST fallback used only when the LangGraph ALS
 * context is absent; production passes `undefined` and resolves per-request.
 *
 * #151 S2 双轨：`opts.cardChannels` 提供且某卡型为 tool 通道时，追加对应
 * submit_xxx 薄工具（内核见 cardSubmit.ts）。不传（旧调用/旧测试）则不追加
 * ——工具清单与双轨改造前完全一致。
 */
export function buildMcpToolsWith(
  client: DbClient,
  injectedUserId?: string,
  opts?: {
    cardChannels?: CardChannels;
    injectedThreadId?: string;
    injectedScenario?: string;
  },
): DynamicStructuredTool[] {
  const loadHistory = new DynamicStructuredTool({
    name: "load_history",
    description:
      "Load the current user training history (history_summary, recent sessions), static profile, " +
      "AND dynamic profile (load_anchors, active_limitations, recovery_state). Read-only. Scoped to the calling user. " +
      "ALWAYS call this before generating a plan — the dynamic profile holds the hard constraints (equipment the user owns, active injuries, recovery). " +
      "profile_static carries the first-use survey values: basic_info (weight/age/height/gender/training_age) and " +
      "preferences (goal incl. body_recomp / weekly_frequency_days / equipment = EXERCISE_EQUIPMENT values / " +
      "time_constraint). profile_dynamic.active_limitations entries may carry `note` — the user's original injury " +
      "wording (旧伤细节); read it, don't infer from severity alone.",
    schema: loadHistorySchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const userRepo = createUserRepository(client);
      const limit = input.limit ?? 10;

      // Training history comes from the `sessions` table directly (source of
      // truth written by every sync/push) — no reliance on the auto-compressed
      // users.history_summary, which drops detail the model needs and is never
      // maintained on this write path. history_summary.sessions still joins the
      // merge as the carrier of write_session Agent-recorded memory entries.
      const history = await userRepo
        .getHistorySummary(userId)
        .catch(() => null);
      let liveRows: Array<{ raw_json: unknown }> = [];
      try {
        // batch4-4: 直连 client.queryMany 改走 Repository 方法（消除工具体内的
        // 最后一条原生 SQL 数据缝）。
        liveRows = await new UserScopedWriteRepository(
          client,
        ).getRecentSessionRaws(userId, limit * 3);
      } catch {
        liveRows = [];
      }
      // #97 红线3「无缺漏无错误」交付硬校验：live 行先过 agent-delivery 门卫
      // （归一 + 全字段 Zod + 关系引用完整性），坏行扣下并上浮原因——拒付
      // 可见（delivery_gate），绝不静默进 Agent。被扣行的 write_session 记忆
      // 条目（如有）仍经下方 merge 以 summary 源补位，不受连带。
      let deliveryGate: {
        validated: number;
        rejected: Array<{
          session_id: string | null;
          code: string;
          reason: string;
        }>;
      } | null = null;
      if (liveRows.length > 0) {
        let knownExerciseIds: Set<string> | undefined;
        try {
          knownExerciseIds = await new ExerciseQuery(client).listAllIds();
        } catch (err) {
          // 引用全集读不到时只做结构校验并留痕——库扫描失败 ≠ 会话数据坏，
          // 不因旁路读失败扣下整段历史（拒付必须有据）。
          console.error(
            "[load_history] exercise id universe unavailable, reference check skipped:",
            err,
          );
        }
        const gate = gateSessionsForAgentDelivery(liveRows, {
          knownExerciseIds,
        });
        liveRows = gate.delivered.map((s) => ({ raw_json: s }));
        if (gate.rejected.length > 0) {
          console.error(
            `[load_history] delivery gate rejected ${gate.rejected.length} session(s):`,
            gate.rejected,
          );
        }
        deliveryGate = {
          validated: gate.delivered.length,
          rejected: gate.rejected,
        };
      }
      const trimmed = trimSessions(
        {
          sessions: mergeHistorySources(
            (history as Record<string, unknown> | null)?.sessions,
            liveRows,
            limit,
          ),
          ...(deliveryGate ? { delivery_gate: deliveryGate } : {}),
        },
        limit,
      );
      let profileStatic: unknown = null;
      if (input.include_profile !== false) {
        try {
          profileStatic = await userRepo.getProfileStatic(userId);
        } catch {
          profileStatic = null;
        }
      }
      let profileDynamic: unknown = null;
      if (input.include_dynamic !== false) {
        try {
          profileDynamic = await userRepo.getProfileDynamic(userId);
        } catch {
          profileDynamic = null;
        }
      }
      return JSON.stringify({
        userId,
        history_summary: trimmed,
        profile_static: profileStatic,
        profile_dynamic: profileDynamic,
      });
    },
  });

  const listExercises = new DynamicStructuredTool({
    name: "list_exercises",
    description:
      "Browse the exercise library with filters + pagination (read-only): {body_part, equipment, " +
      "keyword, limit (default 30, max 100), offset}. The full library (~355) NEVER fits in one " +
      "call — filter first (plan flows: one body_part per needed muscle group), page with offset " +
      "only when has_more=true. Returns {total, count, offset, limit, has_more, exercises:[{id, " +
      "name, name_zh, exercise_type, description}]}. `exercise_type` tells you which fields are " +
      "required (isometric needs duration, outdoor needs distance, resistance needs weight). " +
      "`name_zh` is the official Chinese display name (never translate names yourself — " +
      "user-facing output MUST use it); `description` carries pattern/targets/equipment/joint-impact. " +
      "Never invent an exercise that is not in a returned page.",
    schema: listExercisesSchema,
    func: async (input) => {
      const exerciseQuery = new ExerciseQuery(client);
      const limit = input.limit ?? 30;
      const offset = input.offset ?? 0;
      const { rows, total } = await exerciseQuery.listPage({
        body_part: input.body_part,
        equipment: input.equipment,
        keyword: input.keyword,
        limit,
        offset,
      });
      const exercises = rows.map((r) => ({
        id: r.id,
        name: r.name,
        // [B5b issue#38] 中文名随库直出——展示层确定性中文化，Agent 禁止自行翻译
        name_zh: r.name_zh ?? r.name,
        exercise_type: r.exercise_type,
        description: describeExercise(r),
      }));
      // 42b (issue #42): total + has_more 告知 Agent 还有下一页可翻；
      // count 是本页行数（兼容旧字段语义：count = 本页 exercises 数）。
      return JSON.stringify({
        total,
        count: exercises.length,
        offset,
        limit,
        has_more: offset + exercises.length < total,
        exercises,
      });
    },
  });

  // [T2 issue#54] 组合筛选 + 精排短列表：计划流「选动作」的主工具——
  // 一次调用同时收窄 肌群×模式×器械×难度，按目标肌群命中度精排；
  // 空结果带 relax_hint（逐维度放宽计数），替代翻页遍历。
  const findExercises = new DynamicStructuredTool({
    name: "find_exercises",
    description:
      "Search the exercise library by COMBINED training criteria and get a RANKED short list " +
      "(read-only). Plan/选动作 flows: PREFER this over list_exercises — one call narrows " +
      "muscle×pattern×equipment×difficulty at once and ranks by target-muscle match " +
      "(primary hits first). Returns {total, count, limit, filters_applied, exercises:[{id, " +
      "name, name_zh, exercise_type, difficulty, equipment, movement_pattern, matched, " +
      "description}]}; total = whole-library matches BEFORE the limit slice. total=0 → " +
      "relax_hint names the SINGLE dimension to drop (pick its highest count). Converge in " +
      "≤3 calls: relax one dimension per retry — this tool has NO pagination. " +
      "movement_pattern excludes NULL-classified accessories (calf raises, hip " +
      "abduction...): omit the pattern filter when hunting accessories.",
    schema: findExercisesSchema,
    func: async (input) => {
      const exerciseQuery = new ExerciseQuery(client);
      const filters = {
        muscle_groups: input.muscle_groups,
        movement_pattern: input.movement_pattern,
        equipment: input.equipment,
        difficulty: input.difficulty,
        exclude_ids: input.exclude_ids,
      };
      const { rows, total } = await exerciseQuery.findRanked({
        ...filters,
        limit: input.limit,
      });
      const exercises = rows.map((r) => ({
        id: r.id,
        name: r.name,
        // [B5b issue#38] 中文名随库直出——展示层确定性中文化，Agent 禁止自行翻译
        name_zh: r.name_zh ?? r.name,
        exercise_type: r.exercise_type,
        difficulty: r.difficulty,
        equipment: r.equipment ?? "bodyweight",
        movement_pattern: r.movement_pattern,
        matched:
          r.primary_matches > 0 ? ("primary" as const) : ("secondary" as const),
        description: describeExercise(r),
      }));
      const filtersApplied = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v != null),
      );
      if (total === 0) {
        // 引导性空态（验证门 #2）：逐维度放宽计数，Agent 按最高产出的单一维度放宽重查。
        const relaxHint = await exerciseQuery.relaxCounts(filters);
        return JSON.stringify({
          total,
          count: 0,
          limit: input.limit,
          filters_applied: filtersApplied,
          exercises: [],
          relax_hint: {
            message:
              "0 matches. Relax ONE dimension and retry — counts below are whole-library " +
              "hits with that single dimension dropped (highest count first).",
            ...relaxHint,
          },
        });
      }
      return JSON.stringify({
        total,
        count: exercises.length,
        limit: input.limit,
        filters_applied: filtersApplied,
        note: "已按需求组合过滤并精排（主肌群命中优先，score=primary×3+secondary×1）；无分页。",
        exercises,
      });
    },
  });

  const getExerciseDetail = new DynamicStructuredTool({
    name: "get_exercise_detail",
    description:
      "Fetch the full record of one exercise by id (deepened teaching columns: equipment/category/body_part, primary/secondary_muscles, " +
      "instructions, form_cues, common_mistakes, breathing; plus tutorials, content_html). " +
      "Read-only. Optional drill-down after list_exercises when you need a candidate tutorials/content_html " +
      "or to confirm impact_level on an injured joint. Answer teaching questions (steps/form/mistakes) " +
      "from the returned library fields instead of inventing them.",
    schema: getExerciseDetailSchema,
    func: async (input) => {
      const exerciseQuery = new ExerciseQuery(client);
      const row = await exerciseQuery.findByIdFull(input.id);
      if (!row) {
        return JSON.stringify({ found: false, id: input.id });
      }
      return JSON.stringify({ found: true, exercise: row });
    },
  });

  const getSessionHrCurve = new DynamicStructuredTool({
    name: "get_session_hr_curve",
    description:
      "Read the heart-rate curve of one workout session (5s samples + avg/max/min). " +
      "Read-only, scoped to the calling user. Interpret pacing / intensity zones / recovery " +
      "from the returned curve — never ask the user to type HR values.",
    schema: getSessionHrCurveSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const hrRepo = createHeartRateRepository(client);
      const curve = await hrRepo.getSessionCurve(userId, input.session_id);
      if (!curve) {
        return JSON.stringify({
          found: false,
          message:
            "Session not found or not owned by the calling user. The session id must match one of the user's sessions.",
        });
      }
      return JSON.stringify({ found: true, curve });
    },
  });

  const getHrTrend = new DynamicStructuredTool({
    name: "get_hr_trend",
    description:
      "Cross-session heart-rate trend: per-session avg/max/min over the last N days + coarse " +
      "direction (rising/stable/falling/insufficient). Read-only, scoped to the calling user. " +
      "Use for weekly/monthly load and recovery discussion.",
    schema: getHrTrendSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const hrRepo = createHeartRateRepository(client);
      const days = input.days ?? 30;
      const minSamples = input.min_samples ?? 10;
      const rows = await hrRepo.getTrend(userId, days, minSamples);
      const avgs = rows.map((r) => r.avg_bpm);
      let trend: "rising" | "stable" | "falling" | "insufficient" =
        "insufficient";
      if (rows.length >= 3) {
        // Coarse least-squares slope over per-session avg bpm vs. time index.
        const n = rows.length;
        const xs = avgs.map((_, i) => i);
        const meanX = xs.reduce((a, b) => a + b, 0) / n;
        const meanY = avgs.reduce((a, b) => a + b, 0) / n;
        let num = 0;
        let den = 0;
        for (let i = 0; i < n; i++) {
          num += (xs[i] - meanX) * (avgs[i] - meanY);
          den += (xs[i] - meanX) * (xs[i] - meanX);
        }
        const slope = den === 0 ? 0 : num / den;
        const threshold = 0.5; // bpm per session — below this it's noise
        trend =
          slope > threshold
            ? "rising"
            : slope < -threshold
              ? "falling"
              : "stable";
      }
      return JSON.stringify({ user_id: userId, sessions: rows, trend });
    },
  });

  const createExercise = new DynamicStructuredTool({
    name: "create_exercise",
    description:
      "Create a NEW user-bound exercise (visible ONLY to the calling user) when the library lacks a suitable movement. " +
      "Check list_exercises FIRST and never create a near-duplicate. The NanoID id is generated SERVER-SIDE and returned — " +
      "use the returned id in plan cards. Optionally attach a Markdown tutorial in the same 4-section format the " +
      "frontend coach tutorial uses (### 动作作用 / ### 发力心法 / ### 注意事项 / ### 容易做错的地方).",
    schema: createExerciseSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const exerciseQuery = new ExerciseQuery(client);

      // Duplicate-name guard: fail loudly with an actionable message instead
      // of a raw UNIQUE violation from the driver.
      if (await exerciseQuery.nameExists(input.name)) {
        return JSON.stringify({
          created: false,
          reason: "name_exists",
          message:
            "An exercise with this name already exists in the library. Call list_exercises and use the existing id instead of creating a duplicate.",
        });
      }

      // Server-side NanoID (never LLM-supplied) + user binding via the
      // owner_user_id column (002 promoted it out of the dropped attributes
      // JSONB). Free-form agent input (targets/equipment/description) is NOT
      // persisted into the vocab-constrained 002 columns — it rides back in
      // this response so the agent can describe the move in its own cards.
      const id = generateExerciseNanoId();

      await exerciseQuery.insertUserExercise({
        id,
        name: input.name,
        exercise_type: input.exercise_type,
        owner_user_id: userId,
        // Tutorial persisted into content_html so ExerciseTutorialModal renders
        // it with the same priority as coach/admin-generated tutorials
        // (content_html is the top slot in the modal's source priority).
        content_html: input.tutorial_md ?? null,
        modified_by: "system",
      });

      return JSON.stringify({
        created: true,
        id,
        name: input.name,
        exercise_type: input.exercise_type,
        description: input.description ?? "",
        targets_primary: input.targets_primary ?? [],
        equipment_required: input.equipment_required ?? [],
        visibility: "user_only",
        message:
          "Exercise created and bound to the current user. Use this id in plan cards. " +
          "The library stores only the tutorial for customs — describe targets/equipment " +
          "yourself when referencing this id.",
      });
    },
  });

  const writeSession = new DynamicStructuredTool({
    name: "write_session",
    description:
      "Append a completed training session to the current user history. Always writes to the calling user; the agent cannot target another user.",
    schema: writeSessionSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const writeRepo = new UserScopedWriteRepository(client);
      const res = await writeSessionForUser(writeRepo, userId, userId, input);
      notifySuggestionCacheInvalidation(userId, "session_completed");
      return JSON.stringify(res);
    },
  });

  const writeMemory = new DynamicStructuredTool({
    name: "write_memory",
    description:
      "Write or overwrite a free-text memory note about the current user (keyed). Always writes to the calling user; the agent cannot target another user.",
    schema: writeMemorySchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const writeRepo = new UserScopedWriteRepository(client);
      const res = await writeMemoryForUser(writeRepo, userId, userId, input);
      return JSON.stringify(res);
    },
  });

  const updateProfile = new DynamicStructuredTool({
    name: "update_profile",
    description:
      "Structured update of the current user profile (load_anchors / active_limitations / recovery_state, plus psychological: neurotype / risk_preference / accountability). " +
      "Use AFTER a workout to record new performance anchors, fresh limitations, or recovery state, or after a conversation where the user explicitly stated psychological traits. Always writes to the calling user.",
    schema: updateProfileSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const writeRepo = new UserScopedWriteRepository(client);
      const res = await updateProfileForUser(writeRepo, userId, userId, input);
      notifySuggestionCacheInvalidation(userId, "profile_updated");
      return JSON.stringify(res);
    },
  });

  const getCurrentPlan = new DynamicStructuredTool({
    name: "get_current_plan",
    description:
      "Read the user's persisted weekly plan (plan + all entries). Read-only, scoped to the calling user. " +
      "ALWAYS call BEFORE generating a weekly plan — plans are persisted entities with reuse-by-default " +
      "semantics (one per user per week); when a plan exists, reuse and adjust it, never regenerate.",
    schema: getCurrentPlanSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({
        explicitConfig: config,
        injectedUserId,
      });
      const weekId = input.week_id ?? getIsoWeekId(utcToday());
      const planRepo = createWeeklyPlanRepository(client);
      const result = await planRepo.getWeeklyPlanByUserAndWeek(userId, weekId);
      if (!result) {
        return JSON.stringify({
          found: false,
          week_id: weekId,
          message:
            "No plan for this week yet — the weekly FRAMEWORK is missing. Build one " +
            "(load_history → find_exercises per split day → weekly_plan card with data.apply payload, " +
            "scope='week') respecting the user's weekly days, equipment and injuries. " +
            "The plan persists ONLY after the user confirms the card (proposal-confirm; " +
            "there is no save tool).",
        });
      }
      return JSON.stringify({
        found: true,
        plan: result.plan,
        entries: result.entries,
        message:
          "Plan for this week already exists (reuse-by-default). Adjust entries " +
          "conversationally on request; do NOT regenerate the week.",
      });
    },
  });

  // [B5b issue#38] save_weekly_plan 工具随提案-确认架构移除（见上方工具表
  // 注释）——周计划写入只经确认端点，Agent 不再直接落库。

  // #151 S2 卡片工具通道：channel=tool 的卡型追加 submit_xxx 薄工具
  // （ExerciseQuery 全集经闭包注入 cardSubmit 内核，防循环依赖）。不传
  // cardChannels（旧测试）时为空数组，工具清单与改造前一致。
  const cardSubmitTools = opts?.cardChannels
    ? buildCardSubmitTools(
        {
          listExerciseIds: () => new ExerciseQuery(client).listAllIds(),
          injectedUserId,
          injectedThreadId: opts.injectedThreadId,
          injectedScenario: opts.injectedScenario,
        },
        opts.cardChannels,
      )
    : [];

  return [
    loadHistory,
    listExercises,
    findExercises,
    getExerciseDetail,
    getSessionHrCurve,
    getHrTrend,
    createExercise,
    writeSession,
    writeMemory,
    updateProfile,
    getCurrentPlan,
    ...cardSubmitTools,
  ];
}

/**
 * Production entry point (P006: userId resolved per-request via LangGraph ALS;
 * client = singleton). Returns the eleven domain tools（+ 按 `channels` 追加的
 * submit_xxx 卡片工具；不传 = 全 fence，不追加——与既有调用兼容）。
 * 通道解析（DB > env > 默认）在 DeepAgentService.assembleAgent 完成后传入。
 */
export function buildMcpTools(
  channels?: CardChannels,
): DynamicStructuredTool[] {
  return buildMcpToolsWith(
    getPostgresClient(),
    undefined,
    channels ? { cardChannels: channels } : undefined,
  );
}

// ---------------------------------------------------------------------------
// 同轮幂等工具结果缓存（#116 / #68，2026-10-03）
// ---------------------------------------------------------------------------

/**
 * 参与同轮缓存的工具白名单——仅幂等只读工具（任务书 #116 指定四件）。
 * 白名单外一律直通：写类工具（write_session / write_memory / update_profile /
 * create_exercise / write_file / edit_file / execute）绝不缓存，其余读类
 * 工具（get_current_plan / get_exercise_detail / HR 双件 / ls / glob / grep）
 * 保守起见也不缓存（只是拿不到加速，语义无影响）。
 *
 * 背景：2026-10-03 深研报告实锤——首计划轮 load_history 同轮被调 9 次（纯
 * 重复），每次重复 = 一整步 LLM 思考重读 + 8-56s 往返；缓存命中直接砍掉
 * 重复步 ≈ 省 2-4 分钟/轮（refs #68）。
 */
export const TURN_CACHEABLE_TOOLS: ReadonlySet<string> = new Set([
  "load_history",
  "find_exercises",
  "list_exercises",
  "read_file",
]);

/**
 * 会改变缓存可见数据的工具——执行前清空该线程的本轮缓存（轮内写后读
 * 新鲜度：write_session 后再 load_history 必须拿到写入后的数据，而不是
 * 命中写前的缓存）。写类工具本身从不进缓存（不在 TURN_CACHEABLE_TOOLS）。
 */
const TURN_CACHE_INVALIDATING_TOOLS: ReadonlySet<string> = new Set([
  "write_session",
  "write_memory",
  "update_profile",
  "create_exercise",
  "write_file",
  "edit_file",
  "execute",
]);

/** 一个线程当轮的缓存体：turnId 标识轮次，entries 为「工具名+参数指纹→结果」。 */
interface ThreadTurnCache {
  turnId: string;
  entries: Map<string, { content: ToolMessage["content"]; name?: string }>;
}

/**
 * 线程级轮缓存存储。按 thread_id 隔离（跨用户/跨会话绝不共享——缓存键不含
 * userId，共享即数据串台）；值在每次 beforeAgent 钩子（= 每个 chat() 轮开始）被
 * 整体替换，旧轮条目随之不可达 → 轮结束即弃，禁止跨轮缓存（数据新鲜度）。
 */
const turnToolCaches = new Map<string, ThreadTurnCache>();

/**
 * 稳定序列化（深比较语义）：对象键递归排序后序列化，`{a:1,b:2}` 与
 * `{b:2,a:1}` 同键；数组保序（顺序有语义）。undefined 用独立记号，与
 * null/缺键区分，杜绝碰撞。
 */
export function stableStringifyToolArgs(value: unknown): string {
  if (value === undefined) return "«undefined»";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "«unserializable»";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyToolArgs).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringifyToolArgs(record[k])}`)
    .join(",")}}`;
}

/** 打点用参数指纹（截断，避免 exclude_ids 长数组刷屏）。 */
function argsFingerprint(args: unknown): string {
  const s = stableStringifyToolArgs(args);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/** 从 middleware runtime 读 thread_id（缺席返回 null——无法安全定界则不缓存）。 */
function threadIdFromRuntime(runtime: unknown): string | null {
  const tid = (
    runtime as { configurable?: { thread_id?: unknown } } | undefined
  )?.configurable?.thread_id;
  return typeof tid === "string" && tid.length > 0 ? tid : null;
}

/** 仅供测试隔离使用：清空全部轮缓存。 */
export function __resetTurnToolCacheForTests(): void {
  turnToolCaches.clear();
}

/**
 * 同轮幂等工具缓存中间件（#116 落点，DeepAgentService.assembleAgent 组装）。
 *
 * - `beforeAgent`：每个 agent 调用（= chat() 一轮）开始时为该线程开启全新
 *   缓存体——上一轮条目整体作废，即「轮结束即弃、禁止跨轮缓存」。
 * - `wrapToolCall`：单一收口，同时覆盖本文件 mcpTools 与 deepagents 内置
 *   filesystem 工具（read_file）。白名单内同轮「同工具名+同参数（深比较）」
 *   的重复调用直接复用首轮结果（重建 ToolMessage、换当前 tool_call_id），
 *   命中打点 console.info（工具名+参数指纹）供验收统计；白名单外直通。
 * - 隔离：存储按 thread_id 分仓。同线程轮次天然串行（LangGraph checkpoint
 *   语义），跨线程并发互不影响；thread_id 缺席时整体降级为不缓存。
 * - 新鲜度：写类工具（TURN_CACHE_INVALIDATING_TOOLS）执行前清空本轮缓存，
 *   轮内「写后读」拿到写入后数据；错误结果（ToolMessage status=error 或
 *   抛异常）不进缓存，瞬时故障不粘轮。
 */
export const turnToolCacheMiddleware = createMiddleware({
  name: "turnScopedIdempotentToolCache",
  // 注意：langchain AgentMiddleware 钩子键为 camelCase（beforeAgent /
  // wrapToolCall）；snake_case 键会被 createMiddleware 静默丢弃（2026-10-03
  // 单测实锤：before_agent 写法钩子不挂、缓存整体失效）。
  beforeAgent: (_state, runtime) => {
    const threadId = threadIdFromRuntime(runtime);
    if (threadId === null) return;
    turnToolCaches.set(threadId, { turnId: randomUUID(), entries: new Map() });
  },
  wrapToolCall: async (request, handler) => {
    const toolCall = request.toolCall as
      { name?: string; args?: unknown; id?: string } | undefined;
    const toolName = toolCall?.name;
    const threadId = threadIdFromRuntime(request.runtime);
    if (!toolName || !toolCall?.id || threadId === null) {
      return handler(request);
    }
    const turn = turnToolCaches.get(threadId);

    // 写类工具：执行前清空本轮缓存（轮内写后读新鲜度），自身绝不缓存。
    if (TURN_CACHE_INVALIDATING_TOOLS.has(toolName)) {
      if (turn && turn.entries.size > 0) {
        turn.entries.clear();
        console.info(
          `[turn-tool-cache] 已因写类工具 ${toolName} 清空本轮缓存（threadId=${threadId}，refs #116）`,
        );
      }
      return handler(request);
    }

    if (!TURN_CACHEABLE_TOOLS.has(toolName) || !turn) {
      return handler(request);
    }

    const cacheKey = `${toolName} ${stableStringifyToolArgs(toolCall.args)}`;
    const hit = turn.entries.get(cacheKey);
    if (hit) {
      console.info(
        `[turn-tool-cache] HIT ${toolName} args=${argsFingerprint(toolCall.args)}（同轮重复同参调用，直接复用，refs #116）`,
      );
      return new ToolMessage({
        content: hit.content,
        tool_call_id: toolCall.id,
        ...(hit.name ? { name: hit.name } : {}),
      });
    }

    const result = await handler(request);
    if (result instanceof ToolMessage && result.status !== "error") {
      turn.entries.set(cacheKey, {
        content: result.content,
        name: result.name,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trim the `sessions` array inside a history summary to the last `limit`. */
function trimSessions(
  history: Record<string, unknown> | null,
  limit: number,
): Record<string, unknown> | null {
  if (!history) {
    return null;
  }
  const sessions = history.sessions;
  if (Array.isArray(sessions) && sessions.length > limit) {
    return { ...history, sessions: sessions.slice(-limit) };
  }
  return history;
}

/**
 * Synthesize a compact one-line description from an exercise's 002 深化列 so the
 * agent can pick safe actions from the full list in-context. Carries exactly the
 * constraint-relevant fields: type/difficulty, mechanic, equipment, body part,
 * and target muscles (bodyweight when no equipment).
 *
 * Robust to partial/missing columns — every field is optional.
 */
function describeExercise(row: ExerciseListRow): string {
  const parts: string[] = [];
  if (row.exercise_type) parts.push(String(row.exercise_type));
  if (row.difficulty) parts.push(String(row.difficulty));
  if (row.mechanic) parts.push(String(row.mechanic));
  if (row.equipment) parts.push(`equipment:${row.equipment}`);
  if (row.body_part) parts.push(`part:${row.body_part}`);
  if (Array.isArray(row.primary_muscles) && row.primary_muscles.length > 0) {
    parts.push(
      `targets:${row.primary_muscles.filter((t) => typeof t === "string").join("+")}`,
    );
  }
  if (!row.equipment) parts.push("equipment:bodyweight");
  return parts.join(" | ");
}
