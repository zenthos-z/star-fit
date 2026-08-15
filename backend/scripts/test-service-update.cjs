require('dotenv').config({ path: __dirname + '/../.env' });

async function testServiceUpdate() {
  // Import the compiled service (since it's TypeScript, we need to use the compiled JS or tsx)
  const { getPostgresClient } = require('../dist/db/postgresql/client/postgres-client.js');

  const client = getPostgresClient();

  const userId = '1ffb6e62-4d8c-45dc-b9c5-a0e167c35cad';
  const update = {
    basic_info: { age: 45, weight: 90, training_age: 5 }
  };

  console.log('Testing UserProfileService.updateProfile...');

  // Simulate what the service does
  await client.transaction(async (tx) => {
    // Build the update
    const validated = { basic_info: update.basic_info };
    const values = { userId };
    const setClauses = ['updated_at = NOW()'];

    const staticUpdates = { basic_info: validated.basic_info };
    values.staticUpdates = JSON.stringify(staticUpdates);
    setClauses.push(`profile_static = COALESCE(profile_static, '{}'::jsonb) || $staticUpdates::jsonb`);

    console.log('setClauses:', setClauses);
    console.log('values.staticUpdates:', values.staticUpdates);

    const sql = `
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE id = $userId
    `;
    console.log('SQL:', sql);

    await tx.query(sql, values);
    console.log('Update executed successfully!');
  }, {
    operation: 'testUpdate',
    userId
  });

  // Verify
  const result = await client.queryOne(`
    SELECT id, profile_static FROM users WHERE id = $1
  `, [userId]);

  console.log('Updated profile_static:', JSON.stringify(result.profile_static, null, 2));
}

testServiceUpdate().catch(console.error);
