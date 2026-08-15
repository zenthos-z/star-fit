/**
 * Test Data Factory for Admin Console Testing
 *
 * Provides factory functions for creating test data:
 * - Test users with different profiles (beginner, intermediate, advanced)
 * - Load anchors for different exercise types
 * - Active limitations
 * - Complete user profiles
 *
 * All types imported from shared/contracts as per data contract requirements.
 *
 * @version 1.0.0
 * @created 2026-02-10
 */

import type {
  ProfileStatic,
  ProfileDynamic,
  LoadAnchor,
  ActiveLimitation,
  UserProfileV2,
} from '../../../shared/contracts/index.js';
import {
  createActiveLimitation as createLimitation,
} from '../../../shared/contracts/index.js';
import { generateTestUserId } from './testHelpers.js';

// ============================================================================
// Test User Data Templates
// ============================================================================

/**
 * Test user types with predefined profiles
 */
export const TEST_USERS = {
  beginner: {
    user_id: 'test-user-beginner',
    profile_static: {},
    profile_dynamic: { load_anchors: {}, active_limitations: [] }
  },

  intermediate: {
    user_id: 'test-user-intermediate',
    profile_static: {
      age: 30,
      weight: 75,
      height: 180,
      body_fat_percentage: 15,
      neuro_type: 'type_2a',
      risk_preference: 'moderate',
      accountability: 'high',
    },
    profile_dynamic: {
      load_anchors: {
        '深蹲': { best_weight: 100, best_reps: 5, est_1rm: 115, last_updated: Date.now() },
        '卧推': { best_weight: 80, best_reps: 6, est_1rm: 95, last_updated: Date.now() },
        '硬拉': { best_weight: 120, best_reps: 3, est_1rm: 130, last_updated: Date.now() },
      },
      active_limitations: [],
      recovery_state: undefined,
    },
  },

  advanced: {
    user_id: 'test-user-advanced',
    profile_static: {
      age: 35,
      weight: 85,
      height: 185,
      neuro_type: 'type_1',
      risk_preference: 'aggressive',
    },
    profile_dynamic: {
      load_anchors: {
        '引体向上': { best_reps: 15, progression_level: 8, last_updated: Date.now() },
        '平板支撑': { best_duration: 180, last_updated: Date.now() },
        '5公里跑': { best_pace: 300, best_distance: 5000, last_updated: Date.now() },
      },
      active_limitations: [
        {
          part: '左肩',
          severity: 5,
          expire_at: '2025-02-20T00:00:00Z',
          logged_at: '2025-02-10T00:00:00Z',
          auto_heal: true,
        },
        {
          part: '右膝盖',
          severity: 3,
          expire_at: '2025-02-15T00:00:00Z',
          logged_at: '2025-02-10T00:00:00Z',
          auto_heal: true,
        },
      ],
      recovery_state: undefined,
    },
  },
} as const;

// ============================================================================
// Exercise Type Field Mappings
// ============================================================================

/**
 * Required fields for each exercise type
 */
export const EXERCISE_TYPE_FIELDS: Record<string, (keyof LoadAnchor)[]> = {
  resistance: ['best_weight', 'best_reps'],
  unilateral: ['best_weight', 'best_reps'],
  heavy_weight: ['best_weight', 'best_reps'],
  rep_training: ['best_reps'],
  bodyweight: ['best_reps'],
  assisted: ['best_weight', 'best_reps'],
  isometric: ['best_duration'],
  cardio: ['best_pace'],
  outdoor: ['best_pace'],
  flexibility: [],
};

/**
 * Body part options for limitations
 */
export const BODY_PARTS = [
  '头部', '颈部', '肩部', '胸部', '上背', '下背', '腰部', '臀部',
  '大腿前侧', '大腿后侧', '膝盖', '小腿', '脚踝',
  '上臂', '前臂', '手腕', '手肘',
] as const;

/**
 * Neuro type options
 */
