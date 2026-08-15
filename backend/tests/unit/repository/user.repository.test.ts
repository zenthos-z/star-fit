/**
 * UserRepository Unit Tests (Fixed)
 *
 * Tests for user profile data access with proper mock setup
 * compatible with Node.js built-in test runner.
 *
 * @version 1.0.0
 * @created 2026-02-26
 */

import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert';
import { PostgresClient } from '../../../src/db/postgresql/client/postgres-client.js';
import { UserRepository, createUserRepository } from '../../../src/db/postgresql/repository/user.repository.js';
import type { ProfileStatic, ProfileDynamic, HistorySummary } from '../../../../../../shared/dist/contracts/index.js';
import { ServiceErrorCode } from '../../../src/services/errors/ServiceError.js';

// ============================================================================
// Test Constants
// ============================================================================

const TEST_USER_ID = '00000000-0000-0000-test-000000000001';
const TEST_USERNAME = 'testuser';

// ============================================================================
// Mock Client Factory
// ============================================================================

class MockPostgresClient {
  // Track calls for verification
  queryCalls: any[] = [];

  // Queue of return values for multiple calls
  queryReturnValueQueue: any[] = [];

  // Default return value
  queryReturnValue: any = { rows: [], rowCount: 0 };

  // The query method that BaseRepository uses
  async query(...args: any[]) {
    this.queryCalls.push(args);
    // If there's a queued value, use it and remove from queue
    if (this.queryReturnValueQueue.length > 0) {
      return this.queryReturnValueQueue.shift();
    }
    return this.queryReturnValue;
  }

  reset() {
    this.queryCalls = [];
    this.queryReturnValueQueue = [];
    this.queryReturnValue = { rows: [], rowCount: 0 };
  }

  // Helper to set the return data for the next query call
  setQueryReturnData(data: any) {
    this.queryReturnValue = { rows: [data], rowCount: 1 };
  }

  // Queue a return value for the next query call (doesn't overwrite default)
  queueQueryReturnData(data: any) {
    this.queryReturnValueQueue.push({ rows: [data], rowCount: 1 });
  }

  setQueryReturnMultiple(data: any[]) {
    this.queryReturnValue = { rows: data, rowCount: data.length };
  }

  setQueryReturnEmpty() {
    this.queryReturnValue = { rows: [], rowCount: 0 };
  }
}

// ============================================================================
// ProfileStatic Tests
// ============================================================================

describe('UserRepository - ProfileStatic', () => {
  let repository: UserRepository;
  let mockClient: MockPostgresClient;

  before(() => {
    mockClient = new MockPostgresClient();
    repository = new UserRepository(mockClient as unknown as PostgresClient);
  });

  afterEach(() => {
    mockClient.reset();
  });

  it('should return user profile in API format', async () => {
    const mockProfile = {
      profile_static: {
        fitness_level: 'intermediate',
        tags: ['strength', 'muscle_gain'],
        red_flags: [],
        basic_info: { age: 30, weight: 75 },
        preferences: { goal: 'muscle_gain' },
      },
    };

    mockClient.setQueryReturnData(mockProfile);

    const result = await repository.getProfileStatic(TEST_USER_ID);

    assert.ok(result !== null);
    assert.strictEqual(result.fitness_level, 'intermediate');
    assert.deepStrictEqual(result.tags, ['strength', 'muscle_gain']);
    assert.deepStrictEqual(result.red_flags, []);
    assert.ok(mockClient.queryCalls.length > 0);
  });

  it('should return null when user not found', async () => {
    mockClient.setQueryReturnEmpty();

    const result = await repository.getProfileStatic(TEST_USER_ID);

    assert.strictEqual(result, null);
  });

  it('should return empty default profile when profile_static is null', async () => {
    mockClient.setQueryReturnData({ profile_static: null });

    const result = await repository.getProfileStatic(TEST_USER_ID);

    assert.ok(result !== null);
    assert.strictEqual(result.fitness_level, 'UNKNOWN');
    assert.deepStrictEqual(result.tags, []);
    assert.deepStrictEqual(result.red_flags, []);
  });

  it('should update user profile static', async () => {
    const updateData: ProfileStatic = {
      fitness_level: 'advanced',
      tags: ['strength', 'powerlifting'],
      red_flags: ['knee_issue'],
      age: 35,
      weight: 85,
    };

    mockClient.queryReturnValue = { rows: [], rowCount: 1 }; // UPDATE returns rowCount

    await repository.updateProfileStatic(TEST_USER_ID, updateData);

    assert.ok(mockClient.queryCalls.length > 0);
  });
});

