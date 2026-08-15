import 'dotenv/config';
import { getPostgresClient } from '../client/postgres-client.js';
import { resetConfigCache } from '../config.js';

resetConfigCache();

async function checkUsers() {
  const client = getPostgresClient();

  console.log('=== 1. Check users table columns ===');
  const columns = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'users'
    AND column_name IN ('id', 'device_id', 'display_name')
    ORDER BY ordinal_position
  `);
  console.table(columns.rows);

  console.log('\n=== 2. Sample data from users table ===');
  const users = await client.query(`
    SELECT id, device_id, display_name, created_at
    FROM users
    LIMIT 3
  `);
  console.table(users.rows);

  console.log('\n=== 3. Sample data from user_insights view ===');
  const insights = await client.query(`
    SELECT user_id, device_id, display_name, created_at
    FROM user_insights
    LIMIT 3
  `);
  console.table(insights.rows);

  console.log('\n=== 4. Current API query result ===');
  const apiResult = await client.query(`
    SELECT
      ui.user_id::text as id,
      ui.device_id,
      COALESCE(NULLIF(ui.display_name, ''), ui.device_id, substring(ui.user_id::text, 1, 8)) as display_name,
      ui.created_at
    FROM user_insights ui
    ORDER BY ui.created_at DESC
    LIMIT 3
  `);
  console.table(apiResult.rows);

  process.exit(0);
}

checkUsers().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
