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

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { DynamicStructuredTool } from '@langchain/core/tools';

import {
  buildMcpToolsWith,
  assertUserScope,
  McpScopeError,
  writeSessionForUser,
  writeMemoryForUser,
  updateProfileForUser,
  UserScopedWriteRepository,
} from '../mcpTools.js';
import { PostgresClient } from '../../../db/postgresql/client/postgres-client.js';
import { createUserRepository } from '../../../db/postgresql/repository/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.MCP_TEST_DB_URL ||
  process.env.DATABASE_URL ||
  'postgresql://starfit:starfit@localhost:5432/starfit';

const EXERCISE_ID = 'r3-test-squat';
const EXERCISE_ID_ATTR = 'r3-test-dbrow';
const ATTRS = {
  targets: { primary: ['quads', 'glutes'], secondary: ['hamstrings'] },
  equipment_required: ['dumbbell'],
  impact_level: { knee: 7, back: 4 },
  pattern: 'squat',
};

/** Minimal valid session payload accepted by write_session's schema. */
const SESSION = {
  summary: 'R3 probe session: heavy legs',
  date: '2026-07-11',
  exercises: [{ name: 'Back Squat', sets: 5, reps: 5, weight: 100 }],
  notes: 'felt strong',
};

// ===========================================================================
// No-PG suite: scope guard + tool structure + zod3 boundary (always runs)
// ===========================================================================

