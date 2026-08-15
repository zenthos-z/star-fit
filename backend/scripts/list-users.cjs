require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function listUsers() {
  const pool = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });

  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT id, created_at, profile_static->'basic_info' as basic_info
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log('=== Users in database ===');
    for (const row of result.rows) {
      console.log('ID:', row.id, '| basic_info:', row.basic_info);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

listUsers().catch(console.error);
