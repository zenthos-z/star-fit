import { getPostgresClient } from './src/db/postgresql/index.js';

async function clearUserData() {
  const db = await getPostgresClient();

  // 清空 profile_static
  await db.query(`
    UPDATE users
    SET profile_static = '{}'::jsonb
    WHERE id = '175ce183-754e-474a-b0e4-58834ed228ba'
  `);
  console.log('✓ User profile_static cleared');

  // 验证结果
  const result = await db.query(`
    SELECT profile_static FROM users WHERE id = '175ce183-754e-474a-b0e4-58834ed228ba'
  `);
  console.log('Verification - profile_static:', result.rows[0].profile_static);

  process.exit(0);
}

clearUserData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
