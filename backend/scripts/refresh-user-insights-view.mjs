import { getPostgresClient } from '../src/db/postgresql/client/postgres-client.js';

async function refreshView() {
  const client = getPostgresClient();

  console.log('Dropping and recreating user_insights VIEW...');

  await client.query(`
    DROP VIEW IF EXISTS user_insights CASCADE;
  `);

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

  console.log('VIEW recreated successfully!');

  // Verify the VIEW returns JSONB objects
  const result = await client.queryOne(`
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
  console.log('Sample VIEW data:', JSON.stringify(result, null, 2));

  process.exit(0);
}

refreshView().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
