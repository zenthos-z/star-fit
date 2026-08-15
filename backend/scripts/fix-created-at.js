const { Client } = require('pg');
require('dotenv').config();

const sql = `CREATE OR REPLACE VIEW user_insights AS
SELECT
  u.id as id,
  u.id::text as user_id,
  u.created_at,
  COALESCE(u.profile_static->>'fitness_level', 'beginner')::fitness_level as fitness_level,
  COALESCE(u.profile_dynamic->>'red_flags', '[]') as red_flags,
  u.updated_at,
  COALESCE((u.metadata_json->>'modified_by')::modified_by_type, 'system') as modified_by,
  pgb_json_merge(u.profile_static, u.profile_dynamic)::text as basic_info,
  u.profile_dynamic::text as load_anchors,
  u.profile_static::text as preferences,
  u.profile_static::text as physiological,
  u.profile_static::text as psychological,
  COALESCE(u.history_summary->>'training_strategy', u.profile_static->>'training_strategy') as training_strategy,
  u.metadata_json->>'tags' as tags_json,
  u.history_summary->'summary' as summary,
  u.protocol_version,
  u.version,
  u.metadata_json
FROM users u;`;

const dbUrl = process.env.DATABASE_URL || '';
const user = process.env.PGUSER || 'postgres';
const host = process.env.PGHOST || 'localhost';
const port = process.env.PGPORT || '5432';
const database = process.env.PGDATABASE || 'starfit';

const client = new Client({
  host,
  port: parseInt(port),
  database,
  user,
  password: '',
});

client.connect((err) => {
  if (err) {
    console.error('Connection error:', err);
    process.exit(1);
  }

  console.log('Applying migration to fix created_at field...');

  client.query(sql, (err, res) => {
    if (err) {
      console.error('Migration error:', err);
      process.exit(1);
    }

    console.log('Migration applied successfully! View now includes u.created_at field.');
    client.end();
  });
});
