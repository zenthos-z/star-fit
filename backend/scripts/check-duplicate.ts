import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit'
});

async function main() {
  const result = await pool.query(`
    SELECT id, username, short_id, device_id, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 5
  `);

  console.log('\n📋 Full user data:');
  for (const row of result.rows) {
    console.log({
      id: row.id,
      username: row.username,
      short_id: row.short_id,
      device_id: row.device_id,
      created_at: row.created_at
    });
  }

  await pool.end();
}

main();
