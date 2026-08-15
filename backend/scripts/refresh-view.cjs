const { Client } = require('pg');
require('dotenv').config();

async function refreshView() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    console.log('Forcing user_insights view refresh...');

    // 强制删除并重建视图
    await client.query(`
      DROP VIEW IF EXISTS user_insights;

      CREATE OR REPLACE VIEW user_insights AS
      SELECT
        u.id as id,
        u.id::text as user_id,
        u.created_at,
        COALESCE(u.profile_static->'fitness_level', 'beginner')::fitness_level as fitness_level,
        COALESCE(u.profile_dynamic->'red_flags', '[]') as red_flags,
        u.updated_at,
        COALESCE((u.metadata_json->>'modified_by')::modified_by_type, 'system') as modified_by,
        pgb_json_merge(u.profile_static, u.profile_dynamic)::text as basic_info,
        u.profile_dynamic::text as load_anchors,
        u.profile_static::text as preferences,
        u.profile_static::text as physiological,
        u.profile_static::text as psychological,
        COALESCE(u.history_summary->'training_strategy', u.profile_static->'training_strategy') as training_strategy,
        u.metadata_json->>'tags' as tags_json,
        u.history_summary->'summary' as summary,
        u.protocol_version,
        u.version,
        u.metadata_json
      FROM users u;

      COMMENT ON VIEW user_insights IS 'Force refreshed view - includes created_at field';
    `);

    console.log('View refresh completed successfully!');
    console.log('Sample user data:');
    console.log('  id:', res.rows[0]?.id);
    console.log('  created_at:', res.rows[0]?.created_at);
    console.log('  updated_at:', res.rows[0]?.updated_at);

    await client.end();
  } catch (err) {
    console.error('View refresh failed:', err);
    process.exit(1);
  }
}

refreshView();
