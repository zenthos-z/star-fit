/**
 * Agent Runtime Checkpointer (M-RT)
 *
 * Isolated LangGraph checkpoint storage for the deep-agent runtime.
 *
 * Uses a dedicated `agent_runtime` schema on the SAME PostgreSQL instance as the
 * business database — logical (schema) isolation, not a separate database/host.
 *
 * Zero-intrusion design (L003 probe, A018/L100):
 * - PostgresSaver is built with the native `{ schema: 'agent_runtime' }` option.
 *   Its `setup()` runs `CREATE SCHEMA IF NOT EXISTS "agent_runtime"` and creates
 *   the 4 checkpoint tables, ALL schema-qualified (`"agent_runtime".checkpoints`
 *   etc., per langgraph-checkpoint-postgres sql.js). Every runtime query is
 *   schema-qualified, so the checkpointer can never leak into public/business
 *   schemas regardless of the session search_path.
 * - The business schema SQL files (schema.sql / schema-no-vector.sql) are NOT
 *   modified by this module (zero-intrusion red line, AF2/L010).
 *
 * P006 injectable-side-effect-boundary:
 * - This module does NOT hold a handle to the business DB pool. It obtains only
 *   the connection *string* from the config module and owns its own isolated pool.
 * - M3 injects the returned checkpointer into the compiled agent graph; there is
 *   no global business-DB coupling.
 */

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
// P006: import only the connection-string helper; no business pool handle.
import { getAgentRuntimeConnectionString } from '../../db/postgresql/config.js';

/** Dedicated schema for agent runtime checkpoint state. */
export const AGENT_RUNTIME_SCHEMA = 'agent_runtime';

/**
 * Tables created by PostgresSaver.setup() inside the agent_runtime schema.
 * Used for documentation and verification; the set is fixed by the library.
 */
export const AGENT_RUNTIME_TABLES = [
  'checkpoints',
  'checkpoint_blobs',
  'checkpoint_migrations',
  'checkpoint_writes',
] as const;

// ============================================================================
// Singleton lifecycle
// ============================================================================

let runtimeCheckpointer: PostgresSaver | null = null;

/**
 * Get the agent-runtime checkpointer singleton (lazily constructed).
 *
 * Synchronous by design: constructing a PostgresSaver performs no I/O (it only
 * opens a pg.Pool lazily). Call {@link ensureAgentRuntimeSchema} once at startup
 * (before first use by a graph) to materialise the schema + tables.
 *
 * Returns a concrete `PostgresSaver` (a `BaseCheckpointSaver` subtype) so callers
 * and tests can assert `instanceof PostgresSaver` (AC3/B3).
 */
export function getAgentRuntimeCheckpointer(): PostgresSaver {
  if (!runtimeCheckpointer) {
    const connString = getAgentRuntimeConnectionString();
    // L003 probe: native schema option -> setup() auto-creates the schema and
    // qualifies all 4 tables under agent_runtime. Stronger than a search_path
    // hack (which only affects unqualified resolution).
    runtimeCheckpointer = PostgresSaver.fromConnString(connString, {
      schema: AGENT_RUNTIME_SCHEMA,
    });
  }
  return runtimeCheckpointer;
}

/**
 * Ensure the `agent_runtime` schema and its checkpoint tables exist.
 *
 * Idempotent: PostgresSaver.setup() uses `CREATE SCHEMA IF NOT EXISTS` and
 * `CREATE TABLE IF NOT EXISTS`, plus a migrations bookkeeping table. Safe to
 * call on every startup. Must complete before the checkpointer is first used
 * by a compiled graph.
 */
export async function ensureAgentRuntimeSchema(): Promise<void> {
  const checkpointer = getAgentRuntimeCheckpointer();
  await checkpointer.setup();
}

/**
 * Gracefully close the agent-runtime connection pool and drop the singleton.
 *
 * After this resolves, a subsequent {@link getAgentRuntimeCheckpointer} call
 * rebuilds a fresh instance (AC5/B5). Safe to call when no instance exists.
 */
export async function closeAgentRuntime(): Promise<void> {
  if (runtimeCheckpointer) {
    // end() closes the internal pg.Pool owned by the saver.
    await runtimeCheckpointer.end();
    runtimeCheckpointer = null;
  }
}

/**
 * Reset the cached singleton WITHOUT closing the pool (test-only hook).
 *
 * Used by tests that need to force re-construction against a fresh state while
 * managing pool lifetimes themselves. Not for production use.
 */
export function _resetAgentRuntimeSingletonForTest(): void {
  runtimeCheckpointer = null;
}
