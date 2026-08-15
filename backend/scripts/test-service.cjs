require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function testService() {
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

    // Query exactly like the service does
    const result = await client.query(`SELECT * FROM user_insights WHERE user_id = $1`, [userId]);

    console.log('=== Raw VIEW result ===');
    const row = result.rows[0];
    console.log('user_id:', row.user_id);
    console.log('basic_info:', row.basic_info);
    console.log('typeof basic_info:', typeof row.basic_info);
    console.log('basic_info.age:', row.basic_info?.age);
    console.log('load_anchors:', row.load_anchors);
    console.log('typeof load_anchors:', typeof row.load_anchors);

  } finally {
    client.release();
    await pool.end();
  }
}

testService().catch(console.error);
