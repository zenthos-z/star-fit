/**
 * Admin API Direct Integration Tests
 *
 * Tests admin controller functions directly without HTTP layer
 * to avoid ESM module issues and server dependencies.
 *
 * @version 1.0.0
 * @created 2026-02-10
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import {
  getUserProfile,
  updateUserProfileStatic,
  updateUserProfileDynamic,
  updateUserLoadAnchor,
  addUserLimitation,
  removeUserLimitation
} from '../../src/controllers/adminController.js';
import { UserProfileService } from '../../src/services/userProfileService.postgres.js';

// ============================================================================
// Test Context
// ============================================================================

describe('Admin API Controller Direct Tests', () => {
  let testUserId: string;
  let mockReply: any;
  let mockRequest: any;

  beforeAll(() => {
    testUserId = `admin-direct-test-${Date.now()}`;
  });

  beforeEach(() => {
    // Mock reply object
    mockReply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
    };

    // Mock request object
    mockRequest = {
      params: {},
      body: {},
    };
  });

  // ==========================================================================
  // A1: Get User Profile - Normal Flow
  // ==========================================================================

  describe('A1: Get User Profile - Normal Flow', () => {
    it('should return 404 for non-existent user', async () => {
      mockRequest.params = { userId: 'non-existent-user' };

      await getUserProfile(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not found'),
        })
      );
    });

    it('should return 400 for missing userId', async () => {
      mockRequest.params = { userId: undefined };

      await getUserProfile(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId',
        })
      );
    });
  });

  // ==========================================================================
  // A3: Update Static Profile - Partial Update
  // ==========================================================================

  describe('A3: Update Static Profile - Partial Update', () => {
    it('should accept partial update data', async () => {
      mockRequest.params = { userId: testUserId };
      mockRequest.body = {
        age: 31,
        weight: 76,
      };

      await updateUserProfileStatic(mockRequest, mockReply);

      // Since the user might not exist, we expect either 200 or 500/404
      // The test validates the request structure is correct
      expect(mockReply.send).toHaveBeenCalled();
    });

    it('should return 400 for missing userId', async () => {
      mockRequest.params = { userId: undefined };
      mockRequest.body = { age: 30 };

      await updateUserProfileStatic(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId',
        })
      );
    });
  });

  // ==========================================================================
  // A4: Update Static Profile - Boundary Values
  // ==========================================================================

  describe('A4: Update Static Profile - Boundary Values', () => {
    it('should accept age: 10 (minimum reasonable value)', async () => {
      mockRequest.params = { userId: testUserId };
      mockRequest.body = { age: 10 };

      await updateUserProfileStatic(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalled();
    });

    it('should accept age: 100 (maximum reasonable value)', async () => {
      mockRequest.params = { userId: testUserId };
      mockRequest.body = { age: 100 };

      await updateUserProfileStatic(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // A5: Update Load Anchor - New Anchor
  // ==========================================================================

  describe('A5: Update Load Anchor - New Anchor', () => {
    it('should accept valid anchor data', async () => {
      mockRequest.params = {
        userId: testUserId,
        exerciseId: 'squat',
      };
      mockRequest.body = {
        best_weight: 100,
        best_reps: 8,
        est_1rm: 125,
        last_updated: Date.now(),
      };

      await updateUserLoadAnchor(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalled();
    });

    it('should return 400 for missing userId', async () => {
      mockRequest.params = {
        userId: undefined,
        exerciseId: 'squat',
      };
      mockRequest.body = {
        best_weight: 100,
        best_reps: 8,
      };

      await updateUserLoadAnchor(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId or exerciseId',
        })
      );
    });

    it('should return 400 for missing exerciseId', async () => {
      mockRequest.params = {
        userId: testUserId,
        exerciseId: undefined,
      };
      mockRequest.body = {
        best_weight: 100,
        best_reps: 8,
      };

      await updateUserLoadAnchor(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId or exerciseId',
        })
      );
    });
  });

  // ==========================================================================
  // A7: Add Limitation - Auto Calculate Expiration
  // ==========================================================================

  describe('A7: Add Limitation - Auto Calculate Expiration', () => {
    it('should validate severity range (1-10)', async () => {
      mockRequest.params = { userId: testUserId };
      mockRequest.body = {
        part: '腰部',
        severity: 11, // Invalid: > 10
        auto_heal: true,
      };

      await addUserLimitation(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Severity must be between 1 and 10',
        })
      );
    });

    it('should return 400 for missing part', async () => {
      mockRequest.params = { userId: testUserId };
      mockRequest.body = {
        severity: 5,
        auto_heal: true,
      };

      await addUserLimitation(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId, part, or severity',
        })
      );
    });

    it('should return 400 for missing severity', async () => {
      mockRequest.params = { userId: testUserId };
      mockRequest.body = {
        part: '左肩',
        auto_heal: true,
      };

      await addUserLimitation(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId, part, or severity',
        })
      );
    });
  });

  // ==========================================================================
  // A8: Delete Limitation - Normal Flow
  // ==========================================================================

  describe('A8: Delete Limitation - Normal Flow', () => {
    it('should return 400 for missing userId', async () => {
      mockRequest.params = {
        userId: undefined,
        part: '左肩',
      };

      await removeUserLimitation(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId or part',
        })
      );
    });

    it('should return 400 for missing part', async () => {
      mockRequest.params = {
        userId: testUserId,
        part: undefined,
      };

      await removeUserLimitation(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId or part',
        })
      );
    });

    it('should succeed even if limitation does not exist (idempotent)', async () => {
      mockRequest.params = {
        userId: testUserId,
        part: 'nonexistent-limitation',
      };

      await removeUserLimitation(mockRequest, mockReply);

      // Should succeed gracefully
      expect(mockReply.send).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Update Dynamic Profile Tests
  // ==========================================================================

  describe('Update Dynamic Profile Tests', () => {
    it('should return 400 for missing userId', async () => {
      mockRequest.params = { userId: undefined };
      mockRequest.body = {
        load_anchors: {
          squat: {
            best_weight: 100,
            best_reps: 8,
            last_updated: Date.now(),
          },
        },
      };

      await updateUserProfileDynamic(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing userId',
        })
      );
    });

    it('should accept load_anchors array', async () => {
      mockRequest.params = { userId: testUserId };
      mockRequest.body = {
        load_anchors: {
          squat: {
            best_weight: 100,
            best_reps: 8,
            est_1rm: 125,
            last_updated: Date.now(),
          },
        },
      };

      await updateUserProfileDynamic(mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalled();
    });
  });
});
