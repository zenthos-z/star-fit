-- ============================================================================
-- Migration: 002_create_profile_state_audit
-- ============================================================================

CREATE TABLE IF NOT EXISTS profile_state_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_type VARCHAR(20) NOT NULL CHECK (state_type IN ('static', 'dynamic', 'summary')),
  action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  modified_by VARCHAR(20) NOT NULL CHECK (modified_by IN ('user', 'mas', 'admin')),
  change_reason TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changes JSONB NOT NULL,
  request_id UUID
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON profile_state_audit(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_state_type ON profile_state_audit(state_type);
CREATE INDEX IF NOT EXISTS idx_audit_changes ON profile_state_audit USING GIN(changes);

-- Comments
COMMENT ON TABLE profile_state_audit IS 'Audit log for all profile state changes';
COMMENT ON COLUMN profile_state_audit.user_id IS 'Reference to the user who made the change';
COMMENT ON COLUMN profile_state_audit.state_type IS 'Type of state: static, dynamic, or summary';
COMMENT ON COLUMN profile_state_audit.action IS 'Action performed: created, updated, or deleted';
COMMENT ON COLUMN profile_state_audit.modified_by IS 'Who made the change: user, mas, or admin';
COMMENT ON COLUMN profile_state_audit.change_reason IS 'Human-readable reason for the change';
COMMENT ON COLUMN profile_state_audit.changes IS 'JSONB payload containing the actual changes';
COMMENT ON COLUMN profile_state_audit.request_id IS 'Optional request ID for tracing';

-- Record migration
INSERT INTO migration_metadata (version, name, applied_at)
VALUES ('002', 'create_profile_state_audit', NOW())
ON CONFLICT (version) DO NOTHING;
