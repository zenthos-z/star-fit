/**
 * Tests for useLoadAnchors hook
 *
 * @version 2.0.0
 */

import { vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLoadAnchors, clearAnchorsCache } from '../useLoadAnchors';
import type { LoadAnchors, LoadAnchor } from 'shared/contracts';

// Mock the WebSocket client
vi.mock('../../services/transport/WebSocketClient', () => ({
  socketService: {
    subscribe: jest.fn(() => jest.fn())
  }
}));

// Mock the geminiService（hook 经 '@/services/geminiService' 动态导入，
// vitest alias '@' 指向仓库根，这里同时 mock 两种解析路径以保证命中）
vi.mock('../../services/geminiService', () => ({
  API_BASE: 'http://localhost:43111/api',
  getHeaders: vi.fn(() => ({
    'Content-Type': 'application/json',
    'X-User-Id': 'test-user'
  })),
  getUserId: vi.fn(() => 'test-user')
}));
vi.mock('@/services/geminiService', () => ({
  API_BASE: 'http://localhost:43111/api',
  getHeaders: vi.fn(() => ({
    'Content-Type': 'application/json',
    'X-User-Id': 'test-user'
  })),
  getUserId: vi.fn(() => 'test-user')
}));

// Mock services/api（hook 内部 `await import('../services/api')` 使用 ProfileService）
const { mockGetLoadAnchors, mockUpdateLoadAnchor } = vi.hoisted(() => ({
  mockGetLoadAnchors: vi.fn(),
  mockUpdateLoadAnchor: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  ProfileService: {
    getLoadAnchors: mockGetLoadAnchors,
    updateLoadAnchor: mockUpdateLoadAnchor,
  },
}));

// Mock fetch globally（deleteAnchor 的直连 fetch 用）
global.fetch = vi.fn();


// ProfileServiceV2.handleResponse 走 response.text()；统一构造同时带 text/json 的 mock 响应
const mockResponse = (data: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? 'OK' : 'Internal Server Error',
  text: async () => JSON.stringify(data),
  json: async () => data,
});

describe('useLoadAnchors', () => {
  // ProfileServiceV2 经 Zod 校验 user_id 必须 UUID
  const mockUserId = '00000000-0000-4000-8000-000000000123';
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
    clearAnchorsCache();
  });

  describe('Data fetching on mount', () => {
    it('should fetch load anchors on mount', async () => {
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.anchors).toEqual(mockAnchors);
      expect(result.current.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      mockGetLoadAnchors.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });

    it('should handle empty anchors', async () => {
      mockGetLoadAnchors.mockResolvedValueOnce({});

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
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const benchPress = result.current.getAnchor('bench_press');
      expect(benchPress).toEqual(mockAnchors.bench_press);
      expect(benchPress?.best_weight).toBe(100);
    });

    it('should return undefined for non-existent exercise', async () => {
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);

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

      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors)
      mockGetLoadAnchors.mockResolvedValueOnce({
        ...mockAnchors,
        bench_press: updatedAnchor
      });

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

      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors)
      mockGetLoadAnchors.mockResolvedValueOnce({ ...mockAnchors, deadlift: newAnchor });

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
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);
      mockUpdateLoadAnchor.mockRejectedValueOnce(new Error('Update failed'));

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
      }).rejects.toThrow('Update failed');
    });

    it('should throw error when userId is empty', async () => {
      // 空 userId 时 hook 的 loadAnchors 提前 return——同理不要 queue fetch 值（防泄漏队列）。
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
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);

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
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);
      // DELETE 请求（直连 fetch）→ ok 响应
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse({ message: 'deleted' }));
      // 删除后 refetch
      mockGetLoadAnchors.mockResolvedValueOnce((() => {
        const { bench_press, ...remaining } = mockAnchors as Record<string, unknown>;
        return remaining;
      })());

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
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);
      // deleteAnchor → deleteLoadAnchorApi 用直连 fetch；rejection 由 fetch 抛出
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Delete failed'));

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let caught: unknown = null;
      await act(async () => {
        try {
          await result.current.deleteAnchor('bench_press');
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('Delete failed');
    });

    it('should throw error when userId is empty', async () => {
      // 空 userId 时 hook 的 loadAnchors 提前 return——此处不要 queue 任何 fetch 值，
      // 否则成为泄漏队列污染后续用例（delete errors 曾因此吃到残留 resolved 值而不抛错）。
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
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);

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

      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors)
      mockGetLoadAnchors.mockResolvedValueOnce(updatedAnchors);

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
      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors);

      const { result, rerender } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetLoadAnchors).toHaveBeenCalledTimes(1);

      // Re-render with same userId - should use cache
      rerender();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should not be called again due to cache
      expect(mockGetLoadAnchors).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebSocket event handling', () => {
    it('should subscribe to WebSocket events on mount', async () => {
      const { socketService } = await import('../../services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(unsubscribe);

      renderHook(() => useLoadAnchors(mockUserId));

      expect(socketService.subscribe).toHaveBeenCalledWith('load_anchors_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('profile_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('profile_dynamic_updated', expect.any(Function));
    });

    it('should unsubscribe from WebSocket events on unmount', async () => {
      const { socketService } = await import('../../services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(unsubscribe);

      const { unmount } = renderHook(() => useLoadAnchors(mockUserId));

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });

    it('should refetch when receiving load_anchors_updated event for current user', async () => {
      const { socketService } = await import('../../services/transport/WebSocketClient');
      let eventHandler: ((payload: any) => void) | null = null;

      (socketService.subscribe as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: (payload: any) => void) => {
        if (event === 'load_anchors_updated') {
          eventHandler = handler;
        }
        return jest.fn();
      });

      mockGetLoadAnchors.mockResolvedValueOnce(mockAnchors)
      mockGetLoadAnchors.mockResolvedValueOnce({
        ...mockAnchors,
        deadlift: {
          best_weight: 180,
          best_reps: 5,
          est_1rm: 200,
          last_updated: Date.now()
        }
      });

      const { result } = renderHook(() => useLoadAnchors(mockUserId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetLoadAnchors).toHaveBeenCalledTimes(1);

      // Simulate WebSocket event
      act(() => {
        eventHandler?.({ userId: mockUserId });
      });

      await waitFor(() => {
        expect(mockGetLoadAnchors).toHaveBeenCalledTimes(2);
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
