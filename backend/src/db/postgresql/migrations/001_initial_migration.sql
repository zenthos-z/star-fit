-- ============================================================================
-- Migration: 001_initial_migration
-- ============================================================================
-- Migration tracking table

CREATE TABLE IF NOT EXISTS migration_metadata (
  version VARCHAR(20) PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE migration_metadata IS 'Track applied database migrations';

-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('001', 'initial_migration', NOW())
ON CONFLICT (version) DO NOTHING;
