-- ============================================================================
-- 002_exercise_details.sql — exercises 表深化（issue #4）
-- ============================================================================
-- 动作库支撑「动作百科」式可视化：结构化分类列 + 教学内容列 + 资产引用列
-- + 中文预留列，共 16 列 + owner_user_id（自定义动作用户绑定，自 attributes
-- JSONB 提升为正式列）。attributes JSONB 旧列整体移除——新列完全接管。
--
-- 契约真源：shared/contracts/exercise-library.ts（受控词表 + 三源归一映射表）
-- 归一映射不在本迁移执行：存量 25 条 AI 生成数据按拍板（issue #4 返工）
-- 整体清空，A3 导入管线将以 TS 契约（normalizeMuscle / normalizeEquipment）
-- 灌入干净数据——SQL 侧映射与契约双真源问题就此消除。
--
-- 数据源拍板（issue #3 评估 + issue #4 口径）：
--   主源 free-exercise-db-with-videos 317 条；补充源 free-exercise-db 876 条；
--   RepDB 弃用（许可冲突）。目标精收 300-500 条。
--
-- 幂等性：依赖按序执行（与 000/001 策略一致），metadata 自记录。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 枚举类型（5 个，值与契约 z.enum 一一对应）
-- ----------------------------------------------------------------------------

-- 器材 15 大类（三源归一；源 null/'body only'/'body weight' → bodyweight）
CREATE TYPE public.exercise_equipment AS ENUM (
    'bodyweight',
    'barbell',
    'dumbbell',
    'kettlebell',
    'cable',
    'machine',
    'band',
    'bench',
    'rack',
    'pull_up_bar',
    'stability_ball',
    'medicine_ball',
    'foam_roller',
    'weighted',
    'other'
);

-- 训练类目 7 类（库1 category 归一）
CREATE TYPE public.exercise_category AS ENUM (
    'strength',
    'cardio',
    'stretching',
    'plyometrics',
    'powerlifting',
    'strongman',
    'olympic_weightlifting'
);

-- 身体区域 10 区（库3 bodyPart 归一）
CREATE TYPE public.exercise_body_part AS ENUM (
    'back',
    'cardio',
    'chest',
    'hips',
    'lower_arms',
    'lower_legs',
    'shoulders',
    'upper_arms',
    'upper_legs',
    'waist'
);

-- 力向（库1 force；源 None → NULL 列）
CREATE TYPE public.exercise_force_type AS ENUM (
    'push',
    'pull',
    'static'
);

-- 动作机制（库1 mechanic；源 None → NULL 列）
CREATE TYPE public.exercise_mechanic AS ENUM (
    'compound',
    'isolation'
);

-- ----------------------------------------------------------------------------
-- 新列（16 深化列 + owner_user_id；可空或带默认）
-- ----------------------------------------------------------------------------

ALTER TABLE public.exercises
    ADD COLUMN equipment public.exercise_equipment,
    ADD COLUMN category public.exercise_category,
    ADD COLUMN body_part public.exercise_body_part,
    ADD COLUMN primary_muscles text[] DEFAULT '{}'::text[] NOT NULL,
    ADD COLUMN secondary_muscles text[] DEFAULT '{}'::text[] NOT NULL,
    ADD COLUMN force_type public.exercise_force_type,
    ADD COLUMN mechanic public.exercise_mechanic,
    ADD COLUMN instructions text[],
    ADD COLUMN form_cues text[],
    ADD COLUMN common_mistakes text[],
    ADD COLUMN breathing text,
    ADD COLUMN aliases text[],
    ADD COLUMN image_refs text[],
    ADD COLUMN video_urls jsonb,
    ADD COLUMN poster_url text,
    ADD COLUMN name_zh text,
    ADD COLUMN instructions_zh text[];

COMMENT ON COLUMN public.exercises.equipment IS 'Primary equipment (15 normalized categories); NULL = unknown; source null/body only -> bodyweight. Vocabulary: shared/contracts/exercise-library.ts';

COMMENT ON COLUMN public.exercises.primary_muscles IS 'Primary muscles (17-muscle controlled vocabulary, snake_case); pure-cardio moves allow empty array. NOT NULL default {}';

COMMENT ON COLUMN public.exercises.secondary_muscles IS 'Secondary muscles (same 17-muscle vocabulary). NOT NULL default {}';

COMMENT ON COLUMN public.exercises.instructions IS 'Step-by-step instructions (string array, lib3 steps style); NULL = source lacks field';

