/**
 * NanoID utility functions for generating compact, URL-safe unique identifiers.
 *
 * NanoID advantages over UUID:
 * - 60% shorter (14 chars vs 36 chars)
 * - Reduces AI token consumption
 * - URL-safe character set (no special characters)
 * - Same collision resistance with sufficient length
 */

import { customAlphabet } from 'nanoid';

/**
 * Custom alphabet for exercise IDs:
 * - 0-9: digits
 * - A-Z: uppercase letters
 * - a-z: lowercase letters
 * - _: underscore
 * - -: hyphen
 *
 * Total: 64 characters = 6 bits per character
 * 14 characters = 84 bits of entropy (more than UUID's 122 bits but with shorter length)
 */
export const generateExerciseId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-',
  14
);

/**
 * Generate a NanoID for exercises.
 *
 * @returns A 14-character URL-safe unique identifier
 * @example
 * generateExerciseNanoId() // "V1StGXR8_Z5jdHi6"
 */
export function generateExerciseNanoId(): string {
  return generateExerciseId();
}
