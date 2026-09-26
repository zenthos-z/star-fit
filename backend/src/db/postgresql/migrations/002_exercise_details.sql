-- ============================================================================
-- 002_exercise_details.sql — exercises 表深化（issue #4）
-- ============================================================================
-- 动作库支撑「动作百科」式可视化：结构化分类列 + 教学内容列 + 资产引用列
-- + 中文预留列，共 16 列。attributes JSONB 保留为兜底扩展位（不清空、不改义）。
--
-- 契约真源：shared/contracts/exercise-library.ts（受控词表 + 三源归一映射表）
-- ⚠️ 本文件内联的映射 CASE 与契约 MUSCLE_ALIASES / EQUIPMENT_ALIASES 全等
--    （null 值条目除外：SQL 侧不可映射 → 丢弃该元素/置 NULL 列）。
--    如增改映射值，两处必须同步——契约测试锁定全等。
--
-- 回填：存量 25 条的 attributes（中文 targets/equipment_required + pattern）
-- 解析拆列归一。pg 临时函数（pg_temp，事务结束即消失）承载映射 CASE。
-- 数据源拍板（issue #3 评估 + issue #4 口径）：
--   主源 free-exercise-db-with-videos 317 条；补充源 free-exercise-db 876 条；
--   RepDB 弃用（许可冲突）。本迁移只落结构，不做数据导入。
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
-- 新列（16 列；可空或带默认，存量行先兼容后回填）
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
-- 存量行数快照（回填零丢失校验基线）
-- ----------------------------------------------------------------------------

CREATE TEMP TABLE tmp_exercises_count_002 AS
    SELECT count(*)::bigint AS c FROM public.exercises;

-- ----------------------------------------------------------------------------
-- 归一映射（pg 临时函数，事务结束即消失；CASE 与契约映射表全等）
-- ----------------------------------------------------------------------------

