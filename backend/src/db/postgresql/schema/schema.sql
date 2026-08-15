-- ============================================================================
-- Starfit PostgreSQL Schema - Core-Flex Architecture
-- ============================================================================
-- Version: 3.0.0
-- Created: 2026-02-09
-- Description: PostgreSQL schema with Core-Flex hybrid storage model
--
-- Architecture Principles:
-- - Core Layer: Relational columns (ID, FKs, indexes) for JOIN/WHERE
-- - Flex Layer: JSONB containers (profile_static, profile_dynamic, history_summary)
-- - Three-State Model: Static (rare), Dynamic (frequent), Summary (compressed)
-- - Timestamps: TIMESTAMPTZ with ISO 8601 format
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- ENUMS - Define reusable enums (idempotent using DO blocks)
-- ============================================================================

-- exercise_type_enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exercise_type_enum') THEN
    CREATE TYPE exercise_type_enum AS ENUM (
      'resistance',
      'unilateral',
      'bodyweight',
      'assisted',
      'isometric',
      'cardio',
      'flexibility',
      'heavy_weight',
      'rep_training',
      'outdoor'
    );
  END IF;
END $$;

-- difficulty_level
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'difficulty_level') THEN
    CREATE TYPE difficulty_level AS ENUM (
      'beginner',
      'intermediate',
      'advanced'
    );
  END IF;
END $$;

-- user_role
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'user',
      'admin'
    );
  END IF;
END $$;

-- modified_by_type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'modified_by_type') THEN
    CREATE TYPE modified_by_type AS ENUM (
      'admin',
      'system',
      'mas',
      'user'
    );
  END IF;
END $$;

-- session_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM (
      'draft',
      'in_progress',
      'completed',
      'cancelled'
    );
  END IF;
END $$;

-- video_task_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'video_task_status') THEN
    CREATE TYPE video_task_status AS ENUM (
      'pending',
      'processing',
      'completed',
      'failed'
    );
  END IF;
END $$;

-- import_batch_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_batch_status') THEN
    CREATE TYPE import_batch_status AS ENUM (
      'processing',
      'completed',
      'failed',
      'cancelled'
    );
  END IF;
END $$;

-- ============================================================================
-- USERS TABLE - Core-Flex with Three-State Model
-- ============================================================================

CREATE TABLE users (
  -- Core Layer: Relational columns
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id TEXT UNIQUE,
  display_name TEXT,
  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,
  role user_role DEFAULT 'user',
  permissions JSONB,

  -- Flex Layer: Three-State Model
  profile_static JSONB NOT NULL DEFAULT '{}',
    -- Long-term biological/psychological traits
    -- Structure: BasicInfoSchema + PhysiologicalSchema + PsychologicalSchema
    -- Update frequency: 6 months to 1 year

  profile_dynamic JSONB NOT NULL DEFAULT '{}',
    -- High-frequency state: load anchors, active limitations, recovery
    -- Structure: LoadAnchorsSchema + ActiveLimitations + RecoveryState
    -- Update frequency: After each training session

  history_summary JSONB NOT NULL DEFAULT '{}',
    -- Compressed history to reduce AI token usage
    -- Structure: LastPattern + Trends + RecentSummary + KeyMetrics
    -- Update frequency: Weekly or after significant events

  -- Legacy fields for migration compatibility
  metadata_json JSONB,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT display_name_format CHECK (display_name ~ '^.{1,50}$')
);

