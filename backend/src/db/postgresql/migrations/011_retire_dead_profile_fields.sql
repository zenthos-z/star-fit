-- ============================================================================
-- Migration: 011_retire_dead_profile_fields
-- ============================================================================
-- Purpose: Remove dead user-profile fields from the user_insights view and
-- its compatibility trigger functions:
--   - fitness_level        (profile_static) — no standard, decided to delete
--   - red_flags            (profile_dynamic) — no consumers, superseded by active_limitations
--   - training_strategy    (profile_static) — write-only, zero readers
--
-- Data in users.profile_static / profile_dynamic JSONB is left untouched
-- (harmless orphans); only view/trigger/index surface is retired.
--
-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('011', 'retire_dead_profile_fields', NOW())
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- Recreate user_insights view without dead columns
-- ============================================================================
DROP VIEW IF EXISTS user_insights;

CREATE OR REPLACE VIEW user_insights AS
SELECT
  u.id AS user_id,
  u.id,
  u.device_id,
  u.display_name,
  u.created_at,
  u.updated_at,
  u.updated_at AS modified_at,
  COALESCE(u.profile_static->'basic_info', NULL::jsonb) AS basic_info,
  COALESCE(u.profile_static->'preferences', NULL::jsonb) AS preferences,
  COALESCE(u.profile_static->'physiological', NULL::jsonb) AS physiological,
  COALESCE(u.profile_static->'psychological', NULL::jsonb) AS psychological,
  COALESCE(u.profile_dynamic->'load_anchors', NULL::jsonb) AS load_anchors,
  COALESCE(u.profile_dynamic->'active_limitations', '[]'::jsonb) AS active_limitations,
  COALESCE(u.profile_dynamic->'recovery_state', NULL::jsonb) AS recovery_state,
  COALESCE(u.history_summary->'recent_summary', NULL::jsonb) AS summary,
  'system'::text AS modified_by,
  u.protocol_version,
  u.version
FROM users u;

COMMENT ON VIEW user_insights IS 'Compatibility view for legacy user_insights table. Maps new three-state model to old structure. Dead fields (fitness_level/red_flags/training_strategy) retired in 011.';

-- ============================================================================
-- Replace INSTEAD OF trigger functions (remove dead-column references)
-- ============================================================================

-- INSERT trigger: build profile JSONB from view columns, minus dead fields
CREATE OR REPLACE FUNCTION user_insights_insert_trigger()
RETURNS TRIGGER AS $$
DECLARE
  user_uuid UUID;
  profile_static JSONB;
  profile_dynamic JSONB;
  history_summary JSONB;
BEGIN
  -- Generate or use existing UUID
  IF (NEW.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    user_uuid := NEW.user_id::UUID;
  ELSE
    user_uuid := uuid_generate_v4();
  END IF;

  -- Build profile_static from legacy fields (dead fields removed)
  profile_static := COALESCE(
    jsonb_build_object(
      'basic_info', COALESCE(NEW.basic_info::jsonb, '{}'),
      'preferences', COALESCE(NEW.preferences::jsonb, '{}'),
      'physiological', COALESCE(NEW.physiological::jsonb, '{}'),
      'psychological', COALESCE(NEW.psychological::jsonb, '{}')
    ),
    '{}'
  );

  -- Build profile_dynamic (dead red_flags removed)
  profile_dynamic := COALESCE(
    jsonb_build_object(
      'load_anchors', COALESCE(NEW.load_anchors::jsonb, '{}')
    ),
    '{}'
  );

  -- Build history_summary (dead training_strategy removed)
  history_summary := COALESCE(
    jsonb_build_object(
      'summary', NEW.summary
    ),
    '{}'
  );

  -- Insert into users table
  INSERT INTO users (
    id,
    device_id,
    profile_static,
    profile_dynamic,
    history_summary,
    metadata_json,
    protocol_version,
    version
  ) VALUES (
    user_uuid,
    NEW.user_id, -- Store original ID as device_id for reference
    profile_static,
    profile_dynamic,
    history_summary,
    jsonb_set(
      COALESCE(NEW.metadata_json, '{}'),
      '{modified_by}',
      to_jsonb(NEW.modified_by)
    ),
    COALESCE(NEW.protocol_version, '3.0.0'),
    COALESCE(NEW.version, 1)
  )
  ON CONFLICT (device_id) DO UPDATE SET
    profile_static = EXCLUDED.profile_static,
    profile_dynamic = EXCLUDED.profile_dynamic,
    history_summary = EXCLUDED.history_summary,
    metadata_json = EXCLUDED.metadata_json,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- UPDATE trigger: write back view columns minus dead fields
CREATE OR REPLACE FUNCTION user_insights_update_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the corresponding user record
  UPDATE users
  SET
    profile_static = COALESCE(profile_static, '{}') || jsonb_build_object(
      'basic_info', COALESCE(NEW.basic_info::jsonb, '{}'),
      'preferences', COALESCE(NEW.preferences::jsonb, '{}'),
      'physiological', COALESCE(NEW.physiological::jsonb, '{}'),
      'psychological', COALESCE(NEW.psychological::jsonb, '{}')
    ),
    profile_dynamic = COALESCE(profile_dynamic, '{}') || jsonb_build_object(
      'load_anchors', COALESCE(NEW.load_anchors::jsonb, '{}')
    ),
    history_summary = COALESCE(history_summary, '{}') || jsonb_build_object(
      'summary', NEW.summary
    ),
    metadata_json = jsonb_set(
      COALESCE(metadata_json, '{}'),
      '{modified_by}',
      to_jsonb(NEW.modified_by)
    ),
    updated_at = NEW.updated_at
  WHERE device_id = NEW.user_id OR id::text = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Drop dead-column indexes
-- ============================================================================
DROP INDEX IF EXISTS idx_users_fitness_level;
DROP INDEX IF EXISTS idx_users_red_flags;
