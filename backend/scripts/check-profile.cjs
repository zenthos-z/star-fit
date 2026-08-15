require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function check() {
  const pool = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });

  const client = await pool.connect();

  // Check users table directly
  const usersResult = await client.query(`
    SELECT id, profile_static, profile_dynamic
    FROM users
    WHERE id = '00000000-0000-0000-0000-000000000001'
  `);

  console.log('=== Users table ===');
  console.log('profile_static:', usersResult.rows[0]?.profile_static);
  console.log('profile_dynamic:', usersResult.rows[0]?.profile_dynamic);

  // Check VIEW
  const viewResult = await client.query(`
    SELECT user_id, basic_info, load_anchors
    FROM user_insights
    WHERE user_id = '00000000-0000-0000-0000-000000000001'
  `);

  console.log('\n=== user_insights VIEW ===');
  console.log('basic_info:', viewResult.rows[0]?.basic_info);
  console.log('load_anchors:', viewResult.rows[0]?.load_anchors);

  client.release();
  await pool.end();
}

check().catch(console.error);
