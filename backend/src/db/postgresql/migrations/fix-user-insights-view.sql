-- ============================================================================
-- Fix user_insights VIEW - Remove circular reference
-- ============================================================================
-- Date: 2026-02-13
-- Issue: user_insights VIEW was referencing itself, causing query failures
-- Fix: VIEW now directly reads from users table's JSONB fields
--
-- Run this script:
--   psql $DATABASE_URL -f fix-user-insights-view.sql
-- ============================================================================

-- Drop the existing VIEW if it exists (may have been created incorrectly)
DROP VIEW IF EXISTS user_insights CASCADE;

-- Create the corrected VIEW
CREATE OR REPLACE VIEW user_insights AS
SELECT
  -- Primary key
  u.id AS user_id,
  u.id,  -- Also expose as 'id' for compatibility

  -- Timestamps
  u.created_at,
  u.updated_at,
  u.updated_at AS modified_at,

  -- Core fields extracted from profile_static (Static State - updated 6mo-1yr)
  COALESCE(u.profile_static->>'fitness_level', 'beginner') AS fitness_level,
  COALESCE(u.profile_static->>'red_flags', '[]') AS red_flags,
  COALESCE(u.profile_static->>'basic_info', NULL) AS basic_info,
  COALESCE(u.profile_static->>'preferences', NULL) AS preferences,
  COALESCE(u.profile_static->>'physiological', NULL) AS physiological,
  COALESCE(u.profile_static->>'psychological', NULL) AS psychological,
  COALESCE(u.profile_static->>'training_strategy', NULL) AS training_strategy,

  -- Dynamic fields extracted from profile_dynamic (Dynamic State - updated per workout)
  COALESCE(u.profile_dynamic->>'load_anchors', NULL) AS load_anchors,
  COALESCE(u.profile_dynamic->>'active_limitations', '[]') AS active_limitations,
  COALESCE(u.profile_dynamic->>'recovery_state', NULL) AS recovery_state,

  -- Summary fields extracted from history_summary (Summary State - updated weekly)
  COALESCE(u.history_summary->>'recent_summary', NULL) AS summary,

  -- Metadata
  'system'::text AS modified_by,
  u.protocol_version,
  u.version
FROM users u;

-- Verify the fix
SELECT 'user_insights VIEW created successfully' AS status;

-- Show sample data (if any users exist)
DO $$
DECLARE
  user_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM users;
  IF user_count > 0 THEN
    RAISE NOTICE 'Found % users in database. user_insights VIEW should now return data.', user_count;
  ELSE
    RAISE NOTICE 'No users found in database. VIEW is ready but will return empty results.';
  END IF;
END $$;
