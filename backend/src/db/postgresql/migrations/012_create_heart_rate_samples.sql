-- ============================================================================
-- Migration: 012_create_heart_rate_samples
-- ============================================================================
-- Purpose: Create the heart-rate time-series sample table (ADR-0001).
--   - Source of truth for HR is HealthKit; this table stores the analysis-grade
--     5-second downsampled copy (avg bpm per 5s window).
--   - Per-set average HR is still written into session raw_json set.heartRate
--     (aggregated from these samples at set completion, compat with old chain).
--   - Manual entry path is retired (ADR-0001); `source` retains a distinction
--     capability for future audit, default 'watch'.
--
-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('012', 'create_heart_rate_samples', NOW())
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- heart_rate_samples
-- ============================================================================
CREATE TABLE IF NOT EXISTS heart_rate_samples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_index INTEGER,          -- index of exercise within the session (nullable: intra-set inter-set pauses)
  set_index INTEGER,               -- index of the set this sample belongs to (nullable)
  bpm SMALLINT NOT NULL CHECK (bpm > 0 AND bpm <= 250),
  recorded_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'watch' CHECK (source IN ('watch', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- heart_rate_samples indexes
CREATE INDEX IF NOT EXISTS idx_hr_samples_user_time ON heart_rate_samples(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_samples_session ON heart_rate_samples(session_id);
CREATE INDEX IF NOT EXISTS idx_hr_samples_set ON heart_rate_samples(session_id, exercise_index, set_index);

-- 幂等写入锚点：同一 (session, 时刻, bpm) 只存一行（手表批量同步可安全重放）
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_samples_dedup ON heart_rate_samples(session_id, recorded_at, bpm);

COMMENT ON TABLE heart_rate_samples IS
  'Analysis-grade HR samples (5s downsampled avg). Source of truth is HealthKit. ADR-0001.';
