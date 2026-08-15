/**
 * Exercise Data Cleanup Script for NanoID Migration
 *
 * This script performs the following cleanup operations:
 * 1. Clears all exercises from the exercises table
 * 2. Clears load_anchors from all user profiles
 * 3. Refreshes materialized views to reset vector indices
 *
 * IMPORTANT: This script is destructive and should only be run when
 * transitioning to the new NanoID-based exercise system.
 */

import { getPostgresClient } from '../db/postgresql/index.js';

interface CleanupResult {
  success: boolean;
  exercisesDeleted: number;
  usersCleared: number;
  viewsRefreshed: boolean;
  error?: string;
}

/**
 * Clean up exercise data for NanoID migration
 */
export async function cleanExerciseData(): Promise<CleanupResult> {
  const postgresClient = getPostgresClient();

  try {
    // Use transaction for atomic operations
    const result = await postgresClient.transaction(async (client) => {
      // Step 1: Delete all exercises
      console.log('Step 1: Clearing exercises table...');
      const exerciseResult = await client.query('DELETE FROM exercises');
      const exercisesDeleted = exerciseResult.rowCount || 0;
      console.log(`✓ Deleted ${exercisesDeleted} exercises`);

      // Step 2: Clear load_anchors from all users
      console.log('Step 2: Clearing load_anchors from user profiles...');
      const userResult = await client.query(`
        UPDATE users
        SET profile_dynamic = jsonb_set(
          jsonb_set(
            profile_dynamic,
            '{load_anchors}',
            '{}'::jsonb
          ),
          '{active_limitations}',
          '[]'::jsonb
        ),
        updated_at = NOW()
        WHERE profile_dynamic ? 'load_anchors'
      `);
      const usersCleared = userResult.rowCount || 0;
      console.log(`✓ Cleared load_anchors for ${usersCleared} users`);

      // Step 3: Refresh materialized views
      console.log('Step 3: Refreshing materialized views...');
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY user_current_state');
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY exercise_summary');
      console.log('✓ Refreshed materialized views');

      return {
        exercisesDeleted,
        usersCleared,
      };
    });

    return {
      success: true,
      ...result,
      viewsRefreshed: true,
    };
  } catch (error) {
    console.error('Error cleaning exercise data:', error);
    return {
      success: false,
      exercisesDeleted: 0,
      usersCleared: 0,
      viewsRefreshed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Main execution function for CLI usage
 */
export async function main(): Promise<void> {
  console.log('=== Exercise Data Cleanup for NanoID Migration ===\n');

  const result = await cleanExerciseData();

  console.log('\n=== Cleanup Summary ===');
  console.log(`Success: ${result.success}`);
  console.log(`Exercises deleted: ${result.exercisesDeleted}`);
  console.log(`Users cleared: ${result.usersCleared}`);
  console.log(`Views refreshed: ${result.viewsRefreshed}`);

  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log('\n✓ Cleanup completed successfully');
  process.exit(0);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
