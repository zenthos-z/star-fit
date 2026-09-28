-- ============================================================================
-- 003_suggestion_cache.sql — 建议参数缓存表（issue #39 后端批 / B6）
-- ============================================================================
-- 「动作设置-应用建议」与「购物车预填」参数一致性问题的后台缓存层：
-- 用户画像变更 / 周计划更新 / 训练完成后，由心跳触发静默整批重算落库，
-- 前端打开 App 经 GET /api/suggestions/cache?fingerprint=xxx 对账拉取。
--
-- 粒度：用户 × 动作 × context_fingerprint（同一批次整批落库，行级指纹一致）。
-- 数值真源：shared/contracts/suggestions.ts 纯函数（computeBaseline 复用，
-- 本表只存算好的确定性结果 + 能力剖面 profile，供前端本地 derive 任意 RPE）。
--
-- 红线：AI 不做算术——source='hybrid' 行仅表示叠加了 Agent 有界调整意图
-- （AdjustmentIntent 随 adjustment_json 走），数值仍由公式层计算与钳制。
--
-- 幂等性：依赖按序执行（与 000/001/002 策略一致），metadata 自记录。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 建表
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suggestion_cache (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- exercises.id（NanoID 文本）；动作删除时级联清缓存行（与 plan_entries 同策略）
    exercise_id text NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
    exercise_name text NOT NULL,
    exercise_type text NOT NULL,
    -- 整批上下文指纹（画像 + 当日计划签名 + 动作库签名 + 公式/上下文版本）
    context_fingerprint text NOT NULL,
    baseline_rpe int NOT NULL,
    -- SuggestionValues（shared/contracts/suggestions.ts）
    values_json jsonb NOT NULL,
    -- CapabilityProfile（前端 deriveSuggestion 本地导出的缓存核心）
    profile_json jsonb NOT NULL,
    -- AdjustmentIntent | NULL（Agent 有界调整意图，仅计划/购物车涉及的动作）
    adjustment_json jsonb,
    -- 计划上下文调制元数据（factor / prior_same_muscle_exercises / muscle / today_planned_sets）
    plan_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- formula=纯公式 | hybrid=公式+Agent 有界调整（后端只产这两种）
    source text NOT NULL DEFAULT 'formula'
        CONSTRAINT suggestion_cache_source_check CHECK (source IN ('formula', 'hybrid')),
    generated_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.suggestion_cache IS 'Suggestion parameter cache (user x exercise x context_fingerprint); batch-recomputed deterministically after profile/plan/session changes (issue #39 B6)';

COMMENT ON COLUMN public.suggestion_cache.user_id IS 'Owning user (users.id UUID); cascade-deleted with the user';

COMMENT ON COLUMN public.suggestion_cache.exercise_id IS 'exercises.id NanoID text; cascade-deleted with the exercise row';

COMMENT ON COLUMN public.suggestion_cache.context_fingerprint IS 'Batch context fingerprint (profile + today plan signature + library signature + formula/plan-context versions); mismatch = stale, full recompute';

COMMENT ON COLUMN public.suggestion_cache.values_json IS 'Finalized SuggestionValues (plan-context modulated, agent-adjusted, rounded) at baseline_rpe';

COMMENT ON COLUMN public.suggestion_cache.profile_json IS 'CapabilityProfile snapshot — frontend derives any RPE locally via deriveSuggestion (offline parity)';

COMMENT ON COLUMN public.suggestion_cache.adjustment_json IS 'AdjustmentIntent replayed by frontend derive at other RPEs; NULL = pure formula row';

COMMENT ON COLUMN public.suggestion_cache.plan_context_json IS 'Same-day plan fatigue modulation metadata {factor, prior_same_muscle_exercises, muscle?, today_planned_sets}';

-- ----------------------------------------------------------------------------
-- 索引：GET 对账路径（user + fingerprint 整批读）+ 用户隔离清理路径
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_suggestion_cache_user_fp
    ON public.suggestion_cache USING btree (user_id, context_fingerprint);

-- (user_id, exercise_id) 唯一：整批替换写入（DELETE + INSERT 单事务）的幂等护栏
CREATE UNIQUE INDEX IF NOT EXISTS uq_suggestion_cache_user_exercise
    ON public.suggestion_cache USING btree (user_id, exercise_id);

-- ============================================================================
-- 自记录迁移元数据（MigrationRunner 依赖此表判重；每个迁移文件负责记录自己）
-- ============================================================================
-- 版本号登记沿用 001w/002e 先例（字母后缀）：本库 migration_metadata 存有
-- 历史迁移链的 000-012 版本号（001_initial_migration … 012_heart_rate_samples），
-- 纯数字 '003' 已被 '003 create_user_insights_compatibility' 占用，故登记
-- '003s'。Runner 按文件名解析的数字版本在存量的 5432 库上会因撞号跳过本
-- 文件（与 001/002 文件现状一致），本库以手工应用为准；全新库上 Runner
-- 首轮会执行本文件（全句幂等，重复执行无副作用）。
INSERT INTO public.migration_metadata (version, name, applied_at)
VALUES ('003s', '003_suggestion_cache', NOW())
ON CONFLICT (version) DO NOTHING;
