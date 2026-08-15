/**
 * Tests for useLoadAnchors hook
 *
 * @version 2.0.0
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useLoadAnchors } from '../useLoadAnchors';
import type { LoadAnchors, LoadAnchor } from 'shared/contracts';

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

describe('useLoadAnchors', () => {
  const mockUserId = 'test-user-123';
  const mockAnchors: LoadAnchors = {
    bench_press: {
      best_weight: 100,
      best_reps: 5,
      est_1rm: 115,
      last_updated: Date.now()
    },
    squat: {
      best_weight: 140,
      best_reps: 5,
      est_1rm: 160,
      last_updated: Date.now()
    },
    pull_up: {
      best_reps: 15,
      progression_level: 5,
      last_updated: Date.now()
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear cache
    (require('../useLoadAnchors') as any).anchorsCache?.clear?.();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Data fetching on mount', () => {
    it('should fetch load anchors on mount', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnchors
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors).toEqual(mockAnchors);
      expect(result.current.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });

    it('should handle empty anchors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors).toEqual({});
      expect(Object.keys(result.current.anchors).length).toBe(0);
    });
  });

  describe('getAnchor method', () => {
    it('should return correct anchor by exercise ID', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnchors
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const benchPress = result.current.getAnchor('bench_press');
      expect(benchPress).toEqual(mockAnchors.bench_press);
      expect(benchPress?.best_weight).toBe(100);
    });

    it('should return undefined for non-existent exercise', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnchors
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const nonExistent = result.current.getAnchor('deadlift');
      expect(nonExistent).toBeUndefined();
    });
  });

  describe('updateAnchor method', () => {
    it('should update an existing anchor', async () => {
      const updatedAnchor: LoadAnchor = {
        best_weight: 110,
        best_reps: 5,
        est_1rm: 125,
        last_updated: Date.now()
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnchors
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({} as Response)
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockAnchors,
            bench_press: updatedAnchor
          })
        } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateAnchor('bench_press', updatedAnchor);
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors.bench_press).toEqual(updatedAnchor);
      expect(result.current.anchors.bench_press?.best_weight).toBe(110);
    });

    it('should create a new anchor', async () => {
      const newAnchor: LoadAnchor = {
        best_weight: 180,
        best_reps: 5,
        est_1rm: 200,
        last_updated: Date.now()
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnchors
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({} as Response)
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockAnchors,
            deadlift: newAnchor
          })
        } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateAnchor('deadlift', newAnchor);
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors.deadlift).toEqual(newAnchor);
      expect(result.current.getAnchor('deadlift')).toEqual(newAnchor);
    });

    it('should handle update errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnchors
        } as Response)
        .mockRejectedValueOnce(new Error('Update failed'));

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.updateAnchor('bench_press', {
            best_weight: 110,
            best_reps: 5,
            est_1rm: 125,
            last_updated: Date.now()
          });
        });
      }).rejects.toThrow('Failed to update load anchor');
    });

    it('should throw error when userId is empty', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(''));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.updateAnchor('bench_press', {
            best_weight: 100,
            best_reps: 5,
            est_1rm: 115,
            last_updated: Date.now()
          });
        });
      }).rejects.toThrow('User ID is required');
    });

    it('should throw error when exerciseId is empty', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnchors
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.updateAnchor('', {
            best_weight: 100,
            best_reps: 5,
            est_1rm: 115,
            last_updated: Date.now()
          });
        });
      }).rejects.toThrow('Exercise ID is required');
    });
  });

  describe('deleteAnchor method', () => {
    it('should delete an existing anchor', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnchors
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({} as Response)
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            const { bench_press, ...remaining } = mockAnchors;
            return remaining;
          }
        } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors.bench_press).toBeDefined();

      await act(async () => {
        await result.current.deleteAnchor('bench_press');
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors.bench_press).toBeUndefined();
      expect(result.current.getAnchor('bench_press')).toBeUndefined();
    });

    it('should handle delete errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnchors
        } as Response)
        .mockRejectedValueOnce(new Error('Delete failed'));

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.deleteAnchor('bench_press');
        });
      }).rejects.toThrow('Failed to delete load anchor');
    });

    it('should throw error when userId is empty', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(''));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.deleteAnchor('bench_press');
        });
      }).rejects.toThrow('User ID is required');
    });

    it('should throw error when exerciseId is empty', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnchors
      } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.deleteAnchor('');
        });
      }).rejects.toThrow('Exercise ID is required');
    });
  });

  describe('refetch method', () => {
    it('should refetch load anchors', async () => {
      const updatedAnchors: LoadAnchors = {
        ...mockAnchors,
        overhead_press: {
          best_weight: 60,
          best_reps: 8,
          est_1rm: 75,
          last_updated: Date.now()
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnchors
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => updatedAnchors
        } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors.overhead_press).toBeUndefined();

      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors.overhead_press).toBeDefined();
      expect(result.current.anchors.overhead_press?.best_weight).toBe(60);
    });
  });

  describe('Cache behavior', () => {
    it('should use cached data if available and fresh', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnchors
      } as Response);

      const { result, rerender } = renderHook(() => useLoadAnchors(mockUserId));

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
  });

  describe('WebSocket event handling', () => {
    it('should subscribe to WebSocket events on mount', () => {
      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as jest.Mock).mockReturnValue(unsubscribe);

      renderHook(() => useLoadAnchors(mockUserId));

      expect(socketService.subscribe).toHaveBeenCalledWith('load_anchors_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('profile_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('profile_dynamic_updated', expect.any(Function));
    });

    it('should unsubscribe from WebSocket events on unmount', () => {
      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as jest.Mock).mockReturnValue(unsubscribe);

      const { unmount } = renderHook(() => useLoadAnchors(mockUserId));

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });

    it('should refetch when receiving load_anchors_updated event for current user', async () => {
      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      let eventHandler: ((payload: any) => void) | null = null;

      (socketService.subscribe as jest.Mock).mockImplementation((event: string, handler: (payload: any) => void) => {
        if (event === 'load_anchors_updated') {
          eventHandler = handler;
        }
        return jest.fn();
      });

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockAnchors
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockAnchors,
            deadlift: {
              best_weight: 180,
              best_reps: 5,
              est_1rm: 200,
              last_updated: Date.now()
            }
          })
        } as Response);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

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
  });

  describe('Edge cases', () => {
    it('should handle empty userId', async () => {
      const { result } = renderHook(() => useLoadAnchors(''));

      expect(result.current.loading).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
