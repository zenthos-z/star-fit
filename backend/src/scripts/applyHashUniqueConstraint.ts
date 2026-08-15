/**
 * Apply hash UNIQUE constraint to user_media table
 *
 * This script directly applies the migration for adding a UNIQUE constraint
 * to the hash field in the user_media table.
 *
 * Run with: npx tsx src/scripts/applyHashUniqueConstraint.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env file explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

import { getPostgresClient } from '../db/postgresql/index.js';

// Log environment variables for debugging
console.log('[Migration] DATABASE_URL:', process.env.DATABASE_URL ? '***CONFIGURED***' : 'NOT SET');
console.log('[Migration] PGHOST:', process.env.PGHOST);
console.log('[Migration] PGDATABASE:', process.env.PGDATABASE);

async function applyHashUniqueConstraint() {
  const client = getPostgresClient();

  try {
    console.log('[Migration] Starting 005_add_user_media_hash_unique...');

    // Check if constraint already exists
    const checkResult = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'user_media'
        AND constraint_type = 'UNIQUE'
        AND constraint_name = 'user_media_hash_key';
    `);

    if (checkResult.rows.length > 0) {
      console.log('[Migration] Constraint user_media_hash_key already exists. Skipping.');
      return;
    }

    // Add UNIQUE constraint to hash field
    console.log('[Migration] Adding UNIQUE constraint to user_media.hash...');
    await client.query(`
      ALTER TABLE user_media ADD CONSTRAINT user_media_hash_key UNIQUE (hash);
    `);

    // Create index for efficient hash lookups
    console.log('[Migration] Creating index idx_user_media_hash...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_media_hash ON user_media(hash);
    `);

    console.log('[Migration] ✅ Completed 005_add_user_media_hash_unique');
  } catch (error: any) {
    console.error('[Migration] ❌ Failed:', error.message);
    throw error;
  }
}

// Run migration
applyHashUniqueConstraint()
  .then(() => {
    console.log('[Migration] Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Migration] Error:', error);
    process.exit(1);
  });
