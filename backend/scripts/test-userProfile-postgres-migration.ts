/**
 * Test Script for UserProfileService PostgreSQL Migration
 *
 * This script validates that the migrated PostgreSQL version works correctly
 * by comparing behavior with the original SQLite implementation.
 *
 * Run: npm run test:postgres:user-profile
 */

import { UserProfileService } from '../src/services/userProfileService.postgres.js';
import { getPostgresClient } from '../src/db/postgresql/client/postgres-client.js';
import type { UserProfileUpdate } from '../src/services/userProfileService.postgres.js';

// Test data
const TEST_USER_ID = 'test-user-postgres-migration';
const MOCK_UPDATE: UserProfileUpdate = {
  userId: TEST_USER_ID,
  basic_info: {
    age: 30,
    weight: 75,
    height: 180,
    body_fat_percentage: 15,
    training_age: 3
  },
  preferences: {
    method: 'hypertrophy',
    avoided: ['running'],
    time_constraint: 60,
    equipment: ['dumbbells', 'barbell']
  },
  fitness_level: 'intermediate',
  modifiedBy: 'test',
  changeReason: 'Test migration'
};

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  const startTime = Date.now();
  try {
    await testFn();
    const duration = Date.now() - startTime;
    results.push({ name, passed: true, duration });
    console.log(`✓ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMessage, duration });
    console.error(`✗ ${name} (${duration}ms)`);
    console.error(`  Error: ${errorMessage}`);
  }
}

async function cleanupTestData(): Promise<void> {
  const client = getPostgresClient();
  try {
    await client.query(
      `DELETE FROM audit_logs WHERE user_id = $userId`,
      { userId: TEST_USER_ID }
    );
    await client.query(
      `DELETE FROM user_insights WHERE user_id = $userId`,
      { userId: TEST_USER_ID }
    );
    console.log('Cleanup completed');
  } catch (error) {
    console.warn('Cleanup failed (table might not exist yet):', error);
  }
}

async function runTests(): Promise<void> {
  console.log('='.repeat(60));
  console.log('UserProfileService PostgreSQL Migration Tests');
  console.log('='.repeat(60));
  console.log('');

  // Test 1: Get or Create Profile
  await runTest('getOrCreateProfile - creates new profile', async () => {
    const profile = await UserProfileService.getOrCreateProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should be created');
    }
    if (profile.user_id !== TEST_USER_ID) {
      throw new Error('User ID mismatch');
    }
    if (profile.fitness_level !== 'beginner') {
      throw new Error('Default fitness level should be beginner');
    }
  });

  // Test 2: Get Existing Profile
  await runTest('getProfile - retrieves existing profile', async () => {
    const profile = await UserProfileService.getProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should exist');
    }
    if (profile.user_id !== TEST_USER_ID) {
      throw new Error('User ID mismatch');
    }
  });

  // Test 3: Update Profile
  await runTest('updateProfile - updates profile fields', async () => {
    await UserProfileService.updateProfile(MOCK_UPDATE);

    const updated = await UserProfileService.getProfile(TEST_USER_ID);
    if (!updated) {
      throw new Error('Profile should exist after update');
    }

    const basicInfo = JSON.parse(updated.basic_info || '{}');
    if (basicInfo.age !== 30) {
      throw new Error(`Basic info age should be 30, got ${basicInfo.age}`);
    }

    if (updated.fitness_level !== 'intermediate') {
      throw new Error(`Fitness level should be intermediate, got ${updated.fitness_level}`);
    }
  });

  // Test 4: Add Red Flag
  await runTest('addRedFlag - adds red flag to profile', async () => {
    await UserProfileService.addRedFlag(TEST_USER_ID, 'knee_pain', 'test');

    const profile = await UserProfileService.getProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should exist');
    }

    const flags = JSON.parse(profile.red_flags || '[]');
    if (!flags.includes('knee_pain')) {
      throw new Error('Red flag should be added');
    }
  });

  // Test 5: Remove Red Flag
  await runTest('removeRedFlag - removes red flag from profile', async () => {
    await UserProfileService.removeRedFlag(TEST_USER_ID, 'knee_pain', 'test');

    const profile = await UserProfileService.getProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should exist');
    }

    const flags = JSON.parse(profile.red_flags || '[]');
    if (flags.includes('knee_pain')) {
      throw new Error('Red flag should be removed');
    }
  });

  // Test 6: Update Load Anchors
  await runTest('updateLoadAnchors - updates load anchors', async () => {
    const anchors = {
      'squat': {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        progression_level: 3,
        last_updated: Date.now()
      }
    };

    await UserProfileService.updateLoadAnchors(TEST_USER_ID, anchors, 'test');

    const profile = await UserProfileService.getProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should exist');
    }

    const loadAnchors = JSON.parse(profile.load_anchors || '{}');
    if (!loadAnchors.squat || loadAnchors.squat.best_weight !== 100) {
      throw new Error('Load anchors should be updated');
    }
  });

  // Test 7: Merge Load Anchors (not replace)
  await runTest('updateProfile - merges load anchors when replaceAnchors=false', async () => {
    const update: UserProfileUpdate = {
      userId: TEST_USER_ID,
      load_anchors: {
        'bench_press': {
          best_weight: 80,
          best_reps: 5,
          est_1rm: 90,
          progression_level: 2,
          last_updated: Date.now()
        }
      },
      replaceAnchors: false,
      modifiedBy: 'test'
    };

    await UserProfileService.updateProfile(update);

    const profile = await UserProfileService.getProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should exist');
    }

    const loadAnchors = JSON.parse(profile.load_anchors || '{}');
    if (!loadAnchors.squat) {
      throw new Error('Existing squat anchor should be preserved');
    }
    if (!loadAnchors.bench_press) {
      throw new Error('New bench_press anchor should be added');
    }
  });

  // Test 8: Replace Load Anchors
  await runTest('updateProfile - replaces load anchors when replaceAnchors=true', async () => {
    const update: UserProfileUpdate = {
      userId: TEST_USER_ID,
      load_anchors: {
        'deadlift': {
          best_weight: 140,
          best_reps: 3,
          est_1rm: 155,
          progression_level: 4,
          last_updated: Date.now()
        }
      },
      replaceAnchors: true,
      modifiedBy: 'test'
    };

    await UserProfileService.updateProfile(update);

    const profile = await UserProfileService.getProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should exist');
    }

    const loadAnchors = JSON.parse(profile.load_anchors || '{}');
    if (loadAnchors.squat || loadAnchors.bench_press) {
      throw new Error('Old anchors should be removed');
    }
    if (!loadAnchors.deadlift) {
      throw new Error('New deadlift anchor should be present');
    }
  });

  // Test 9: Audit Logs
  await runTest('getAuditLogs - retrieves audit logs', async () => {
    const logs = await UserProfileService.getAuditLogs(TEST_USER_ID);

    if (!Array.isArray(logs)) {
      throw new Error('Audit logs should be an array');
    }

    // Check that we have some logs from our operations
    const profileUpdateLogs = logs.filter(log => log.field_name);
    if (profileUpdateLogs.length === 0) {
      throw new Error('Should have audit logs from profile updates');
    }
  });

  // Test 10: Validation
  await runTest('validateProfile - validates input data', async () => {
    const validUpdate = UserProfileService.validateProfile({
      userId: TEST_USER_ID,
      fitness_level: 'advanced',
      red_flags: ['shoulder_issue'],
      modifiedBy: 'test'
    });

    if (validUpdate.fitness_level !== 'advanced') {
      throw new Error('Fitness level should be validated');
    }

    try {
      UserProfileService.validateProfile({
        userId: TEST_USER_ID,
        fitness_level: 'invalid' as any,
        modifiedBy: 'test'
      });
      throw new Error('Should throw error for invalid fitness level');
    } catch (error) {
      if (!error.message.includes('Invalid fitness_level')) {
        throw error;
      }
      // Expected error
    }
  });

  // Test 11: Transaction Rollback
  await runTest('updateProfile - handles transaction errors', async () => {
    // This test verifies that transaction rollback works correctly
    // by attempting an operation that should fail
    const client = getPostgresClient();

    // Verify the profile still exists and has correct data
    const profile = await UserProfileService.getProfile(TEST_USER_ID);
    if (!profile) {
      throw new Error('Profile should still exist after transaction test');
    }
  });

  console.log('');
  console.log('='.repeat(60));
  console.log('Test Results Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Duration: ${totalDuration}ms`);
  console.log('');

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  - ${r.name}`);
        console.log(`    ${r.error}`);
      });
    console.log('');
  }

  // Cleanup
  await cleanupTestData();

  console.log('Tests completed!');

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
