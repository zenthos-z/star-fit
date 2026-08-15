/**
 * PostgreSQL Module - Core-Flex Architecture Database
 *
 * Exports PostgreSQL client, configuration, and migration utilities
 * for the new Starfit data architecture.
 *
 * @version 3.0.0
 */

// Configuration
export * from './config.js';

// Schema SQL file is available at ./schema/schema.sql for migration tools
// It is not exported as a module since SQL files are not JavaScript modules

// Client
export { PostgresClient, TransactionClient, getPostgresClient, closePostgresClient } from './client/postgres-client.js';
export type { PostgresClientOptions, QueryOptions, TransactionOptions } from './client/postgres-client.js';

// Initialization
export { initializeDatabase } from './client/postgres-init.js';

// Migrations - SQLite migration removed (migration complete)

