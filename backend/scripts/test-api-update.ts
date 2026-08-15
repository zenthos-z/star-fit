// Direct test of the update flow by importing the controller function
import 'dotenv/config';

async function testDirect() {
  const userId = '1ffb6e62-4d8c-45dc-b9c5-a0e167c35cad';
  const updates = {
    basic_info: { age: 200, weight: 300 }
  };

  console.log('=== Testing direct import of UserProfileService ===');

  // Import the service
  const { UserProfileService } = await import('../src/services/userProfileService.postgres.js');

  console.log('Calling updateProfile with:', { userId, updates });

  await UserProfileService.updateProfile(userId, {
    basic_info: updates.basic_info,
    modifiedBy: 'admin',
    changeReason: 'Direct test'
  });

  console.log('updateProfile completed!');

  // Verify
  const { getPostgresClient } = await import('../src/db/postgresql/client/postgres-client.js');
  const client = getPostgresClient();

  const result = await client.queryOne(
    `SELECT profile_static FROM users WHERE id = $userId`,
    { userId }
  );

  console.log('After update, profile_static.basic_info:', result?.profile_static?.basic_info);

  process.exit(0);
}

testDirect().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
