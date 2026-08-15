-- ============================================================================
-- Migration: 003_create_user_insights_compatibility
-- ============================================================================
-- Purpose: Create compatibility layer for user_insights table
--
-- This migration creates a view and trigger system to maintain backward
-- compatibility with the existing user_insights-based code during the
-- migration to the new three-state model (users table).
--
-- The new architecture stores user profile data in:
-- - users.profile_static (long-term biological/psychological traits)
-- - users.profile_dynamic (high-frequency state: load anchors, limitations)
-- - users.history_summary (compressed history)
--
-- This view maps the old user_insights structure to the new users table.
-- ============================================================================

-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('003', 'create_user_insights_compatibility', NOW())
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- CREATE VIEW: user_insights compatibility view
-- ============================================================================

CREATE OR REPLACE VIEW user_insights AS
SELECT
  -- Core fields (mapped from users table)
  u.id as id,  -- Add UUID id for UserProfileV2 validation
  u.id::text as user_id,
  u.created_at,  -- Add created_at for UserProfileV2 validation
  COALESCE(
    u.profile_static->'fitness_level',
    'beginner'
  )::fitness_level as fitness_level,
  COALESCE(
    u.profile_dynamic->'red_flags',
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
    u.history_summary->'training_strategy',
    u.profile_static->'training_strategy'
  ) as training_strategy,

  -- Legacy fields (for backward compatibility)
  u.metadata_json->>'tags' as tags_json,
  u.history_summary->'summary' as summary,
  u.protocol_version,
  u.version,
  u.metadata_json

FROM users u;

COMMENT ON VIEW user_insights IS 'Compatibility view for legacy user_insights table. Maps new three-state model to old structure.';

-- ============================================================================
-- CREATE FUNCTION: pgb_json_merge - Merge JSONB objects
-- ============================================================================

CREATE OR REPLACE FUNCTION pgb_json_merge(a JSONB, b JSONB)
RETURNS JSONB AS $$
BEGIN
  IF a IS NULL THEN
    RETURN b;
  END IF;
  IF b IS NULL THEN
    RETURN a;
  END IF;
  RETURN a || b;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- CREATE TRIGGER FUNCTIONS: Handle INSERT/UPDATE/DELETE on user_insights view
-- ============================================================================

-- Function to handle INSERT through the compatibility view
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

  -- Build profile_static from legacy fields
  profile_static := COALESCE(
    jsonb_build_object(
      'fitness_level', NEW.fitness_level,
      'basic_info', COALESCE(NEW.basic_info::jsonb, '{}'),
      'preferences', COALESCE(NEW.preferences::jsonb, '{}'),
      'physiological', COALESCE(NEW.physiological::jsonb, '{}'),
      'psychological', COALESCE(NEW.psychological::jsonb, '{}')
    ),
    '{}'
  );

  -- Build profile_dynamic
  profile_dynamic := COALESCE(
    jsonb_build_object(
      'red_flags', COALESCE(NEW.red_flags::jsonb, '[]'),
      'load_anchors', COALESCE(NEW.load_anchors::jsonb, '{}')
    ),
    '{}'
  );

  -- Build history_summary
  history_summary := COALESCE(
    jsonb_build_object(
      'training_strategy', NEW.training_strategy,
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

-- Function to handle UPDATE through the compatibility view
CREATE OR REPLACE FUNCTION user_insights_update_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the corresponding user record
  UPDATE users
  SET
    profile_static = jsonb_set(
      COALESCE(profile_static, '{}'),
      '{fitness_level}',
      to_jsonb(NEW.fitness_level)
    ),
    profile_dynamic = jsonb_set(
      COALESCE(profile_dynamic, '{}'),
      '{red_flags}',
      COALESCE(NEW.red_flags::jsonb, '[]'::jsonb)
    ),
    history_summary = jsonb_set(
      COALESCE(history_summary, '{}'),
      '{training_strategy}',
      to_jsonb(NEW.training_strategy)
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
-- CREATE TRIGGERS on view placeholder tables
-- ============================================================================
-- Note: PostgreSQL doesn't support triggers directly on views.
-- Instead, application code should be updated to use the new users table.
-- For the migration period, we'll create INSTEAD OF triggers if needed.

-- ============================================================================
-- CREATE INDEX: Support common queries
-- ============================================================================

-- Index on fitness_level (extracted from profile_static)
CREATE INDEX IF NOT EXISTS idx_users_fitness_level
ON users ((profile_static->>'fitness_level'));

-- Index on red_flags (extracted from profile_dynamic)
CREATE INDEX IF NOT EXISTS idx_users_red_flags
ON users USING gin((profile_dynamic->'red_flags'));

-- ============================================================================
-- MIGRATION DATA: Migrate existing user_insights to users table
-- ============================================================================

-- This function should be called after the migration to transfer data
CREATE OR REPLACE FUNCTION migrate_user_insights_to_users()
RETURNS INTEGER AS $$
DECLARE
  migrated_count INTEGER;
BEGIN
  -- Check if legacy user_insights table exists
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_insights_backup') THEN
    -- Migrate data from backup table
    INSERT INTO users (
      device_id,
      profile_static,
      profile_dynamic,
      history_summary,
      metadata_json,
      protocol_version,
      version
    )
    SELECT
      ui.user_id::text,
      jsonb_build_object(
        'fitness_level', ui.fitness_level,
        'basic_info', COALESCE(ui.basic_info::jsonb, '{}'),
        'preferences', COALESCE(ui.preferences::jsonb, '{}'),
        'physiological', COALESCE(ui.physiological::jsonb, '{}'),
        'psychological', COALESCE(ui.psychological::jsonb, '{}')
      ),
      jsonb_build_object(
        'red_flags', COALESCE(ui.red_flags::jsonb, '[]'),
        'load_anchors', COALESCE(ui.load_anchors::jsonb, '{}')
      ),
      jsonb_build_object(
        'training_strategy', ui.training_strategy,
        'summary', ui.summary
      ),
      jsonb_set(
        COALESCE(ui.metadata_json, '{}'),
        '{modified_by,tags}',
        jsonb_build_object(
          'modified_by', ui.modified_by,
          'tags', COALESCE(ui.tags_json::jsonb, '[]')
        )
      ),
      COALESCE(ui.protocol_version, '3.0.0'),
      COALESCE(ui.version, 1)
    FROM user_insights_backup ui
    ON CONFLICT (device_id) DO NOTHING;

    GET DIAGNOSTICS migrated_count = ROW_COUNT;
  ELSE
    migrated_count := 0;
  END IF;

  RETURN migrated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION migrate_user_insights_to_users IS 'Migrate data from legacy user_insights_backup table to new users table. Returns count of migrated users.';

-- ============================================================================
-- COMPLETE MIGRATION
-- ============================================================================

-- Run data migration if legacy table exists
SELECT migrate_user_insights_to_users() as migrated_users;
