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
 * ## Tool set (9)
 * - `load_history`        (read)  history_summary + profile_static + profile_dynamic
 * - `list_exercises`      (read)  the WHOLE exercise library as [{id, name, description}].
 *                                 The library is small enough to fit in context, so the agent
 *                                 picks actions itself. `description`
 *                                 carries pattern/targets/equipment/impact so the agent can
 *                                 respect the user equipment + injuries in-context.
 * - `get_exercise_detail` (read)  full record of one exercise (structured columns, tutorials, content)
 * - `write_session`       (write) append a completed session to history_summary
 * - `write_memory`        (write) keyed free-text memory note under profile_dynamic.memories
 * - `update_profile`      (write) structured update of profile_dynamic
 *                                 (load_anchors / active_limitations / recovery_state)
 *                                 + profile_static.psychological
 *                                 (neurotype / risk_preference / accountability)
 * - `create_exercise`     (write) insert a USER-BOUND custom exercise into the
 *                                 library. User-binding rides in the dedicated
 *                                 `owner_user_id` column (HC-2 user binding,
 *                                 promoted from the retired attributes JSONB in
 *                                 migration 002) — the row stays invisible to other
 *                                 users' queries and the admin console filters
 *                                 can adopt it later. A NanoID is generated
 *                                 server-side (never LLM-supplied).
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
import { getConfig } from "@langchain/langgraph";
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
import { mergeHistorySources } from "./historyMerger.js";
import { generateExerciseNanoId } from "../../utils/nanoid.js";
import {
  EXERCISE_MUSCLES,
  EXERCISE_EQUIPMENT,
} from "../../../../shared/dist/contracts/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The PostgresClient type, derived from the accessor to avoid an extra import. */
type DbClient = ReturnType<typeof getPostgresClient>;

/** One exercises row for the list tool (structured columns are synthesized into a description). */
interface ExerciseListRow {
  id: string;
  name: string;
  exercise_type: string | null;
  difficulty: string | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  equipment: string | null;
  force_type: string | null;
  mechanic: string | null;
}

/** Full exercise row for the detail tool. */
interface ExerciseDetailRow {
  id: string;
  name: string;
  name_zh: string | null;
  exercise_type: string | null;
  difficulty: string | null;
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
  aliases: string[] | null;
  owner_user_id: string | null;
  tutorials: unknown;
  content_html: string | null;
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

/**
 * Read-only accessor for the `exercises` table (HC-2: thin read-only wrapper;
 * no `ExerciseRepository` exists yet). SELECT only — no writes.
 */
export class ExerciseQuery extends BaseRepository {
  /**
   * Return the whole exercise library (id/name/type/difficulty + structured
   * classification columns). The library is small enough to fit in the model
   * context, so the agent filters and picks actions in-context — no SQL filtering.
   */
  async listAll(): Promise<ExerciseListRow[]> {
    return this.queryMany<ExerciseListRow>(
      `SELECT id, name, exercise_type, difficulty,
              primary_muscles, secondary_muscles, equipment, force_type, mechanic
         FROM exercises
         ORDER BY name`,
    );
  }

