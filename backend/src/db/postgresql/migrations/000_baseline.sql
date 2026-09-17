-- ============================================================================
-- 000_baseline.sql — Starfit 数据库结构基线（2026-09-17 压缩版）
-- ============================================================================
-- 由 000..012 全部历史迁移压缩而成（源库 schema-only 导出，结构=活库实况）。
-- 历史脚本已归档删除；今后 schema 变更从 001 起以增量迁移追加。
-- 幂等性：依赖全新空库执行（与项目迁移策略一致）；migration_metadata 由 runner 记录。
-- ============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: agent_runtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA agent_runtime;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: difficulty_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.difficulty_level AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);


--
-- Name: exercise_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.exercise_type_enum AS ENUM (
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


--
-- Name: fitness_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fitness_level AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);


--
-- Name: import_batch_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.import_batch_status AS ENUM (
    'processing',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: modified_by_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.modified_by_type AS ENUM (
    'admin',
    'system',
    'mas',
    'user'
);


--
-- Name: session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_status AS ENUM (
    'draft',
    'in_progress',
    'completed',
    'cancelled'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'user',
    'admin'
);


--
-- Name: video_task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.video_task_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


--
-- Name: pgb_json_merge(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pgb_json_merge(a jsonb, b jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF a IS NULL THEN
    RETURN b;
  END IF;
  IF b IS NULL THEN
    RETURN a;
  END IF;
  RETURN a || b;
END;
$$;


--
-- Name: refresh_materialized_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_materialized_views() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_current_state;
  REFRESH MATERIALIZED VIEW CONCURRENTLY exercise_summary;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: user_insights_insert_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_insights_insert_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;


--
-- Name: user_insights_update_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_insights_update_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: checkpoint_blobs; Type: TABLE; Schema: agent_runtime; Owner: -
--

CREATE TABLE agent_runtime.checkpoint_blobs (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    channel text NOT NULL,
    version text NOT NULL,
    type text NOT NULL,
    blob bytea
);


--
-- Name: checkpoint_migrations; Type: TABLE; Schema: agent_runtime; Owner: -
--

CREATE TABLE agent_runtime.checkpoint_migrations (
    v integer NOT NULL
);


--
-- Name: checkpoint_writes; Type: TABLE; Schema: agent_runtime; Owner: -
--

CREATE TABLE agent_runtime.checkpoint_writes (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    task_id text NOT NULL,
    idx integer NOT NULL,
    channel text NOT NULL,
    type text,
    blob bytea NOT NULL
);


--
-- Name: checkpoints; Type: TABLE; Schema: agent_runtime; Owner: -
--

CREATE TABLE agent_runtime.checkpoints (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    parent_checkpoint_id text,
    type text,
    checkpoint jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: app_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_configs (
    user_id text DEFAULT 'global'::text NOT NULL,
    key text NOT NULL,
    value_json jsonb NOT NULL,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    metadata_json jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    modified_by public.modified_by_type NOT NULL,
    field_name text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    change_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS 'Lightweight audit trail for all data modifications';


--
-- Name: cache_history_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache_history_summaries (
    user_id uuid NOT NULL,
    last_session_id uuid,
    summary_text text,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    metadata_json jsonb,
    updated_at timestamp with time zone
);


--
-- Name: cache_rpe_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache_rpe_stats (
    user_id uuid NOT NULL,
    exercise_name text NOT NULL,
    stats_json jsonb NOT NULL,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    metadata_json jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deviation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deviation_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    exercise_id text NOT NULL,
    field text NOT NULL,
    original_value text,
    current_value text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1
);


--
-- Name: exercises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exercises (
    id text NOT NULL,
    name text NOT NULL,
    exercise_type public.exercise_type_enum DEFAULT 'resistance'::public.exercise_type_enum,
    difficulty public.difficulty_level DEFAULT 'beginner'::public.difficulty_level,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_html text,
    tutorials jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags_json jsonb,
    assets_json jsonb,
    modified_by public.modified_by_type DEFAULT 'system'::public.modified_by_type,
    modified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exercises_id_check CHECK (((length(id) >= 12) AND (length(id) <= 24)))
);


--
-- Name: TABLE exercises; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.exercises IS 'Exercise library (loaded in full by the agent via the list_exercises MCP tool)';


--
-- Name: COLUMN exercises.attributes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.exercises.attributes IS 'Flexible JSONB for exercise attributes, tags, equipment, impact levels';


--
-- Name: exercise_summary; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.exercise_summary AS
 SELECT id,
    name,
    exercise_type,
    difficulty,
    (attributes -> 'targets'::text) AS targets,
    (attributes -> 'equipment_required'::text) AS equipment_required,
    (attributes -> 'pattern'::text) AS pattern,
    updated_at
   FROM public.exercises e
  WITH NO DATA;


--
-- Name: guidance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guidance (
    user_id text DEFAULT 'global'::text NOT NULL,
    key text NOT NULL,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    title text,
    content_md text,
    meta_json jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: heart_rate_samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heart_rate_samples (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    exercise_index integer,
    set_index integer,
    bpm smallint NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    source text DEFAULT 'watch'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT heart_rate_samples_bpm_check CHECK (((bpm > 0) AND (bpm <= 250))),
    CONSTRAINT heart_rate_samples_source_check CHECK ((source = ANY (ARRAY['watch'::text, 'manual'::text])))
);


--
-- Name: TABLE heart_rate_samples; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.heart_rate_samples IS 'Analysis-grade HR samples (5s downsampled avg). Source of truth is HealthKit. ADR-0001.';


--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    id text NOT NULL,
    user_id uuid NOT NULL,
    status public.import_batch_status DEFAULT 'processing'::public.import_batch_status,
    total_exercises integer DEFAULT 0,
    processed_exercises integer DEFAULT 0,
    video_task_ids jsonb,
    errors_json jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone
);


--
-- (migration_metadata 由 MigrationRunner.ensureMetadataTable 幂等创建，此处不建)


--
-- Name: TABLE migration_metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.migration_metadata IS 'Track applied database migrations';


--
-- Name: prompt_style_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_style_configs (
    user_id text DEFAULT 'global'::text NOT NULL,
    style_key text NOT NULL,
    parameters_json jsonb NOT NULL,
    is_active boolean DEFAULT true,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    metadata_json jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rpe_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rpe_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    exercise_name text NOT NULL,
    rpe numeric(3,1) NOT NULL,
    weight numeric(10,2),
    reps integer,
    metadata_json jsonb,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rpe_logs_rpe_check CHECK (((rpe >= (0)::numeric) AND (rpe <= (10)::numeric)))
);


--
-- Name: TABLE rpe_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rpe_logs IS 'Individual set logs for analytics and progression tracking';


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    duration integer,
    title text,
    raw_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata_json jsonb,
    ai_audit_text text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sessions IS 'Training sessions with full context storage for AI processing';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    device_id text,
    display_name text,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    role public.user_role DEFAULT 'user'::public.user_role,
    permissions jsonb,
    profile_static jsonb DEFAULT '{}'::jsonb NOT NULL,
    profile_dynamic jsonb DEFAULT '{}'::jsonb NOT NULL,
    history_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT display_name_format CHECK ((display_name ~ '^.{1,50}$'::text))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'User accounts with three-state model: profile_static, profile_dynamic, history_summary';


--
-- Name: COLUMN users.profile_static; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.profile_static IS 'Long-term biological/psychological traits, updated 6mo-1yr';


--
-- Name: COLUMN users.profile_dynamic; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.profile_dynamic IS 'High-frequency state: load anchors, limitations, recovery, updated per session';


--
-- Name: COLUMN users.history_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.history_summary IS 'Compressed history for AI token optimization, updated weekly';


--
-- Name: user_current_state; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.user_current_state AS
 SELECT id,
    profile_static,
    (profile_dynamic -> 'load_anchors'::text) AS load_anchors,
    (profile_dynamic -> 'active_limitations'::text) AS active_limitations,
    (profile_dynamic -> 'recovery_state'::text) AS recovery_state,
    history_summary,
    updated_at
   FROM public.users u
  WITH NO DATA;


--
-- Name: user_insights; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_insights AS
 SELECT id AS user_id,
    id,
    device_id,
    display_name,
    created_at,
    updated_at,
    updated_at AS modified_at,
    COALESCE((profile_static -> 'basic_info'::text), NULL::jsonb) AS basic_info,
    COALESCE((profile_static -> 'preferences'::text), NULL::jsonb) AS preferences,
    COALESCE((profile_static -> 'physiological'::text), NULL::jsonb) AS physiological,
    COALESCE((profile_static -> 'psychological'::text), NULL::jsonb) AS psychological,
    COALESCE((profile_dynamic -> 'load_anchors'::text), NULL::jsonb) AS load_anchors,
    COALESCE((profile_dynamic -> 'active_limitations'::text), '[]'::jsonb) AS active_limitations,
    COALESCE((profile_dynamic -> 'recovery_state'::text), NULL::jsonb) AS recovery_state,
    COALESCE((history_summary -> 'recent_summary'::text), NULL::jsonb) AS summary,
    'system'::text AS modified_by,
    protocol_version,
    version
   FROM public.users u;


--
-- Name: VIEW user_insights; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.user_insights IS 'Compatibility view for legacy user_insights table. Maps new three-state model to old structure. Dead fields (fitness_level/red_flags/training_strategy) retired in 011.';


--
-- Name: user_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_media (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    hash text NOT NULL,
    mime text NOT NULL,
    size bigint NOT NULL,
    protocol_version text DEFAULT '3.0.0'::text,
    version integer DEFAULT 1,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: video_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_tasks (
    id text NOT NULL,
    exercise_name text NOT NULL,
    original_filename text NOT NULL,
    original_path text NOT NULL,
    status public.video_task_status DEFAULT 'pending'::public.video_task_status,
    progress integer DEFAULT 0,
    current_stage text,
    error_message text,
    sources_json jsonb,
    poster_url text,
    metadata_json jsonb,
    file_size bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    retry_count integer DEFAULT 0,
    CONSTRAINT video_tasks_progress_check CHECK (((progress >= 0) AND (progress <= 100)))
);


--
-- Name: checkpoint_blobs checkpoint_blobs_pkey; Type: CONSTRAINT; Schema: agent_runtime; Owner: -
--

ALTER TABLE ONLY agent_runtime.checkpoint_blobs
    ADD CONSTRAINT checkpoint_blobs_pkey PRIMARY KEY (thread_id, checkpoint_ns, channel, version);


--
-- Name: checkpoint_migrations checkpoint_migrations_pkey; Type: CONSTRAINT; Schema: agent_runtime; Owner: -
--

ALTER TABLE ONLY agent_runtime.checkpoint_migrations
    ADD CONSTRAINT checkpoint_migrations_pkey PRIMARY KEY (v);


--
-- Name: checkpoint_writes checkpoint_writes_pkey; Type: CONSTRAINT; Schema: agent_runtime; Owner: -
--

ALTER TABLE ONLY agent_runtime.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx);


--
-- Name: checkpoints checkpoints_pkey; Type: CONSTRAINT; Schema: agent_runtime; Owner: -
--

ALTER TABLE ONLY agent_runtime.checkpoints
    ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id);


--
-- Name: app_configs app_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_configs
    ADD CONSTRAINT app_configs_pkey PRIMARY KEY (user_id, key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: cache_history_summaries cache_history_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_history_summaries
    ADD CONSTRAINT cache_history_summaries_pkey PRIMARY KEY (user_id);


--
-- Name: cache_rpe_stats cache_rpe_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_rpe_stats
    ADD CONSTRAINT cache_rpe_stats_pkey PRIMARY KEY (user_id, exercise_name);


--
-- Name: deviation_logs deviation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deviation_logs
    ADD CONSTRAINT deviation_logs_pkey PRIMARY KEY (id);


--
-- Name: exercises exercises_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT exercises_name_key UNIQUE (name);


--
-- Name: exercises exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT exercises_pkey PRIMARY KEY (id);


--
-- Name: guidance guidance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guidance
    ADD CONSTRAINT guidance_pkey PRIMARY KEY (user_id, key);


--
-- Name: heart_rate_samples heart_rate_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heart_rate_samples
    ADD CONSTRAINT heart_rate_samples_pkey PRIMARY KEY (id);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);




--
-- Name: prompt_style_configs prompt_style_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_style_configs
    ADD CONSTRAINT prompt_style_configs_pkey PRIMARY KEY (user_id, style_key);


--
-- Name: rpe_logs rpe_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpe_logs
    ADD CONSTRAINT rpe_logs_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: user_media user_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_media
    ADD CONSTRAINT user_media_pkey PRIMARY KEY (id);


--
-- Name: users users_device_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_device_id_key UNIQUE (device_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: video_tasks video_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_tasks
    ADD CONSTRAINT video_tasks_pkey PRIMARY KEY (id);


--
-- Name: idx_app_configs_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_configs_updated_at ON public.app_configs USING btree (updated_at DESC);


--
-- Name: idx_app_configs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_configs_user_id ON public.app_configs USING btree (user_id);


--
-- Name: idx_audit_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_field_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_field_name ON public.audit_logs USING btree (field_name);


--
-- Name: idx_audit_modified_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_modified_by ON public.audit_logs USING btree (modified_by);


--
-- Name: idx_audit_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_cache_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_history_user_id ON public.cache_history_summaries USING btree (user_id);


--
-- Name: idx_cache_rpe_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_rpe_updated_at ON public.cache_rpe_stats USING btree (updated_at DESC);


--
-- Name: idx_cache_rpe_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_rpe_user_id ON public.cache_rpe_stats USING btree (user_id);


--
-- Name: idx_deviation_exercise_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deviation_exercise_id ON public.deviation_logs USING btree (exercise_id);


--
-- Name: idx_deviation_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deviation_timestamp ON public.deviation_logs USING btree ("timestamp" DESC);


--
-- Name: idx_deviation_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deviation_user_id ON public.deviation_logs USING btree (user_id);


--
-- Name: idx_exercises_attributes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_attributes ON public.exercises USING gin (attributes);


--
-- Name: idx_exercises_difficulty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_difficulty ON public.exercises USING btree (difficulty);


--
-- Name: idx_exercises_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_equipment ON public.exercises USING gin (((attributes -> 'equipment_required'::text)));


--
-- Name: idx_exercises_impact_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_impact_level ON public.exercises USING gin (((attributes -> 'impact_level'::text)));


--
-- Name: idx_exercises_name_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_name_fts ON public.exercises USING gin (to_tsvector('english'::regconfig, name));


--
-- Name: idx_exercises_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_pattern ON public.exercises USING gin (((attributes -> 'pattern'::text)));


--
-- Name: idx_exercises_targets; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_targets ON public.exercises USING gin (((attributes -> 'targets'::text)));


--
-- Name: idx_exercises_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_type ON public.exercises USING btree (exercise_type);


--
-- Name: idx_exercises_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_updated_at ON public.exercises USING btree (updated_at DESC);


--
-- Name: idx_guidance_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guidance_updated_at ON public.guidance USING btree (updated_at DESC);


--
-- Name: idx_guidance_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guidance_user_id ON public.guidance USING btree (user_id);


--
-- Name: idx_hr_samples_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_hr_samples_dedup ON public.heart_rate_samples USING btree (session_id, recorded_at, bpm);


--
-- Name: idx_hr_samples_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_samples_session ON public.heart_rate_samples USING btree (session_id);


--
-- Name: idx_hr_samples_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_samples_set ON public.heart_rate_samples USING btree (session_id, exercise_index, set_index);


--
-- Name: idx_hr_samples_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_samples_user_time ON public.heart_rate_samples USING btree (user_id, recorded_at DESC);


--
-- Name: idx_import_batches_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_started_at ON public.import_batches USING btree (started_at DESC);


--
-- Name: idx_import_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_status ON public.import_batches USING btree (status);


--
-- Name: idx_import_batches_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_user_id ON public.import_batches USING btree (user_id);


--
-- Name: idx_mview_exercise_summary_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mview_exercise_summary_id ON public.exercise_summary USING btree (id);


--
-- Name: idx_mview_exercise_summary_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mview_exercise_summary_name ON public.exercise_summary USING btree (name);


--
-- Name: idx_mview_exercise_summary_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mview_exercise_summary_type ON public.exercise_summary USING btree (exercise_type);


--
-- Name: idx_mview_user_current_state_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mview_user_current_state_id ON public.user_current_state USING btree (id);


--
-- Name: idx_prompt_style_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompt_style_is_active ON public.prompt_style_configs USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_prompt_style_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prompt_style_user_id ON public.prompt_style_configs USING btree (user_id);


--
-- Name: idx_rpe_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rpe_session_id ON public.rpe_logs USING btree (session_id);


--
-- Name: idx_rpe_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rpe_timestamp ON public.rpe_logs USING btree ("timestamp" DESC);


--
-- Name: idx_rpe_user_exercise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rpe_user_exercise ON public.rpe_logs USING btree (user_id, exercise_name);


--
-- Name: idx_rpe_user_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rpe_user_timestamp ON public.rpe_logs USING btree (user_id, "timestamp" DESC);


--
-- Name: idx_sessions_raw_json; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_raw_json ON public.sessions USING gin (raw_json);


--
-- Name: idx_sessions_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_start_time ON public.sessions USING btree (start_time DESC);


--
-- Name: idx_sessions_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_updated_at ON public.sessions USING btree (updated_at DESC);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: idx_sessions_user_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_start_time ON public.sessions USING btree (user_id, start_time DESC);


--
-- Name: idx_user_media_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_media_created_at ON public.user_media USING btree (created_at DESC);


--
-- Name: idx_user_media_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_media_hash ON public.user_media USING btree (hash);


--
-- Name: idx_user_media_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_media_user_id ON public.user_media USING btree (user_id);


--
-- Name: idx_users_active_limitations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active_limitations ON public.users USING gin (((profile_dynamic -> 'active_limitations'::text)));


--
-- Name: idx_users_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_created_at ON public.users USING btree (created_at DESC);


--
-- Name: idx_users_device_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_device_id ON public.users USING btree (device_id) WHERE (device_id IS NOT NULL);


--
-- Name: idx_users_history_summary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_history_summary ON public.users USING gin (history_summary);


--
-- Name: idx_users_load_anchors; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_load_anchors ON public.users USING gin (((profile_dynamic -> 'load_anchors'::text)));


--
-- Name: idx_users_profile_dynamic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_profile_dynamic ON public.users USING gin (profile_dynamic);


--
-- Name: idx_users_profile_static; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_profile_static ON public.users USING gin (profile_static);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_video_tasks_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_tasks_created_at ON public.video_tasks USING btree (created_at DESC);


--
-- Name: idx_video_tasks_exercise_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_tasks_exercise_name ON public.video_tasks USING btree (exercise_name);


--
-- Name: idx_video_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_tasks_status ON public.video_tasks USING btree (status);


--
-- Name: app_configs update_app_configs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_app_configs_updated_at BEFORE UPDATE ON public.app_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: exercises update_exercises_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_exercises_updated_at BEFORE UPDATE ON public.exercises FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: guidance update_guidance_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_guidance_updated_at BEFORE UPDATE ON public.guidance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: prompt_style_configs update_prompt_style_configs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_prompt_style_configs_updated_at BEFORE UPDATE ON public.prompt_style_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sessions update_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cache_history_summaries cache_history_summaries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_history_summaries
    ADD CONSTRAINT cache_history_summaries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: deviation_logs deviation_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deviation_logs
    ADD CONSTRAINT deviation_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: heart_rate_samples heart_rate_samples_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heart_rate_samples
    ADD CONSTRAINT heart_rate_samples_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: heart_rate_samples heart_rate_samples_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heart_rate_samples
    ADD CONSTRAINT heart_rate_samples_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: import_batches import_batches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: rpe_logs rpe_logs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpe_logs
    ADD CONSTRAINT rpe_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: rpe_logs rpe_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpe_logs
    ADD CONSTRAINT rpe_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_media user_media_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_media
    ADD CONSTRAINT user_media_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--




-- ============================================================================
-- 自记录迁移元数据（MigrationRunner 依赖此表判重；每个迁移文件负责记录自己）
-- ============================================================================
INSERT INTO public.migration_metadata (version, name, applied_at)
VALUES ('000', 'baseline', NOW())
ON CONFLICT (version) DO NOTHING;
