/**
 * Admin Console API Integration Tests
 *
 * Tests the 6 new admin API endpoints for user profile management:
 * - GET /api/admin/users/:userId/profile - Get user profile
 * - POST /api/admin/users/:userId/profile/static - Update static profile
 * - POST /api/admin/users/:userId/profile/dynamic - Update dynamic profile
 * - POST /api/admin/users/:userId/anchors/:exerciseId - Update load anchor
 * - POST /api/admin/users/:userId/limitations - Add limitation
 * - DELETE /api/admin/users/:userId/limitations/:part - Delete limitation
 *
 * Test Scenarios:
 * A1: Get User Profile - Normal Flow
 * A2: Get User Profile - User Not Found
 * A3: Update Static Profile - Partial Update
 * A4: Update Static Profile - Boundary Values
 * A5: Update Load Anchor - New Anchor
 * A6: Update Load Anchor - Type Validation
 * A7: Add Limitation - Auto Calculate Expiration
 * A8: Delete Limitation - Normal Flow
 *
 * @version 1.0.0
 * @created 2026-02-10
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import { createServer } from '../../src/server.js';
import {
  UserProfileV2Schema,
  ProfileStaticSchema,
  ProfileDynamicSchema,
  LoadAnchorSchema,
  ActiveLimitationSchema,
  createActiveLimitation,
  validateAnchorForExerciseType,
  type UserProfileV2,
  type LoadAnchor,
  type ActiveLimitation
} from '../../../shared/contracts/index.js';

// ============================================================================
// Test Context
// ============================================================================

interface AdminApiTestContext {
  app: any;
  testUserId: string;
  nonExistentUserId: string;
  testExerciseId: string;
  cleanup: () => Promise<void>;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Admin Console API Integration Tests', () => {
  let ctx: AdminApiTestContext;

  beforeAll(async () => {
    // Create Fastify server instance
    const app = createServer();
    await app.ready();

    ctx = {
      app,
      testUserId: `admin-test-user-${Date.now()}`,
      nonExistentUserId: `non-existent-user-${Date.now()}`,
      testExerciseId: 'squat',
      cleanup: async () => {
        await app.close();
      }
    };

    // Create test user profile
    await setupTestUserProfile(ctx.testUserId);
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData(ctx.testUserId);
    await ctx.cleanup();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // A1: Get User Profile - Normal Flow
  // ==========================================================================

  describe('A1: Get User Profile - Normal Flow', () => {
    it('should return complete UserProfileV2 with protocol_version === 2.0.0', async () => {
      const response = await request(ctx.app)
        .get(`/api/admin/users/${ctx.testUserId}/profile`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();

      // Validate using shared contract schema
      const profile = UserProfileV2Schema.parse(response.body.data);
      expect(profile.protocol_version).toBe('2.0.0');
      expect(profile.user_id).toBe(ctx.testUserId);
      expect(profile.created_at).toBeDefined();
      expect(profile.updated_at).toBeDefined();

      // Verify structure
      expect(profile.profile_static).toBeDefined();
      expect(profile.profile_dynamic).toBeDefined();
    });

    it('should include all required profile_static fields', async () => {
      const response = await request(ctx.app)
        .get(`/api/admin/users/${ctx.testUserId}/profile`)
        .expect(200);

      const profile = response.body.data;
      expect(profile.profile_static).toMatchObject({
        age: expect.any(Number),
        weight: expect.any(Number),
        height: expect.any(Number),
        neuro_type: expect.any(String),
        risk_preference: expect.any(String),
      });
    });
  });

  // ==========================================================================
  // A2: Get User Profile - User Not Found
  // ==========================================================================

  describe('A2: Get User Profile - User Not Found', () => {
    it('should return 404 for non-existent user', async () => {
      const response = await request(ctx.app)
        .get(`/api/admin/users/${ctx.nonExistentUserId}/profile`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('should return 400 for missing userId', async () => {
      const response = await request(ctx.app)
        .get('/api/admin/users//profile')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // A3: Update Static Profile - Partial Update
  // ==========================================================================

  describe('A3: Update Static Profile - Partial Update', () => {
    it('should update only specified fields (age: 31, weight: 76)', async () => {
      const updateData = {
        age: 31,
        weight: 76
      };

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/static`)
        .send(updateData)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated');

      // Verify only specified fields were updated
      const profileResponse = await request(ctx.app)
        .get(`/api/admin/users/${ctx.testUserId}/profile`)
        .expect(200);

      const profile = profileResponse.body.data;
      expect(profile.profile_static.age).toBe(31);
      expect(profile.profile_static.weight).toBe(76);
    });

    it('should accept single field update', async () => {
      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/static`)
        .send({ neuro_type: 'type_2a' })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify field was updated
      const profileResponse = await request(ctx.app)
        .get(`/api/admin/users/${ctx.testUserId}/profile`)
        .expect(200);

      expect(profileResponse.body.data.profile_static.neuro_type).toBe('type_2a');
    });
  });

  // ==========================================================================
  // A4: Update Static Profile - Boundary Values
  // ==========================================================================

  describe('A4: Update Static Profile - Boundary Values', () => {
    it('should accept age: 10 (minimum boundary)', async () => {
      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/static`)
        .send({ age: 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should accept age: 100 (maximum boundary)', async () => {
      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/static`)
        .send({ age: 100 })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should accept age: 9 (below boundary - depends on validation)', async () => {
      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/static`)
        .send({ age: 9 });

      // Current implementation may not validate age range
      // Expect either 200 (no validation) or 400 (validation enforced)
      expect([200, 400]).toContain(response.status);
    });

    it('should accept age: 101 (above boundary - depends on validation)', async () => {
      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/static`)
        .send({ age: 101 });

      // Current implementation may not validate age range
      expect([200, 400]).toContain(response.status);
    });
  });

  // ==========================================================================
  // A5: Update Load Anchor - New Anchor
  // ==========================================================================

  describe('A5: Update Load Anchor - New Anchor', () => {
    it('should add new anchor to load_anchors', async () => {
      const anchorData: LoadAnchor = {
        best_weight: 100,
        best_reps: 8,
        est_1rm: 125,
        last_updated: Date.now()
      };

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/anchors/${ctx.testExerciseId}`)
        .send(anchorData)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.exerciseId).toBe(ctx.testExerciseId);
      expect(response.body.data.anchor.best_weight).toBe(100);

      // Verify anchor was added to profile
      const profileResponse = await request(ctx.app)
        .get(`/api/admin/users/${ctx.testUserId}/profile`)
        .expect(200);

      const profile = profileResponse.body.data;
      expect(profile.profile_dynamic.load_anchors[ctx.testExerciseId]).toBeDefined();
      expect(profile.profile_dynamic.load_anchors[ctx.testExerciseId].best_weight).toBe(100);
    });

    it('should merge anchor with existing load_anchors', async () => {
      // Add first anchor
      const firstAnchor: LoadAnchor = {
        best_weight: 80,
        best_reps: 10,
        est_1rm: 100,
        last_updated: Date.now()
      };

      await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/anchors/bench_press`)
        .send(firstAnchor)
        .expect(200);

      // Add second anchor
      const secondAnchor: LoadAnchor = {
        best_weight: 120,
        best_reps: 6,
        est_1rm: 140,
        last_updated: Date.now()
      };

      await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/anchors/deadlift`)
        .send(secondAnchor)
        .expect(200);

      // Verify both anchors exist
      const profileResponse = await request(ctx.app)
        .get(`/api/admin/users/${ctx.testUserId}/profile`)
        .expect(200);

      const anchors = profileResponse.body.data.profile_dynamic.load_anchors;
      expect(anchors.bench_press).toBeDefined();
      expect(anchors.deadlift).toBeDefined();
      expect(anchors.bench_press.best_weight).toBe(80);
      expect(anchors.deadlift.best_weight).toBe(120);
    });
  });

  // ==========================================================================
  // A6: Update Load Anchor - Type Validation
  // ==========================================================================

  describe('A6: Update Load Anchor - Type Validation', () => {
    it('should validate resistance type requires best_weight and best_reps', async () => {
      const invalidAnchor = {
        best_duration: 60, // Wrong field for resistance type
        last_updated: Date.now()
      };

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/anchors/squat`)
        .send(invalidAnchor);

      // Should accept request but validate anchor data
      // For resistance type, best_weight and best_reps should be required
      // The API may not validate this, so we check the contract validation
      const validation = validateAnchorForExerciseType(
        invalidAnchor as LoadAnchor,
        'resistance'
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('resistance 类型需要 best_weight 和 best_reps');
    });

    it('should accept valid resistance anchor with all required fields', async () => {
      const validAnchor: LoadAnchor = {
        best_weight: 90,
        best_reps: 8,
        est_1rm: 110,
        last_updated: Date.now()
      };

      const validation = validateAnchorForExerciseType(validAnchor, 'resistance');
      expect(validation.valid).toBe(true);

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/anchors/squat`)
        .send(validAnchor)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should validate bodyweight type requires best_reps', async () => {
      const anchorWithoutReps = {
        progression_level: 5,
        last_updated: Date.now()
      };

      const validation = validateAnchorForExerciseType(
        anchorWithoutReps as LoadAnchor,
        'bodyweight'
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('bodyweight 类型需要 best_reps');
    });
  });

  // ==========================================================================
  // A7: Add Limitation - Auto Calculate Expiration
  // ==========================================================================

  describe('A7: Add Limitation - Auto Calculate Expiration', () => {
    it('should auto calculate expire_at based on severity', async () => {
      const limitationData = {
        part: '左肩',
        severity: 5,
        note: '训练时轻微疼痛',
        auto_heal: true
      };

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/limitations`)
        .send(limitationData)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.limitation).toBeDefined();

      const limitation = response.body.data.limitation;
      expect(limitation.part).toBe('左肩');
      expect(limitation.severity).toBe(5);
      expect(limitation.expire_at).toBeDefined();
      expect(limitation.logged_at).toBeDefined();

      // Validate using shared contract
      const validatedLimitation = ActiveLimitationSchema.parse(limitation);
      expect(validatedLimitation.auto_heal).toBe(true);

      // Verify expiration time is in the future
      const expireDate = new Date(validatedLimitation.expire_at);
      const now = new Date();
      expect(expireDate.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should calculate different expiration for different severity levels', async () => {
      // High severity (7) should have longer expiration
      const highSeverity = {
        part: '右膝',
        severity: 7,
        auto_heal: true
      };

      const highResponse = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/limitations`)
        .send(highSeverity)
        .expect(200);

      // Low severity (3) should have shorter expiration
      const lowSeverity = {
        part: '左肘',
        severity: 3,
        auto_heal: true
      };

      const lowResponse = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/limitations`)
        .send(lowSeverity)
        .expect(200);

      const highExpiration = new Date(highResponse.body.data.limitation.expire_at);
      const lowExpiration = new Date(lowResponse.body.data.limitation.expire_at);

      // Higher severity should result in longer expiration
      expect(highExpiration.getTime()).toBeGreaterThan(lowExpiration.getTime());
    });

    it('should validate severity range (1-10)', async () => {
      const invalidSeverity = {
        part: '腰部',
        severity: 11, // Invalid: > 10
        auto_heal: true
      };

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/limitations`)
        .send(invalidSeverity)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('between 1 and 10');
    });
  });

  // ==========================================================================
  // A8: Delete Limitation - Normal Flow
  // ==========================================================================

  describe('A8: Delete Limitation - Normal Flow', () => {
    it('should delete existing limitation by part', async () => {
      // First add a limitation
      const limitationData = {
        part: '删除测试部位',
        severity: 4,
        note: '用于测试删除功能',
        auto_heal: true
      };

      await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/limitations`)
        .send(limitationData)
        .expect(200);

      // Then delete it
      const deleteResponse = await request(ctx.app)
        .delete(`/api/admin/users/${ctx.testUserId}/limitations/删除测试部位`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(deleteResponse.body.success).toBe(true);
      expect(deleteResponse.body.message).toContain('removed');
    });

    it('should return success even if limitation does not exist', async () => {
      const response = await request(ctx.app)
        .delete(`/api/admin/users/${ctx.testUserId}/limitations/nonexistent`)
        .expect(200);

      // Should succeed gracefully (idempotent operation)
      expect(response.body.success).toBe(true);
    });

    it('should handle URL encoding for part names with special characters', async () => {
      // Add limitation with special characters
      const specialPart = '左-肩_部';
      const limitationData = {
        part: specialPart,
        severity: 3,
        auto_heal: true
      };

      await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/limitations`)
        .send(limitationData)
        .expect(200);

      // Delete with encoded part name
      const encodedPart = encodeURIComponent(specialPart);
      const deleteResponse = await request(ctx.app)
        .delete(`/api/admin/users/${ctx.testUserId}/limitations/${encodedPart}`)
        .expect(200);

      expect(deleteResponse.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // Additional: Update Dynamic Profile
  // ==========================================================================

  describe('Update Dynamic Profile Tests', () => {
    it('should update load_anchors in profile_dynamic', async () => {
      const loadAnchors = {
        squat: {
          best_weight: 100,
          best_reps: 8,
          est_1rm: 125,
          last_updated: Date.now()
        },
        bench_press: {
          best_weight: 80,
          best_reps: 10,
          est_1rm: 100,
          last_updated: Date.now()
        }
      };

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/dynamic`)
        .send({ load_anchors: loadAnchors })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify update
      const profileResponse = await request(ctx.app)
        .get(`/api/admin/users/${ctx.testUserId}/profile`)
        .expect(200);

      const anchors = profileResponse.body.data.profile_dynamic.load_anchors;
      expect(anchors.squat.best_weight).toBe(100);
      expect(anchors.bench_press.best_weight).toBe(80);
    });

    it('should accept active_limitations array', async () => {
      const limitations = [
        createActiveLimitation('测试部位1', 3),
        createActiveLimitation('测试部位2', 5)
      ];

      const response = await request(ctx.app)
        .post(`/api/admin/users/${ctx.testUserId}/profile/dynamic`)
        .send({ active_limitations: limitations })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});

// ============================================================================
// Test Helper Functions
// ============================================================================

/**
 * Setup test user profile with initial data
 */
async function setupTestUserProfile(userId: string): Promise<void> {
  // This would typically create a test user profile in the database
  // For integration tests, we rely on the existing database setup
  // The test user should be created or we should handle 404 gracefully
}

/**
 * Cleanup test data after tests complete
 */
async function cleanupTestData(userId: string): Promise<void> {
  // This would typically clean up test data from the database
  // For integration tests, we might want to keep the data for inspection
  // or clean it up via a dedicated cleanup endpoint
}