// ============================================================================
// ProfileDynamic Tests
// ============================================================================

describe('UserRepository - ProfileDynamic', () => {
  let repository: UserRepository;
  let mockClient: MockPostgresClient;

  before(() => {
    mockClient = new MockPostgresClient();
    repository = new UserRepository(mockClient as unknown as PostgresClient);
  });

  afterEach(() => {
    mockClient.reset();
  });

  it('should return user dynamic profile', async () => {
    const mockData = {
      profile_dynamic: {
        load_anchors: {
          bench_press: {
            last_weight: 100,
            last_updated: Date.now(),
          },
        },
        active_limitations: [],
        recovery_state: {
          fatigue_level: 3,
        },
      },
    };

    mockClient.setQueryReturnData(mockData);

    const result = await repository.getProfileDynamic(TEST_USER_ID);

    assert.ok(result !== null);
    assert.ok((result as any).load_anchors);
    assert.ok((result as any).active_limitations);
  });

  it('should return null when user not found', async () => {
    mockClient.setQueryReturnEmpty();

    const result = await repository.getProfileDynamic(TEST_USER_ID);

    assert.strictEqual(result, null);
  });

  it('should return empty object when profile_dynamic is null', async () => {
    mockClient.setQueryReturnData({ profile_dynamic: null });

    const result = await repository.getProfileDynamic(TEST_USER_ID);

    // When profile_dynamic is null, the repo returns {}
    assert.deepStrictEqual(Object.keys(result).length, 0);
  });

  it('should update user profile dynamic with partial data', async () => {
    const updateData: Partial<ProfileDynamic> = {
      load_anchors: {
        squat: { last_weight: 120, last_updated: Date.now() } as any,
      },
    };

    mockClient.queryReturnValue = { rows: [], rowCount: 1 };

    await repository.updateProfileDynamic(TEST_USER_ID, updateData);

    assert.ok(mockClient.queryCalls.length > 0);
  });
});

// ============================================================================
// HistorySummary Tests
// ============================================================================

