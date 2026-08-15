#!/usr/bin/env tsx
/**
 * Manual Test Data Seeding Script
 *
 * This script seeds the PostgreSQL database with test data for admin console testing.
 * It creates users with different profile levels (beginner, intermediate, advanced)
 * and can be run manually to populate the test database.
 *
 * Usage:
 *   npx tsx tests/manual/seedTestData.ts
 *   npx tsx tests/manual/seedTestData.ts --level intermediate
 *   npx tsx tests/manual/seedTestData.ts --count 5
 *   npx tsx tests/manual/seedTestData.ts --cleanup
 *
 * @version 1.0.0
 * @created 2026-02-10
 */

import { getPostgresClient } from '../../src/db/postgresql/index.js';
import {
  createTestUser,
  createTestUserBatch,
  createLoadAnchor,
  createActiveLimitation,
  createMixedLoadAnchors,
  cleanupTestData,
  EXERCISE_TYPE_FIELDS,
  BODY_PARTS,
  NEURO_TYPES,
  RISK_PREFERENCES,
  ACCOUNTABILITY_OPTIONS,
} from '../helpers/testDataFactory.js';
import type { UserProfileV2 } from '../../../shared/contracts/index.js';

// ============================================================================
// CLI Arguments
// ============================================================================

interface Args {
  level: 'beginner' | 'intermediate' | 'advanced' | 'all';
  count: number;
  cleanup: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    level: 'all',
    count: 1,
    cleanup: false,
    dryRun: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--cleanup') {
      result.cleanup = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg.startsWith('--level=')) {
      const level = arg.split('=')[1];
      if (['beginner', 'intermediate', 'advanced', 'all'].includes(level)) {
        result.level = level as any;
      }
    } else if (arg.startsWith('--count=')) {
      const count = parseInt(arg.split('=')[1]);
      if (!isNaN(count) && count > 0) {
        result.count = count;
      }
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
Test Data Seeding Script

Usage:
  npx tsx tests/manual/seedTestData.ts [options]

Options:
  --help, -h              Show this help message
  --level=<level>         Create users of specific level (beginner|intermediate|advanced|all)
                          Default: all
  --count=<n>             Number of users to create per level
                          Default: 1
  --cleanup               Clean up existing test data before seeding
  --dry-run               Show what would be created without actually creating it

Examples:
  npx tsx tests/manual/seedTestData.ts
  npx tsx tests/manual/seedTestData.ts --level intermediate --count 5
  npx tsx tests/manual/seedTestData.ts --cleanup --level advanced
  npx tsx tests/manual/seedTestData.ts --dry-run --count 10

Test User Levels:
  - beginner: Empty profile with minimal data
  - intermediate: Has load anchors, no limitations
  - advanced: Has load anchors, active limitations, permanent injuries
`);
}

// ============================================================================
// Seeding Functions
// ============================================================================

/**
 * Create a single test user in the database
 */
async function seedTestUser(
  level: 'beginner' | 'intermediate' | 'advanced',
  dryRun: boolean = false
): Promise<UserProfileV2 | null> {
  const testUser = createTestUser(level);
  const client = getPostgresClient({ preset: 'test' });

  if (dryRun) {
    console.log(`[Dry Run] Would create user:`);
    console.log(`  ID: ${testUser.user_id}`);
    console.log(`  Level: ${level}`);
    console.log(`  Profile:`, JSON.stringify(testUser, null, 2));
    return testUser;
  }

  try {
    await client.query(
      `INSERT INTO users (id, device_id, profile_static, profile_dynamic, history_summary, protocol_version)
       VALUES ($userId, $deviceId, $profileStatic, $profileDynamic, $historySummary, $protocolVersion)
       ON CONFLICT (id) DO UPDATE SET
         profile_static = EXCLUDED.profile_static,
         profile_dynamic = EXCLUDED.profile_dynamic,
         history_summary = EXCLUDED.history_summary,
         updated_at = NOW()`,
      {
        userId: testUser.user_id,
        deviceId: testUser.user_id,
        profileStatic: JSON.stringify(testUser.profile_static || {}),
        profileDynamic: JSON.stringify(testUser.profile_dynamic || {}),
        historySummary: JSON.stringify(testUser.history_summary || {}),
        protocolVersion: testUser.protocol_version,
      },
      { operation: 'seed_test_user', userId: testUser.user_id }
    );

    console.log(`[Seeded] User: ${testUser.user_id} (${level})`);
    return testUser;
  } catch (error) {
    console.error(`[Failed] Could not create user ${testUser.user_id}:`, error);
    return null;
  }
}

/**
 * Seed multiple test users
 */
async function seedTestUsers(
  level: 'beginner' | 'intermediate' | 'advanced',
  count: number,
  dryRun: boolean = false
): Promise<(UserProfileV2 | null)[]> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Seeding ${count} ${level} test user(s)`);
  console.log(`${'='.repeat(60)}\n`);

  const users: (UserProfileV2 | null)[] = [];

  for (let i = 0; i < count; i++) {
    const user = await seedTestUser(level, dryRun);
    if (user) {
      users.push(user);
    }

    // Small delay between creations
    if (i < count - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return users;
}

/**
 * Seed all test user types
 */
async function seedAllTestUserTypes(
  countPerLevel: number = 1,
  dryRun: boolean = false
): Promise<Map<string, UserProfileV2[]>> {
  const results = new Map<string, UserProfileV2[]>();
  const levels: Array<'beginner' | 'intermediate' | 'advanced'> = ['beginner', 'intermediate', 'advanced'];

  for (const level of levels) {
    const users = await seedTestUsers(level, countPerLevel, dryRun);
    results.set(level, users.filter((u): u is UserProfileV2 => u !== null));
  }

  return results;
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/**
 * Clean up all test data
 */
async function cleanupAllTestData(dryRun: boolean = false): Promise<void> {
  const client = getPostgresClient({ preset: 'test' });

  if (dryRun) {
    console.log('[Dry Run] Would delete all users with device_id starting with "test-"');
    return;
  }

  try {
    const result = await client.query(
      `DELETE FROM users WHERE device_id LIKE $pattern OR id::text LIKE $pattern`,
      { pattern: 'test-%' },
      { operation: 'cleanup_test_data' }
    );

    console.log(`[Cleaned] Removed ${result.rowCount} test user(s)`);
  } catch (error) {
    console.error('[Failed] Could not cleanup test data:', error);
  }
}

// ============================================================================
// Verification Functions
// ============================================================================

/**
 * Verify seeded test data
 */
async function verifySeededData(): Promise<void> {
  const client = getPostgresClient({ preset: 'test' });

  try {
    const result = await client.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE device_id LIKE $pattern OR id::text LIKE $pattern`,
      { pattern: 'test-%' },
      { operation: 'verify_test_data' }
    );

    const count = result ? parseInt(result.count, 10) : 0;
    console.log(`\n[Verification] Total test users in database: ${count}`);

    // Get breakdown by level
    const levels = ['beginner', 'intermediate', 'advanced'];
    for (const level of levels) {
      const levelResult = await client.queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM users
         WHERE (device_id LIKE $pattern OR id::text LIKE $pattern)
         AND device_id LIKE $levelPattern`,
        { pattern: 'test-%', levelPattern: `test-${level}-%` },
        { operation: 'verify_test_data_by_level' }
      );

      const levelCount = levelResult ? parseInt(levelResult.count, 10) : 0;
      console.log(`  - ${level}: ${levelCount}`);
    }
  } catch (error) {
    console.error('[Failed] Could not verify test data:', error);
  }
}

