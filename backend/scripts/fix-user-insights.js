// Fix user_insights view - add created_at field
import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit';

async function main() {
  const client = new pg.Client({ connectionString });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();

    console.log('Dropping and recreating user_insights view...');

    // First create the merge function if it doesn't exist
    await client.query(`
      CREATE OR REPLACE FUNCTION pgb_json_merge(a JSONB, b JSONB)
      RETURNS JSONB AS $$
      BEGIN
        IF a IS NULL THEN
          RETURN b;
        END IF;
        IF b IS NULL THEN
          RETURN a;
        END IF;
        RETURN a || b;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Drop view first to avoid column name conflicts
    await client.query(`DROP VIEW IF EXISTS user_insights`);

    // Then recreate view with created_at and id fields
    const result = await client.query(`
      CREATE VIEW user_insights AS
      SELECT
        u.id as id,
        u.id::text as user_id,
        u.created_at,
        u.updated_at,
        COALESCE((u.profile_static->>'fitness_level')::text, 'beginner')::text as fitness_level,
        COALESCE((u.profile_dynamic->>'red_flags')::text, '[]')::text as red_flags,
        COALESCE((u.metadata_json->>'modified_by')::text, 'system')::text as modified_by,
        pgb_json_merge(u.profile_static, u.profile_dynamic)::text as basic_info,
        u.profile_dynamic::text as load_anchors,
        u.profile_static::text as preferences,
        u.profile_static::text as physiological,
        u.profile_static::text as psychological,
        COALESCE((u.history_summary->>'training_strategy')::text, (u.profile_static->>'training_strategy')::text)::text as training_strategy,
        u.metadata_json->>'tags'::text as tags_json,
        u.history_summary->>'summary'::text as summary,
        u.protocol_version,
        u.version,
        u.metadata_json
      FROM users u
    `);

    console.log('✓ user_insights view updated with created_at and id fields');
    console.log('Rows:', result.rowCount);

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
