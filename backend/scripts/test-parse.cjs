require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function testParse() {
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

    const result = await client.query(`SELECT * FROM user_insights WHERE user_id = $1`, [userId]);
    const profile = result.rows[0];

    console.log('=== Testing JSON.parse on JSONB values ===');
    console.log('red_flags:', profile.red_flags);
    console.log('typeof red_flags:', typeof profile.red_flags);

    // This is what the controller does - it will FAIL if red_flags is already an object
    try {
      const parsed = JSON.parse(profile.red_flags);
      console.log('JSON.parse(red_flags) succeeded:', parsed);
    } catch (e) {
      console.log('JSON.parse(red_flags) FAILED:', e.message);
      console.log('This is the bug! red_flags is already an object, not a string');
    }

    // The fix should be to check if it's already an object
    const safeParsed = typeof profile.red_flags === 'string'
      ? JSON.parse(profile.red_flags)
      : profile.red_flags;
    console.log('Safe parse result:', safeParsed);

  } finally {
    client.release();
    await pool.end();
  }
}

testParse().catch(console.error);
