/**
 * HeartRate Repository integration tests (ADR-0001).
 *
 * Validates against a REAL PostgreSQL: session-scoped reads, user scoping,
 * trend aggregation and idempotent batch insert (idx_hr_samples_dedup).
 * Skipped automatically when DATABASE_URL is unset (CI/PG-less machines).
 *
 * Run for real with:
 *   DATABASE_URL=postgresql://starfit:***@localhost:5432/starfit npx jest \
 *     tests/integration/heartRateRepository.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import pg from "pg";

import {
  getPostgresClient,
  closePostgresClient,
} from "../../src/db/postgresql/client/postgres-client.js";
import { createHeartRateRepository } from "../../src/db/postgresql/repository/heartRate.repository.js";

const connectionString = process.env.DATABASE_URL;
const describeOrSkip = connectionString ? describe : describe.skip;

let adminPool!: pg.Pool;
let userId!: string;
let sessionId!: string;
const now = Date.now();

describeOrSkip("HeartRateRepository (real PG)", () => {
  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString });
    // Fresh user + session for the test (unique device_id to survive parallel runs).
    const user = await adminPool.query(
      `INSERT INTO users (device_id, display_name, protocol_version)
       VALUES ($1, 'hr-test-user', '3.0.0') RETURNING id`,
      [`hr-test-${now}`],
    );
    userId = user.rows[0].id;
    const session = await adminPool.query(
      `INSERT INTO sessions (user_id, start_time, raw_json)
       VALUES ($1, NOW() - interval '1 hour', '{}') RETURNING id`,
      [userId],
    );
    sessionId = session.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query("DELETE FROM users WHERE id = $1", [userId]);
    await adminPool.end();
    await closePostgresClient();
  });

  it("insertBatch persists rows and is idempotent on replay", async () => {
    const repo = createHeartRateRepository(getPostgresClient());
    const samples = [
      {
        bpm: 120,
        recorded_at: new Date(now - 10000).toISOString(),
        exercise_index: 0,
        set_index: 0,
      },
      {
        bpm: 125,
        recorded_at: new Date(now - 5000).toISOString(),
        exercise_index: 0,
        set_index: 0,
      },
      {
        bpm: 130,
        recorded_at: new Date(now).toISOString(),
        exercise_index: 0,
        set_index: 1,
      },
    ];
    const inserted = await repo.insertBatch(userId, sessionId, samples);
    expect(inserted).toBe(3);

    // Replay must insert nothing (unique idx_hr_samples_dedup).
    const replayed = await repo.insertBatch(userId, sessionId, samples);
    expect(replayed).toBe(0);
  });

  it("getSessionCurve returns curve + stats scoped to the owner", async () => {
    const repo = createHeartRateRepository(getPostgresClient());
    const curve = await repo.getSessionCurve(userId, sessionId);
    expect(curve).not.toBeNull();
    expect(curve!.sample_count).toBe(3);
    expect(curve!.points).toHaveLength(3);
    expect(curve!.avg_bpm).toBe(125);
    expect(curve!.max_bpm).toBe(130);
    expect(curve!.min_bpm).toBe(120);
  });

  it("getSessionCurve returns null for another user (row scoping)", async () => {
    const other = await adminPool.query(
      `INSERT INTO users (device_id, display_name, protocol_version)
       VALUES ($1, 'hr-test-other', '3.0.0') RETURNING id`,
      [`hr-test-other-${now}`],
    );
    const repo = createHeartRateRepository(getPostgresClient());
    const curve = await repo.getSessionCurve(other.rows[0].id, sessionId);
    expect(curve).toBeNull();
    await adminPool.query("DELETE FROM users WHERE id = $1", [
      other.rows[0].id,
    ]);
  });

  it("getTrend aggregates per-session stats within the window", async () => {
    const repo = createHeartRateRepository(getPostgresClient());
    const trend = await repo.getTrend(userId, 7, 1);
    expect(trend.length).toBeGreaterThanOrEqual(1);
    const row = trend.find((t) => t.session_id === sessionId);
    expect(row).toBeDefined();
    expect(row!.avg_bpm).toBe(125);
    expect(row!.sample_count).toBe(3);
  });
});
