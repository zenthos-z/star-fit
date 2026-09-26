-- ============================================================================
-- 001_weekly_plans.sql — 周计划持久化实体（issue #10）
-- ============================================================================
-- 架构拍板（AI 隐形体验架构 2026-09-24）：计划从「每次生成」变为持久化实体，
-- 默认复用、调整例外。本迁移落两张表：
--   weekly_plans  周计划：周标识 + 用户 + 分化(split) + 状态
--   plan_entries  每日条目：日期 + exercise_id + 目标组数 + 目标负荷区间 + 状态机
--
-- 契约真源：shared/contracts/weekly-plan.ts（Zod 与本 DDL 一一对应）
-- 幂等性：依赖全新空库按序执行（与 000_baseline 策略一致），metadata 自记录。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 枚举类型
-- ----------------------------------------------------------------------------

-- 分化：对齐 skills/program-progression/knowledge/split-selection.md
CREATE TYPE public.weekly_plan_split AS ENUM (
    'full_body',
    'upper_lower',
    'push_pull_legs',
    'hybrid',
    'custom'
);

-- 周计划状态：active 本周生效 / archived 归档留史
CREATE TYPE public.weekly_plan_status AS ENUM (
    'active',
    'archived'
);

-- 条目状态机：planned → adjusted → completed / skipped（completed/skipped 终态）
CREATE TYPE public.plan_entry_status AS ENUM (
    'planned',
    'adjusted',
    'completed',
    'skipped'
);

-- 负荷表达：RPE 区间 / %1RM 区间
CREATE TYPE public.plan_load_type AS ENUM (
    'rpe',
    'percent_1rm'
);

-- ----------------------------------------------------------------------------
-- 表：weekly_plans
-- ----------------------------------------------------------------------------

CREATE TABLE public.weekly_plans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    week_id text NOT NULL,
    split public.weekly_plan_split NOT NULL,
    status public.weekly_plan_status DEFAULT 'active'::public.weekly_plan_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weekly_plans_pkey PRIMARY KEY (id),
    -- 每周每用户一份计划（issue #10 核心唯一约束）
    CONSTRAINT weekly_plans_user_week_unique UNIQUE (user_id, week_id),
    -- ISO 周格式 YYYY-Www（周号 01-53），与契约 WEEK_ID_PATTERN 一致
    CONSTRAINT weekly_plans_week_id_format CHECK (week_id ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'::text)
);

COMMENT ON TABLE public.weekly_plans IS 'Weekly training plans (persisted entities, reuse-by-default per AI-invisible-experience architecture 2026-09-24)';

COMMENT ON COLUMN public.weekly_plans.week_id IS 'ISO-8601 week identifier YYYY-Www (e.g. 2026-W40); unique per user';

COMMENT ON COLUMN public.weekly_plans.split IS 'Training split: full_body / upper_lower / push_pull_legs / hybrid / custom';

-- ----------------------------------------------------------------------------
-- 表：plan_entries
-- ----------------------------------------------------------------------------

CREATE TABLE public.plan_entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    weekly_plan_id uuid NOT NULL,
    user_id uuid NOT NULL,
    entry_date date NOT NULL,
    exercise_id text NOT NULL,
    target_sets integer NOT NULL,
    target_load_type public.plan_load_type NOT NULL,
    target_load_min numeric(5,2) NOT NULL,
    target_load_max numeric(5,2) NOT NULL,
    status public.plan_entry_status DEFAULT 'planned'::public.plan_entry_status NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plan_entries_pkey PRIMARY KEY (id),
    -- 目标组数为正整数（契约 target_sets: int().positive()）
    CONSTRAINT plan_entries_target_sets_check CHECK ((target_sets > 0)),
    -- 区间有序：min ≤ max（契约 TargetLoadSchema superRefine）
    CONSTRAINT plan_entries_load_order_check CHECK ((target_load_min <= target_load_max)),
    -- 负荷边界随类型切换（契约 superRefine）：
    --   rpe: [0, 10]；percent_1rm: (0, 100]
    CONSTRAINT plan_entries_load_bounds_check CHECK ((
        (target_load_type = 'rpe'::public.plan_load_type)
        AND (target_load_min >= (0)::numeric) AND (target_load_max <= (10)::numeric)
    ) OR (
        (target_load_type = 'percent_1rm'::public.plan_load_type)
        AND (target_load_min > (0)::numeric) AND (target_load_max <= (100)::numeric)
    ))
);

COMMENT ON TABLE public.plan_entries IS 'Daily plan entries: one row per planned exercise per day, with target load range and entry state machine';

COMMENT ON COLUMN public.plan_entries.entry_date IS 'Calendar day YYYY-MM-DD (timezone-free) the entry belongs to';

COMMENT ON COLUMN public.plan_entries.exercise_id IS 'NanoID (12-24 chars) referencing exercises.id';

COMMENT ON COLUMN public.plan_entries.target_load_min IS 'Load range lower bound: RPE 0-10 when type=rpe, %1RM (0,100] when type=percent_1rm';

COMMENT ON COLUMN public.plan_entries.user_id IS 'Denormalized owner column for user-scoped queries (heart_rate_samples precedent)';

-- ----------------------------------------------------------------------------
-- 索引
-- ----------------------------------------------------------------------------

-- (user_id, week_id) 唯一索引由 weekly_plans_user_week_unique 约束隐式创建。

-- 按计划取整周条目（主读取路径：GET 周计划 → 条目按日期+序号排序）
CREATE INDEX idx_plan_entries_weekly_plan ON public.plan_entries USING btree (weekly_plan_id, entry_date, sort_order);

-- 跨计划按用户+日期查条目（"今天练什么"路径）
CREATE INDEX idx_plan_entries_user_date ON public.plan_entries USING btree (user_id, entry_date);

-- ----------------------------------------------------------------------------
-- updated_at 触发器（复用 000_baseline 的 update_updated_at_column()）
-- ----------------------------------------------------------------------------

CREATE TRIGGER update_weekly_plans_updated_at BEFORE UPDATE ON public.weekly_plans
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_plan_entries_updated_at BEFORE UPDATE ON public.plan_entries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 外键（对齐 baseline 惯例：一律 ON DELETE CASCADE）
-- ----------------------------------------------------------------------------

ALTER TABLE ONLY public.weekly_plans
    ADD CONSTRAINT weekly_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_weekly_plan_id_fkey FOREIGN KEY (weekly_plan_id) REFERENCES public.weekly_plans(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plan_entries
    ADD CONSTRAINT plan_entries_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE CASCADE;

-- ============================================================================
-- 自记录迁移元数据（MigrationRunner 依赖此表判重；每个迁移文件负责记录自己）
-- ============================================================================
INSERT INTO public.migration_metadata (version, name, applied_at)
VALUES ('001', 'weekly_plans', NOW())
ON CONFLICT (version) DO NOTHING;
