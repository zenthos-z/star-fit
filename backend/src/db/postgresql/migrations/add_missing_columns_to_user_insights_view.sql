-- Migration: Add missing columns to user_insights VIEW
-- Date: 2026-02-16
-- Description: Fix persistence.ts query errors by adding tags_json, psycho_os, hr_baseline, protocol_status columns

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
  COALESCE(u.profile_static->'tags', '[]'::jsonb) AS tags_json,
  COALESCE(u.profile_static->'red_flags', '[]'::jsonb) AS red_flags,
  COALESCE(u.profile_static->'basic_info', NULL::jsonb) AS basic_info,
  COALESCE(u.profile_static->'preferences', NULL::jsonb) AS preferences,
  COALESCE(u.profile_static->'physiological', NULL::jsonb) AS physiological,
  COALESCE(u.profile_static->'psychological', NULL::jsonb) AS psychological,
  COALESCE(u.profile_static->'psychoOS', NULL::jsonb) AS psycho_os,
  COALESCE(u.profile_static->'training_strategy', NULL::jsonb) AS training_strategy,

  -- Dynamic fields extracted from profile_dynamic (Dynamic State - updated per workout)
  COALESCE(u.profile_dynamic->'load_anchors', NULL::jsonb) AS load_anchors,
  COALESCE(u.profile_dynamic->'active_limitations', '[]'::jsonb) AS active_limitations,
  COALESCE(u.profile_dynamic->'recovery_state', NULL::jsonb) AS recovery_state,
  COALESCE(u.profile_dynamic->'hrBaseline', NULL::jsonb) AS hr_baseline,
  COALESCE(u.profile_dynamic->'protocolStatus', NULL::jsonb) AS protocol_status,

  -- Summary fields extracted from history_summary (Summary State - updated weekly)
  COALESCE(u.history_summary->'recent_summary', NULL::jsonb) AS summary,

  -- Metadata
  'system'::text AS modified_by,
  u.protocol_version,
  u.version
FROM users u;

COMMENT ON VIEW user_insights IS 'User insights flattened view from users table JSONB fields';
