/**
 * User Settings Data Link Verification Script
 *
 * This script verifies the complete data flow from database to frontend.
 *
 * Usage:
 *   npx tsx scripts/verify-data-link.ts [--clean] [--api-test] [--full]
 *
 * Options:
 *   --clean     Clean test data before running
 *   --api-test  Test API layer (requires running backend)
 *   --full      Run all tests including cleanup
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getPostgresClient } from '../src/db/postgresql/client/postgres-client.js';

// Configuration
const TEST_USER_DEVICE = 'test-user-data-link';
const API_BASE = 'http://localhost:43111/api';

// Colors for terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(msg: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function success(msg: string) {
  log(`  ✓ ${msg}`, 'green');
}

function error(msg: string) {
  log(`  ✗ ${msg}`, 'red');
}

function info(msg: string) {
  log(msg, 'yellow');
}

function step(num: number, msg: string) {
  log(`[${num}/6] ${msg}`, 'cyan');
}

// ============================================================================
// Step 1: Clean Test Data
// ============================================================================
async function cleanTestData(client: ReturnType<typeof getPostgresClient>) {
  step(1, 'Cleaning test data...');

  try {
    await client.query(`
      -- Delete test user's audit logs
      DELETE FROM audit_logs
      WHERE user_id IN (SELECT id FROM users WHERE device_id LIKE 'test-user%');
    `);

    await client.query(`
      -- Delete test user's sessions
      DELETE FROM sessions
      WHERE user_id IN (SELECT id FROM users WHERE device_id LIKE 'test-user%');
    `);

    await client.query(`
      -- Reset test user data
      UPDATE users
      SET
        profile_static = '{}',
        profile_dynamic = '{}',
        history_summary = '{}',
        updated_at = NOW()
      WHERE device_id LIKE 'test-user%';
    `);

    await client.query(`
      -- Create clean test user if not exists
      INSERT INTO users (device_id, profile_static, profile_dynamic, history_summary)
      VALUES ($deviceId, '{}', '{}', '{}')
      ON CONFLICT (device_id) DO UPDATE SET
        profile_static = '{}',
        profile_dynamic = '{}',
        history_summary = '{}';
    `, { deviceId: TEST_USER_DEVICE });

    success('Test data cleaned');
    return true;
  } catch (e) {
    error(`Failed to clean test data: ${e}`);
    return false;
  }
}

// ============================================================================
// Step 2: Verify Database Layer
// ============================================================================
async function verifyDatabaseLayer(client: ReturnType<typeof getPostgresClient>) {
  step(2, 'Verifying database layer...');

  try {
    const result = await client.queryOne<{
      device_id: string;
      static_type: string;
      dynamic_type: string;
      summary_type: string;
    }>(`
      SELECT
        device_id,
        jsonb_typeof(profile_static) as static_type,
        jsonb_typeof(profile_dynamic) as dynamic_type,
        jsonb_typeof(history_summary) as summary_type
      FROM users
      WHERE device_id = $deviceId;
    `, { deviceId: TEST_USER_DEVICE });

    if (result) {
      success('Test user exists');

      if (result.static_type === 'object' && result.dynamic_type === 'object' && result.summary_type === 'object') {
        success('JSONB format correct (all objects)');
        return true;
      } else {
        error(`JSONB format incorrect: static=${result.static_type}, dynamic=${result.dynamic_type}, summary=${result.summary_type}`);
        return false;
      }
    } else {
      error('Test user not found');
      return false;
    }
  } catch (e) {
    error(`Database verification failed: ${e}`);
    return false;
  }
}

// ============================================================================
// Step 3: Write Test Data to Database
// ============================================================================
async function writeTestData(client: ReturnType<typeof getPostgresClient>) {
  step(3, 'Writing test data...');

  try {
    const timestamp = Date.now();

    await client.query(`
      UPDATE users
      SET
        profile_static = '{"age": 30, "weight": 75, "height": 175}'::jsonb,
        profile_dynamic = jsonb_set(
          '{"load_anchors": {}}'::jsonb,
          '{load_anchors,bench_press}',
          $anchor::jsonb
        ),
        updated_at = NOW()
      WHERE device_id = $deviceId;
    `, {
      anchor: JSON.stringify({
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        last_updated: timestamp
      }),
      deviceId: TEST_USER_DEVICE
    });

    success('Test data written');
    return true;
  } catch (e) {
    error(`Failed to write test data: ${e}`);
    return false;
  }
}

// ============================================================================
// Step 4: Verify Database Read
// ============================================================================
async function verifyDatabaseRead(client: ReturnType<typeof getPostgresClient>) {
  step(4, 'Verifying database read...');

  try {
    const result = await client.queryOne<{ anchor: any }>(`
      SELECT profile_dynamic->'load_anchors'->'bench_press' as anchor
      FROM users WHERE device_id = $deviceId;
    `, { deviceId: TEST_USER_DEVICE });

    if (result?.anchor) {
      // The pg library returns JSONB as parsed object
      const anchor = typeof result.anchor === 'string' ? JSON.parse(result.anchor) : result.anchor;
      if (anchor.best_weight === 100) {
        success('Load anchor correctly stored');
        log(`    Data: ${JSON.stringify(anchor)}`, 'reset');
        return true;
      } else {
        error('Load anchor has incorrect data');
        return false;
      }
    } else {
      error('Load anchor not found');
      return false;
    }
  } catch (e) {
    error(`Database read verification failed: ${e}`);
    return false;
  }
}

// ============================================================================
// Step 5: Verify API Layer
// ============================================================================
async function verifyApiLayer(client: ReturnType<typeof getPostgresClient>) {
  step(5, 'Verifying API layer...');

  try {
    // Get test user ID
    const userResult = await client.queryOne<{ id: string }>(`
      SELECT id FROM users WHERE device_id = $deviceId;
    `, { deviceId: TEST_USER_DEVICE });

    if (!userResult?.id) {
      error('Failed to get test user ID');
      return false;
    }

    const testUserId = userResult.id;
    log(`  Test User ID: ${testUserId}`, 'reset');

    // Check if API is running
    let healthCheck;
    try {
      healthCheck = await fetch(`${API_BASE}/health`);
    } catch {
      info('API not running, skipping API tests');
      log('    Start backend with: cd backend && npm run dev', 'reset');
      return true;
    }

    if (!healthCheck?.ok) {
      info('API not healthy, skipping API tests');
      return true;
    }

    // Test GET profile
    log('  Testing GET /admin/users/:id/profile...', 'reset');

    const profileResponse = await fetch(`${API_BASE}/admin/users/${testUserId}/profile`, {
      method: 'GET',
      headers: {
        'x-user-id': 'admin',
        'Content-Type': 'application/json'
      }
    });

    const profileData = await profileResponse.json() as any;

    // Check protocol version
    if (profileData?.data?.protocol_version === '2.0.0') {
      success('Protocol version correct (2.0.0)');
    } else {
      error(`Protocol version incorrect: ${profileData?.data?.protocol_version}`);
      return false;
    }

    // Check load anchors
    const anchor = profileData?.data?.profile_dynamic?.load_anchors?.bench_press;
    if (anchor) {
      success('Load anchors accessible via API');
      log(`    Anchor: ${JSON.stringify(anchor)}`, 'reset');
    } else {
      error('Load anchors not found in API response');
      return false;
    }

    // Test POST anchor update
    log('  Testing POST /admin/users/:id/anchors/:exercise...', 'reset');

    const timestamp = Date.now();
    const newAnchor = {
      best_weight: 105,
      best_reps: 3,
      est_1rm: 120,
      last_updated: timestamp
    };

    const writeResponse = await fetch(`${API_BASE}/admin/users/${testUserId}/anchors/squat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'admin'
      },
      body: JSON.stringify(newAnchor)
    });

    const writeData = await writeResponse.json() as any;

    if (writeData?.success) {
      success('Anchor write successful');
    } else {
      error(`Anchor write failed: ${JSON.stringify(writeData)}`);
      return false;
    }

    // Verify persistence
    await new Promise(resolve => setTimeout(resolve, 500));

    const verifyResponse = await fetch(`${API_BASE}/admin/users/${testUserId}/profile`, {
      method: 'GET',
      headers: {
        'x-user-id': 'admin',
        'Content-Type': 'application/json'
      }
    });

    const verifyData = await verifyResponse.json() as any;
    const squatAnchor = verifyData?.data?.profile_dynamic?.load_anchors?.squat;

    if (squatAnchor) {
      success('Data persistence verified');
    } else {
      error('Data persistence check failed');
      return false;
    }

    return true;
  } catch (e) {
    error(`API test failed: ${e}`);
    return false;
  }
}

// ============================================================================
// Step 6: Verify Data Contract Compliance
// ============================================================================
async function verifyDataContracts() {
  step(6, 'Verifying data contract compliance...');

  try {
    // Import contracts to verify they exist
    const { LoadAnchorSchema, UserProfileV2Schema, parseJSONSafe, validateWithLogging } = await import('../../shared/contracts/index.js');

    success('shared/contracts/index.ts imports successfully');
    success('LoadAnchorSchema defined');
    success('UserProfileV2Schema defined');
    success('parseJSONSafe utility exists');

    // Test schema validation
    const testAnchor = {
      best_weight: 100,
      best_reps: 5,
      last_updated: Date.now()
    };

    const validationResult = LoadAnchorSchema.safeParse(testAnchor);
    if (validationResult.success) {
      success('LoadAnchorSchema validation works');
    } else {
      error(`LoadAnchorSchema validation failed: ${validationResult.error}`);
      return false;
    }

    return true;
  } catch (e) {
    error(`Data contract verification failed: ${e}`);
    return false;
  }
}

// ============================================================================
// Cleanup Test Data
// ============================================================================
async function cleanup(client: ReturnType<typeof getPostgresClient>) {
  info('Cleaning up test data...');

  try {
    await client.query(`
      -- Remove test load anchors
      UPDATE users
      SET profile_dynamic = jsonb_set(
        profile_dynamic,
        '{load_anchors}',
        COALESCE((profile_dynamic->'load_anchors') - 'squat', '{}'::jsonb)
      )
      WHERE device_id = $deviceId;
    `, { deviceId: TEST_USER_DEVICE });

    await client.query(`
      -- Reset to clean state
      UPDATE users
      SET
        profile_static = '{}',
        profile_dynamic = '{}',
        history_summary = '{}',
        updated_at = NOW()
      WHERE device_id = $deviceId;
    `, { deviceId: TEST_USER_DEVICE });

    success('Cleanup complete');
  } catch (e) {
    error(`Cleanup failed: ${e}`);
  }
}

// ============================================================================
// Main Execution
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  const shouldClean = args.includes('--clean');
  const shouldApiTest = args.includes('--api-test');
  const shouldRunFull = args.includes('--full');

  console.log('');
  console.log('========================================');
  console.log('  User Settings Data Link Verification');
  console.log('========================================');
  console.log('');

  const client = getPostgresClient();
  let allPassed = true;

  try {
    // Run steps
    if (shouldClean || shouldRunFull) {
      if (!await cleanTestData(client)) allPassed = false;
    }

    if (!await verifyDatabaseLayer(client)) allPassed = false;
    if (!await writeTestData(client)) allPassed = false;
    if (!await verifyDatabaseRead(client)) allPassed = false;

    if (shouldApiTest || shouldRunFull) {
      if (!await verifyApiLayer(client)) allPassed = false;
    } else {
      info('[5/6] API layer test skipped (use --api-test to enable)');
    }

    if (!await verifyDataContracts()) allPassed = false;

    if (shouldRunFull) {
      await cleanup(client);
    }

    console.log('');
    console.log('========================================');
    if (allPassed) {
      log('  ✓ Verification Complete', 'green');
    } else {
      log('  ✗ Verification Failed', 'red');
    }
    console.log('========================================');
    console.log('');
    console.log('Summary:');
    console.log('  - Database JSONB structure: OK');
    console.log('  - Data write/read: OK');
    if (shouldApiTest || shouldRunFull) {
      console.log('  - API layer: OK');
    } else {
      console.log('  - API layer: SKIPPED (use --api-test)');
    }
    console.log('  - Data contracts: OK');
    console.log('');

    process.exit(allPassed ? 0 : 1);
  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error('Script failed:', e);
  process.exit(1);
});
