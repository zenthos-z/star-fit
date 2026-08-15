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
 * ## Tool set (6)
 * - `load_history`        (read)  history_summary + profile_static + profile_dynamic
 * - `list_exercises`      (read)  the WHOLE exercise library as [{id, name, description}].
 *                                 The library is small enough to fit in context, so the agent
 *                                 picks actions itself — no vector/semantic search. `description`
 *                                 carries pattern/targets/equipment/impact so the agent can
 *                                 respect the user equipment + injuries in-context.
 * - `get_exercise_detail` (read)  full record of one exercise (attributes, tutorials, content)
 * - `write_session`       (write) append a completed session to history_summary
 * - `write_memory`        (write) keyed free-text memory note under profile_dynamic.memories
 * - `update_profile`      (write) structured update of profile_dynamic
 *                                 (load_anchors / active_limitations / recovery_state)
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
 * ## Why the write tools do not reuse UserRepository.update*
 * The existing `UserRepository.updateProfileDynamic` / `updateHistorySummary`
 * emit `jsonb_set(target, $updates::jsonb)` — a 2-argument call that Postgres
 * rejects at runtime (`function jsonb_set(jsonb, jsonb) does not exist`,
 * verified against the live DB). `repository/` is GOLD read-only for this card,
 * so the correct `||`-concat merge is implemented in the derived
 * `UserScopedWriteRepository` below. Reads still use `UserRepository` unchanged.
 *
 * ## userId resolution (per-request, ALS)
 * Production (`buildMcpTools()`) is built once at agent-assembly time with no
 * userId; each tool func resolves the calling user from the LangGraph
 * AsyncLocalStorage context (`getConfig().configurable.userId`), which the
 * ToolNode propagates. `buildMcpToolsWith(client, injectedUserId)` keeps an
 * explicit fallback for the real-PG test suite (which runs outside LangGraph).
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { getConfig } from '@langchain/langgraph';
import { z } from 'zod';

// B1: data access is via the Repository layer only. These imports reach the
// `pg` driver indirectly through PostgresClient inside BaseRepository; the tool
// bodies themselves hold no `pg` / `Pool` / `client.query` handle.
import {
  BaseRepository,
  createUserRepository,
} from '../../db/postgresql/repository/index.js';
import { getPostgresClient } from '../../db/postgresql/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The PostgresClient type, derived from the accessor to avoid an extra import. */
type DbClient = ReturnType<typeof getPostgresClient>;

/** One exercises row for the list tool (raw attributes are synthesized into a description). */
interface ExerciseListRow {
  id: string;
  name: string;
  exercise_type: string | null;
  difficulty: string | null;
  attributes: Record<string, unknown> | null;
}

/** Full exercise row for the detail tool. */
interface ExerciseDetailRow {
  id: string;
  name: string;
  exercise_type: string | null;
  difficulty: string | null;
  attributes: unknown;
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
    this.name = 'McpScopeError';
  }
}

/**
 * P012 build-gate: a write may only touch the resolved principal's own row.
 * Throws `McpScopeError` on mismatch. The write tools call this with
 * `target === injected` (secure by construction — no userId param is exposed to
 * the LLM); the exported scoped-write helpers let tests drive mismatched inputs
 * to prove the guard is not a perpetually-green no-op.
 */
