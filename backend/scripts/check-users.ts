import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit'
});

async function main() {
  const result = await pool.query(`
    SELECT id, username, short_id, device_id, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 10
  `);

  console.log('\n📋 Recent users in database:');
  console.table(result.rows.map(r => ({
    id: r.id.slice(0, 8) + '...',
    username: r.username || '(null)',
    short_id: r.short_id || '(null)',
    device_id: r.device_id?.slice(0, 8) + '...' || '(null)',
    created_at: r.created_at
  })));

  await pool.end();
}

main();