-- Users indexes
CREATE INDEX idx_users_device_id ON users(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- JSONB GIN indexes for profile queries
CREATE INDEX idx_users_profile_static ON users USING gin(profile_static);
CREATE INDEX idx_users_profile_dynamic ON users USING gin(profile_dynamic);
CREATE INDEX idx_users_history_summary ON users USING gin(history_summary);

-- Specific path indexes for common queries
CREATE INDEX idx_users_load_anchors ON users USING gin((profile_dynamic->'load_anchors'));
CREATE INDEX idx_users_active_limitations ON users USING gin((profile_dynamic->'active_limitations'));

-- ============================================================================
-- EXERCISES TABLE
-- ============================================================================

CREATE TABLE exercises (
  -- Core Layer: Relational columns
  id TEXT PRIMARY KEY CHECK (length(id) >= 12 AND length(id) <= 24),
  name TEXT NOT NULL UNIQUE,
  exercise_type exercise_type_enum DEFAULT 'resistance',
  difficulty difficulty_level DEFAULT 'beginner',

  -- Flex Layer: Exercise attributes
  attributes JSONB NOT NULL DEFAULT '{}',
    -- Structure: {
    --   targets: { primary: string[], secondary: string[] },
    --   equipment_required: string[],
    --   impact_level: { shoulder: number, knee: number, back: number, ... },
    --   pattern: 'push' | 'pull' | 'squat' | 'hinge' | 'lunge' | 'rotation' | ...,
    --   movement_plane: 'sagittal' | 'frontal' | 'transverse',
    --   stabilizers: string[],
    --   tags: string[]
    -- }

  -- Content and assets
  content_html TEXT,
  tutorials JSONB NOT NULL DEFAULT '{}',
    -- Structure: { cover?: string, video?: string[], images?: string[] }

  -- Legacy fields for migration
  tags_json JSONB,
  assets_json JSONB,

  -- Audit
  modified_by modified_by_type DEFAULT 'system',
  modified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exercises indexes
CREATE INDEX idx_exercises_type ON exercises(exercise_type);
CREATE INDEX idx_exercises_difficulty ON exercises(difficulty);
CREATE INDEX idx_exercises_updated_at ON exercises(updated_at DESC);

-- JSONB GIN indexes
CREATE INDEX idx_exercises_attributes ON exercises USING gin(attributes);
CREATE INDEX idx_exercises_targets ON exercises USING gin((attributes->'targets'));
CREATE INDEX idx_exercises_impact_level ON exercises USING gin((attributes->'impact_level'));
CREATE INDEX idx_exercises_equipment ON exercises USING gin((attributes->'equipment_required'));
CREATE INDEX idx_exercises_pattern ON exercises USING gin((attributes->'pattern'));

-- Full-text search on name
CREATE INDEX idx_exercises_name_fts ON exercises USING gin(to_tsvector('english', name));

-- ============================================================================
-- SESSIONS TABLE - Training Sessions
-- ============================================================================

CREATE TABLE sessions (
  -- Core Layer: Relational columns
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  -- Session timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration INTEGER, -- seconds

  title TEXT,

  -- Flex Layer: Session data
  raw_json JSONB NOT NULL DEFAULT '{}',
    -- Full session context for AI processing
    -- Structure: WorkoutSessionSchema (from shared/contracts)

  metadata_json JSONB,
  ai_audit_text TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions indexes
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_start_time ON sessions(start_time DESC);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_user_start_time ON sessions(user_id, start_time DESC);

-- JSONB indexes
CREATE INDEX idx_sessions_raw_json ON sessions USING gin(raw_json);

-- ============================================================================
-- RPE LOGS TABLE - Training Analytics
-- ============================================================================

CREATE TABLE rpe_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  exercise_name TEXT NOT NULL,
  rpe NUMERIC(3, 1) NOT NULL CHECK (rpe >= 0 AND rpe <= 10),
  weight NUMERIC(10, 2),
  reps INTEGER,

  metadata_json JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RPE logs indexes
CREATE INDEX idx_rpe_user_exercise ON rpe_logs(user_id, exercise_name);
CREATE INDEX idx_rpe_session_id ON rpe_logs(session_id);
CREATE INDEX idx_rpe_timestamp ON rpe_logs(timestamp DESC);
CREATE INDEX idx_rpe_user_timestamp ON rpe_logs(user_id, timestamp DESC);

-- ============================================================================
-- GUIDANCE TABLE - Strategy Documents
-- ============================================================================

CREATE TABLE guidance (
  user_id TEXT NOT NULL DEFAULT 'global',
  key TEXT NOT NULL,
  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  title TEXT,
  content_md TEXT,
  meta_json JSONB,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, key)
);

-- Guidance indexes
CREATE INDEX idx_guidance_user_id ON guidance(user_id);
CREATE INDEX idx_guidance_updated_at ON guidance(updated_at DESC);

-- ============================================================================
-- APP CONFIGS TABLE - Application Configuration
-- ============================================================================

CREATE TABLE app_configs (
  user_id TEXT NOT NULL DEFAULT 'global',
  key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  metadata_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, key)
);

-- App configs indexes
CREATE INDEX idx_app_configs_user_id ON app_configs(user_id);
CREATE INDEX idx_app_configs_updated_at ON app_configs(updated_at DESC);

-- ============================================================================
-- PROMPT STYLE CONFIGS TABLE - AI System Prompts
-- ============================================================================

CREATE TABLE prompt_style_configs (
  user_id TEXT NOT NULL DEFAULT 'global',
  style_key TEXT NOT NULL,
  parameters_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  metadata_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, style_key)
);