export function assertUserScope(injectedUserId: string, targetUserId: string): void {
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
export function getUserIdFromContext(opts: {
  explicitConfig?: unknown;
  injectedUserId?: string;
} = {}): string {
  // 1. LangGraph ALS context (production primary).
  let alsUserId: string | undefined;
  try {
    const cfg = getConfig() as { configurable?: { userId?: string } } | undefined;
    alsUserId = cfg?.configurable?.userId;
  } catch {
    // getConfig() can throw when invoked outside a LangGraph run; that's fine,
    // we fall through to the explicit fallbacks.
    alsUserId = undefined;
  }
  if (alsUserId) {
    return alsUserId;
  }

  // 2. Test-injected principal.
  if (opts.injectedUserId) {
    return opts.injectedUserId;
  }

  // 3. DynamicStructuredTool func config argument (RunnableConfig).
  const cfg = opts.explicitConfig as
    | { configurable?: { userId?: string } }
    | { config?: { configurable?: { userId?: string } } }
    | undefined;
  const fromExplicit =
    (cfg as { configurable?: { userId?: string } } | undefined)?.configurable?.userId ??
    (cfg as { config?: { configurable?: { userId?: string } } } | undefined)?.config?.configurable
      ?.userId;
  if (fromExplicit) {
    return fromExplicit;
  }

  throw new Error(
    'mcpTools: userId not found — expected LangGraph configurable.userId (set by DeepAgentService.chat) or an injected test principal',
  );
}

// ---------------------------------------------------------------------------
// BaseRepository subclasses (B1: allowed derivations; HC-2: no schema change)
// ---------------------------------------------------------------------------

/**
 * Write path for the agent tools. Extends `BaseRepository` (B1) and implements a
 * CORRECT jsonb shallow-merge (`COALESCE(col,'{}') || $updates::jsonb`) that the
 * GOLD `UserRepository` write methods lack (see module header).
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

  /** Raw `history_summary` for the append-read in `write_session`. */
  async readHistorySummary(userId: string): Promise<Record<string, unknown> | null> {
    const row = await this.queryOne<{ history_summary: unknown }>(
      `SELECT history_summary FROM users WHERE id = $userId`,
      { userId },
    );
    const hs = row?.history_summary;
    return hs && typeof hs === 'object' ? (hs as Record<string, unknown>) : null;
  }

  /** Raw `profile_dynamic` for the read-modify-write in `write_memory`. */
  async readProfileDynamic(userId: string): Promise<Record<string, unknown> | null> {
    const row = await this.queryOne<{ profile_dynamic: unknown }>(
      `SELECT profile_dynamic FROM users WHERE id = $userId`,
      { userId },
    );
    const pd = row?.profile_dynamic;
    return pd && typeof pd === 'object' ? (pd as Record<string, unknown>) : null;
  }
}

/**
 * Read-only accessor for the `exercises` table (HC-2: thin read-only wrapper;
 * no `ExerciseRepository` exists yet). SELECT only — no writes, no vector search.
 */
export class ExerciseQuery extends BaseRepository {
  /**
   * Return the whole exercise library (id/name/type/difficulty/attributes). The
   * library is small enough to fit in the model context, so the agent filters
   * and picks actions in-context — no SQL filtering or vector/semantic search.
   * Does not touch the removed `embedding` column.
   */
  async listAll(): Promise<ExerciseListRow[]> {
    return this.queryMany<ExerciseListRow>(
      `SELECT id, name, exercise_type, difficulty, attributes
         FROM exercises
         ORDER BY name`,
    );
  }

