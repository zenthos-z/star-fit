-- ============================================================================
-- 005_agent_payload_snapshots.sql — Agent 交付载荷快照表（#96 Agent 输入可视化页）
-- ============================================================================
-- 训练后审计（非实时流）：原始会话落库（sessions.raw_json 写链）时，用与
-- load_history 同一套归一化 + 硬校验（shared/contracts/agent-delivery.ts）
-- 冻结「交付时点」快照，供调试台 Payload 审计页列表/详情回看。
--
-- 设计要点（契约真源 shared/contracts/agent-payload-snapshot.ts）：
--   (user_id, session_id) 唯一   每次训练一条快照；重同步 upsert 覆盖
--                                （最新交付时点胜出，不留多版本）
--   payload_json      jsonb      交付候选载荷本体（归一形态；unnormalizable
--                                时原始输入原样冻结——快照即交付时点的真实样子）
--   validation_json   jsonb      硬校验结果 {ok, code, reason, reference_check,
--                                checked_at}（拒付也落快照，失败明细可见）
--   preprocess_json   jsonb      预处理标注 [{exercise_index, set_index,
--                                timestamp_source, status_normalized,
--                                status_original}]（载荷之外的推导轨迹）
--
-- 红线：快照为只读审计数据，任何链路禁止 UPDATE payload 本体做「修复」；
-- 会话删除（sync delete 链）级联清快照（无训练即无记录）。
--
-- 幂等性：全句幂等（IF NOT EXISTS），重复执行无副作用——与 003/004 策略一致。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_payload_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- sessions.id（同步链落库的训练会话）；级联删除与「每次训练一条记录」对齐
    session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    -- raw_json.startTime（坏数据可能不可解析 → NULL 容忍，列表排序仍可工作）
    start_time timestamptz,
    end_time timestamptz,
    title text,
    exercise_count int NOT NULL DEFAULT 0,
    validation_passed boolean NOT NULL,
    payload_json jsonb NOT NULL,
    validation_json jsonb NOT NULL,
    preprocess_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- 首次快照时刻（不被重同步 upsert 改写）
    snapshotted_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.agent_payload_snapshots IS 'Agent delivery payload snapshots (per-training audit, issue #96); frozen at raw-session ingestion via the same normalize+validate gate load_history uses; read-only audit data — no repair/rewrite';

COMMENT ON COLUMN public.agent_payload_snapshots.user_id IS 'Owning user (users.id UUID); cascade-deleted with the user';

COMMENT ON COLUMN public.agent_payload_snapshots.session_id IS 'sessions.id the snapshot was derived from; cascade-deleted with the session row (sync delete chain)';

COMMENT ON COLUMN public.agent_payload_snapshots.start_time IS 'raw_json.startTime; NULL when unparseable (bad data is frozen, not fixed)';

COMMENT ON COLUMN public.agent_payload_snapshots.exercise_count IS 'exercises.length in the delivery candidate payload (0 for unnormalizable rows)';

COMMENT ON COLUMN public.agent_payload_snapshots.validation_passed IS 'Delivery hard-validation verdict: true = delivered shape, false = rejected (failure detail in validation_json)';

COMMENT ON COLUMN public.agent_payload_snapshots.payload_json IS 'Delivery candidate payload: normalized AgentDeliverySession, or the raw input as-is when unnormalizable (shared/contracts/agent-payload-snapshot.ts)';

COMMENT ON COLUMN public.agent_payload_snapshots.validation_json IS 'AgentPayloadValidation {ok, code, reason, reference_check, checked_at} frozen at snapshot time';

COMMENT ON COLUMN public.agent_payload_snapshots.preprocess_json IS 'Per-set preprocessing notes (timestamp_source / status normalization trail); derivation annotations, not part of the payload';

COMMENT ON COLUMN public.agent_payload_snapshots.snapshotted_at IS 'First snapshot time for this (user, session); survives re-sync upserts';

-- ----------------------------------------------------------------------------
-- 索引：列表路径（user + 时间倒序分页）+ 幂等 upsert 护栏
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_agent_payload_snapshots_user_start
    ON public.agent_payload_snapshots USING btree (user_id, start_time DESC);

-- (user_id, session_id) 唯一：重同步 upsert（ON CONFLICT DO UPDATE）的幂等护栏
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_payload_snapshots_user_session
    ON public.agent_payload_snapshots USING btree (user_id, session_id);

-- ============================================================================
-- 自记录迁移元数据（MigrationRunner 依赖此表判重；每个迁移文件负责记录自己）
-- ============================================================================
-- 版本号登记沿用 001w/002e/003s/004p 先例（字母后缀）：存量库 migration_metadata
-- 的 '005' 已被 'add_user_media_hash_unique' 占用，故登记 '005a'。Runner 按文件名
-- 解析的数字版本在存量库上会因撞号跳过本文件（与 001-004 文件现状一致），存量库
-- 以手工应用为准；全新库上 Runner 首轮会执行本文件（全句幂等，重复执行无副作用）。
INSERT INTO public.migration_metadata (version, name, applied_at)
VALUES ('005a', '005_agent_payload_snapshots', NOW())
ON CONFLICT (version) DO NOTHING;
