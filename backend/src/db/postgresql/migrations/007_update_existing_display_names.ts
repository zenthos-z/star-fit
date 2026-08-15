/**
 * Migration: Update existing users' display_name from device_id
 * For users who haven't set a display_name yet, use their device_id
 */

import 'dotenv/config';
import { getPostgresClient } from '../client/postgres-client.js';
import { resetConfigCache } from '../config.js';

resetConfigCache();

async function migrate() {
  const client = getPostgresClient();

  console.log('[Migration] Updating existing users display_name...\n');

  try {
    // Update users where display_name is null and device_id is not null
    const result = await client.query(`
      UPDATE users
      SET display_name = device_id,
          updated_at = NOW()
      WHERE display_name IS NULL
        AND device_id IS NOT NULL
      RETURNING id, device_id, display_name
    `);

    console.log(`[Migration] ✓ Updated ${result.rows.length} users`);

    if (result.rows.length > 0) {
      console.log('\n[Migration] Sample updated users:');
      console.table(result.rows.slice(0, 5));
    }

    console.log('\n[Migration] ✓ Completed successfully!\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n[Migration] ✗ Failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

migrate();
