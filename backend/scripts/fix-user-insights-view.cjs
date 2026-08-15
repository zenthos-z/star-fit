/**
 * Fix user_insights VIEW to properly query from users table
 */

// Load environment variables from .env file
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getPostgresClient } = require('../dist/backend/src/db/postgresql/client/postgres-client.js');

async function fixUserInsightsView() {
  const client = getPostgresClient();

  console.log('[Fix] Connecting to PostgreSQL...');
  try {
    await client.connect();
    console.log('[Fix] Connected to PostgreSQL');

    // First drop the broken VIEW
    console.log('[Fix] Dropping broken user_insights VIEW...');
    await client.query('DROP VIEW IF EXISTS user_insights');
    console.log('[Fix] Dropped existing VIEW');

    // Create proper VIEW that extracts profile data from users table
    console.log('[Fix] Creating proper user_insights VIEW...');
    await client.query(`
      CREATE OR REPLACE VIEW user_insights AS
      SELECT
        u.id AS user_id,
        u.created_at,
        u.updated_at,
        -- Core fields from profile data
        COALESCE(u.profile_static->>'fitness_level', 'beginner') AS fitness_level,
        COALESCE(u.profile_static->>'red_flags', '[]') AS red_flags,
        COALESCE(u.profile_static->>'summary', '') AS summary,
        -- Extended JSON fields
        u.profile_static AS basic_info,
        u.profile_dynamic AS preferences,
        COALESCE(u.profile_static->>'physiological', NULL) AS physiological,
        COALESCE(u.profile_static->>'psychological', NULL) AS psychological,
        COALESCE(u.profile_dynamic->>'load_anchors', NULL) AS load_anchors,
        COALESCE(u.profile_dynamic->>'training_strategy', NULL) AS training_strategy,
        -- Metadata
        'system' AS modified_by,
        u.protocol_version AS protocol_version
      FROM users u
    `);
    console.log('[Fix] user_insights VIEW created successfully!');

    // Verify the VIEW works by querying all users
    console.log('[Fix] Checking all users in database...');
    const allUsers = await client.query('SELECT id, profile_static, profile_dynamic FROM users LIMIT 5');
    console.log('[Fix] Total users in database:', allUsers.rows.length);
    allUsers.rows.forEach((user, idx) => {
      console.log(`[Fix] User ${idx + 1}: id=${user.id}`);
    });

    // Now test the user_insights VIEW with first user
    if (allUsers.rows.length > 0) {
      const firstUserId = allUsers.rows[0].id;
      console.log('[Fix] Testing user_insights VIEW for user:', firstUserId);
      const testResult = await client.query(`
        SELECT * FROM user_insights
        WHERE user_id = $userId
      `, { userId: firstUserId });

      console.log('[Fix] VIEW query result:', testResult.rows.length, 'rows');
      if (testResult.rows.length > 0) {
        console.log('[Fix] Sample row:', JSON.stringify(testResult.rows[0], null, 2));
      }
    } else {
      console.log('[Fix] No users found in database. Creating test user...');
      // Create a test user for development
      await client.query(`
        INSERT INTO users (id, device_id, profile_static, profile_dynamic)
        VALUES ($1, $2, $3, $4)
      `, {
        userId: '77b3bb0e-7f0a-4a3b-9b1c-8d2e4f3a5b1',
        deviceId: 'test-device-001',
        profileStatic: JSON.stringify({
          fitness_level: 'beginner',
          red_flags: [],
          summary: 'Test user for development'
        }),
        profileDynamic: JSON.stringify({
          load_anchors: [],
          training_strategy: 'balanced'
        })
      });
      console.log('[Fix] Test user created!');
    }
  } catch (error) {
    console.error('[Fix] Error:', error);
    throw error;
  } finally {
    await client.close();
    console.log('[Fix] Connection closed');
  }
}

fixUserInsightsView().catch(console.error);
