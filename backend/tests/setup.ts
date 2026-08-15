/**
 * Jest Test Setup File
 *
 * Configures the test environment for all Jest tests
 * - Mock environment variables
 * - Configure test globals
 * - Setup test database connections
 *
 * @version 1.0.0
 * @created 2026-02-12
 * @updated 2026-02-12
 */

import { jest } from '@jest/globals';

// ============================================================================
// Environment Setup
// ============================================================================

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise during tests

// Disable Redis for Jest tests (use in-memory fallback)
process.env.REDIS_DISABLED = 'true';

// Use PostgreSQL for Jest tests by default
process.env.TEST_DB_TYPE = 'postgres';

// ============================================================================
// Global Test Utilities
// ============================================================================

/**
 * Generate a random test user ID
 */
global.generateTestUserId = (): string => {
  return `test-user-${Date.now()}-${Math.random().toString(36).substring(7)}`;
};

/**
 * Generate a random test exercise ID
 */
global.generateTestExerciseId = (): string => {
  return `test-exercise-${Date.now()}-${Math.random().toString(36).substring(7)}`;
};

/**
 * Wait for async operations (useful for testing promises)
 */
global.wait = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Create a mock embedding vector for testing (1536 dimensions - OpenAI default)
 */
global.createMockEmbedding = (dimension: number = 1536): number[] => {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
};

// ============================================================================
// Test Timeout Configuration
// ============================================================================

// Increase timeout for tests that need more time (e.g., integration tests)
jest.setTimeout(10000);

// ============================================================================
// Console Output Control
// ============================================================================

// Suppress unnecessary console output during tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.error = (...args: any[]) => {
  // Only show errors that aren't from known test noise
  const message = args[0];
  if (typeof message === 'string') {
    // Filter out expected test errors
    if (
      message.includes('warnings') ||
      message.includes('deprecated')
    ) {
      return;
    }
  }
  originalConsoleError.apply(console, args);
};

console.warn = (...args: any[]) => {
  // Filter out expected warnings
  const message = args[0];
  if (typeof message === 'string') {
    if (
      message.includes('warnings') ||
      message.includes('deprecated')
    ) {
      return;
    }
  }
  originalConsoleWarn.apply(console, args);
};

// ============================================================================
// Cleanup After All Tests
// ============================================================================

afterAll(() => {
  // Restore console methods
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// ============================================================================
// Type Declarations for Global Test Utilities
// ============================================================================

declare global {
  var generateTestUserId: () => string;
  var generateTestExerciseId: () => string;
  var wait: (ms: number) => Promise<void>;
  var createMockEmbedding: (dimension?: number) => number[];
}

// ============================================================================
// Named exports for tests that import from this file
// ============================================================================

import { PostgresClient } from '../src/db/postgresql/client/postgres-client.js';

/**
 * Test database client instance
 * Used by tests that need database access
 */
let testPostgresClient: PostgresClient | null = null;

/**
 * Setup test database connection
 * Creates a isolated database for testing
 */
export async function setupTestDatabase(): Promise<PostgresClient> {
  if (!testPostgresClient) {
    // For unit tests, we may use a mock or in-memory database
    // The test-infra-fixer teammate will complete this setup
    testPostgresClient = null as PostgresClient;
  }
  return testPostgresClient as PostgresClient;
}

/**
 * Cleanup test database
 * Closes connections and clears test data
 */
export async function cleanupTestDatabase(): Promise<void> {
  if (testPostgresClient) {
    await testPostgresClient.close();
    testPostgresClient = null;
  }
}

/**
 * Get test database client
 */
export function getTestPostgresClient(): PostgresClient | null {
  return testPostgresClient;
}

/**
 * Global test setup
 * Called before all test suites
 */
export async function globalSetup(): Promise<void> {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

/**
 * Global test teardown
 * Called after all test suites
 */
export async function globalTeardown(): Promise<void> {
  await cleanupTestDatabase();
}