  /** Full record for one exercise by id (attributes, tutorials, content_html). */
  async findByIdFull(id: string): Promise<ExerciseDetailRow | null> {
    return this.queryOne<ExerciseDetailRow>(
      `SELECT id, name, exercise_type, difficulty, attributes, tutorials, content_html
         FROM exercises
        WHERE id = $id`,
      { id },
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
      .describe('Also return the static profile. Defaults to true.'),
    include_dynamic: z
      .boolean()
      .optional()
      .describe(
        'Also return profile_dynamic (load_anchors, active_limitations, recovery_state). Defaults to true. ' +
          'These are hard constraints for plan generation — load them.',
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe('Max recent sessions to return from history_summary.sessions.'),
  })
  .describe(
    'Read the current user training history + static + dynamic profile. Read-only. Scoped to the calling user.',
  );

const listExercisesSchema = z
  .object({})
  .describe(
    'List the ENTIRE exercise library as [{id, name, description}]. No filters, no arguments — ' +
      'the library is small enough to fit in context. Read it ONCE, then pick actions in-context ' +
      'respecting the user equipment and any active injuries (from load_history). `description` ' +
      'carries pattern / targets / equipment / joint-impact so you can choose safe actions directly. ' +
      'Never invent an exercise that is not in the returned list.',
  );

const getExerciseDetailSchema = z
  .object({
    id: z.string().min(1).max(24).describe('Exact exercise id.'),
  })
  .describe('Fetch the full record of one exercise (attributes, tutorials, content_html). Read-only.');

const exerciseEntrySchema = z
  .object({
    name: z.string().max(120).describe('Exercise name, e.g. "Back Squat".'),
    sets: z.number().int().positive().optional(),
    reps: z.number().int().positive().optional(),
    weight: z.number().optional().describe('Weight used (kg or lb, as configured).'),
    rpe: z.number().min(0).max(10).optional(),
  })
  .passthrough();

const writeSessionSchema = z
  .object({
    summary: z
      .string()
      .min(1)
      .max(500)
      .describe('One-line summary of the completed session.'),
    date: z
      .string()
      .max(20)
      .optional()
      .describe('ISO date of the session, e.g. "2026-07-11".'),
    exercises: z
      .array(exerciseEntrySchema)
      .max(50)
      .optional()
      .describe('Exercises performed in this session.'),
    notes: z.string().max(1000).optional(),
  })
  .passthrough()
  .describe('Append a completed training session to the current user history.');

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
      .describe('Free-text memory content to remember about the user.'),
  })
  .passthrough()
  .describe('Write/overwrite a memory note keyed under the current user profile.');

const updateProfileSchema = z
  .object({
    load_anchors: z
      .record(z.string(), z.any())
      .optional()
      .describe(
        'Replacement load_anchors map (exercise name -> anchor object, e.g. {type,best_weight,best_reps}). REPLACES the whole map — to update one anchor, load_history first, merge, then pass the full map.',
      ),
    active_limitations: z
      .array(
        z
          .object({
            part: z.string().describe('Body part, e.g. "left_knee".'),
            severity: z.number().min(1).max(10).describe('1-10 severity.'),
            expire_at: z.string().describe('ISO 8601 UTC auto-heal timestamp.'),
            logged_at: z.string().describe('ISO 8601 UTC when logged.'),
            auto_heal: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        'Replacement active_limitations array. To ADD a limitation, load_history first, append it, then pass the full array here.',
      ),
    recovery_state: z
      .object({
        total_score: z.number().min(0).max(100).describe('0-100 recovery score.'),
        last_assessed: z.string().describe('ISO 8601 UTC.'),
        cns_fusing: z.boolean().optional(),
        acute_load: z.number().optional(),
        chronic_load: z.number().optional(),
      })
      .passthrough()
      .optional()
      .describe('Replacement recovery_state.'),
  })
  .passthrough()
  .describe(
    'Structured update to the current user profile_dynamic (load_anchors / active_limitations / recovery_state). Shallow-merges into profile_dynamic; always targets the calling user. Use after a workout to record new anchors, limitations, or recovery.',
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
  await writeRepo.mergeProfileDynamic(targetUserId, filtered);
  return { ok: true, userId: targetUserId, updated_fields: Object.keys(filtered) };
}

/** Read just the `memories` map from `profile_dynamic` (used for read-modify-write). */
async function readProfileDynamicMemories(
  repo: UserScopedWriteRepository,
  userId: string,
): Promise<Record<string, string>> {
  const pd = await repo.readProfileDynamic(userId);
  const memories = pd?.memories;
  return memories && typeof memories === 'object'
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
    name: 'load_history',
    description:
      'Load the current user training history (history_summary, recent sessions), static profile, ' +
      'AND dynamic profile (load_anchors, active_limitations, recovery_state). Read-only. Scoped to the calling user. ' +
      'ALWAYS call this before generating a plan — the dynamic profile holds the hard constraints (equipment the user owns, active injuries, recovery).',
    schema: loadHistorySchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({ explicitConfig: config, injectedUserId });
      const userRepo = createUserRepository(client);
      const history = await userRepo.getHistorySummary(userId);
      const trimmed = trimSessions(history, input.limit ?? 10);
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
    name: 'list_exercises',
    description:
      'List the ENTIRE exercise library (read-only) as [{id, name, exercise_type, description}]. No arguments. ' +
      'The library is small enough to fit in context — call this ONCE, then pick actions in-context ' +
      'respecting the user equipment and any active injuries. `exercise_type` tells you which fields are required ' +
      '(isometric needs duration, outdoor needs distance, resistance needs weight). ' +
      '`description` carries pattern/targets/equipment/joint-impact. Never invent an exercise that is not in the returned list.',
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
    name: 'get_exercise_detail',
    description:
      'Fetch the full record of one exercise by id (attributes incl. equipment/targets/impact, tutorials, content_html). ' +
      'Read-only. Optional drill-down after list_exercises when you need a candidate tutorials/content_html ' +
      'or to confirm impact_level on an injured joint.',
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

  const writeSession = new DynamicStructuredTool({
    name: 'write_session',
    description:
      'Append a completed training session to the current user history. Always writes to the calling user; the agent cannot target another user.',
    schema: writeSessionSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({ explicitConfig: config, injectedUserId });
      const writeRepo = new UserScopedWriteRepository(client);
      const res = await writeSessionForUser(writeRepo, userId, userId, input);
      return JSON.stringify(res);
    },
  });

  const writeMemory = new DynamicStructuredTool({
    name: 'write_memory',
    description:
      'Write or overwrite a free-text memory note about the current user (keyed). Always writes to the calling user; the agent cannot target another user.',
    schema: writeMemorySchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({ explicitConfig: config, injectedUserId });
      const writeRepo = new UserScopedWriteRepository(client);
      const res = await writeMemoryForUser(writeRepo, userId, userId, input);
      return JSON.stringify(res);
    },
  });

  const updateProfile = new DynamicStructuredTool({
    name: 'update_profile',
    description:
      'Structured update of the current user dynamic profile (load_anchors / active_limitations / recovery_state). ' +
      'Use AFTER a workout to record new performance anchors, fresh limitations, or recovery state. Always writes to the calling user.',
    schema: updateProfileSchema,
    func: async (input, _runManager, config) => {
      const userId = getUserIdFromContext({ explicitConfig: config, injectedUserId });
      const writeRepo = new UserScopedWriteRepository(client);
      const res = await updateProfileForUser(writeRepo, userId, userId, input);
      return JSON.stringify(res);
    },
  });

  return [loadHistory, listExercises, getExerciseDetail, writeSession, writeMemory, updateProfile];
}

