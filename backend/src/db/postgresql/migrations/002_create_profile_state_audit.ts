/**
 * Direct execution script for migration 002
 * Creates the profile_state_audit table
 */

import { Pool } from 'pg';

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit'
  });

  try {
    console.log('[Migration] Starting migration 002...');

    // Step 1: Create migration_metadata table if not exists
    console.log('[Migration] Creating migration_metadata table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration_metadata (
        version VARCHAR(20) PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Check if migration already applied
    const checkResult = await pool.query('SELECT * FROM migration_metadata WHERE version = $1', ['002']);
    if (checkResult.rows.length > 0) {
      console.log('[Migration] Migration 002 already applied. Skipping.');
      return;
    }

    // Step 2: Create profile_state_audit table
    console.log('[Migration] Creating profile_state_audit table...');
    await pool.query(`
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
      )
    `);

    // Step 3: Create indexes
    console.log('[Migration] Creating indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_user_time ON profile_state_audit(user_id, timestamp DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_state_type ON profile_state_audit(state_type)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_changes ON profile_state_audit USING GIN(changes)
    `);

    // Step 4: Add comments
    console.log('[Migration] Adding table comments...');
    await pool.query(`COMMENT ON TABLE profile_state_audit IS 'Audit log for all profile state changes'`);
    await pool.query(`COMMENT ON COLUMN profile_state_audit.user_id IS 'Reference to the user who made the change'`);
    await pool.query(`COMMENT ON COLUMN profile_state_audit.state_type IS 'Type of state: static, dynamic, or summary'`);
    await pool.query(`COMMENT ON COLUMN profile_state_audit.action IS 'Action performed: created, updated, or deleted'`);
    await pool.query(`COMMENT ON COLUMN profile_state_audit.modified_by IS 'Who made the change: user, mas, or admin'`);
    await pool.query(`COMMENT ON COLUMN profile_state_audit.change_reason IS 'Human-readable reason for the change'`);
    await pool.query(`COMMENT ON COLUMN profile_state_audit.changes IS 'JSONB payload containing the actual changes'`);
    await pool.query(`COMMENT ON COLUMN profile_state_audit.request_id IS 'Optional request ID for tracing'`);

    // Step 5: Record migration
    console.log('[Migration] Recording migration...');
    await pool.query(`
      INSERT INTO migration_metadata (version, name, applied_at)
      VALUES ('002', 'create_profile_state_audit', NOW())
      ON CONFLICT (version) DO NOTHING
    `);

    console.log('[Migration] Migration 002 completed successfully!');
    console.log('[Migration] Created table: profile_state_audit');
  } catch (error: any) {
    console.error('[Migration] Error:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(console.error);
