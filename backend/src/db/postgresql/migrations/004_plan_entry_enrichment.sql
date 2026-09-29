-- ============================================================================
-- 004_plan_entry_enrichment.sql — plan_entries 结构化契约升级（T9 / issue #66）
-- ============================================================================
-- 信息页/详情页四个缺口（日聚焦标签 / 当日说明 / 三段分类 / 逐组处方）的
-- 根因修复：plan_entries 增列 day_focus / rationale / category / sets。
--
-- 设计要点（契约真源 shared/contracts/weekly-plan.ts v1.1.0）：
--   day_focus   text NULL  当日聚焦短标签（腿/胸/背/肩/全身…）——同日条目
--                         冗余同值（无独立日表，沿用 user_id 冗余列先例）
--   rationale   text NULL  当日说明（安排原因/目标/注意要点）——同日冗余同值
--   category    plan_entry_category NULL
--                         段位 warmup/main/cooldown；旧数据 NULL 由读取侧
--                         resolvePlanEntryCategory 回落 'main'（不炸、不猜）
--   sets        jsonb NULL 逐组处方 [{set_no, weight_kg?, reps, rpe}]——
--                         结构校验归 Zod（PlanSetPrescriptionSchema），本库
--                         只锁「在位必为数组」防脏写入
--
-- 旧数据兼容：全列可空，存量行读出 NULL 即回落（category→main、
-- sets→消费方按 target_sets × target_load 展示），无需回填。
--
-- 幂等性：全句幂等（DO 块判存 + IF NOT EXISTS + 约束按 pg_catalog 判存），
-- 重复执行无副作用——与 003 策略一致（见下「版本号登记」注）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 枚举类型：条目段位（三段式课表 热身→正式→收尾拉伸）
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'plan_entry_category' AND n.nspname = 'public'
    ) THEN
        CREATE TYPE public.plan_entry_category AS ENUM (
            'warmup',
            'main',
            'cooldown'
        );
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 增列（全部可空——旧计划回落兼容）
-- ----------------------------------------------------------------------------

ALTER TABLE public.plan_entries
    ADD COLUMN IF NOT EXISTS day_focus text;

ALTER TABLE public.plan_entries
    ADD COLUMN IF NOT EXISTS rationale text;

ALTER TABLE public.plan_entries
    ADD COLUMN IF NOT EXISTS category public.plan_entry_category;

-- 逐组处方：[{set_no, weight_kg?, reps, rpe}]（结构校验归应用层 Zod）
ALTER TABLE public.plan_entries
    ADD COLUMN IF NOT EXISTS sets jsonb;

-- ----------------------------------------------------------------------------
-- 约束：sets 在位必为 JSON 数组（防脏写入把对象/标量塞进处方列）
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'plan_entries_sets_array_check'
          AND conrelid = 'public.plan_entries'::regclass
    ) THEN
        ALTER TABLE public.plan_entries
            ADD CONSTRAINT plan_entries_sets_array_check
            CHECK (sets IS NULL OR jsonb_typeof(sets) = 'array');
    END IF;
END
$$;

COMMENT ON COLUMN public.plan_entries.day_focus IS 'Day focus short label (腿/胸/背/肩/全身…), denormalized per entry within the same day (T9/#66)';

COMMENT ON COLUMN public.plan_entries.rationale IS 'Day rationale: why this layout / goal / cautions, denormalized per entry within the same day (T9/#66)';

COMMENT ON COLUMN public.plan_entries.category IS 'Segment: warmup / main / cooldown; NULL on legacy rows resolves to main on read (T9/#66)';

COMMENT ON COLUMN public.plan_entries.sets IS 'Per-set prescription [{set_no, weight_kg?, reps, rpe}]; structure validated by Zod PlanSetPrescriptionSchema, NULL on legacy rows (T9/#66)';

-- ============================================================================
-- 自记录迁移元数据（MigrationRunner 依赖此表判重；每个迁移文件负责记录自己）
-- ============================================================================
-- 版本号登记沿用 001w/002e/003s 先例（字母后缀）：本库 migration_metadata 存有
-- 历史迁移链的 000-012 数字版本号（'004' 已被 'add_id_to_view' 占用），故登记
-- '004p'。Runner 按文件名解析的数字版本在存量库上会因撞号跳过本文件（与
-- 001/002/003 文件现状一致），存量库以手工应用为准；全新库上 Runner 首轮会
-- 执行本文件（全句幂等，重复执行无副作用）。
INSERT INTO public.migration_metadata (version, name, applied_at)
VALUES ('004p', '004_plan_entry_enrichment', NOW())
ON CONFLICT (version) DO NOTHING;
