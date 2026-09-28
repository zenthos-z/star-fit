/**
 * mcpTools (R3, enhanced) tests.
 *
 * Coverage map (no mocks on the data path — A018 / L100):
 *   - B1: tools route through the Repository layer (structure + scope-guard).
 *   - B2: write tools userId-scope — REAL PG. Inject A, attempt B rejected
 *         (McpScopeError + B's row unchanged); write A succeeds and lands.
 *   - B3 / P012: vacuity probe — assertUserScope fires on mismatch, passes on match.
 *   - B4: read tools return seeded rows — REAL PG (load_history, list_exercises,
 *         get_exercise_detail).
 *   - Enhanced filters: equipment subset / target overlap / impact cap — REAL PG.
 *   - update_profile: structured write into profile_dynamic — REAL PG.
 *   - P005: zod3 schema crosses into DynamicStructuredTool (bad input rejected,
 *         schema/description present).
 *
 * Runner: node:test via tsx (same convention as the sibling agent __tests__).
 *
 * Real-PG suite connects to the configured database; if it is unreachable the
 * PG-dependent tests SKIP (honest — they never fake green). The no-PG suite
 * (scope guard / structure / zod boundary) always runs.
 *
 *   cd backend && DATABASE_URL=postgresql://starfit:starfit@localhost:5432/starfit \
 *     npx tsx --test src/services/agent/__tests__/mcpTools.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { DynamicStructuredTool } from "@langchain/core/tools";

import {
  buildMcpToolsWith,
  assertUserScope,
  McpScopeError,
  writeSessionForUser,
  writeMemoryForUser,
  updateProfileForUser,
  UserScopedWriteRepository,
} from "../mcpTools.js";
import { PostgresClient } from "../../../db/postgresql/client/postgres-client.js";
import { createUserRepository } from "../../../db/postgresql/repository/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.MCP_TEST_DB_URL ||
  process.env.DATABASE_URL ||
  "postgresql://starfit:starfit@localhost:5432/starfit";

const EXERCISE_ID = "r3-test-squat";
const EXERCISE_ID_ATTR = "r3-test-dbrow";
/** 深化列测试值（002 结构化列；17 肌群 / 15 器材英文词表） */
const DETAIL_COLS = {
  primary_muscles: ["quadriceps", "glutes"],
  secondary_muscles: ["hamstrings"],
  equipment: "dumbbell",
  mechanic: "compound",
  force_type: "push",
};

/** Minimal valid session payload accepted by write_session's schema. */
const SESSION = {
  summary: "R3 probe session: heavy legs",
  date: "2026-07-11",
  exercises: [{ name: "Back Squat", sets: 5, reps: 5, weight: 100 }],
  notes: "felt strong",
};

// ===========================================================================
// No-PG suite: scope guard + tool structure + zod3 boundary (always runs)
// ===========================================================================

