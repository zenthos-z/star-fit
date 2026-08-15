// Test script that directly imports and tests UserProfileService
import 'dotenv/config';
import { getPostgresClient } from '../src/db/postgresql/client/postgres-client.js';

async function testUpdate() {
  const client = getPostgresClient();

  const userId = '1ffb6e62-4d8c-45dc-b9c5-a0e167c35cad';
  const update = {
    basic_info: { age: 77, weight: 99 },
    modifiedBy: 'admin' as const,
    changeReason: 'Direct test'
  };

  console.log('=== Before Update ===');
  const before = await client.queryOne(`SELECT profile_static FROM users WHERE id = $userId`, { userId });
  console.log('profile_static.basic_info:', before?.profile_static?.basic_info);

  console.log('\n=== Executing Update ===');

  // Simulate exactly what UserProfileService.updateProfile does
  await client.transaction(async (tx) => {
    // Validation (simplified)
    const validated = {
      basic_info: update.basic_info,
      modifiedBy: update.modifiedBy
    };

    const values: Record<string, any> = { userId };
    const setClauses: string[] = ['updated_at = NOW()'];

    const staticUpdates: Record<string, any> = {};
    if (validated.basic_info !== undefined) {
      staticUpdates.basic_info = validated.basic_info;
    }

    if (Object.keys(staticUpdates).length > 0) {
      values.staticUpdates = JSON.stringify(staticUpdates);
      setClauses.push(`profile_static = COALESCE(profile_static, '{}'::jsonb) || $staticUpdates::jsonb`);
      console.log('staticUpdates:', values.staticUpdates);
    }

    console.log('setClauses:', setClauses);
    console.log('setClauses.length:', setClauses.length);

    if (setClauses.length === 1) {
      console.log('ERROR: Only updated_at in setClauses, no data to update!');
      return;
    }

    const sql = `
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE id = $userId
    `;
    console.log('SQL:', sql);
    console.log('Values keys:', Object.keys(values));

    const result = await tx.query(sql, values);
    console.log('Update result rowCount:', result.rowCount);
  }, {
    operation: 'testUpdate',
    userId
  });

  console.log('\n=== After Update ===');
  const after = await client.queryOne(`SELECT profile_static FROM users WHERE id = $userId`, { userId });
  console.log('profile_static.basic_info:', after?.profile_static?.basic_info);

  process.exit(0);
}

testUpdate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
