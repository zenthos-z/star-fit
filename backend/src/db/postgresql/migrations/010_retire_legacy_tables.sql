-- 010: Retire legacy tables and materialized views.
-- Removes objects with no live reader/writer in the codebase:
--   - profile_state_audit     (orphan, superseded by audit_logs, zero code refs)
--   - deviation_logs          (event-driven correction never implemented)
--   - cache_history_summaries (SQLite-era cache layer; Agent history now reads
--                              the sessions table directly, no compression cache)
--   - cache_rpe_stats         (same era; RPE stats queried from rpe_logs directly)
--   - user_current_state / exercise_summary (materialized views, never SELECTed
--                              by the app; only refreshed by a one-off script)
--   - refresh_materialized_views() (only caller was the above script)
-- All objects are empty (0 rows) or unread at drop time — no data loss.
-- Idempotent.

DROP TABLE IF EXISTS profile_state_audit;
DROP TABLE IF EXISTS deviation_logs;
DROP TABLE IF EXISTS cache_history_summaries;
DROP TABLE IF EXISTS cache_rpe_stats;

DROP MATERIALIZED VIEW IF EXISTS user_current_state;
DROP MATERIALIZED VIEW IF EXISTS exercise_summary;

DROP FUNCTION IF EXISTS refresh_materialized_views();

-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('010', 'retire_legacy_tables', NOW())
ON CONFLICT (version) DO NOTHING;