// ============================================================================
// Summary Report
// ============================================================================

function printSummary(results: Map<string, UserProfileV2[]>, dryRun: boolean): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Seeding Summary${dryRun ? ' (Dry Run)' : ''}`);
  console.log(`${'='.repeat(60)}\n`);

  let totalUsers = 0;
  for (const [level, users] of results.entries()) {
    const count = users.length;
    totalUsers += count;
    console.log(`${level.toUpperCase()}: ${count} user(s)`);
    for (const user of users) {
      console.log(`  - ${user.user_id}`);
      const anchorCount = Object.keys(user.profile_dynamic?.load_anchors || {}).length;
      const limitationCount = user.profile_dynamic?.active_limitations?.length || 0;
      console.log(`    Load Anchors: ${anchorCount}, Limitations: ${limitationCount}`);
    }
    console.log('');
  }

  console.log(`Total: ${totalUsers} user(s) created`);
  console.log(`${'='.repeat(60)}\n`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  console.log('\n🌱 Starfit Test Data Seeding Script');
  console.log('='.repeat(60));
  console.log(`Level: ${args.level}`);
  console.log(`Count per level: ${args.count}`);
  console.log(`Cleanup before seeding: ${args.cleanup}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log('='.repeat(60));

  try {
    // Only connect to database if not in dry-run mode
    if (!args.dryRun) {
      const client = getPostgresClient({ preset: 'test' });
      await client.connect();
      console.log('✓ Connected to PostgreSQL\n');
    }

    // Cleanup if requested
    if (args.cleanup) {
      console.log('🧹 Cleaning up existing test data...\n');
      await cleanupAllTestData(args.dryRun);
      console.log('');
    }

    // Seed test data
    let results: Map<string, UserProfileV2[]>;

    if (args.level === 'all') {
      results = await seedAllTestUserTypes(args.count, args.dryRun);
    } else {
      const users = await seedTestUsers(args.level, args.count, args.dryRun);
      results = new Map([[args.level, users.filter((u): u is UserProfileV2 => u !== null)]]);
    }

    // Print summary
    printSummary(results, args.dryRun);

    // Verify if not dry run
    if (!args.dryRun) {
      console.log('🔍 Verifying seeded data...\n');
      await verifySeededData();
    }

    console.log('\n✅ Seeding complete!\n');
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
