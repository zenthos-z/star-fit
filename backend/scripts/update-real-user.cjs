require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function updateRealUser() {
  const pool = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });

  const client = await pool.connect();

  try {
    // Use a valid UUID
    const userId = '1ffb6e62-4d8c-45dc-b9c5-a0e167c35cad';

    // Update profile_static with test data
    const staticUpdates = { basic_info: { age: 30, weight: 75, training_age: 2 } };
    const staticUpdatesJson = JSON.stringify(staticUpdates);

    await client.query(
      `UPDATE users SET profile_static = COALESCE(profile_static, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [staticUpdatesJson, userId]
    );

    console.log('Updated user:', userId);

    // Verify
    const result = await client.query(`
      SELECT id, profile_static, profile_static->'basic_info' as basic_info
      FROM users
      WHERE id = $1
    `, [userId]);

    console.log('Result:', result.rows[0]);

  } finally {
    client.release();
    await pool.end();
  }
}

updateRealUser().catch(console.error);