COMMENT ON COLUMN public.exercises.video_urls IS 'Demo video references {male?, female?} as external URLs — references only, files are NOT stored in-repo (lib3 1080p MP4)';

COMMENT ON COLUMN public.exercises.name_zh IS 'Chinese display name reserved (filled by AI translation pipeline later); NULL until then';

COMMENT ON COLUMN public.exercises.instructions_zh IS 'Chinese instructions reserved (parallel to instructions); NULL until AI translation pipeline fills it';

-- ----------------------------------------------------------------------------
-- owner_user_id：自定义动作的用户绑定（自 attributes.owner_user_id 提升）
-- NULL = 公共库动作；非空 = 该用户私有（agent create_exercise / HC-2 可见性）
-- ----------------------------------------------------------------------------

ALTER TABLE public.exercises
    ADD COLUMN owner_user_id uuid;

COMMENT ON COLUMN public.exercises.owner_user_id IS 'Owner of user-created custom exercises (NULL = public library row). Promoted from attributes.owner_user_id JSONB key in 002 (HC-2 user binding)';

CREATE INDEX idx_exercises_owner_user ON public.exercises USING btree (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 旧结构拆除：exercise_summary 物化视图（attributes 投影，无代码消费）
-- ----------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS public.exercise_summary;

-- ----------------------------------------------------------------------------
-- 存量数据清空（用户拍板：25 条 AI 生成数据整体清除，A3 管线重灌干净数据）
--
-- FK 依赖链检查（2026-09-26 实测）：引用 exercises 的外键唯一来源是
-- plan_entries(plan_entries_exercise_id_fkey)。TRUNCATE ... CASCADE 连带清空
-- plan_entries——exercises 清空后其条目全部悬空，级联清理是正确语义；
-- weekly_plans / sessions 等用户数据表不在引用链上，不受影响。
-- ----------------------------------------------------------------------------

TRUNCATE public.exercises CASCADE;

-- ----------------------------------------------------------------------------
-- DROP attributes JSONB 旧列（新列完全接管）
-- 连带自动删除 5 个 attributes 表达式索引：
--   idx_exercises_attributes / idx_exercises_equipment / idx_exercises_impact_level
--   / idx_exercises_pattern / idx_exercises_targets
-- ----------------------------------------------------------------------------

ALTER TABLE public.exercises DROP COLUMN attributes;

-- ----------------------------------------------------------------------------
-- CHECK 约束：肌群数组元素 ∈ 17 基准词表（防绕过 Repository 写入脏值）
-- 真源：shared/contracts/exercise-library.ts EXERCISE_MUSCLES
-- <@（数组被包含）为纯运算符表达式（CHECK 不允许子查询；空数组 ⊆ 词表 恒真）
-- ----------------------------------------------------------------------------

ALTER TABLE public.exercises
    ADD CONSTRAINT exercises_primary_muscles_vocab_check CHECK (
        primary_muscles <@ ARRAY[
            'abdominals', 'abductors', 'adductors', 'biceps', 'calves',
            'chest', 'forearms', 'glutes', 'hamstrings', 'lats',
            'lower_back', 'middle_back', 'neck', 'quadriceps',
            'shoulders', 'traps', 'triceps'
        ]::text[]
    ),
    ADD CONSTRAINT exercises_secondary_muscles_vocab_check CHECK (
        secondary_muscles <@ ARRAY[
            'abdominals', 'abductors', 'adductors', 'biceps', 'calves',
            'chest', 'forearms', 'glutes', 'hamstrings', 'lats',
            'lower_back', 'middle_back', 'neck', 'quadriceps',
            'shoulders', 'traps', 'triceps'
        ]::text[]
    );

-- ----------------------------------------------------------------------------
-- 索引（动作百科筛选路径；difficulty 已有 baseline 索引，不重复）
-- ----------------------------------------------------------------------------

CREATE INDEX idx_exercises_primary_muscles ON public.exercises USING gin (primary_muscles);

CREATE INDEX idx_exercises_secondary_muscles ON public.exercises USING gin (secondary_muscles);

CREATE INDEX idx_exercises_equipment_category ON public.exercises USING btree (equipment);

CREATE INDEX idx_exercises_category ON public.exercises USING btree (category);

CREATE INDEX idx_exercises_body_part ON public.exercises USING btree (body_part);

-- ============================================================================
-- 自记录迁移元数据（MigrationRunner 依赖此表判重）
-- ============================================================================
INSERT INTO public.migration_metadata (version, name, applied_at)
VALUES ('002', 'exercise_details', NOW())
ON CONFLICT (version) DO NOTHING;
