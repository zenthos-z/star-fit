import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit'
});

async function main() {
  // 模拟 getUsers 查询
  const result = await pool.query(`
    SELECT
      ui.user_id::text as id,
      u.username,
      u.short_id,
      ui.created_at,
      COALESCE(s.session_count, 0) as session_count,
      COALESCE(u.username, u.short_id, LEFT(u.id::text, 8)) as display_name
    FROM user_insights ui
    LEFT JOIN users u ON ui.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as session_count
      FROM sessions
      GROUP BY user_id
    ) s ON ui.user_id = s.user_id
    ORDER BY ui.created_at DESC
    LIMIT 5
  `);

  console.log('\n📋 getUsers API 返回的数据:');
  console.table(result.rows.map(r => ({
    id: r.id.slice(0, 8) + '...',
    username: r.username || '(null)',
    short_id: r.short_id || '(null)',
    session_count: r.session_count,
    display_name: r.display_name
  })));

  await pool.end();
}

main();
