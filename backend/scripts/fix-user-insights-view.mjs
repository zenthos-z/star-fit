/**
 * Fix user_insights view - Add id field for UserProfileV2 validation
 *
 * Run with: node scripts/fix-user-insights-view.mjs
 */

import { getPostgresClient } from './src/db/postgresql/client/postgres-client.js';

const SQL = `
-- Drop and recreate user_insights view with id field
DROP VIEW IF EXISTS user_insights;

CREATE OR REPLACE VIEW user_insights AS
SELECT
  -- Core fields (mapped from users table)
  u.id as id,  -- Add UUID id for UserProfileV2 validation
  u.id::text as user_id,
  COALESCE(
    u.profile_static->>'fitness_level',
    'beginner'
  )::fitness_level as fitness_level,
  COALESCE(
    u.profile_dynamic->>'red_flags',
    '[]'
  ) as red_flags,
  u.updated_at,

  -- Map modified_by from metadata if available, default to 'system'
  COALESCE(
    (u.metadata_json->>'modified_by')::modified_by_type,
    'system'
  ) as modified_by,

  -- Flex fields (mapped from JSONB columns)
  pgb_json_merge(u.profile_static, u.profile_dynamic)::text as basic_info,
  u.profile_dynamic::text as load_anchors,
  u.profile_static::text as preferences,
  u.profile_static::text as physiological,
  u.profile_static::text as psychological,

  -- Training strategy from history_summary or profile_static
  COALESCE(
    u.history_summary->>'training_strategy',
    u.profile_static->>'training_strategy'
  ) as training_strategy,

  -- Legacy fields (for backward compatibility)
  u.metadata_json->>'tags' as tags_json,
  u.history_summary->>'summary' as summary,
  u.protocol_version,
  u.version,
  u.metadata_json
FROM users u;

COMMENT ON VIEW user_insights IS 'Compatibility view for legacy user_insights table. Maps new three-state model to old structure. Updated to include id field for UserProfileV2 validation.';
`;

async function main() {
  try {
    const client = getPostgresClient();

    console.log('Updating user_insights view...');

    await client.query(SQL);

    console.log('✓ user_insights view updated successfully');
    console.log('  - Added: u.id as id');

    await client.close();
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to update view:', error.message);
    process.exit(1);
  }
}

main();