  /** Full record for one exercise by id (structured columns, tutorials, content_html). */
  async findByIdFull(id: string): Promise<ExerciseDetailRow | null> {
    return this.queryOne<ExerciseDetailRow>(
      `SELECT id, name, name_zh, exercise_type, difficulty,
              equipment, category, body_part,
              primary_muscles, secondary_muscles, force_type, mechanic,
              instructions, form_cues, common_mistakes, breathing, aliases,
              owner_user_id, tutorials, content_html
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
   * `owner_user_id` column (promoted from the retired attributes JSONB in
   * migration 002 — HC-2 user binding).
   */
  async insertUserExercise(row: {
    id: string;
    name: string;
    exercise_type: string;
    ownerUserId: string;
    primaryMuscles: string[];
    secondaryMuscles: string[];
    equipment: string | null;
    content_html: string | null;
    modified_by: string;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO exercises (
         id, name, exercise_type, difficulty, owner_user_id,
         primary_muscles, secondary_muscles, equipment,
         content_html, modified_by, updated_at
       )
       VALUES (
         $id, $name, $exerciseType, 'beginner', $ownerUserId::uuid,
         $primaryMuscles::text[], $secondaryMuscles::text[], $equipment::public.exercise_equipment,
         $contentHtml, $modifiedBy, NOW()
       )`,
      {
        id: row.id,
        name: row.name,
        exerciseType: row.exercise_type,
        ownerUserId: row.ownerUserId,
        primaryMuscles: row.primaryMuscles,
        secondaryMuscles: row.secondaryMuscles,
        equipment: row.equipment,
        contentHtml: row.content_html,
        modifiedBy: row.modified_by,
      },
    );
  }
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
  .object({})
  .describe(
    "List the ENTIRE exercise library as [{id, name, description}]. No filters, no arguments — " +
      "the library is small enough to fit in context. Read it ONCE, then pick actions in-context " +
      "respecting the user equipment and any active injuries (from load_history). `description` " +
      "carries pattern / targets / equipment / joint-impact so you can choose safe actions directly. " +
      "Never invent an exercise that is not in the returned list.",
  );

const getExerciseDetailSchema = z
  .object({
    id: z.string().min(1).max(24).describe("Exact exercise id."),
  })
  .describe(
    "Fetch the full record of one exercise (structured classification columns, tutorials, content_html). Read-only.",
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
    exercise_type: z
      .string()
      .max(24)
      .describe(
        "One of: resistance | unilateral | bodyweight | assisted | isometric | cardio | flexibility | heavy_weight | rep_training | outdoor. Pick by how the movement is measured (assisted uses NEGATIVE assistance weight).",
      ),
    targets_primary: z
      .array(z.enum(EXERCISE_MUSCLES))
      .max(6)
      .optional()
      .describe(
        `Primary muscle groups from the 17-muscle vocabulary: ${EXERCISE_MUSCLES.join(" | ")}.`,
      ),
    targets_secondary: z
      .array(z.enum(EXERCISE_MUSCLES))
      .max(6)
      .optional()
      .describe(
        "Secondary muscle groups (same 17-muscle vocabulary as targets_primary).",
      ),
    equipment: z
      .enum(EXERCISE_EQUIPMENT)
      .optional()
      .describe(
        `Single primary equipment category: ${EXERCISE_EQUIPMENT.join(" | ")}. Omit or use bodyweight when none needed.`,
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
    "Create a NEW user-bound exercise when the library has no suitable match. The exercise is visible ONLY to the calling user (bound via the server-side owner_user_id column). The id is generated server-side and returned — use it in plan cards. Check list_exercises FIRST; do not create a near-duplicate of an existing exercise.",
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
            auto_heal: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        "Replacement active_limitations array. To ADD a limitation, load_history first, append it, then pass the full array here.",
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
 */
export function buildMcpToolsWith(
  client: DbClient,
  injectedUserId?: string,
): DynamicStructuredTool[] {
  const loadHistory = new DynamicStructuredTool({
    name: "load_history",
    description:
      "Load the current user training history (history_summary, recent sessions), static profile, " +
      "AND dynamic profile (load_anchors, active_limitations, recovery_state). Read-only. Scoped to the calling user. " +
      "ALWAYS call this before generating a plan — the dynamic profile holds the hard constraints (equipment the user owns, active injuries, recovery).",
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
      const trimmed = trimSessions(
        {
          sessions: mergeHistorySources(
            (history as Record<string, unknown> | null)?.sessions,
            liveRows,
            limit,
          ),
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
      "List the ENTIRE exercise library (read-only) as [{id, name, exercise_type, description}]. No arguments. " +
      "The library is small enough to fit in context — call this ONCE, then pick actions in-context " +
      "respecting the user equipment and any active injuries. `exercise_type` tells you which fields are required " +
      "(isometric needs duration, outdoor needs distance, resistance needs weight). " +
      "`description` carries pattern/targets/equipment/joint-impact. Never invent an exercise that is not in the returned list.",
    schema: listExercisesSchema,
    func: async () => {
      const exerciseQuery = new ExerciseQuery(client);
      const rows = await exerciseQuery.listAll();
      const exercises = rows.map((r) => ({
        id: r.id,
        name: r.name,
        exercise_type: r.exercise_type,
        description: describeExercise(r),
      }));
      return JSON.stringify({ count: exercises.length, exercises });
    },
  });

  const getExerciseDetail = new DynamicStructuredTool({
    name: "get_exercise_detail",
    description:
      "Fetch the full record of one exercise by id (equipment/muscles/mechanic classification, instructions, tutorials, content_html). " +
      "Read-only. Optional drill-down after list_exercises when you need a candidate tutorials/content_html " +
      "or to confirm impact_level on an injured joint.",
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
      // dedicated owner_user_id column (migrated off the retired attributes
      // JSONB in 002).
      const id = generateExerciseNanoId();

      await exerciseQuery.insertUserExercise({
        id,
        name: input.name,
        exercise_type: input.exercise_type,
        ownerUserId: userId,
        primaryMuscles: input.targets_primary ?? [],
        secondaryMuscles: input.targets_secondary ?? [],
        equipment: input.equipment ?? null,
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
        visibility: "user_only",
        message:
          "Exercise created and bound to the current user. Use this id in plan cards.",
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
      return JSON.stringify(res);
    },
  });

  return [
    loadHistory,
    listExercises,
    getExerciseDetail,
    getSessionHrCurve,
    getHrTrend,
    createExercise,
    writeSession,
    writeMemory,
    updateProfile,
  ];
}

/**
 * Production entry point (P006: userId resolved per-request via LangGraph ALS;
 * client = singleton). Returns the nine domain tools.
 */
export function buildMcpTools(): DynamicStructuredTool[] {
  return buildMcpToolsWith(getPostgresClient(), undefined);
}

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
 * Synthesize a compact one-line description from an exercise's structured columns so the
 * agent can pick safe actions from the full list in-context. Carries exactly the
 * constraint-relevant fields: type/difficulty, mechanic/force, target muscles,
 * and required equipment (bodyweight when none).
 *
 * Robust to partial/missing columns — every field is optional.
 */
function describeExercise(row: ExerciseListRow): string {
  const parts: string[] = [];
  if (row.exercise_type) parts.push(String(row.exercise_type));
  if (row.difficulty) parts.push(String(row.difficulty));
  if (row.mechanic) parts.push(`mechanic:${row.mechanic}`);
  if (row.force_type) parts.push(`force:${row.force_type}`);
  const muscles = [
    ...(row.primary_muscles ?? []),
    ...(row.secondary_muscles ?? []),
  ];
  if (muscles.length > 0) parts.push(`muscles:${muscles.join("+")}`);
  // equipment 缺省语义 = bodyweight（002 归一口径：源 null/'body only' → bodyweight）
  parts.push(`equipment:${row.equipment ?? "bodyweight"}`);
  return parts.join(" | ");
}
