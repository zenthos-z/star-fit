/**
 * Database Schema Definitions
 *
 * These schemas define the structure of data as stored in PostgreSQL.
 * All field names use snake_case to match PostgreSQL conventions.
 *
 * These schemas are used for:
 * - Validating data read from database
 * - Preparing data for database storage
 * - Defining the contract between application and database
 */

// Re-export from the TypeScript definitions
export * from './user-profile.schema.js';
