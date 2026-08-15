import 'dotenv/config';
import { getPostgresClient } from '../client/postgres-client.js';
import { resetConfigCache } from '../config.js';

resetConfigCache();

async function check() {
  const client = getPostgresClient();

  console.log('=== Current users table data ===');
  const users = await client.query(`
    SELECT id, device_id, display_name, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 3
  `);
  console.table(users.rows);

  console.log('\n=== Current API response (getUsers query) ===');
  const apiResult = await client.query(`
    SELECT
      ui.user_id::text as id,
      ui.device_id,
      NULLIF(ui.display_name, '') as display_name,
      ui.created_at,
      COALESCE(s.session_count, 0) as session_count
    FROM user_insights ui
    LEFT JOIN (
      SELECT user_id, COUNT(*) as session_count
      FROM sessions
      GROUP BY user_id
    ) s ON ui.user_id = s.user_id
    ORDER BY ui.created_at DESC
    LIMIT 3
  `);
  console.table(apiResult.rows);

  process.exit(0);
}

check().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
