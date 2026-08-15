-- ============================================================================
-- Migration: 004_add_id_to_view
-- ============================================================================
-- Purpose: Add id field to user_insights view for UserProfileV2 validation
--
-- This migration updates the user_insights compatibility view to include
-- the actual UUID (id) field needed for UserProfileV2Schema validation
--
-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('004', 'add_id_to_view', NOW())
ON CONFLICT (version) DO NOTHING;

-- Drop and recreate user_insights view with id field
DROP VIEW IF EXISTS user_insights;

CREATE OR REPLACE VIEW user_insights AS
SELECT
  -- Core fields (mapped from users table)
  u.id as id,  -- Add UUID id for UserProfileV2 validation
  u.id::text as user_id,
  u.created_at,
  COALESCE(
    u.profile_static->>'fitness_level',
    'beginner'
  ) as fitness_level,
  COALESCE(
    u.profile_dynamic->>'red_flags',
    '[]'
  ) as red_flags,
  u.updated_at,

  -- Map modified_by from metadata if available, default to 'system'
  COALESCE(
    (u.metadata_json->>'modified_by')::modified_by_type,
    'system'
  ) as modified_by,

  -- Flex fields (mapped from JSONB columns)
  pgb_json_merge(u.profile_static, u.profile_dynamic)::text as basic_info,
  u.profile_dynamic::text as load_anchors,
  u.profile_static::text as preferences,
  u.profile_static::text as physiological,
  u.profile_static::text as psychological,

  -- Training strategy from history_summary or profile_static
  COALESCE(
    u.history_summary->>'training_strategy',
    u.profile_static->>'training_strategy'
  ) as training_strategy,

  -- Legacy fields (for backward compatibility)
  u.metadata_json->>'tags' as tags_json,
  u.history_summary->>'summary' as summary,
  u.protocol_version,
  u.version,
  u.metadata_json
FROM users u;

COMMENT ON VIEW user_insights IS 'Compatibility view for legacy user_insights table. Maps new three-state model to old structure. Updated to include id field for UserProfileV2 validation.';