describe("mcpTools — B1 structure & P005 zod3 boundary (no PG)", () => {
  // buildMcpToolsWith needs a client only for tool *invocation*; constructing
  // the tool array is pure and lets us assert structure without a database.
  const tools = buildMcpToolsWith(
    {} as never,
    "00000000-0000-0000-0000-0000000000aa",
  );

  it("builds exactly the ten named tools", () => {
    // B5b (230e9c9) removed save_weekly_plan under the proposal-confirm flow —
    // the tool list below is the ten that remain (test was stale until 42b).
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "create_exercise",
      "get_current_plan",
      "get_exercise_detail",
      "get_hr_trend",
      "get_session_hr_curve",
      "list_exercises",
      "load_history",
      "update_profile",
      "write_memory",
      "write_session",
    ]);
  });

  it("every tool is a DynamicStructuredTool with a non-empty description + schema (P005)", () => {
    for (const t of tools) {
      assert.ok(
        t instanceof DynamicStructuredTool,
        `${t.name} must be DynamicStructuredTool`,
      );
      assert.ok(
        t.description && t.description.length > 10,
        `${t.name} needs a description`,
      );
      // P005: the zod3 schema crossed into the tool and is materialised.
      assert.ok(t.schema, `${t.name} must carry a schema`);
    }
  });

  it("list_exercises schema exposes pagination/filter params (42b)", () => {
    const le = tools.find((t) => t.name === "list_exercises")!;
    const shape =
      (le.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    for (const key of [
      "body_part",
      "equipment",
      "keyword",
      "limit",
      "offset",
    ]) {
      assert.ok(key in shape, `list_exercises must accept ${key}`);
    }
    // Default limit must be 30 (deadweight: no more whole-library dumps).
    const parsed = (
      le.schema as unknown as {
        safeParse: (i: unknown) => {
          success: boolean;
          data?: { limit?: number; offset?: number };
        };
      }
    ).safeParse({});
    assert.ok(parsed.success, "empty input is valid (all filters optional)");
    if (parsed.success) {
      assert.equal(parsed.data?.limit, 30, "default limit is 30");
      assert.equal(parsed.data?.offset, 0, "default offset is 0");
    }
  });

  it("write tools do NOT expose a forgeable userId parameter (secure by construction)", () => {
    const ws = tools.find((t) => t.name === "write_session")!;
    const wm = tools.find((t) => t.name === "write_memory")!;
    const up = tools.find((t) => t.name === "update_profile")!;
    const ce = tools.find((t) => t.name === "create_exercise")!;
    const wsShape =
      (ws.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    const wmShape =
      (wm.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    const upShape =
      (up.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    const ceShape =
      (ce.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    assert.ok(!("userId" in wsShape), "write_session must not accept userId");
    assert.ok(!("userId" in wmShape), "write_memory must not accept userId");
    assert.ok(!("userId" in upShape), "update_profile must not accept userId");
    assert.ok(!("userId" in ceShape), "create_exercise must not accept userId");
    assert.ok(
      !("id" in ceShape),
      "create_exercise must not accept an LLM-supplied id (server-side NanoID)",
    );
  });

  it("rejects input that violates the zod3 schema (P005: schema is live)", async () => {
    const ws = tools.find((t) => t.name === "write_session")!;
    // summary is required + non-empty; omitting it must throw (zod validation).
    await assert.rejects(
      () => ws.invoke({ date: "2026-07-11" } as unknown as { summary: string }),
      /summary|required/i,
    );
  });
});

// ===========================================================================
// B3 / P012 — vacuity probe of the userId scope guard (no PG)
// ===========================================================================

describe("mcpTools — B3/P012 scope guard vacuity probe (no PG)", () => {
  it("throws McpScopeError when target != injected", () => {
    assert.throws(
      () => assertUserScope("user-A", "user-B"),
      McpScopeError,
      "mismatched ids must throw McpScopeError (the guard is not vacuous)",
    );
  });

  it("passes silently when target === injected", () => {
    assert.doesNotThrow(() => assertUserScope("user-A", "user-A"));
  });

  it("writeSessionForUser routes through the guard (rejects cross-user before any write)", async () => {
    // A throw here proves the guard fires on the real write path, not just in
    // isolation. No DB row is touched because the guard throws first.
    await assert.rejects(
      () =>
        writeSessionForUser(
          new UserScopedWriteRepository({} as never),
          "user-A",
          "user-B",
          SESSION,
        ),
      McpScopeError,
    );
  });

  it("writeMemoryForUser routes through the guard", async () => {
    await assert.rejects(
      () =>
        writeMemoryForUser(
          new UserScopedWriteRepository({} as never),
          "user-A",
          "user-B",
          { key: "k", content: "v" },
        ),
      McpScopeError,
    );
  });

  it("updateProfileForUser routes through the guard", async () => {
    await assert.rejects(
      () =>
        updateProfileForUser(
          new UserScopedWriteRepository({} as never),
          "user-A",
          "user-B",
          {
            recovery_state: {
              total_score: 50,
              last_assessed: "2026-07-11T00:00:00Z",
            },
          },
        ),
      McpScopeError,
    );
  });
});

// ===========================================================================
// Real-PG suite: B2 (write scope) + B4 (read tools) + enhanced filters. Skips
// if PG unreachable.
// ===========================================================================

describe("mcpTools — B2/B4 real PG", { concurrency: false }, () => {
  let client: PostgresClient;
  let userA: string;
  let userB: string;
  let pgAvailable = false;

  before(async () => {
    client = new PostgresClient({ connectionString: TEST_DB_URL });
    try {
      await client.connect();
      pgAvailable = true;
    } catch {
      pgAvailable = false;
      // Leave client constructed; the skip guards below protect each test.
    }
    userA = crypto.randomUUID();
    userB = crypto.randomUUID();
  });

  // Seed two real users + two exercises before the PG-dependent tests.
  async function seed(): Promise<void> {
    const minimalProfile = JSON.stringify({
      tags: ["r3-test"],
    });
    for (const id of [userA, userB]) {
      await client.query(
        `INSERT INTO users (id, profile_static, profile_dynamic, history_summary)
         VALUES ($id, $ps, '{}'::jsonb, $hs)`,
        {
          id,
          ps: minimalProfile,
          hs: JSON.stringify({
            sessions: [{ summary: "seed-legacy", date: "2026-07-10" }],
          }),
        },
      );
    }
    await client.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty)
       VALUES ($id, $name, $type::exercise_type_enum, $diff::difficulty_level)
       ON CONFLICT (id) DO NOTHING`,
      {
        id: EXERCISE_ID,
        name: "R3 Test Squat",
        type: "resistance",
        diff: "intermediate",
      },
    );
    // A fully-classified exercise for the filter / detail tests (structured columns).
    await client.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty,
         primary_muscles, secondary_muscles, equipment, mechanic, force_type)
       VALUES ($id, $name, $type::exercise_type_enum, $diff::difficulty_level,
         $pm::text[], $sm::text[], $eq::public.exercise_equipment,
         $mech::public.exercise_mechanic, $ft::public.exercise_force_type)
       ON CONFLICT (id) DO UPDATE SET
         primary_muscles = EXCLUDED.primary_muscles,
         secondary_muscles = EXCLUDED.secondary_muscles,
         equipment = EXCLUDED.equipment,
         mechanic = EXCLUDED.mechanic,
         force_type = EXCLUDED.force_type`,
      {
        id: EXERCISE_ID_ATTR,
        name: "R3 DB Row",
        type: "resistance",
        diff: "intermediate",
        pm: DETAIL_COLS.primary_muscles,
        sm: DETAIL_COLS.secondary_muscles,
        eq: DETAIL_COLS.equipment,
        mech: DETAIL_COLS.mechanic,
        ft: DETAIL_COLS.force_type,
      },
    );
  }

  after(async () => {
    if (!pgAvailable) {
      return;
    }
    try {
      await client.query(`DELETE FROM users WHERE id IN ($a, $b)`, {
        a: userA,
        b: userB,
      });
      await client.query(`DELETE FROM exercises WHERE id IN ($id1, $id2)`, {
        id1: EXERCISE_ID,
        id2: EXERCISE_ID_ATTR,
      });
    } finally {
      await client.close();
    }
  });

  it("B2/B4 setup: connected to real PG (skips the rest if not)", async (t) => {
    if (!pgAvailable) {
      t.skip(
        "PG unreachable — skipping real-PG assertions (no mock substitutes, per A018)",
      );
      return;
    }
    await seed();
    assert.ok(pgAvailable);
  });

  it("B2 green: write_session for the injected user lands on that user (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const writeRepo = new UserScopedWriteRepository(client);
    const res = await writeSessionForUser(writeRepo, userA, userA, SESSION);
    assert.equal(res.userId, userA);

    // Real read-back: the session must be persisted on userA's history_summary.
    const userRepo = createUserRepository(client);
    const hist = await userRepo.getHistorySummary(userA);
    const sessions = (hist as { sessions?: unknown[] } | null)?.sessions ?? [];
    assert.ok(
      sessions.some(
        (s) => (s as { summary?: string }).summary === SESSION.summary,
      ),
      "written session must appear in userA history_summary (real PG)",
    );
  });

  it("B2 reject: writing user B while injected as A is blocked + leaves B unchanged (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const writeRepo = new UserScopedWriteRepository(client);

    // Capture B's history before the attempted write.
    const userRepo = createUserRepository(client);
    const histBefore = await userRepo.getHistorySummary(userB);

    // The scoped helper must reject the cross-user write.
    await assert.rejects(
      () => writeSessionForUser(writeRepo, userA, userB, SESSION),
      McpScopeError,
    );

    // Real read-back: B's history_summary must be unchanged.
    const histAfter = await userRepo.getHistorySummary(userB);
    assert.deepEqual(
      histAfter,
      histBefore,
      "rejected write must not mutate userB (real PG confirms isolation)",
    );
  });

  it("B2 tool-level: buildMcpToolsWith(A).write_session writes only to A", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const ws = tools.find((t2) => t2.name === "write_session")!;
    const out = (await ws.invoke(SESSION)) as string;
    const parsed = JSON.parse(out) as { userId: string };
    assert.equal(
      parsed.userId,
      userA,
      "tool must always target the injected userId",
    );

    // And the memory tool, too.
    const wm = tools.find((t2) => t2.name === "write_memory")!;
    await wm.invoke({ key: "r3-note", content: "remember this" });
    const pd = await new UserScopedWriteRepository(client).readProfileDynamic(
      userA,
    );
    assert.equal(
      (pd?.memories as Record<string, string> | undefined)?.["r3-note"],
      "remember this",
      "write_memory persisted on userA (real PG)",
    );
  });

  it("B4 read: load_history returns the user history + profile + dynamic (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const lh = tools.find((t2) => t2.name === "load_history")!;
    const out = (await lh.invoke({
      include_profile: true,
      include_dynamic: true,
    })) as string;
    const parsed = JSON.parse(out) as {
      userId: string;
      history_summary: { sessions?: { summary?: string }[] } | null;
      profile_static: unknown;
      profile_dynamic: unknown;
    };
    assert.equal(parsed.userId, userA);
    const summaries = (parsed.history_summary?.sessions ?? []).map(
      (s) => s.summary,
    );
    assert.ok(
      summaries.includes(SESSION.summary),
      "load_history must return the previously written session (real PG read)",
    );
    assert.ok(
      parsed.profile_static !== undefined,
      "static profile returned when requested",
    );
    assert.ok(
      parsed.profile_dynamic !== null && parsed.profile_dynamic !== undefined,
      "dynamic profile returned",
    );
  });

  it("B4 read: list_exercises keyword filter locates the seeded exercise (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === "list_exercises")!;
    // 42b: the tool is paginated — callers locate rows by filter, not by
    // paging a whole-library dump. The seeded row is found via keyword.
    const out = (await le.invoke({ keyword: "R3 Test" })) as string;
    const parsed = JSON.parse(out) as {
      total: number;
      count: number;
      exercises: { id: string; name: string; description: string }[];
    };
    assert.ok(parsed.count >= 1, "keyword filter must return the seeded row");
    const seeded = parsed.exercises.find((e) => e.id === EXERCISE_ID);
    assert.ok(
      seeded,
      "seeded R3 exercise must be reachable via keyword filter (real PG read)",
    );
    assert.equal(typeof seeded!.description, "string");
    assert.ok(
      seeded!.description.length > 0,
      "description is synthesized for every exercise",
    );
  });

  it("B4 read: list_exercises default page is 30 rows with total/has_more (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === "list_exercises")!;
    // No filters = default page semantics (the intentional default-behaviour
    // probe): 30 rows, real total, has_more true while rows remain.
    const parsed = JSON.parse((await le.invoke({})) as string) as {
      total: number;
      count: number;
      limit: number;
      offset: number;
      has_more: boolean;
      exercises: { id: string }[];
    };
    assert.equal(parsed.limit, 30, "default limit is 30");
    assert.equal(parsed.offset, 0, "default offset is 0");
    assert.equal(parsed.count, 30, "default page returns exactly 30 rows");
    assert.equal(parsed.exercises.length, 30);
    assert.ok(
      parsed.total >= parsed.count,
      "total must cover at least the returned page",
    );
    assert.equal(
      parsed.has_more,
      parsed.total > 30,
      "has_more reflects remaining rows",
    );
  });

  it("B4 read: list_exercises offset pages forward without overlap (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === "list_exercises")!;
    const page1 = JSON.parse((await le.invoke({})) as string) as {
      exercises: { id: string }[];
    };
    const page2 = JSON.parse((await le.invoke({ offset: 30 })) as string) as {
      offset: number;
      exercises: { id: string }[];
    };
    assert.equal(page2.offset, 30);
    assert.equal(page2.exercises.length, 30, "second page is full");
    const ids1 = new Set(page1.exercises.map((e) => e.id));
    assert.ok(
      !page2.exercises.some((e) => ids1.has(e.id)),
      "page 2 must not repeat page-1 rows (stable ORDER BY name)",
    );
  });

  it("B4 read: list_exercises body_part filter narrows to one muscle group (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === "list_exercises")!;
    const unfiltered = JSON.parse((await le.invoke({})) as string) as {
      total: number;
    };
    const parsed = JSON.parse(
      (await le.invoke({ body_part: "chest" })) as string,
    ) as {
      total: number;
      count: number;
      has_more: boolean;
    };
    assert.ok(parsed.total >= 1, "library has chest exercises");
    assert.ok(
      parsed.total < unfiltered.total,
      "body_part filter narrows the result set (chest < whole library)",
    );
    if (parsed.total <= 30) {
      assert.equal(parsed.count, parsed.total);
      assert.equal(
        parsed.has_more,
        false,
        "has_more=false when page covers all",
      );
    }
  });

  it("B4 read: list_exercises equipment + keyword combine; miss returns empty page (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === "list_exercises")!;
    // Seeded DB Row has equipment=dumbbell; Squat has none → combination narrows.
    const hit = JSON.parse(
      (await le.invoke({ keyword: "R3", equipment: "dumbbell" })) as string,
    ) as { total: number; exercises: { id: string }[] };
    assert.equal(hit.total, 1, "dumbbell+R3 matches only the seeded DB Row");
    assert.equal(hit.exercises[0]?.id, EXERCISE_ID_ATTR);
    const miss = JSON.parse(
      (await le.invoke({ keyword: "R3", equipment: "barbell" })) as string,
    ) as { total: number; count: number; has_more: boolean };
    assert.equal(miss.total, 0);
    assert.equal(miss.count, 0);
    assert.equal(miss.has_more, false, "empty page never claims more");
  });

  it("B4 read: list_exercises limit/has_more arithmetic and name_zh keyword (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === "list_exercises")!;
    const p1 = JSON.parse(
      (await le.invoke({ keyword: "R3", limit: 1 })) as string,
    ) as { total: number; count: number; has_more: boolean };
    assert.equal(p1.count, 1);
    assert.equal(p1.total, 2, "both seeded rows match keyword R3");
    assert.equal(p1.has_more, true, "1 of 2 returned → has_more");
    const p2 = JSON.parse(
      (await le.invoke({ keyword: "R3", limit: 1, offset: 1 })) as string,
    ) as { count: number; has_more: boolean };
    assert.equal(p2.count, 1);
    assert.equal(p2.has_more, false, "last page flips has_more to false");
    // name_zh is searchable (library backfills official Chinese names).
    const zh = JSON.parse((await le.invoke({ keyword: "卧推" })) as string) as {
      total: number;
    };
    assert.ok(zh.total >= 1, "keyword matches name_zh (Chinese names)");
  });

  it("B4 read: list_exercises description carries pattern/equipment/impact for in-context filtering (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === "list_exercises")!;
    const parsed = JSON.parse(
      (await le.invoke({ keyword: "R3 DB Row" })) as string,
    ) as {
      exercises: { id: string; description: string }[];
    };
    const attr = parsed.exercises.find((e) => e.id === EXERCISE_ID_ATTR);
    assert.ok(attr, "seeded ATTR exercise present");
    // The whole library is loaded into context; the `description` one-liner must
    // carry the constraint-relevant fields so the agent can filter in-context:
    // mechanic/force, muscles, and equipment.
    const d = attr!.description;
    assert.ok(d.includes("compound"), "description carries mechanic:compound");
    assert.ok(d.includes("quadriceps"), "description carries primary muscle");
    assert.ok(d.includes("dumbbell"), "description carries equipment:dumbbell");
  });

  it("B4 read: get_exercise_detail returns structured columns (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const ged = tools.find((t2) => t2.name === "get_exercise_detail")!;
    const out = (await ged.invoke({ id: EXERCISE_ID_ATTR })) as string;
    const parsed = JSON.parse(out) as {
      found: boolean;
      exercise?: {
        id: string;
        equipment?: string | null;
        primary_muscles?: string[];
        mechanic?: string | null;
      };
    };
    assert.equal(parsed.found, true);
    assert.equal(parsed.exercise?.equipment, "dumbbell");
    assert.deepEqual(parsed.exercise?.primary_muscles, [
      "quadriceps",
      "glutes",
    ]);
    assert.equal(parsed.exercise?.mechanic, "compound");
  });

  it("B2 write: update_profile merges structured recovery_state into profile_dynamic (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const up = tools.find((t2) => t2.name === "update_profile")!;
    const out = (await up.invoke({
      recovery_state: {
        total_score: 72,
        last_assessed: "2026-07-11T00:00:00Z",
      },
    } as never)) as string;
    const parsed = JSON.parse(out) as {
      userId: string;
      updated_fields: string[];
    };
    assert.equal(
      parsed.userId,
      userA,
      "update_profile targets the injected user",
    );
    assert.ok(parsed.updated_fields.includes("recovery_state"));

    // Real read-back: recovery_state landed in profile_dynamic.
    const pd = await new UserScopedWriteRepository(client).readProfileDynamic(
      userA,
    );
    assert.equal(
      (pd?.recovery_state as { total_score?: number } | undefined)?.total_score,
      72,
      "recovery_state persisted into profile_dynamic (real PG)",
    );
  });

  it("B2 write: create_exercise inserts a user-bound row with server-side NanoID + tutorial in content_html (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const ce = tools.find((t2) => t2.name === "create_exercise")!;
    const uniqueName = `测试自定义动作-${crypto.randomUUID().slice(0, 8)}`;
    const out = (await ce.invoke({
      name: uniqueName,
      exercise_type: "resistance",
      targets_primary: ["lats"],
      equipment: "dumbbell",
      description: "test custom exercise",
      tutorial_md: "### 动作作用\n测试教程",
    } as never)) as string;
    const parsed = JSON.parse(out) as {
      created: boolean;
      id: string;
      visibility: string;
    };
    assert.equal(parsed.created, true, "create_exercise succeeds");
    assert.match(
      parsed.id,
      /^[0-9A-Za-z_-]{12,24}$/,
      "id is a NanoID (server-generated)",
    );
    assert.equal(parsed.visibility, "user_only");

    // Real read-back: row exists with owner binding on the owner_user_id column
    // and the tutorial landed in content_html (same slot the frontend modal renders).
    const eq = new ExerciseQueryLike(client);
    const row = await eq.findByIdFull(parsed.id);
    assert.ok(row, "created row readable via ExerciseQuery");
    assert.equal(
      row!.owner_user_id,
      userA,
      "owner_user_id column binds the calling user",
    );
    assert.ok(
      String(row!.content_html).includes("### 动作作用"),
      "tutorial persisted into content_html",
    );
  });

  it("B2 write: create_exercise rejects a duplicate library name with an actionable reason (real PG)", async (t) => {
    if (!pgAvailable) {
      t.skip("PG unreachable");
      return;
    }
    const tools = buildMcpToolsWith(client, userA);
    const ce = tools.find((t2) => t2.name === "create_exercise")!;
    // EXERCISE_ID_SIMPLE is seeded with a known name in this suite.
    const seededName = (await new ExerciseQueryLike(client).findByIdFull(
      EXERCISE_ID,
    ))!.name;
    const out = (await ce.invoke({
      name: seededName,
      exercise_type: "resistance",
    } as never)) as string;
    const parsed = JSON.parse(out) as { created: boolean; reason: string };
    assert.equal(
      parsed.created,
      false,
      "duplicate name is rejected, not a driver error",
    );
    assert.equal(parsed.reason, "name_exists");
  });
});

/**
 * Minimal read-back handle for created rows. Mirrors the mcpTools ExerciseQuery
 * read path (BaseRepository.queryOne) without importing the non-exported
 * class: UserScopedWriteRepository extends BaseRepository, so we reuse ITS
 * queryOne through a tiny subclass.
 */
class ExerciseQueryLike extends UserScopedWriteRepository {
  async findByIdFull(id: string): Promise<{
    name: string;
    owner_user_id: string | null;
    content_html: string | null;
  } | null> {
    return this.queryOne(
      `SELECT name, owner_user_id, content_html FROM exercises WHERE id = $id`,
      { id },
    );
  }
}
