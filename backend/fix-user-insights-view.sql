-- Fix user_insights VIEW to properly query from users table
-- The new schema stores profile data in profile_static and profile_dynamic JSONB columns

-- First drop the broken VIEW
DROP VIEW IF EXISTS user_insights;

-- Create proper VIEW that extracts profile data from users table
CREATE OR REPLACE VIEW user_insights AS
SELECT
  u.id AS user_id,
  u.created_at,
  u.updated_at,
  -- Core fields from profile data
  COALESCE(u.profile_static->>'fitness_level', 'beginner') AS fitness_level,
  COALESCE(u.profile_static->>'red_flags', '[]') AS red_flags,
  COALESCE(u.profile_static->>'summary', '') AS summary,
  -- Extended JSON fields
  u.profile_static AS basic_info,
  u.profile_dynamic AS preferences,
  COALESCE(u.profile_static->>'physiological', NULL) AS physiological,
  COALESCE(u.profile_static->>'psychological', NULL) AS psychological,
  COALESCE(u.profile_dynamic->>'load_anchors', NULL) AS load_anchors,
  COALESCE(u.profile_dynamic->>'training_strategy', NULL) AS training_strategy,
  -- Metadata
  'system' AS modified_by,
  u.protocol_version AS protocol_version
FROM users u;

-- Verify the VIEW works
SELECT * FROM user_insights LIMIT 5;