describe('UserRepository - HistorySummary', () => {
  let repository: UserRepository;
  let mockClient: MockPostgresClient;

  before(() => {
    mockClient = new MockPostgresClient();
    repository = new UserRepository(mockClient as unknown as PostgresClient);
  });

  afterEach(() => {
    mockClient.reset();
  });

  it('should return user history summary', async () => {
    const mockHistory = {
      history_summary: {
        last_pattern: {
          sequence: 'A',
          date: '2026-02-26',
          exercises: ['bench_press', 'squat'],
        },
        trends: {
          rpe_trend: 'rising',
          volume_trend: 'increasing',
          recent_avg_rpe: 7.5,
          fatigue_level: 3,
        },
        recent_summary: 'Recent training showed good progress',
        week_number: 8,
        key_metrics: {
          total_sessions: 24,
          personal_records: 3,
          injury_count: 0,
        },
      },
    };

    mockClient.setQueryReturnData(mockHistory);

    const result = await repository.getHistorySummary(TEST_USER_ID);

    assert.ok(result !== null);
    assert.strictEqual((result as any).last_pattern?.sequence, 'A');
    assert.strictEqual((result as any).trends?.rpe_trend, 'rising');
    assert.strictEqual((result as any).recent_summary, 'Recent training showed good progress');
  });

  it('should return empty object when user not found', async () => {
    mockClient.setQueryReturnEmpty();

    const result = await repository.getHistorySummary(TEST_USER_ID);

    assert.strictEqual(result, null);
  });

  it('should return empty object when history_summary is null', async () => {
    mockClient.setQueryReturnData({ history_summary: null });

    const result = await repository.getHistorySummary(TEST_USER_ID);

    // When history_summary is null, the repo returns {}
    assert.deepStrictEqual(Object.keys(result).length, 0);
  });

  it('should update user history summary', async () => {
    const updateData: Partial<HistorySummary> = {
      recent_summary: 'Updated summary text',
      week_number: 9,
    };

    mockClient.queryReturnValue = { rows: [], rowCount: 1 };

    await repository.updateHistorySummary(TEST_USER_ID, updateData);

    assert.ok(mockClient.queryCalls.length > 0);
  });

  it('should merge new data with existing history summary', async () => {
    const existingHistory = {
      last_pattern: {
        sequence: 'A',
        date: '2026-02-26',
        exercises: ['bench_press'],
      },
      recent_summary: 'Old summary',
      week_number: 8,
    };

    const updateData: Partial<HistorySummary> = {
      recent_summary: 'New summary',
      week_number: 9,
    };

    // First call (getHistorySummary) returns existing data
    mockClient.queueQueryReturnData({ history_summary: existingHistory });
    // Second call (update) returns rowCount
    mockClient.queueQueryReturnData({ rows: [], rowCount: 1 });

    const result = await repository.mergeHistorySummary(TEST_USER_ID, updateData);

    assert.strictEqual(result.recent_summary, 'New summary');
    assert.strictEqual(result.week_number, 9);
    assert.strictEqual((result as any).last_pattern?.sequence, 'A');
  });

  it('should create new history summary when none exists', async () => {
    const updateData: Partial<HistorySummary> = {
      recent_summary: 'First summary',
    };

    // First call (getHistorySummary) returns empty
    mockClient.setQueryReturnData({ history_summary: {} });
    // Second call (update) returns rowCount
    mockClient.queryReturnValue = { rows: [], rowCount: 1 };

    const result = await repository.mergeHistorySummary(TEST_USER_ID, updateData);

    assert.strictEqual(result.recent_summary, 'First summary');
  });
});

// ============================================================================
// User Resolution Tests
// ============================================================================

describe('UserRepository - User Resolution', () => {
  let repository: UserRepository;
  let mockClient: MockPostgresClient;

  before(() => {
    mockClient = new MockPostgresClient();
    repository = new UserRepository(mockClient as unknown as PostgresClient);
  });

  afterEach(() => {
    mockClient.reset();
  });

  it('should return user ID for existing username', async () => {
    mockClient.setQueryReturnData({ id: TEST_USER_ID });

    const result = await repository.getIdByUsername(TEST_USERNAME);

    assert.strictEqual(result, TEST_USER_ID);
  });

  it('should return null for non-existent username', async () => {
    mockClient.setQueryReturnEmpty();

    const result = await repository.getIdByUsername('nonexistent');

    assert.strictEqual(result, null);
  });

  it('should return username for existing user ID', async () => {
    mockClient.setQueryReturnData({ username: TEST_USERNAME });

    const result = await repository.getUsernameById(TEST_USER_ID);

    assert.strictEqual(result, TEST_USERNAME);
  });

  it('should return null for non-existent user ID', async () => {
    mockClient.setQueryReturnEmpty();

    const result = await repository.getUsernameById('non-existent-id');

    assert.strictEqual(result, null);
  });

  it('should return UUID when given valid UUID', async () => {
    // Use valid UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // where y is 8, 9, A, or B, and x is any hex digit
    const validUuid = '550e8400-e29b-41d4-8716-446655440000';
    const result = await repository.resolveUserId(validUuid);

    assert.strictEqual(result, validUuid);
    // Should not query database for valid UUID
    assert.strictEqual(mockClient.queryCalls.length, 0);
  });

  it('should resolve username to UUID', async () => {
    mockClient.setQueryReturnData({ id: TEST_USER_ID });

    const result = await repository.resolveUserId(TEST_USERNAME);

    assert.strictEqual(result, TEST_USER_ID);
  });

  it('should throw NOT_FOUND when user does not exist', async () => {
    mockClient.setQueryReturnEmpty();

    await assert.rejects(
      async () => await repository.resolveUserId('nonexistent'),
      (error: any) => {
        assert.strictEqual(error.code, ServiceErrorCode.NOT_FOUND);
        assert.ok(error.message.includes('nonexistent'));
        return true; // Validation passed
      }
    );
  });
});
