/**
 * HeartRate Repository
 *
 * Read-side access to `heart_rate_samples` (ADR-0001). All queries are scoped
 * to a user id — a session belonging to another user never leaks rows.
 *
 * The table stores the analysis-grade copy (5s downsampled avg per sample);
 * HealthKit remains the raw source of truth.
 */

import { PostgresClient } from "../client/postgres-client.js";
import { BaseRepository } from "./base.repository.js";

export interface HeartRatePoint {
  t: string; // ISO 8601
  bpm: number;
}

export interface HeartRateCurveRow {
  session_id: string;
  start_time: string;
  end_time: string | null;
  sample_count: number;
  points: HeartRatePoint[];
  avg_bpm: number;
  max_bpm: number;
  min_bpm: number;
}

export interface HeartRateSessionStatRow {
  session_id: string;
  started_at: string;
  avg_bpm: number;
  max_bpm: number;
  min_bpm: number;
  sample_count: number;
}

export class HeartRateRepository extends BaseRepository {
  constructor(client: PostgresClient) {
    super(client);
  }

  /**
   * Fetch the full HR curve (all 5s samples) for one session.
   * Scoped to the owning user; returns null when the session is not theirs.
   */
  async getSessionCurve(
    userId: string,
    sessionId: string,
  ): Promise<HeartRateCurveRow | null> {
    const session = await this.queryOne<{
      start_time: Date;
      end_time: Date | null;
    }>(
      `SELECT start_time, end_time FROM sessions WHERE id = $sessionId AND user_id = $userId`,
      { sessionId, userId },
    );
    if (!session) return null;

    const rows = await this.queryMany<{ recorded_at: Date; bpm: number }>(
      `SELECT recorded_at, bpm FROM heart_rate_samples
        WHERE session_id = $sessionId AND user_id = $userId
        ORDER BY recorded_at ASC`,
      { sessionId, userId },
    );

    const bpmValues = rows.map((r) => Number(r.bpm));
    return {
      session_id: sessionId,
      start_time: session.start_time.toISOString(),
      end_time: session.end_time ? session.end_time.toISOString() : null,
      sample_count: rows.length,
      points: rows.map((r) => ({
        t: r.recorded_at.toISOString(),
        bpm: Number(r.bpm),
      })),
      avg_bpm: bpmValues.length
        ? Math.round(bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length)
        : 0,
      max_bpm: bpmValues.length ? Math.max(...bpmValues) : 0,
      min_bpm: bpmValues.length ? Math.min(...bpmValues) : 0,
    };
  }

  /**
   * Per-session HR stats over the last `days` days (for trend analysis).
   * Sessions with fewer than `minSamples` samples are excluded (noise guard).
   */
  async getTrend(
    userId: string,
    days: number,
    minSamples = 10,
  ): Promise<HeartRateSessionStatRow[]> {
    const rows = await this.queryMany<{
      session_id: string;
      started_at: Date;
      avg_bpm: string;
      max_bpm: string;
      min_bpm: string;
      sample_count: string;
    }>(
      `SELECT
         s.id AS session_id,
         s.start_time AS started_at,
         ROUND(AVG(h.bpm)) AS avg_bpm,
         MAX(h.bpm) AS max_bpm,
         MIN(h.bpm) AS min_bpm,
         COUNT(h.id) AS sample_count
       FROM sessions s
       JOIN heart_rate_samples h ON h.session_id = s.id
       WHERE s.user_id = $userId
         AND s.start_time >= NOW() - ($days || ' days')::interval
       GROUP BY s.id, s.start_time
       HAVING COUNT(h.id) >= $minSamples
       ORDER BY s.start_time ASC`,
      { userId, days, minSamples },
    );
    return rows.map((r) => ({
      session_id: r.session_id,
      started_at: r.started_at.toISOString(),
      avg_bpm: Number(r.avg_bpm),
      max_bpm: Number(r.max_bpm),
      min_bpm: Number(r.min_bpm),
      sample_count: Number(r.sample_count),
    }));
  }

  /**
   * Persist a batch of samples for a session (watch post-workout sync path).
   * Returns the number of rows inserted. Idempotent per (session, recorded_at, bpm)
   * via the unique index idx_hr_samples_dedup — replaying a batch is safe.
   */
  async insertBatch(
    userId: string,
    sessionId: string,
    samples: Array<{
      bpm: number;
      recorded_at: string;
      source?: string;
      exercise_index?: number;
      set_index?: number;
    }>,
  ): Promise<number> {
    if (samples.length === 0) return 0;
    // Single named param + jsonb_to_recordset: no positional numbering to
    // collide with the client's named-param processor.
    const rows = samples.map((s) => ({
      user_id: userId,
      session_id: sessionId,
      exercise_index: s.exercise_index ?? null,
      set_index: s.set_index ?? null,
      bpm: s.bpm,
      recorded_at: s.recorded_at,
      source: s.source ?? "watch",
    }));
    return this.execute(
      `INSERT INTO heart_rate_samples (user_id, session_id, exercise_index, set_index, bpm, recorded_at, source)
       SELECT t.user_id::uuid, t.session_id::uuid, t.exercise_index::int, t.set_index::int,
              t.bpm::smallint, t.recorded_at::timestamptz, t.source::text
       FROM jsonb_to_recordset($samples::jsonb) AS t(
         user_id text, session_id text, exercise_index int, set_index int,
         bpm int, recorded_at text, source text)
       ON CONFLICT DO NOTHING`,
      { samples: JSON.stringify(rows) },
    );
  }
}

export function createHeartRateRepository(
  client: PostgresClient,
): HeartRateRepository {
  return new HeartRateRepository(client);
}
