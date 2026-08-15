/**
 * Test Database Setup Utilities
 *
 * Provides utilities for setting up and tearing down PostgreSQL test databases,
 * ensuring test isolation and proper cleanup.
 *
 * @version 2.0.0 - PostgreSQL Migration
 * @updated 2026-02-10
 */

import { getPostgresClient } from '../../src/db/postgresql/index.js';
import type { PostgresClient } from '../../src/db/postgresql/index.js';
import {
  createTestUser,
  createLoadAnchor,
  createActiveLimitation,
  TEST_USERS,
  cleanupTestData as cleanupTestDataFactory,
} from './testDataFactory.js';
import type { UserProfileV2 } from '../../../shared/contracts/index.js';
import { UserProfileV2Schema } from '../../../shared/contracts/index.js';

// ============================================================================
// Database Setup
// ============================================================================

/**
 * Setup test database environment
 *
 * Ensures the PostgreSQL database is accessible and ready for testing
 */
export async function setupTestDatabase(): Promise<PostgresClient> {
  try {
    const client = getPostgresClient({ preset: 'test' });
    await client.connect();

    console.log('[TestDatabase] PostgreSQL connection established');

    // Verify connection is working
    const healthCheck = await client.healthCheck();
    if (!healthCheck.connected) {
      throw new Error('PostgreSQL connection test failed');
    }

    console.log('[TestDatabase] PostgreSQL verified and ready');
    return client;
  } catch (error) {
    console.error('[TestDatabase] Failed to setup test database:', error);
    throw error;
  }
}

/**
 * Create a test user in the database
 *
 * @param level - The profile level (beginner, intermediate, advanced)
 * @param userId - Optional custom user ID
 * @returns The created user profile
 */
export async function createTestUserInDatabase(
  level: keyof typeof TEST_USERS = 'intermediate',
  userId?: string
): Promise<UserProfileV2> {
  const client = getPostgresClient({ preset: 'test' });
  const testUser = createTestUser(level, userId);

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
      { operation: 'create_test_user', userId: testUser.user_id }
    );

    console.log(`[TestDatabase] Created test user: ${testUser.user_id} (${level})`);
    return testUser;
  } catch (error) {
    console.error(`[TestDatabase] Failed to create test user:`, error);
    throw error;
  }
}

/**
 * Create multiple test users in the database
 *
 * @param count - Number of users to create
 * @param level - Profile level for all users
 * @returns Array of created user profiles
 */
export async function createTestUsersBatch(
  count: number,
  level: keyof typeof TEST_USERS = 'intermediate'
): Promise<UserProfileV2[]> {
  const users: UserProfileV2[] = [];

  for (let i = 0; i < count; i++) {
    const userId = `test-${level}-${Date.now()}-${i}`;
    const user = await createTestUserInDatabase(level, userId);
    users.push(user);
  }

  console.log(`[TestDatabase] Created batch of ${count} test users (${level})`);
  return users;
}

/**
 * Seed the database with all test user types
 *
 * Creates one of each: beginner, intermediate, advanced
 * @returns Array of all created user profiles
 */
export async function seedAllTestUserTypes(): Promise<UserProfileV2[]> {
  const users: UserProfileV2[] = [];

  for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
    const user = await createTestUserInDatabase(level);
    users.push(user);
  }

  console.log('[TestDatabase] Seeded all test user types');
  return users;
}

// ============================================================================
// Database Cleanup
// ============================================================================

/**
 * Delete a test user from the database
 *
 * @param userId - The user ID to delete
 */
export async function deleteTestUser(userId: string): Promise<void> {
  try {
    const client = getPostgresClient({ preset: 'test' });

    await client.query(
      `DELETE FROM users WHERE id = $userId OR device_id = $userId`,
      { userId },
      { operation: 'delete_test_user', userId }
    );

    console.log(`[TestDatabase] Deleted test user: ${userId}`);
  } catch (error) {
    console.warn(`[TestDatabase] Failed to delete user ${userId}:`, error);
  }
}

/**
 * Clean up all test users from the database
 *
 * Deletes all users with user_id starting with 'test-'
 */
