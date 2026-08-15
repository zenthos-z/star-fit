// Fix user_insights view - add id field
import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit';

// Use simpler syntax - JSONB -> operator returns JSON, cast to text directly
const SQL = `
DROP VIEW IF EXISTS user_insights;

CREATE OR REPLACE VIEW user_insights AS
SELECT
  u.id as id,
  u.id::text as user_id,
  COALESCE(u.profile_static->'fitness_level', 'beginner')::text as fitness_level,
  COALESCE(u.profile_dynamic->'red_flags', '[]')::text as red_flags,
  u.updated_at,
  COALESCE(u.metadata_json->>'modified_by', 'system')::text as modified_by,
  pgb_json_merge(u.profile_static, u.profile_dynamic) as basic_info,
  u.profile_dynamic::text as load_anchors,
  u.profile_static::text as preferences,
  u.profile_static::text as physiological,
  u.profile_static::text as psychological,
  COALESCE(u.history_summary->'training_strategy', u.profile_static->'training_strategy')::text as training_strategy,
  u.metadata_json->>'tags' as tags_json,
  u.history_summary->'summary' as summary,
  u.protocol_version,
  u.version,
  u.metadata_json
FROM users u;

COMMENT ON VIEW user_insights IS 'Compatibility view with id field for UserProfileV2 validation';
`;

async function main() {
  const client = new pg.Client({ connectionString });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();

    console.log('Updating user_insights view...');
    await client.query(SQL);

    console.log('✓ user_insights view updated successfully');
    console.log('  - Added: u.id as id');

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to update view:', error.message);
    console.error(error.stack);
    await client.end();
    process.exit(1);
  }
}

main();
