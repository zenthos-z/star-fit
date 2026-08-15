/**
 * Diagnostic script: Check why user profile loading fails
 *
 * This script checks:
 * 1. Which user_insights view is active
 * 2. Data in users table vs user_insights view
 * 3. Sample profile query results
 */

import 'dotenv/config';
import { getPostgresClient } from '../client/postgres-client.js';
import { resetConfigCache } from '../config.js';

resetConfigCache();

async function diagnose() {
  const client = getPostgresClient();

  console.log('========================================');
  console.log('USER PROFILE LOADING DIAGNOSTIC');
  console.log('========================================\n');

  // 1. Get a sample user
  console.log('=== 1. Sample users from users table ===');
  const users = await client.query(`
    SELECT id, device_id, display_name, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 3
  `);
  console.table(users.rows);

  if (users.rows.length === 0) {
    console.log('No users found. Exiting.');
    process.exit(1);
  }

  const sampleUserId = users.rows[0].id;
  console.log(`\nUsing sample user ID: ${sampleUserId}\n`);

  // 2. Check profile_static JSONB content
  console.log('=== 2. Profile Static Content (users table) ===');
  const profileStatic = await client.query(`
    SELECT
      id,
      profile_static,
      profile_dynamic
    FROM users
    WHERE id = $userId
  `, { userId: sampleUserId });
  console.log('profile_static:', JSON.stringify(profileStatic.rows[0]?.profile_static, null, 2));
  console.log('profile_dynamic:', JSON.stringify(profileStatic.rows[0]?.profile_dynamic, null, 2));

  // 3. Check user_insights view (what getUserProfile queries)
  console.log('\n=== 3. User Insights View (what getUserProfile reads) ===');
  const insightsView = await client.query(`
    SELECT * FROM user_insights WHERE user_id = $userId
  `, { userId: sampleUserId });

  if (insightsView.rows.length === 0) {
    console.log('❌ NO ROWS FOUND in user_insights view for this user!');
    console.log('This is why profile loading fails - the view returns no data.');
  } else {
    console.log('✅ Found data in user_insights view:');
    console.table(insightsView.rows);
  }

  // 4. Check if old user_insights table exists
  console.log('\n=== 4. Check for legacy user_insights table ===');
  try {
    const legacyTable = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'current_schema()
        AND table_name = 'user_insights'
      )
    `);
    console.log('Legacy user_insights table exists:', legacyTable.rows[0].exists);

    if (legacyTable.rows[0].exists) {
      const legacyData = await client.query(`
        SELECT * FROM user_insights WHERE user_id = $userId
      `, { userId: sampleUserId });
      console.log('Legacy table has', legacyData.rows.length, 'rows for this user');
      if (legacyData.rows.length > 0) {
        console.table(legacyData.rows);
      }
    }
  } catch (e) {
    console.log('❌ Error checking for legacy table:', (e as Error).message);
  }

  // 5. Check view definition
  console.log('\n=== 5. Current user_insights view definition ===');
  const viewDef = await client.query(`
    SELECT pg_get_viewdef('user_insights', true) as view_definition
  `);
  console.log(viewDef.rows[0]?.view_definition);

  // 6. Test the actual query that UserProfileService.getProfile uses
  console.log('\n=== 6. Test UserProfileService.getProfile query ===');
  try {
    const profileQuery = await client.query(`
      SELECT * FROM user_insights WHERE user_id = $userId
    `, { userId: sampleUserId });

    if (profileQuery.rows.length === 0) {
      console.log('❌ Query returns NO ROWS - profile will be null');
    } else {
      console.log('✅ Query returns data. Sample fields:');
      console.log('  fitness_level:', profileQuery.rows[0].fitness_level);
      console.log('  red_flags:', profileQuery.rows[0].red_flags);
      console.log('  basic_info:', profileQuery.rows[0].basic_info);
      console.log('  load_anchors:', profileQuery.rows[0].load_anchors);
    }
  } catch (e) {
    console.log('❌ Query error:', (e as Error).message);
  }

  process.exit(0);
}

diagnose().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