-- Prompt style configs indexes
CREATE INDEX idx_prompt_style_user_id ON prompt_style_configs(user_id);
CREATE INDEX idx_prompt_style_is_active ON prompt_style_configs(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- USER MEDIA TABLE - Media File Management
-- ============================================================================

CREATE TABLE user_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,

  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User media indexes
CREATE INDEX idx_user_media_user_id ON user_media(user_id);
CREATE INDEX idx_user_media_hash ON user_media(hash);
CREATE INDEX idx_user_media_created_at ON user_media(created_at DESC);

-- ============================================================================
-- DEVIATION LOGS TABLE - AI Feedback Loop
-- ============================================================================

CREATE TABLE deviation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,

  field TEXT NOT NULL,
  original_value TEXT,
  current_value TEXT,

  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB,
  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1
);

-- Deviation logs indexes
CREATE INDEX idx_deviation_user_id ON deviation_logs(user_id);
CREATE INDEX idx_deviation_exercise_id ON deviation_logs(exercise_id);
CREATE INDEX idx_deviation_timestamp ON deviation_logs(timestamp DESC);

-- ============================================================================
-- CACHE: HISTORY SUMMARIES TABLE
-- ============================================================================

CREATE TABLE cache_history_summaries (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_session_id UUID,
  summary_text TEXT,

  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  metadata_json JSONB,
  updated_at TIMESTAMPTZ
);

-- Cache history summaries indexes
CREATE INDEX idx_cache_history_user_id ON cache_history_summaries(user_id);

-- ============================================================================
-- CACHE: RPE STATS TABLE
-- ============================================================================

CREATE TABLE cache_rpe_stats (
  user_id UUID NOT NULL,
  exercise_name TEXT NOT NULL,
  stats_json JSONB NOT NULL,

  protocol_version TEXT DEFAULT '3.0.0',
  version INTEGER DEFAULT 1,

  metadata_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, exercise_name)
);

-- Cache RPE stats indexes
CREATE INDEX idx_cache_rpe_user_id ON cache_rpe_stats(user_id);
CREATE INDEX idx_cache_rpe_updated_at ON cache_rpe_stats(updated_at DESC);

-- ============================================================================
-- AUDIT LOGS TABLE - Lightweight Audit Trail
-- ============================================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  modified_by modified_by_type NOT NULL,
  field_name TEXT NOT NULL,

  old_value JSONB,
  new_value JSONB,

  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit logs indexes
CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_field_name ON audit_logs(field_name);
CREATE INDEX idx_audit_modified_by ON audit_logs(modified_by);

-- ============================================================================
-- VIDEO TASKS TABLE - Background Processing Queue
-- ============================================================================

CREATE TABLE video_tasks (
  id TEXT PRIMARY KEY,
  exercise_name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  original_path TEXT NOT NULL,

  status video_task_status DEFAULT 'pending',
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_stage TEXT,
  error_message TEXT,

  sources_json JSONB,
  poster_url TEXT,
  metadata_json JSONB,

  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER DEFAULT 0
);