-- 肌群：三源原值 → 17 基准（不可映射 → NULL 即丢弃该元素）
-- 真源：shared/contracts/exercise-library.ts MUSCLE_ALIASES
CREATE OR REPLACE FUNCTION pg_temp.map_muscle_002(raw text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE raw
        -- 库1 17 原值（identity + 空格 → snake_case）
        WHEN 'abdominals' THEN 'abdominals'
        WHEN 'abductors' THEN 'abductors'
        WHEN 'adductors' THEN 'adductors'
        WHEN 'biceps' THEN 'biceps'
        WHEN 'calves' THEN 'calves'
        WHEN 'chest' THEN 'chest'
        WHEN 'forearms' THEN 'forearms'
        WHEN 'glutes' THEN 'glutes'
        WHEN 'hamstrings' THEN 'hamstrings'
        WHEN 'lats' THEN 'lats'
        WHEN 'lower back' THEN 'lower_back'
        WHEN 'middle back' THEN 'middle_back'
        WHEN 'neck' THEN 'neck'
        WHEN 'quadriceps' THEN 'quadriceps'
        WHEN 'shoulders' THEN 'shoulders'
        WHEN 'traps' THEN 'traps'
        WHEN 'triceps' THEN 'triceps'
        -- 库3 39 target（同义词冗余归一；cardiovascular system / full body
        -- 为非肌群目标，契约值为 null → 此处丢弃）
        WHEN 'abs' THEN 'abdominals'
        WHEN 'anterior deltoid' THEN 'shoulders'
        WHEN 'deltoids' THEN 'shoulders'
        WHEN 'delts' THEN 'shoulders'
        WHEN 'erector spinae' THEN 'lower_back'
        WHEN 'erectors' THEN 'lower_back'
        WHEN 'forearm extensors' THEN 'forearms'
        WHEN 'gluteus medius' THEN 'abductors'
        WHEN 'hip flexors' THEN 'quadriceps'
        WHEN 'neck flexors' THEN 'neck'
        WHEN 'obliques' THEN 'abdominals'
        WHEN 'pectorals' THEN 'chest'
        WHEN 'peroneals' THEN 'calves'
        WHEN 'posterior deltoid' THEN 'shoulders'
        WHEN 'quads' THEN 'quadriceps'
        WHEN 'rear deltoids' THEN 'shoulders'
        WHEN 'rectus abdominis' THEN 'abdominals'
        WHEN 'rhomboids' THEN 'middle_back'
        WHEN 'spinal erectors' THEN 'lower_back'
        WHEN 'spine' THEN 'lower_back'
        WHEN 'sternocleidomastoid' THEN 'neck'
        WHEN 'thoracic spine' THEN 'middle_back'
        WHEN 'upper back' THEN 'middle_back'
        WHEN 'upper pectorals' THEN 'chest'
        -- 存量中文脏值（25 条实测 distinct 全集）
        WHEN 'ROTATOR_CUFF' THEN 'shoulders'
        WHEN '三角肌' THEN 'shoulders'
        WHEN '上胸' THEN 'chest'
        WHEN '下胸' THEN 'chest'
        WHEN '中下胸' THEN 'chest'
        WHEN '中束' THEN 'shoulders'
        WHEN '二头' THEN 'biceps'
        WHEN '三头' THEN 'triceps'
        WHEN '前束' THEN 'shoulders'
        WHEN '前肩' THEN 'shoulders'
        WHEN '前臂' THEN 'forearms'
        WHEN '后束' THEN 'shoulders'
        WHEN '后肩' THEN 'shoulders'
        WHEN '后链' THEN 'hamstrings'
        WHEN '核心' THEN 'abdominals'
        WHEN '股四' THEN 'quadriceps'
        WHEN '肩膀' THEN 'shoulders'
        WHEN '背部厚度' THEN 'middle_back'
        WHEN '背阔' THEN 'lats'
        WHEN '背阔肌' THEN 'lats'
        WHEN '腘绳' THEN 'hamstrings'
        WHEN '腹肌' THEN 'abdominals'
        WHEN '臀大' THEN 'glutes'
        -- 18 中文词表值兜底
        WHEN '小臂' THEN 'forearms'
        WHEN '小腿' THEN 'calves'
        WHEN '侧腹' THEN 'abdominals'
        WHEN '上臀部' THEN 'glutes'
        WHEN '下臀部' THEN 'glutes'
        WHEN '下背' THEN 'lower_back'
        WHEN '斜方肌' THEN 'traps'
        WHEN '背部' THEN 'lats'
        ELSE NULL
    END
$fn$;

-- 器材：三源原值 → 15 大类（不可映射 → NULL）
-- 真源：shared/contracts/exercise-library.ts EQUIPMENT_ALIASES
CREATE OR REPLACE FUNCTION pg_temp.map_equipment_002(raw text)
RETURNS public.exercise_equipment
LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE raw
        -- 库1 13 值
        WHEN 'None' THEN 'bodyweight'
        WHEN 'body only' THEN 'bodyweight'
        WHEN 'bands' THEN 'band'
        WHEN 'barbell' THEN 'barbell'
        WHEN 'cable' THEN 'cable'
        WHEN 'dumbbell' THEN 'dumbbell'
        WHEN 'e-z curl bar' THEN 'barbell'
        WHEN 'exercise ball' THEN 'stability_ball'
        WHEN 'foam roll' THEN 'foam_roller'
        WHEN 'kettlebells' THEN 'kettlebell'
        WHEN 'machine' THEN 'machine'
        WHEN 'medicine ball' THEN 'medicine_ball'
        WHEN 'other' THEN 'other'
        -- 库3 13 值
        WHEN 'band' THEN 'band'
        WHEN 'body weight' THEN 'bodyweight'
        WHEN 'ez barbell' THEN 'barbell'
        WHEN 'kettlebell' THEN 'kettlebell'
        WHEN 'leverage machine' THEN 'machine'
        WHEN 'rope' THEN 'cable'
        WHEN 'sled machine' THEN 'machine'
        WHEN 'smith machine' THEN 'machine'
        WHEN 'stability ball' THEN 'stability_ball'
        WHEN 'weighted' THEN 'weighted'
        -- 存量中文 10 值
        WHEN '杠铃' THEN 'barbell'
        WHEN '哑铃' THEN 'dumbbell'
        WHEN '拉力器' THEN 'cable'
        WHEN '卧推凳' THEN 'bench'
        WHEN '上斜凳' THEN 'bench'
        WHEN '腿举机' THEN 'machine'
        WHEN '腿弯举机' THEN 'machine'
        WHEN '深蹲架' THEN 'rack'
        WHEN '单杠' THEN 'pull_up_bar'
        WHEN '双杠' THEN 'pull_up_bar'
        ELSE NULL
    END::public.exercise_equipment
$fn$;

-- ----------------------------------------------------------------------------
-- 回填：attributes JSONB 解析拆列
--   primary/secondary muscles —— 数组逐元素映射，DISTINCT 去重，丢不可映射值
--   equipment —— 主器材 = 数组首个可映射值；空数组 → bodyweight；全不可映射 → NULL
--   force_type —— 仅 pattern=push/pull 直映射（squat/hinge/lunge 等力向歧义，不映射）
-- ----------------------------------------------------------------------------

UPDATE public.exercises AS e
SET
    primary_muscles = COALESCE((
        SELECT ARRAY_AGG(DISTINCT pg_temp.map_muscle_002(t.v))
        FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(e.attributes->'targets'->'primary') = 'array'
                 THEN e.attributes->'targets'->'primary' ELSE '[]'::jsonb END
        ) AS t(v)
        WHERE pg_temp.map_muscle_002(t.v) IS NOT NULL
    ), '{}'::text[]),
    secondary_muscles = COALESCE((
        SELECT ARRAY_AGG(DISTINCT pg_temp.map_muscle_002(t.v))
        FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(e.attributes->'targets'->'secondary') = 'array'
                 THEN e.attributes->'targets'->'secondary' ELSE '[]'::jsonb END
        ) AS t(v)
        WHERE pg_temp.map_muscle_002(t.v) IS NOT NULL
    ), '{}'::text[]),
    equipment = COALESCE((
        SELECT pg_temp.map_equipment_002(t.v)
        FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(e.attributes->'equipment_required') = 'array'
                 THEN e.attributes->'equipment_required' ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS t(v, ord)
        WHERE pg_temp.map_equipment_002(t.v) IS NOT NULL
        ORDER BY t.ord
        LIMIT 1
    ), CASE
        WHEN jsonb_array_length(
            CASE WHEN jsonb_typeof(e.attributes->'equipment_required') = 'array'
                 THEN e.attributes->'equipment_required' ELSE '[]'::jsonb END
        ) = 0 THEN 'bodyweight'::public.exercise_equipment
        ELSE NULL
    END),
    force_type = CASE (e.attributes->>'pattern')
        WHEN 'push' THEN 'push'::public.exercise_force_type
        WHEN 'pull' THEN 'pull'::public.exercise_force_type
        ELSE NULL
    END;

-- ----------------------------------------------------------------------------
-- 回填零丢失校验（行数与快照不一致 → 事务整体回滚）
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    before_count bigint;
    after_count bigint;
BEGIN
    SELECT c INTO before_count FROM tmp_exercises_count_002;
    SELECT count(*) INTO after_count FROM public.exercises;
    IF before_count <> after_count THEN
        RAISE EXCEPTION '002 backfill row loss: % -> %', before_count, after_count;
    END IF;
END $$;

DROP TABLE tmp_exercises_count_002;

-- ----------------------------------------------------------------------------
-- CHECK 约束：肌群数组元素 ∈ 17 基准词表（防绕过 Repository 写入脏值）
-- 真源：shared/contracts/exercise-library.ts EXERCISE_MUSCLES
-- ----------------------------------------------------------------------------

-- <@（数组被包含）为纯运算符表达式：primary_muscles 全部元素 ∈ 17 词表
-- （CHECK 约束不允许子查询，NOT EXISTS 写法不可用；空数组 ⊆ 词表 恒真）
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