export const NEURO_TYPES = [
  'UNKNOWN',
  'type_1',
  'type_2a',
  'type_2b',
  'type_3',
] as const;

/**
 * Risk preference options
 */
export const RISK_PREFERENCES = [
  'UNKNOWN',
  'conservative',
  'moderate',
  'aggressive',
] as const;

/**
 * Accountability options
 */
export const ACCOUNTABILITY_OPTIONS = [
  'UNKNOWN',
  'low',
  'medium',
  'high',
] as const;

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a test user with a specific profile level
 *
 * @param level - The profile level (beginner, intermediate, advanced)
 * @param userId - Optional custom user ID (generates one if not provided)
 * @returns Complete test user object
 */
export function createTestUser(
  level: keyof typeof TEST_USERS,
  userId?: string
): UserProfileV2 {
  const template = TEST_USERS[level];
  const now = new Date().toISOString();

  return {
    protocol_version: '2.0.0',
    user_id: userId || template.user_id || generateTestUserId(),
    created_at: now,
    updated_at: now,
    profile_static: template.profile_static as ProfileStatic,
    profile_dynamic: template.profile_dynamic as ProfileDynamic,
    history_summary: undefined,
    tags: [],
    fitness_level: level === 'beginner' ? 'beginner' : level === 'intermediate' ? 'intermediate' : 'advanced',
    red_flags: [],
    training_strategy: null,
  };
}

/**
 * Create a load anchor for a specific exercise type
 *
 * @param exerciseType - The exercise type (resistance, bodyweight, isometric, cardio)
 * @param data - Optional data overrides
 * @returns Load anchor with required fields for the exercise type
 */
export function createLoadAnchor(
  exerciseType: string,
  data: Partial<LoadAnchor> = {}
): LoadAnchor {
  const requiredFields = EXERCISE_TYPE_FIELDS[exerciseType] || [];
  const anchor: LoadAnchor = {
    last_updated: data.last_updated || Date.now(),
    ...data,
  };

  // Ensure required fields are present
  for (const field of requiredFields) {
    if (anchor[field] === undefined) {
      switch (field) {
        case 'best_weight':
          anchor[field] = 100;
          break;
        case 'best_reps':
          anchor[field] = 10;
          break;
        case 'best_duration':
          anchor[field] = 60;
          break;
        case 'best_pace':
          anchor[field] = 300;
          break;
        default:
          anchor[field] = 0;
      }
    }
  }

  return anchor;
}

/**
 * Create a resistance training anchor
 *
 * @param data - Optional data overrides
 * @returns Load anchor for resistance training
 */
export function createResistanceAnchor(data: Partial<LoadAnchor> = {}): LoadAnchor {
  return createLoadAnchor('resistance', {
    best_weight: 100,
    best_reps: 8,
    est_1rm: 120,
    ...data,
  });
}

/**
 * Create a bodyweight training anchor
 *
 * @param data - Optional data overrides
 * @returns Load anchor for bodyweight training
 */
export function createBodyweightAnchor(data: Partial<LoadAnchor> = {}): LoadAnchor {
  return createLoadAnchor('bodyweight', {
    best_reps: 12,
    progression_level: 5,
    ...data,
  });
}

/**
 * Create an isometric hold anchor
 *
 * @param data - Optional data overrides
 * @returns Load anchor for isometric hold
 */
export function createIsometricAnchor(data: Partial<LoadAnchor> = {}): LoadAnchor {
  return createLoadAnchor('isometric', {
    best_duration: 90,
    ...data,
  });
}

/**
 * Create a cardio anchor
 *
 * @param data - Optional data overrides
 * @returns Load anchor for cardio
 */
export function createCardioAnchor(data: Partial<LoadAnchor> = {}): LoadAnchor {
  return createLoadAnchor('cardio', {
    best_pace: 300,
    best_distance: 5000,
    best_duration: 1800,
    ...data,
  });
}