-- Video tasks indexes
CREATE INDEX idx_video_tasks_status ON video_tasks(status);
CREATE INDEX idx_video_tasks_exercise_name ON video_tasks(exercise_name);
CREATE INDEX idx_video_tasks_created_at ON video_tasks(created_at DESC);

-- ============================================================================
-- IMPORT BATCHES TABLE - Import Job Tracking
-- ============================================================================

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  status import_batch_status DEFAULT 'processing',
  total_exercises INTEGER DEFAULT 0,
  processed_exercises INTEGER DEFAULT 0,

  video_task_ids JSONB,
  errors_json JSONB,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Import batches indexes
CREATE INDEX idx_import_batches_user_id ON import_batches(user_id);
CREATE INDEX idx_import_batches_status ON import_batches(status);
CREATE INDEX idx_import_batches_started_at ON import_batches(started_at DESC);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exercises_updated_at BEFORE UPDATE ON exercises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guidance_updated_at BEFORE UPDATE ON guidance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_configs_updated_at BEFORE UPDATE ON app_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prompt_style_configs_updated_at BEFORE UPDATE ON prompt_style_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS - Common Query Patterns
-- ============================================================================

-- User current state view (combines three-state model)
CREATE MATERIALIZED VIEW user_current_state AS
SELECT
  u.id,
  u.profile_static,
  u.profile_dynamic->'load_anchors' as load_anchors,
  u.profile_dynamic->'active_limitations' as active_limitations,
  u.profile_dynamic->'recovery_state' as recovery_state,
  u.history_summary,
  u.updated_at
FROM users u;

CREATE INDEX ON user_current_state (id);

-- Exercise summary view for quick lookups
CREATE MATERIALIZED VIEW exercise_summary AS
SELECT
  e.id,
  e.name,
  e.exercise_type,
  e.difficulty,
  e.attributes->'targets' as targets,
  e.attributes->'equipment_required' as equipment_required,
  e.attributes->'pattern' as pattern,
  e.updated_at
FROM exercises e;

CREATE INDEX ON exercise_summary (id);
CREATE INDEX ON exercise_summary (exercise_type);
CREATE INDEX ON exercise_summary (name);

-- Refresh materialized views function (run periodically)
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_current_state;
  REFRESH MATERIALIZED VIEW CONCURRENTLY exercise_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- user_insights VIEW - Admin Panel Interface
-- ============================================================================
-- This VIEW provides a flattened interface for the admin panel
-- Data is sourced directly from users table's JSONB fields (Core-Flex architecture)
-- DO NOT create a separate user_insights table - this VIEW is the interface layer

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
  -- Use -> to return JSONB objects instead of ->> which returns TEXT
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

-- Index on the VIEW's underlying table is already covered by users table indexes

-- ============================================================================
-- COMMENTS - Documentation
-- ============================================================================

COMMENT ON TABLE users IS 'User accounts with three-state model: profile_static, profile_dynamic, history_summary';
COMMENT ON COLUMN users.profile_static IS 'Long-term biological/psychological traits, updated 6mo-1yr';
COMMENT ON COLUMN users.profile_dynamic IS 'High-frequency state: load anchors, limitations, recovery, updated per session';
COMMENT ON COLUMN users.history_summary IS 'Compressed history for AI token optimization, updated weekly';

COMMENT ON TABLE exercises IS 'Exercise library (loaded in full by the agent via list_exercises; no vector search)';
COMMENT ON COLUMN exercises.attributes IS 'Flexible JSONB for exercise attributes, tags, equipment, impact levels';

COMMENT ON TABLE sessions IS 'Training sessions with full context storage for AI processing';
COMMENT ON TABLE rpe_logs IS 'Individual set logs for analytics and progression tracking';

COMMENT ON TABLE audit_logs IS 'Lightweight audit trail for all data modifications';
