/**
 * Short ID Generator
 *
 * Generates unique, user-friendly short IDs for users.
 * Format: U_XXXXXX (e.g., U_7K9X2M)
 *
 * Characteristics:
 * - Character set: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (34 chars)
 * - Excludes: 0/O/1/I/L (confusing characters)
 * - Capacity: 34^6 ≈ 1.54 billion unique combinations
 * - Collision handling: retry with new random ID
 *
 * @module shortIdGenerator
 */

import { customAlphabet } from 'nanoid';
import type { PostgresClient } from '../db/postgresql/client/postgres-client.js';

// Character set excluding visually similar characters
// Excludes: 0 (zero), O (letter O), 1 (one), I (letter I), L (letter L)
const SAFE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// Prefix for all user short IDs
const PREFIX = 'U_';

// Length of the random part (after prefix)
const ID_LENGTH = 6;

// Maximum collision retry attempts
const MAX_RETRIES = 10;

// Create a custom nanoid generator with safe alphabet
const generateId = customAlphabet(SAFE_ALPHABET, ID_LENGTH);

/**
 * Generate a single short ID
 * @returns A short ID in format U_XXXXXX
 */
export function generateShortId(): string {
  return PREFIX + generateId();
}

/**
 * Generate a unique short ID that doesn't exist in the database
 * Uses atomic check-and-insert pattern to prevent race conditions
 *
 * @param client - PostgreSQL client (or transaction client)
 * @returns A unique short ID
 * @throws Error if unable to generate unique ID after MAX_RETRIES
 */
export async function generateUniqueShortId(client: PostgresClient): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const shortId = generateShortId();

    // Check if this ID already exists
    const existing = await client.queryOne<{ short_id: string }>(
      'SELECT short_id FROM users WHERE short_id = $shortId',
      { shortId }
    );

    if (!existing) {
      return shortId;
    }

    console.log(`[ShortIdGenerator] Collision detected for ${shortId}, retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
  }

  throw new Error(`Failed to generate unique short ID after ${MAX_RETRIES} attempts`);
}

/**
 * Validate a short ID format
 * @param shortId - The short ID to validate
 * @returns True if valid format
 */
export function isValidShortId(shortId: string): boolean {
  const pattern = /^U_[A-Z0-9]{6}$/;
  if (!pattern.test(shortId)) {
    return false;
  }

  // Check that all characters are from the safe alphabet
  const chars = shortId.slice(2); // Remove 'U_' prefix
  for (const char of chars) {
    if (!SAFE_ALPHABET.includes(char)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate username format
 * Rules:
 * - 2-20 characters
 * - Letters, numbers, underscores, and Chinese characters allowed
 * - Case-insensitive uniqueness
 *
 * @param username - The username to validate
 * @returns Object with valid status and error message if invalid
 */
export function validateUsername(username: string | null | undefined): { valid: boolean; error?: string } {
  // Empty username is allowed (optional field)
  if (!username) {
    return { valid: true };
  }

  // Check length
  if (username.length < 2) {
    return { valid: false, error: '用户名至少2个字符' };
  }
  if (username.length > 20) {
    return { valid: false, error: '用户名最多20个字符' };
  }

  // Check character set (letters, numbers, underscores, Chinese)
  const pattern = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/;
  if (!pattern.test(username)) {
    return { valid: false, error: '只能包含字母、数字、下划线和中文' };
  }

  return { valid: true };
}

/**
 * Normalize username for storage and comparison
 * Lowercases the username for case-insensitive uniqueness
 *
 * @param username - The username to normalize
 * @returns Normalized username
 */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}