export async function cleanupAllTestUsers(): Promise<void> {
  try {
    const client = getPostgresClient({ preset: 'test' });

    const result = await client.query(
      `DELETE FROM users WHERE device_id LIKE $pattern OR id::text LIKE $pattern`,
      { pattern: 'test-%' },
      { operation: 'cleanup_test_users' }
    );

    console.log(`[TestDatabase] Cleaned up ${result.rowCount} test users`);
  } catch (error) {
    console.error('[TestDatabase] Failed to cleanup test users:', error);
    throw error;
  }
}

/**
 * Clean up specific test users
 *
 * @param userIds - Array of user IDs to delete
 */
export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  try {
    const client = getPostgresClient({ preset: 'test' });

    // Build parameterized query for IN clause
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');

    await client.query(
      `DELETE FROM users WHERE id IN (${placeholders}) OR device_id IN (${placeholders})`,
      [...userIds, ...userIds],
      { operation: 'cleanup_test_users_batch' }
    );

    console.log(`[TestDatabase] Cleaned up ${userIds.length} test users`);
  } catch (error) {
    console.error('[TestDatabase] Failed to cleanup test users:', error);
    throw error;
  }
}

// ============================================================================
// Test Data Verification
// ============================================================================

/**
 * Verify that a test user exists in the database
 *
 * @param userId - The user ID to verify
 * @returns True if the user exists
 */
export async function verifyTestUserExists(userId: string): Promise<boolean> {
  try {
    const client = getPostgresClient({ preset: 'test' });

    const result = await client.queryOne(
      `SELECT id FROM users WHERE id = $userId OR device_id = $userId LIMIT 1`,
      { userId },
      { operation: 'verify_test_user', userId }
    );

    return result !== undefined;
  } catch (error) {
    console.error(`[TestDatabase] Failed to verify user ${userId}:`, error);
    return false;
  }
}

/**
 * Get test user count in database
 *
 * @returns Number of users with device_id starting with 'test-'
 */
export async function getTestUserCount(): Promise<number> {
  try {
    const client = getPostgresClient({ preset: 'test' });

    const result = await client.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE device_id LIKE $pattern OR id::text LIKE $pattern`,
      { pattern: 'test-%' },
      { operation: 'count_test_users' }
    );

    return result ? parseInt(result.count, 10) : 0;
  } catch (error) {
    console.error('[TestDatabase] Failed to get test user count:', error);
    return 0;
  }
}

/**
 * Get a test user's profile from the database
 *
 * @param userId - The user ID to fetch
 * @returns The user profile or null if not found
 */
export async function getTestUserProfile(userId: string): Promise<UserProfileV2 | null> {
  try {
    const client = getPostgresClient({ preset: 'test' });

    const row = await client.queryOne<any>(
      `SELECT id, device_id, profile_static, profile_dynamic, history_summary, protocol_version, created_at, updated_at
       FROM users WHERE id = $userId OR device_id = $userId LIMIT 1`,
      { userId },
      { operation: 'get_test_user_profile', userId }
    );

    if (!row) {
      return null;
    }

    return {
      protocol_version: row.protocol_version || '2.0.0',
      user_id: row.id,
      device_id: row.device_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      profile_static: row.profile_static,
      profile_dynamic: row.profile_dynamic,
      history_summary: row.history_summary,
      tags: [],
      fitness_level: 'beginner',
      red_flags: [],
      training_strategy: null,
    };
  } catch (error) {
    console.error(`[TestDatabase] Failed to get user profile ${userId}:`, error);
    return null;
  }
}

// ============================================================================
// Test Isolation Utilities
// ============================================================================

/**
 * Create an isolated test environment
 *
 * Wraps test execution with proper setup and teardown
 * Usage:
 * ```ts
 * await withTestEnvironment(async (cleanup) => {
 *   const user = await createTestUserInDatabase('intermediate');
 *   cleanup.push(() => deleteTestUser(user.user_id));
 *   // Run test...
 * });
 * ```
 */
export async function withTestEnvironment<T>(
  fn: (cleanup: Array<() => Promise<void>>) => Promise<T>
): Promise<T> {
  const cleanup: Array<() => Promise<void>> = [];

  try {
    // Setup
    await setupTestDatabase();

    // Run test function
    const result = await fn(cleanup);
    return result;
  } finally {
    // Teardown - run all cleanup functions
    for (const fn of cleanup) {
      try {
        await fn();
      } catch (error) {
        console.error('[TestDatabase] Cleanup function failed:', error);
      }
    }
  }
}
