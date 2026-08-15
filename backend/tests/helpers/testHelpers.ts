/**
 * Test Helper Utilities
 *
 * Shared utilities for all test files to reduce duplication
 * and ensure consistency across the test suite.
 *
 * @version 1.0.0
 * @created 2026-02-09
 */

// R9: Logger type moved to its canonical home (src/utils/logger.ts). The old
// re-export via services/mas/config/serviceRegistry.js is gone with the MAS runtime.
import { Logger } from '../../src/utils/logger.js';

/**
 * Create a mock logger for testing
 * All methods are jest.fn() that can be asserted against
 */
export function createMockLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  };
}

/**
 * Create a mock logger with spy tracking
 * Returns both the logger and an object with spy accessors
 */
export function createMockLoggerWithSpies() {
  const spies = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  };

  const logger: Logger = {
    info: spies.info,
    warn: spies.warn,
    error: spies.error,
    debug: spies.debug,
    fatal: spies.fatal,
  };

  return { logger, spies };
}

/**
 * Clear all mock logger calls
 * Useful for beforeEach hooks
 */
export function clearMockLogger(logger: Logger): void {
  (logger.info as jest.Mock).mockClear();
  (logger.warn as jest.Mock).mockClear();
  (logger.error as jest.Mock).mockClear();
  (logger.debug as jest.Mock).mockClear();
  (logger.fatal as jest.Mock).mockClear();
}

/**
 * Assert that a logger method was called with specific message
 */
export function expectLoggerCall(
  logger: Logger,
  method: keyof Logger,
  message: string | RegExp
): void {
  const mock = logger[method] as jest.Mock;
  expect(mock).toHaveBeenCalled();
  const call = mock.mock.calls[0][0];
  if (message instanceof RegExp) {
    expect(call).toMatch(message);
  } else {
    expect(call).toContain(message);
  }
}

/**
 * Generate a random test user ID
 */
export function generateTestUserId(): string {
  return `test-user-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Generate a random test exercise ID
 */
export function generateTestExerciseId(): string {
  return `test-exercise-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Wait for async operations to complete
 * Useful for testing promises and event handlers
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for the next tick (microtask queue to clear)
 */
export async function nextTick(): Promise<void> {
  await Promise.resolve();
}

/**
 * Create a mock embedding vector for testing
 * Generates a 1536-dimensional vector (OpenAI default)
 */
export function createMockEmbedding(dimension: number = 1536): number[] {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

/**
 * Create mock exercise data for testing
 */
export function createMockExercise(overrides: Partial<any> = {}) {
  return {
    id: generateTestExerciseId(),
    name: 'Test Exercise',
    target: 'Test Target',
    difficulty: 'intermediate',
    equipment: ['dumbbells'],
    exerciseType: 'strength',
    ...overrides,
  };
}

/**
 * Create mock load anchor for testing
 */
export function createMockLoadAnchor(overrides: Partial<any> = {}) {
  return {
    '1rm': 100,
    current: 90,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create mock user profile for testing
 */
export function createMockUserProfile(overrides: Partial<any> = {}) {
  return {
    user_id: generateTestUserId(),
    basic_info: {
      age: 30,
      height: 180,
      weight: 75,
      gender: 'male',
    },
    preferences: {
      goal: '增肌',
      duration: 60,
    },
    load_anchors: {
      bench_press: createMockLoadAnchor(),
    },
    profile_static: '{}',
    profile_dynamic: '{}',
    history_summary: '{}',
    ...overrides,
  };
}

/**
 * Create mock workout session for testing
 */
export function createMockWorkoutSession(overrides: Partial<any> = {}) {
  return {
    id: `session-${Date.now()}`,
    user_id: generateTestUserId(),
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    exercises: [],
    ...overrides,
  };
}

/**
 * Assert that an async function throws a specific error
 */
export async function expectAsyncError<T>(
  fn: () => Promise<T>,
  errorClass: new (...args: any[]) => Error,
  errorMessage?: string | RegExp
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected function to throw ${errorClass.name}, but it didn't throw`);
  } catch (error) {
    expect(error).toBeInstanceOf(errorClass);
    if (errorMessage) {
      if (errorMessage instanceof RegExp) {
        expect((error as Error).message).toMatch(errorMessage);
      } else {
        expect((error as Error).message).toContain(errorMessage);
      }
    }
  }
}

/**
 * Assert that a service error was thrown with specific code
 */
export async function expectServiceError(
  fn: () => Promise<any>,
  errorCode: string
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected function to throw ServiceError with code ${errorCode}, but it didn't throw`);
  } catch (error: any) {
    expect(error.code).toBe(errorCode);
  }
}

/**
 * Mock a database connection for testing
 */
export function createMockDatabase() {
  return {
    prepare: jest.fn(),
    exec: jest.fn(),
    transaction: jest.fn(() => ({
      prepare: jest.fn(),
      exec: jest.fn(),
    })),
    close: jest.fn(),
  };
}

/**
 * Clean up test resources
 * Call this in afterAll hooks to ensure proper cleanup
 */
export async function cleanupTestResources(resources: {
  closeables?: Array<{ close: () => Promise<void> | void }>;
  disconnectables?: Array<{ disconnect: () => Promise<void> | void }>;
}): Promise<void> {
  const { closeables = [], disconnectables = [] } = resources;

  for (const closeable of closeables) {
    try {
      await closeable.close();
    } catch (error) {
      console.error('Error closing resource:', error);
    }
  }

  for (const disconnectable of disconnectables) {
    try {
      await disconnectable.disconnect();
    } catch (error) {
      console.error('Error disconnecting resource:', error);
    }
  }
}

/**
 * Test data builder for creating complex test objects
 * Provides a fluent interface for building test data
 */
export class TestDataBuilder<T> {
  private data: Partial<T>;

  constructor(initialData: Partial<T> = {}) {
    this.data = initialData;
  }

  with<K extends keyof T>(key: K, value: T[K]): this {
    this.data[key] = value;
    return this;
  }

  withMultiple(updates: Partial<T>): this {
    this.data = { ...this.data, ...updates };
    return this;
  }

  build(): T {
    return this.data as T;
  }
}

/**
 * Create a test data builder for a specific type
 */
export function createTestDataBuilder<T>(initialData?: Partial<T>): TestDataBuilder<T> {
  return new TestDataBuilder<T>(initialData);
}

/**
 * Retry a function with exponential backoff
 * Useful for flaky tests or waiting for conditions
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 100,
    backoff = true,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
        await wait(delay);
      }
    }
  }

  throw lastError;
}