/**
 * Create an active limitation
 *
 * @param part - Body part
 * @param severity - Severity level (1-10)
 * @param note - Optional description
 * @returns Active limitation with auto-calculated timestamps
 */
export function createActiveLimitation(
  part: string,
  severity: number,
  note?: string
): ActiveLimitation {
  return createLimitation(part, severity, note);
}

/**
 * Create a batch of test users
 *
 * @param count - Number of users to create
 * @param level - Profile level for all users
 * @returns Array of test users
 */
export function createTestUserBatch(
  count: number,
  level: keyof typeof TEST_USERS = 'intermediate'
): UserProfileV2[] {
  return Array.from({ length: count }, (_, i) =>
    createTestUser(level, `${level}-user-${i + 1}`)
  );
}

/**
 * Create test load anchors for a variety of exercises
 *
 * @returns Load anchors object with multiple exercise types
 */
export function createMixedLoadAnchors(): Record<string, LoadAnchor> {
  return {
    '深蹲': createResistanceAnchor({ best_weight: 100, best_reps: 5, est_1rm: 115 }),
    '卧推': createResistanceAnchor({ best_weight: 80, best_reps: 6, est_1rm: 95 }),
    '硬拉': createResistanceAnchor({ best_weight: 120, best_reps: 3, est_1rm: 130 }),
    '引体向上': createBodyweightAnchor({ best_reps: 15, progression_level: 8 }),
    '平板支撑': createIsometricAnchor({ best_duration: 180 }),
    '5公里跑': createCardioAnchor({ best_pace: 300, best_distance: 5000 }),
  };
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/**
 * Cleanup test data from database
 *
 * @param userIds - Array of user IDs to clean up
 * @param postgresClient - Optional PostgreSQL client instance
 */
export async function cleanupTestData(
  userIds: string[],
  postgresClient?: any
): Promise<void> {
  if (!userIds.length) {
    return;
  }

  console.log(`[TestDataFactory] Cleaning up ${userIds.length} test users:`, userIds);

  try {
    // Use provided client or get default
    const client = postgresClient || (await import('../../src/db/postgresql/index.js')).getPostgresClient();

    // Build parameterized query for IN clause
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');

    // Delete from users table (cascade will handle related records)
    await client.query(
      `DELETE FROM users WHERE id IN (${placeholders}) OR device_id IN (${placeholders})`,
      [...userIds, ...userIds],
      { operation: 'cleanup_test_data' }
    );

    console.log(`[TestDataFactory] Successfully cleaned up ${userIds.length} test users`);
  } catch (error) {
    console.error(`[TestDataFactory] Failed to cleanup test users:`, error);
    throw error;
  }
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate that a load anchor has all required fields for its exercise type
 *
 * @param anchor - The load anchor to validate
 * @param exerciseType - The exercise type
 * @returns Validation result
 */
export function validateLoadAnchor(
  anchor: LoadAnchor,
  exerciseType: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const requiredFields = EXERCISE_TYPE_FIELDS[exerciseType] || [];

  for (const field of requiredFields) {
    if (anchor[field] === undefined) {
      errors.push(`${exerciseType} 类型需要 ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that an active limitation is properly formed
 *
 * @param limitation - The limitation to validate
 * @returns Validation result
 */
export function validateActiveLimitation(
  limitation: ActiveLimitation
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!limitation.part) {
    errors.push('part 字段不能为空');
  }

  if (limitation.severity < 1 || limitation.severity > 10) {
    errors.push('severity 必须在 1-10 之间');
  }

  if (!limitation.expire_at) {
    errors.push('expire_at 字段不能为空');
  } else if (isNaN(Date.parse(limitation.expire_at))) {
    errors.push('expire_at 必须是有效的 ISO 8601 日期');
  }

  if (!limitation.logged_at) {
    errors.push('logged_at 字段不能为空');
  } else if (isNaN(Date.parse(limitation.logged_at))) {
    errors.push('logged_at 必须是有效的 ISO 8601 日期');
  }

  return { valid: errors.length === 0, errors };
}
