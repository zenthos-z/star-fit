/**
 * ProfileServiceV2 Tests
 *
 * Unit tests for the ProfileServiceV2 API client.
 * Uses mock fetch to simulate API responses.
 *
 * @version 2.0.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileService, ProfileServiceError } from '../ProfileServiceV2';
import type { UserProfileV2, ProfileStatic, ProfileDynamic, LoadAnchor, ActiveLimitation } from 'shared/contracts';

// Mock the geminiService imports
vi.mock('../../../services/geminiService', () => ({
  API_BASE: 'http://localhost:43111/api',
  getHeaders: (extra: Record<string, string> = {}, includeContentType = true) => ({
    'X-User-Id': '00000000-0000-4000-8000-000000000999',
    'Content-Type': includeContentType ? 'application/json' : undefined,
    ...extra
  })
}));

describe('ProfileServiceV2', () => {
  // Mock fetch
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    mockFetch.mockClear();
    global.fetch = originalFetch;
  });

  const mockUserId = '00000000-0000-4000-8000-000000000001';
  const mockProfileV2: UserProfileV2 = {
    protocol_version: '2.0.0',
    user_id: mockUserId,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-15T00:00:00.000Z',
    profile_static: {
      age: 30,
      weight: 75,
      height: 180
    },
    profile_dynamic: {
      load_anchors: {
        'bench_press': {
          best_weight: 100,
          best_reps: 8,
          est_1rm: 120,
          last_updated: Date.now()
        }
      },
      active_limitations: []
    },
    history_summary: {
      recent_summary: 'Test summary'
    },
  };

  const mockProfileStatic: ProfileStatic = {
    age: 30,
    weight: 75,
    height: 180,
    body_fat_percentage: 15,
    neuro_type: 'type_2a',
    risk_preference: 'moderate',
    accountability: 'high'
  };

  const mockProfileDynamic: ProfileDynamic = {
    load_anchors: {
      'squat': {
        best_weight: 140,
        best_reps: 5,
        est_1rm: 160,
        last_updated: Date.now()
      }
    },
    active_limitations: [
      {
        part: 'left_shoulder',
        severity: 5,
        expire_at: '2024-02-01T00:00:00.000Z',
        logged_at: '2024-01-15T00:00:00.000Z',
        auto_heal: true
      }
    ],
    recovery_state: {
      total_score: 75,
      cns_fusing: false,
      last_assessed: '2024-01-15T00:00:00.000Z',
      acute_load: 1000,
      chronic_load: 950
    }
  };

  describe('getProfile', () => {
    it('should fetch and validate user profile', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockProfileV2)
      } as Response);

      const result = await ProfileService.getProfile(mockUserId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:43111/api/profiles/${mockUserId}`,
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toEqual(mockProfileV2);
    });

    it('should throw error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      await expect(ProfileService.getProfile(mockUserId)).rejects.toThrow(ProfileServiceError);
    });

    it('should throw error on invalid JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'invalid json{'
      } as Response);

      await expect(ProfileService.getProfile(mockUserId)).rejects.toThrow();
    });
  });

  describe('getProfileStatic', () => {
    it('should fetch and parse profile static data', async () => {
      const responseWithStatic = {
        ...mockProfileV2,
        profile_static: mockProfileStatic
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseWithStatic)
      } as Response);

      const result = await ProfileService.getProfileStatic(mockUserId);

      expect(result).toEqual(mockProfileStatic);
    });

    it('should return empty object if no static data', async () => {
      const responseWithoutStatic = {
        ...mockProfileV2,
        profile_static: null
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseWithoutStatic)
      } as Response);

      const result = await ProfileService.getProfileStatic(mockUserId);

      expect(result).toEqual({});
    });
  });

  describe('getProfileDynamic', () => {
    it('should fetch and parse profile dynamic data', async () => {
      const responseWithDynamic = {
        ...mockProfileV2,
        profile_dynamic: mockProfileDynamic
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseWithDynamic)
      } as Response);

      const result = await ProfileService.getProfileDynamic(mockUserId);

      expect(result).toEqual(mockProfileDynamic);
    });

    it('should return empty object if no dynamic data', async () => {
      const responseWithoutDynamic = {
        ...mockProfileV2,
        profile_dynamic: null
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseWithoutDynamic)
      } as Response);

      const result = await ProfileService.getProfileDynamic(mockUserId);

      expect(result).toEqual({});
    });
  });

  describe('updateProfileStatic', () => {
    it('should update profile static data', async () => {
      const updates: Partial<ProfileStatic> = {
        weight: 80,
        age: 31
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Profile updated successfully' })
      } as Response);

      await ProfileService.updateProfileStatic(mockUserId, updates);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:43111/api/profiles/${mockUserId}`,
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"profile_static"')
        })
      );
    });
  });

  describe('updateProfileDynamic', () => {
    it('should update profile dynamic data', async () => {
      const updates: Partial<ProfileDynamic> = {
        load_anchors: {
          'deadlift': {
            best_weight: 180,
            best_reps: 5,
            est_1rm: 205,
            last_updated: Date.now()
          }
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Profile updated successfully' })
      } as Response);

      await ProfileService.updateProfileDynamic(mockUserId, updates);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:43111/api/profiles/${mockUserId}`,
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"profile_dynamic"')
        })
      );
    });
  });

  describe('getLoadAnchors', () => {
    it('should fetch load anchors from profile dynamic', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockProfileV2)
      } as Response);

      const result = await ProfileService.getLoadAnchors(mockUserId);

      expect(result).toEqual(mockProfileV2.profile_dynamic?.load_anchors);
    });
  });

  describe('updateLoadAnchor', () => {
    it('should update a single load anchor', async () => {
      const exerciseId = 'bench_press';
      const newAnchor: LoadAnchor = {
        best_weight: 110,
        best_reps: 6,
        est_1rm: 130,
        last_updated: Date.now()
      };

      // First call: get existing anchors
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockProfileV2)
      } as Response);

      // Second call: update profile
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Profile updated successfully' })
      } as Response);

      await ProfileService.updateLoadAnchor(mockUserId, exerciseId, newAnchor);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('addActiveLimitation', () => {
    it('should add a new active limitation', async () => {
      const limitation: ActiveLimitation = {
        part: 'right_knee',
        severity: 6,
        expire_at: '2024-02-15T00:00:00.000Z',
        logged_at: '2024-01-20T00:00:00.000Z',
        auto_heal: true
      };

      // First call: get existing dynamic data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockProfileV2)
      } as Response);

      // Second call: update profile
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Profile updated successfully' })
      } as Response);

      await ProfileService.addActiveLimitation(mockUserId, limitation);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeActiveLimitation', () => {
    it('should remove an active limitation by part', async () => {
      const partToRemove = 'left_shoulder';

      // First call: get existing dynamic data
      const profileWithLimitations = {
        ...mockProfileV2,
        profile_dynamic: mockProfileDynamic
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(profileWithLimitations)
      } as Response);

      // Second call: update profile
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Profile updated successfully' })
      } as Response);

      await ProfileService.removeActiveLimitation(mockUserId, partToRemove);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
