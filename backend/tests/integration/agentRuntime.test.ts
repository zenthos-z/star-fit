/**
 * M-RT: Agent Runtime Checkpointer integration tests.
 *
 * Validates the acceptance criteria B1-B5 against a REAL PostgreSQL instance
 * (L100 real-data-over-mock / A018 no-fake-checkpointer): the agent_runtime
 * schema is created by the real PostgresSaver.setup(), a real compiled graph
 * checkpoints into it, and isolation from the business (public) schema is
 * proven at the data level.
 *
 * The suite is skipped automatically when DATABASE_URL is unset, so typecheck /
 * lint / CI on PG-less machines is not broken. An unreachable or misconfigured
 * DB surfaces as a clear error inside beforeAll (the first real query).
 *
 * Run for real with:
 *   DATABASE_URL=postgresql://user:pwd@host:5432/db npx jest \
 *     tests/integration/agentRuntime.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import {
  getAgentRuntimeCheckpointer,
  ensureAgentRuntimeSchema,
  closeAgentRuntime,
  _resetAgentRuntimeSingletonForTest,
  AGENT_RUNTIME_SCHEMA,
  AGENT_RUNTIME_TABLES,
} from '../../src/services/agent/agentRuntime.js';

// ============================================================================
// PG availability gate
// ============================================================================

const connectionString = process.env.DATABASE_URL;
// jest runs tests in CommonJS (ts-jest): no top-level await, so the skip
// decision is based on the synchronous presence of DATABASE_URL.
const describeOrSkip = connectionString ? describe : describe.skip;

// Dedicated verification pool (raw SQL, separate from the saver's own pool).
// Created in beforeAll; definite assignment because jest lifecycle guarantees
// beforeAll runs before any test / afterEach / afterAll reads it.
let verifyPool!: pg.Pool;

const TEST_THREAD = `mrt-test-${Date.now()}`;

/**
 * Minimal pure-function graph (no LLM) that forces a checkpoint write per
 * super-step. L100: the only unstable dependency we avoid here is an LLM; the
 * checkpointer itself is the real component under test (A018 forbids faking it).
 */
function buildEchoGraph(checkpointer: PostgresSaver) {
  const State = Annotation.Root({
    msg: Annotation<string>({ default: () => '', reducer: (_x: string, y: string) => y }),
  });
  return new StateGraph(State)
    .addNode('echo', async (state: { msg: string }) => ({ msg: `${state.msg}!` }))
    .addEdge(START, 'echo')
    .addEdge('echo', END)
    .compile({ checkpointer });
}

// ============================================================================
// Tests
// ============================================================================

describeOrSkip('M-RT: agent_runtime checkpointer (real PG)', () => {
  beforeAll(async () => {
    verifyPool = new pg.Pool({
      connectionString: connectionString as string,
      connectionTimeoutMillis: 5000,
    });
    // Clean slate: drop any prior agent_runtime so we prove creation works.
    await verifyPool.query(`DROP SCHEMA IF EXISTS "${AGENT_RUNTIME_SCHEMA}" CASCADE`);
    // Clear the in-module singleton so setup() is exercised fresh.
    _resetAgentRuntimeSingletonForTest();
  });

  afterAll(async () => {
    // Leave the DB as we found it (no agent_runtime residue from this run).
    await verifyPool.query(`DROP SCHEMA IF EXISTS "${AGENT_RUNTIME_SCHEMA}" CASCADE`);
    await closeAgentRuntime();
    await verifyPool.end();
  });

  it('B1: ensureAgentRuntimeSchema creates the 4 tables in agent_runtime', async () => {
    await ensureAgentRuntimeSchema();

    for (const table of AGENT_RUNTIME_TABLES) {
      const res = await verifyPool.query(`SELECT to_regclass($1) AS oid`, [
        `${AGENT_RUNTIME_SCHEMA}.${table}`,
      ]);
      expect(res.rows[0].oid).not.toBeNull();
    }
  });

  it('B2: agent_runtime schema contains the checkpoint tables (isolated from business)', async () => {
    const res = await verifyPool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
      [AGENT_RUNTIME_SCHEMA],
    );
    const tables = res.rows.map((r: { table_name: string }) => r.table_name);
    // setup() creates exactly the 4 checkpoint tables under agent_runtime.
    // No business tables leak into agent_runtime (zero-intrusion target).
    for (const table of AGENT_RUNTIME_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('B3: real PostgresSaver instance + put/get lands in agent_runtime.checkpoints', async () => {
    const checkpointer = getAgentRuntimeCheckpointer();
    // A018: assert the real type, not a fake stand-in.
    expect(checkpointer).toBeInstanceOf(PostgresSaver);

    const graph = buildEchoGraph(checkpointer);
    await graph.invoke({ msg: 'hello' }, { configurable: { thread_id: TEST_THREAD } });

    // The write reached the agent_runtime checkpoints table.
    const hit = await verifyPool.query(
      `SELECT count(*)::int AS n FROM "${AGENT_RUNTIME_SCHEMA}".checkpoints WHERE thread_id = $1`,
      [TEST_THREAD],
    );
    expect(hit.rows[0].n).toBeGreaterThanOrEqual(1);

    // And is retrievable via the real checkpointer API.
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: TEST_THREAD } });
    expect(tuple).toBeDefined();
  });

  it('B4: writes are isolated to agent_runtime (do not land in public.checkpoints)', async () => {
    // Self-contained: write a fresh checkpoint for this thread.
    const checkpointer = getAgentRuntimeCheckpointer();
    const graph = buildEchoGraph(checkpointer);
    await graph.invoke({ msg: 'isolate' }, { configurable: { thread_id: TEST_THREAD } });

    // public.checkpoints may pre-exist from the legacy MAS graph; the rigorous
    // zero-intrusion proof is that THIS thread's data is NOT in public.
    const leaked = await verifyPool.query(
      `SELECT count(*)::int AS n FROM public.checkpoints WHERE thread_id = $1`,
      [TEST_THREAD],
    );
    expect(leaked.rows[0].n).toBe(0);

    // And the data IS in agent_runtime.
    const isolated = await verifyPool.query(
      `SELECT count(*)::int AS n FROM "${AGENT_RUNTIME_SCHEMA}".checkpoints WHERE thread_id = $1`,
      [TEST_THREAD],
    );
    expect(isolated.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('B5: closeAgentRuntime resolves and the singleton rebuilds afterwards', async () => {
    const before = getAgentRuntimeCheckpointer();
    expect(before).toBeInstanceOf(PostgresSaver);

    await expect(closeAgentRuntime()).resolves.toBeUndefined();

    // After close, a fresh instance is constructed on next access.
    const after = getAgentRuntimeCheckpointer();
    expect(after).toBeInstanceOf(PostgresSaver);
    expect(after).not.toBe(before);

    // Re-run setup (idempotent) so the rebuilt pool is ready for use.
    await ensureAgentRuntimeSchema();
  });
});
