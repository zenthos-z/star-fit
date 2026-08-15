/**
 * Quick migration script for display_name column
 * Run with: npx tsx src/db/postgresql/migrations/006_run_direct.ts
 */

import 'dotenv/config';
import { getPostgresClient } from '../client/postgres-client.js';
import { resetConfigCache } from '../config.js';

// Reset config cache to ensure fresh load from env
resetConfigCache();

async function runMigration() {
  const client = getPostgresClient();

  console.log('[Migration] Starting display_name migration...\n');

  try {
    // Add display_name column
    console.log('[1/3] Adding display_name column...');
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS display_name TEXT
    `);
    console.log('      ✓ Column added');

    // Add constraint (check if exists first)
    console.log('[2/3] Adding display_name constraint...');
    try {
      // Check if constraint already exists
      const constraintCheck = await client.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'users'
        AND constraint_name = 'display_name_format'
      `);

      if (constraintCheck.rows.length === 0) {
        await client.query(`
          ALTER TABLE users
          ADD CONSTRAINT display_name_format
          CHECK (display_name ~ '^.{1,50}$')
        `);
        console.log('      ✓ Constraint added');
      } else {
        console.log('      ⊘ Constraint already exists, skipping');
      }
    } catch (e: any) {
      // Ignore constraint errors (might already exist)
      if (e.message.includes('already exists')) {
        console.log('      ⊘ Constraint already exists, skipping');
      } else {
        throw e;
      }
    }

    // Recreate view
    console.log('[3/3] Recreating user_insights view...');
    await client.query(`
      DROP VIEW IF EXISTS user_insights;

      CREATE OR REPLACE VIEW user_insights AS
      SELECT
        u.id AS user_id,
        u.id,
        u.device_id,
        u.display_name,
        u.created_at,
        u.updated_at,
        u.updated_at AS modified_at,
        COALESCE(u.profile_static->>'fitness_level', 'beginner') AS fitness_level,
        COALESCE(u.profile_static->'red_flags', '[]'::jsonb) AS red_flags,
        COALESCE(u.profile_static->'basic_info', NULL::jsonb) AS basic_info,
        COALESCE(u.profile_static->'preferences', NULL::jsonb) AS preferences,
        COALESCE(u.profile_static->'physiological', NULL::jsonb) AS physiological,
        COALESCE(u.profile_static->'psychological', NULL::jsonb) AS psychological,
        COALESCE(u.profile_static->'training_strategy', NULL::jsonb) AS training_strategy,
        COALESCE(u.profile_dynamic->'load_anchors', NULL::jsonb) AS load_anchors,
        COALESCE(u.profile_dynamic->'active_limitations', '[]'::jsonb) AS active_limitations,
        COALESCE(u.profile_dynamic->'recovery_state', NULL::jsonb) AS recovery_state,
        COALESCE(u.history_summary->'recent_summary', NULL::jsonb) AS summary,
        'system'::text AS modified_by,
        u.protocol_version,
        u.version
      FROM users u
    `);
    console.log('      ✓ View recreated');

    console.log('\n[Migration] ✓ Completed successfully!\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n[Migration] ✗ Failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration();
