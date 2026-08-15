// CommonJS script to refresh user_insights VIEW
// Loads .env properly and runs the VIEW update

require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function refreshView() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'starfit',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  });

  console.log('Connecting to PostgreSQL...');
  console.log('Host:', process.env.PGHOST);
  console.log('Database:', process.env.PGDATABASE);

  try {
    const client = await pool.connect();
    console.log('Connected!');

    // Drop existing VIEW
    console.log('Dropping existing VIEW...');
    await client.query('DROP VIEW IF EXISTS user_insights CASCADE;');
    console.log('VIEW dropped.');

    // Create new VIEW with JSONB operators
    console.log('Creating new VIEW with JSONB operators...');
    await client.query(`
      CREATE VIEW user_insights AS
      SELECT
        u.id AS user_id,
        u.id,
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
    console.log('VIEW created!');

    // Verify the VIEW returns JSONB types
    const result = await client.query(`
      SELECT
        user_id,
        fitness_level,
        basic_info,
        pg_typeof(basic_info) as basic_info_type,
        load_anchors,
        pg_typeof(load_anchors) as load_anchors_type
      FROM user_insights
      LIMIT 1
    `);
    console.log('Sample VIEW data:');
    console.log(JSON.stringify(result.rows[0], null, 2));

    client.release();
    await pool.end();
    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

refreshView();