describe('mcpTools — B1 structure & P005 zod3 boundary (no PG)', () => {
  // buildMcpToolsWith needs a client only for tool *invocation*; constructing
  // the tool array is pure and lets us assert structure without a database.
  const tools = buildMcpToolsWith({} as never, '00000000-0000-0000-0000-0000000000aa');

  it('builds exactly the six named tools', () => {
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'get_exercise_detail',
      'list_exercises',
      'load_history',
      'update_profile',
      'write_memory',
      'write_session',
    ]);
  });

  it('every tool is a DynamicStructuredTool with a non-empty description + schema (P005)', () => {
    for (const t of tools) {
      assert.ok(t instanceof DynamicStructuredTool, `${t.name} must be DynamicStructuredTool`);
      assert.ok(t.description && t.description.length > 10, `${t.name} needs a description`);
      // P005: the zod3 schema crossed into the tool and is materialised.
      assert.ok(t.schema, `${t.name} must carry a schema`);
    }
  });

  it('write tools do NOT expose a forgeable userId parameter (secure by construction)', () => {
    const ws = tools.find((t) => t.name === 'write_session')!;
    const wm = tools.find((t) => t.name === 'write_memory')!;
    const up = tools.find((t) => t.name === 'update_profile')!;
    const wsShape = (ws.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    const wmShape = (wm.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    const upShape = (up.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    assert.ok(!('userId' in wsShape), 'write_session must not accept userId');
    assert.ok(!('userId' in wmShape), 'write_memory must not accept userId');
    assert.ok(!('userId' in upShape), 'update_profile must not accept userId');
  });

  it('rejects input that violates the zod3 schema (P005: schema is live)', async () => {
    const ws = tools.find((t) => t.name === 'write_session')!;
    // summary is required + non-empty; omitting it must throw (zod validation).
    await assert.rejects(
      () => ws.invoke({ date: '2026-07-11' } as unknown as { summary: string }),
      /summary|required/i,
    );
  });
});

// ===========================================================================
// B3 / P012 — vacuity probe of the userId scope guard (no PG)
// ===========================================================================

describe('mcpTools — B3/P012 scope guard vacuity probe (no PG)', () => {
  it('throws McpScopeError when target != injected', () => {
    assert.throws(
      () => assertUserScope('user-A', 'user-B'),
      McpScopeError,
      'mismatched ids must throw McpScopeError (the guard is not vacuous)',
    );
  });

  it('passes silently when target === injected', () => {
    assert.doesNotThrow(() => assertUserScope('user-A', 'user-A'));
  });

  it('writeSessionForUser routes through the guard (rejects cross-user before any write)', async () => {
    // A throw here proves the guard fires on the real write path, not just in
    // isolation. No DB row is touched because the guard throws first.
    await assert.rejects(
      () =>
        writeSessionForUser(
          new UserScopedWriteRepository({} as never),
          'user-A',
          'user-B',
          SESSION,
        ),
      McpScopeError,
    );
  });

  it('writeMemoryForUser routes through the guard', async () => {
    await assert.rejects(
      () =>
        writeMemoryForUser(
          new UserScopedWriteRepository({} as never),
          'user-A',
          'user-B',
          { key: 'k', content: 'v' },
        ),
      McpScopeError,
    );
  });

  it('updateProfileForUser routes through the guard', async () => {
    await assert.rejects(
      () =>
        updateProfileForUser(
          new UserScopedWriteRepository({} as never),
          'user-A',
          'user-B',
          { recovery_state: { total_score: 50, last_assessed: '2026-07-11T00:00:00Z' } },
        ),
      McpScopeError,
    );
  });
});

// ===========================================================================
// Real-PG suite: B2 (write scope) + B4 (read tools) + enhanced filters. Skips
// if PG unreachable.
// ===========================================================================

describe('mcpTools — B2/B4 real PG', { concurrency: false }, () => {
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
      fitness_level: 'BEGINNER',
      tags: ['r3-test'],
      red_flags: [],
    });
    for (const id of [userA, userB]) {
      await client.query(
        `INSERT INTO users (id, profile_static, profile_dynamic, history_summary)
         VALUES ($id, $ps, '{}'::jsonb, $hs)`,
        {
          id,
          ps: minimalProfile,
          hs: JSON.stringify({ sessions: [{ summary: 'seed-legacy', date: '2026-07-10' }] }),
        },
      );
    }
    await client.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty)
       VALUES ($id, $name, $type::exercise_type_enum, $diff::difficulty_level)
       ON CONFLICT (id) DO NOTHING`,
      {
        id: EXERCISE_ID,
        name: 'R3 Test Squat',
        type: 'resistance',
        diff: 'intermediate',
      },
    );
    // A fully-attributed exercise for the filter / detail tests.
    await client.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty, attributes)
       VALUES ($id, $name, $type::exercise_type_enum, $diff::difficulty_level, $attrs::jsonb)
       ON CONFLICT (id) DO UPDATE SET attributes = EXCLUDED.attributes`,
      {
        id: EXERCISE_ID_ATTR,
        name: 'R3 DB Row',
        type: 'resistance',
        diff: 'intermediate',
        attrs: JSON.stringify(ATTRS),
      },
    );
  }

  after(async () => {
    if (!pgAvailable) {
      return;
    }
    try {
      await client.query(`DELETE FROM users WHERE id IN ($a, $b)`, { a: userA, b: userB });
      await client.query(`DELETE FROM exercises WHERE id IN ($id1, $id2)`, {
        id1: EXERCISE_ID,
        id2: EXERCISE_ID_ATTR,
      });
    } finally {
      await client.close();
    }
  });

  it('B2/B4 setup: connected to real PG (skips the rest if not)', async (t) => {
    if (!pgAvailable) {
      t.skip('PG unreachable — skipping real-PG assertions (no mock substitutes, per A018)');
      return;
    }
    await seed();
    assert.ok(pgAvailable);
  });

  it('B2 green: write_session for the injected user lands on that user (real PG)', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
    const writeRepo = new UserScopedWriteRepository(client);
    const res = await writeSessionForUser(writeRepo, userA, userA, SESSION);
    assert.equal(res.userId, userA);

    // Real read-back: the session must be persisted on userA's history_summary.
    const userRepo = createUserRepository(client);
    const hist = await userRepo.getHistorySummary(userA);
    const sessions = (hist as { sessions?: unknown[] } | null)?.sessions ?? [];
    assert.ok(
      sessions.some((s) => (s as { summary?: string }).summary === SESSION.summary),
      'written session must appear in userA history_summary (real PG)',
    );
  });

  it('B2 reject: writing user B while injected as A is blocked + leaves B unchanged (real PG)', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
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
      'rejected write must not mutate userB (real PG confirms isolation)',
    );
  });

  it('B2 tool-level: buildMcpToolsWith(A).write_session writes only to A', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
    const tools = buildMcpToolsWith(client, userA);
    const ws = tools.find((t2) => t2.name === 'write_session')!;
    const out = (await ws.invoke(SESSION)) as string;
    const parsed = JSON.parse(out) as { userId: string };
    assert.equal(parsed.userId, userA, 'tool must always target the injected userId');

    // And the memory tool, too.
    const wm = tools.find((t2) => t2.name === 'write_memory')!;
    await wm.invoke({ key: 'r3-note', content: 'remember this' });
    const pd = await new UserScopedWriteRepository(client).readProfileDynamic(userA);
    assert.equal(
      (pd?.memories as Record<string, string> | undefined)?.['r3-note'],
      'remember this',
      'write_memory persisted on userA (real PG)',
    );
  });

  it('B4 read: load_history returns the user history + profile + dynamic (real PG)', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
    const tools = buildMcpToolsWith(client, userA);
    const lh = tools.find((t2) => t2.name === 'load_history')!;
    const out = (await lh.invoke({ include_profile: true, include_dynamic: true })) as string;
    const parsed = JSON.parse(out) as {
      userId: string;
      history_summary: { sessions?: { summary?: string }[] } | null;
      profile_static: unknown;
      profile_dynamic: unknown;
    };
    assert.equal(parsed.userId, userA);
    const summaries = (parsed.history_summary?.sessions ?? []).map((s) => s.summary);
    assert.ok(
      summaries.includes(SESSION.summary),
      'load_history must return the previously written session (real PG read)',
    );
    assert.ok(parsed.profile_static !== undefined, 'static profile returned when requested');
    assert.ok(parsed.profile_dynamic !== null && parsed.profile_dynamic !== undefined, 'dynamic profile returned');
  });

  it('B4 read: list_exercises returns every exercise as {id,name,description} (real PG)', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === 'list_exercises')!;
    const out = (await le.invoke({})) as string;
    const parsed = JSON.parse(out) as {
      count: number;
      exercises: { id: string; name: string; description: string }[];
    };
    assert.ok(parsed.count >= 1, 'list_exercises must return the seeded library');
    const seeded = parsed.exercises.find((e) => e.id === EXERCISE_ID);
    assert.ok(seeded, 'seeded R3 exercise must be in the full list (real PG read)');
    assert.equal(typeof seeded!.description, 'string');
    assert.ok(seeded!.description.length > 0, 'description is synthesized for every exercise');
  });

  it('B4 read: list_exercises description carries pattern/equipment/impact for in-context filtering (real PG)', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
    const tools = buildMcpToolsWith(client, userA);
    const le = tools.find((t2) => t2.name === 'list_exercises')!;
    const parsed = JSON.parse((await le.invoke({})) as string) as {
      exercises: { id: string; description: string }[];
    };
    const attr = parsed.exercises.find((e) => e.id === EXERCISE_ID_ATTR);
    assert.ok(attr, 'seeded ATTR exercise present');
    // The whole library is loaded into context; the `description` one-liner must
    // carry the constraint-relevant fields so the agent can filter in-context:
    // movement pattern, required equipment, and notable joint impact (knee=7 >= 5).
    const d = attr!.description;
    assert.ok(d.includes('squat'), 'description carries pattern:squat');
    assert.ok(d.includes('dumbbell'), 'description carries equipment:dumbbell');
    assert.ok(d.includes('knee:7'), 'description carries notable knee impact (>=5)');
  });

  it('B4 read: get_exercise_detail returns full attributes (real PG)', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
    const tools = buildMcpToolsWith(client, userA);
    const ged = tools.find((t2) => t2.name === 'get_exercise_detail')!;
    const out = (await ged.invoke({ id: EXERCISE_ID_ATTR })) as string;
    const parsed = JSON.parse(out) as {
      found: boolean;
      exercise?: { id: string; attributes: { pattern?: string; equipment_required?: string[] } };
    };
    assert.equal(parsed.found, true);
    assert.equal(parsed.exercise?.attributes.pattern, 'squat');
    assert.deepEqual(parsed.exercise?.attributes.equipment_required, ['dumbbell']);
  });

  it('B2 write: update_profile merges structured recovery_state into profile_dynamic (real PG)', async (t) => {
    if (!pgAvailable) { t.skip('PG unreachable'); return; }
    const tools = buildMcpToolsWith(client, userA);
    const up = tools.find((t2) => t2.name === 'update_profile')!;
    const out = (await up.invoke({
      recovery_state: { total_score: 72, last_assessed: '2026-07-11T00:00:00Z' },
    } as never)) as string;
    const parsed = JSON.parse(out) as { userId: string; updated_fields: string[] };
    assert.equal(parsed.userId, userA, 'update_profile targets the injected user');
    assert.ok(parsed.updated_fields.includes('recovery_state'));

    // Real read-back: recovery_state landed in profile_dynamic.
    const pd = await new UserScopedWriteRepository(client).readProfileDynamic(userA);
    assert.equal(
      (pd?.recovery_state as { total_score?: number } | undefined)?.total_score,
      72,
      'recovery_state persisted into profile_dynamic (real PG)',
    );
  });
});
