-- Migration: Add display_name column to users table
-- Date: 2025-02-27
-- Description: Adds display_name column for user-friendly names that can be set by admin

-- Add display_name column
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Add check constraint for display_name (1-50 characters)
-- Note: IF NOT EXISTS not supported for ADD CONSTRAINT in PostgreSQL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'display_name_format'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT display_name_format
      CHECK (display_name ~ '^.{1,50}$');
  END IF;
END $$;

-- Refresh the user_insights view to include the new column
DROP VIEW IF EXISTS user_insights;

CREATE OR REPLACE VIEW user_insights AS
SELECT
  -- Primary key
  u.id AS user_id,
  u.id,  -- Also expose as 'id' for compatibility

  -- User identifiers
  u.device_id,
  u.display_name,

  -- Timestamps
  u.created_at,
  u.updated_at,
  u.updated_at AS modified_at,

  -- Core fields extracted from profile_static (Static State - updated 6mo-1yr)
  COALESCE(u.profile_static->>'fitness_level', 'beginner') AS fitness_level,
  COALESCE(u.profile_static->'red_flags', '[]'::jsonb) AS red_flags,
  COALESCE(u.profile_static->'basic_info', NULL::jsonb) AS basic_info,
  COALESCE(u.profile_static->'preferences', NULL::jsonb) AS preferences,
  COALESCE(u.profile_static->'physiological', NULL::jsonb) AS physiological,
  COALESCE(u.profile_static->'psychological', NULL::jsonb) AS psychological,
  COALESCE(u.profile_static->'training_strategy', NULL::jsonb) AS training_strategy,

  -- Dynamic fields extracted from profile_dynamic (Dynamic State - updated per workout)
  COALESCE(u.profile_dynamic->'load_anchors', NULL::jsonb) AS load_anchors,
  COALESCE(u.profile_dynamic->'active_limitations', '[]'::jsonb) AS active_limitations,
  COALESCE(u.profile_dynamic->'recovery_state', NULL::jsonb) AS recovery_state,

  -- Summary fields extracted from history_summary (Summary State - updated weekly)
  COALESCE(u.history_summary->'recent_summary', NULL::jsonb) AS summary,

  -- Metadata
  'system'::text AS modified_by,
  u.protocol_version,
  u.version
FROM users u;

-- Add comment
COMMENT ON COLUMN users.display_name IS 'User-friendly display name that can be set by admin (1-50 characters)';
