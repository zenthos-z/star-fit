/**
 * Tests for useProfileV2 hook
 *
 * @version 2.0.0
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useProfileV2 } from '../useProfileV2';
import type { UserProfileV2, ProfileStatic, ProfileDynamic, HistorySummary } from 'shared/contracts';

// Mock the WebSocket client
jest.mock('@/v2/services/transport/WebSocketClient', () => ({
  socketService: {
    subscribe: jest.fn(() => jest.fn())
  }
}));

// Mock the geminiService
jest.mock('@/services/geminiService', () => ({
  API_BASE: 'http://localhost:43111/api',
  getHeaders: jest.fn(() => ({
    'Content-Type': 'application/json',
    'X-User-Id': 'test-user'
  }))
}));

// Mock fetch globally
global.fetch = jest.fn();

describe('useProfileV2', () => {
  const mockUserId = 'test-user-123';
  const mockProfile: UserProfileV2 = {
    protocol_version: '2.0.0',
    user_id: mockUserId,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    profile_static: {
      age: 30,
      weight: 75,
      height: 180,
      neuro_type: 'type_2a',
      risk_preference: 'moderate',
      accountability: 'medium'
    } as ProfileStatic,
    profile_dynamic: {
      load_anchors: {
        bench_press: {
          best_weight: 100,
          best_reps: 5,
          est_1rm: 115,
          last_updated: Date.now()
        }
      }
    } as ProfileDynamic,
    history_summary: {
      key_metrics: {
        total_sessions: 50,
        personal_records: 10,
        injury_count: 0
      }
    } as HistorySummary,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear cache
    (require('../useProfileV2') as any).profileCache?.clear?.();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Data fetching on mount', () => {
    it('should fetch profile data on mount', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfile
      } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profile).toEqual(mockProfile);
      expect(result.current.profileStatic).toEqual(mockProfile.profile_static);
      expect(result.current.profileDynamic).toEqual(mockProfile.profile_dynamic);
      expect(result.current.historySummary).toEqual(mockProfile.history_summary);
      expect(result.current.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain('404');
    });
  });

  describe('Cache behavior', () => {
    it('should use cached data if available and fresh', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfile
      } as Response);

      // First render - should fetch
      const { result, rerender } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Re-render with same userId - should use cache
      rerender();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Fetch should not be called again due to cache
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should refetch when cache is invalidated via refetch()', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProfile
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockProfile,
            profile_static: {
              ...mockProfile.profile_static,
              age: 31
            } as ProfileStatic
          })
        } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Call refetch
      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.current.profileStatic?.age).toBe(31);
    });
  });

  describe('WebSocket event handling', () => {
    it('should subscribe to WebSocket events on mount', () => {
      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as jest.Mock).mockReturnValue(unsubscribe);

      renderHook(() => useProfileV2(mockUserId));

      expect(socketService.subscribe).toHaveBeenCalledWith('profile_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('profile_static_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('profile_dynamic_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('history_summary_updated', expect.any(Function));
    });

    it('should unsubscribe from WebSocket events on unmount', () => {
      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as jest.Mock).mockReturnValue(unsubscribe);

      const { unmount } = renderHook(() => useProfileV2(mockUserId));

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });

    it('should refetch when receiving profile_updated event for current user', async () => {
      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      let eventHandler: ((payload: any) => void) | null = null;

      (socketService.subscribe as jest.Mock).mockImplementation((event: string, handler: (payload: any) => void) => {
        if (event === 'profile_updated') {
          eventHandler = handler;
        }
        return jest.fn();
      });

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProfile
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockProfile,
            updated_at: '2024-01-02T00:00:00.000Z'
          })
        } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Simulate WebSocket event
      act(() => {
        eventHandler?.({ userId: mockUserId });
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    });

    it('should ignore WebSocket events for other users', async () => {
      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      let eventHandler: ((payload: any) => void) | null = null;

      (socketService.subscribe as jest.Mock).mockImplementation((event: string, handler: (payload: any) => void) => {
        if (event === 'profile_updated') {
          eventHandler = handler;
        }
        return jest.fn();
      });

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfile
      } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Simulate WebSocket event for different user
      act(() => {
        eventHandler?.({ userId: 'other-user' });
      });

      // Should not refetch
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Update methods', () => {
    it('should update static state and refetch', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProfile
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({} as Response)
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockProfile,
            profile_static: {
              ...mockProfile.profile_static,
              age: 35
            } as ProfileStatic
          })
        } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateStatic({ age: 35 });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profileStatic?.age).toBe(35);
    });

    it('should update dynamic state and refetch', async () => {
      const updatedAnchors = {
        squat: {
          best_weight: 140,
          best_reps: 5,
          est_1rm: 160,
          last_updated: Date.now()
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProfile
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({} as Response)
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockProfile,
            profile_dynamic: {
              load_anchors: updatedAnchors
            } as ProfileDynamic
          })
        } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateDynamic({ load_anchors: updatedAnchors });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profileDynamic?.load_anchors).toEqual(updatedAnchors);
    });

    it('should handle update errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProfile
        } as Response)
        .mockRejectedValueOnce(new Error('Update failed'));

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.updateStatic({ age: 35 });
        });
      }).rejects.toThrow('Failed to update static state');
    });
  });

  describe('Loading states', () => {
    it('should set loading to true while fetching', async () => {
      let resolveFetch: (value: any) => void;
      const fetchPromise = new Promise(resolve => {
        resolveFetch = resolve;
      });

      (global.fetch as jest.MockedFunction<typeof fetch>).mockReturnValueOnce(
        fetchPromise as any
      );

      const { result } = renderHook(() => useProfileV2(mockUserId));

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolveFetch!({
          ok: true,
          json: async () => mockProfile
        } as Response);
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty userId', async () => {
      const { result } = renderHook(() => useProfileV2(''));

      expect(result.current.loading).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle null profile data', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => null
      } as Response);

      const { result } = renderHook(() => useProfileV2(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.profile).toBeNull();
      expect(result.current.profileStatic).toBeNull();
      expect(result.current.profileDynamic).toBeNull();
      expect(result.current.historySummary).toBeNull();
    });
  });
});
