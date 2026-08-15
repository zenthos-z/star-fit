require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function testUpdate() {
  const pool = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });

  const client = await pool.connect();

  try {
    const userId = '00000000-0000-0000-0000-000000000001';

    // First, clear the profile_static to start fresh
    await client.query(`UPDATE users SET profile_static = '{}'::jsonb WHERE id = $1`, [userId]);
    console.log('Cleared profile_static');

    // Now test the exact SQL that userProfileService uses
    const staticUpdates = { basic_info: { age: 99, weight: 88, training_age: 5 } };
    const staticUpdatesJson = JSON.stringify(staticUpdates);

    console.log('Running UPDATE with:', staticUpdatesJson);

    await client.query(
      `UPDATE users SET profile_static = COALESCE(profile_static, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [staticUpdatesJson, userId]
    );

    // Verify the result
    const result = await client.query(`
      SELECT
        id,
        profile_static,
        pg_typeof(profile_static) as type,
        profile_static->'basic_info' as basic_info_extracted
      FROM users
      WHERE id = $1
    `, [userId]);

    console.log('\n=== Result ===');
    console.log('profile_static:', JSON.stringify(result.rows[0].profile_static, null, 2));
    console.log('basic_info extracted:', result.rows[0].basic_info_extracted);

    // Also check the VIEW
    const viewResult = await client.query(`
      SELECT user_id, basic_info, pg_typeof(basic_info) as basic_info_type
      FROM user_insights
      WHERE user_id = $1
    `, [userId]);

    console.log('\n=== VIEW Result ===');
    console.log('basic_info from VIEW:', viewResult.rows[0].basic_info);
    console.log('basic_info type:', viewResult.rows[0].basic_info_type);

  } finally {
    client.release();
    await pool.end();
  }
}

testUpdate().catch(console.error);