/**
 * Production entry point (P006: userId resolved per-request via LangGraph ALS;
 * client = singleton). Returns the six domain tools.
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
 * Synthesize a compact one-line description from an exercise's attributes so the
 * agent can pick safe actions from the full list in-context. Carries exactly the
 * constraint-relevant fields: type/difficulty, movement pattern, target muscles,
 * required equipment (bodyweight when none), and any notable joint impact (>=5).
 *
 * Robust to partial/missing attributes — every field is optional.
 */
function describeExercise(row: ExerciseListRow): string {
  const attr = (row.attributes ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (row.exercise_type) parts.push(String(row.exercise_type));
  if (row.difficulty) parts.push(String(row.difficulty));
  const pattern = attr.pattern;
  if (typeof pattern === 'string' && pattern) parts.push(`pattern:${pattern}`);
  const targets = (attr.targets as { primary?: unknown } | undefined)?.primary;
  if (Array.isArray(targets) && targets.length > 0) {
    parts.push(`targets:${targets.filter((t) => typeof t === 'string').join('+')}`);
  }
  const equip = attr.equipment_required;
  if (Array.isArray(equip) && equip.length > 0) {
    parts.push(`equipment:${equip.filter((e) => typeof e === 'string').join('+')}`);
  } else {
    parts.push('equipment:bodyweight');
  }
  const impact = attr.impact_level;
  if (impact && typeof impact === 'object') {
    const notable = Object.entries(impact as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && v >= 5)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    if (notable) parts.push(`impact:${notable}`);
  }
  return parts.join(' | ');
}
