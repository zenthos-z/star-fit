/**
 * Tests for useExercises hook
 *
 * @version 2.0.0
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useExercises } from '../useExercises';
import type { ParsedExercise, MuscleTarget } from '../../services/api/ExerciseServiceV2';

// Mock the WebSocket client
jest.mock('@/v2/services/transport/WebSocketClient', () => ({
  socketService: {
    subscribe: jest.fn(() => jest.fn())
  }
}));

// Mock fetch globally
global.fetch = jest.fn();

describe('useExercises', () => {
  const mockExercises: ParsedExercise[] = [
    {
      id: 'ex-1',
      name: 'Bench Press',
      exercise_type: 'resistance',
      targets: { primary: ['中下胸'], secondary: ['前束', '三头'] },
      equipment_required: ['barbell', 'bench'],
      difficulty: 'intermediate',
      modified_by: 'admin',
      modified_at: Date.now()
    },
    {
      id: 'ex-2',
      name: 'Squat',
      exercise_type: 'resistance',
      targets: { primary: ['股四', '腘绳'], secondary: ['臀部' as MuscleTarget] },
      equipment_required: ['barbell', 'rack'],
      difficulty: 'advanced',
      modified_by: 'admin',
      modified_at: Date.now()
    },
    {
      id: 'ex-3',
      name: 'Push-up',
      exercise_type: 'bodyweight',
      targets: { primary: ['中下胸'], secondary: ['三头'] },
      equipment_required: [],
      difficulty: 'beginner',
      modified_by: 'admin',
      modified_at: Date.now(),
      tags: ['push', 'compound']
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear module cache
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Data fetching on mount', () => {
    it('should fetch exercises on mount', async () => {
      // Mock ExerciseService
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockResolvedValue(mockExercises)
        }
      }));

      const { result } = renderHook(() => useExercises());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.exercises).toEqual(mockExercises);
      expect(result.current.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      // Mock ExerciseService to throw error
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockRejectedValue(new Error('Network error'))
        }
      }));

      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });

    it('should handle empty exercise list', async () => {
      // Mock ExerciseService with empty array
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockResolvedValue([])
        }
      }));

      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.exercises).toEqual([]);
      expect(result.current.exercises.length).toBe(0);
    });
  });

  describe('Filtering methods', () => {
    beforeEach(async () => {
      // Mock ExerciseService
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockResolvedValue(mockExercises)
        }
      }));
    });

    it('should get exercise by ID', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const exercise = result.current.getExerciseById('ex-1');
      expect(exercise).toEqual(mockExercises[0]);
      expect(exercise?.name).toBe('Bench Press');
    });

    it('should return undefined for non-existent ID', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const exercise = result.current.getExerciseById('non-existent');
      expect(exercise).toBeUndefined();
    });

    it('should get exercise by name', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const exercise = result.current.getExerciseByName('Squat');
      expect(exercise).toEqual(mockExercises[1]);
      expect(exercise?.difficulty).toBe('advanced');
    });

    it('should filter by target muscle', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const chestExercises = result.current.getExercisesByTarget('中下胸');
      expect(chestExercises).toHaveLength(2);
      expect(chestExercises.every(ex => ex.targets.primary.includes('中下胸'))).toBe(true);
    });

    it('should filter by difficulty', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const beginnerExercises = result.current.getExercisesByDifficulty('beginner');
      expect(beginnerExercises).toHaveLength(1);
      expect(beginnerExercises[0].name).toBe('Push-up');
    });

    it('should filter by exercise type', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const bodyweightExercises = result.current.getExercisesByType('bodyweight');
      expect(bodyweightExercises).toHaveLength(1);
      expect(bodyweightExercises[0].name).toBe('Push-up');
    });
  });

  describe('Search functionality', () => {
    beforeEach(async () => {
      // Mock ExerciseService
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockResolvedValue(mockExercises)
        }
      }));
    });

    it('should search by exercise name', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const results = result.current.searchExercises('bench');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Bench Press');
    });

    it('should search by tags', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const results = result.current.searchExercises('push');
      expect(results).toHaveLength(1);
      expect(results[0].tags).toContain('push');
    });

    it('should search by target muscle', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const results = result.current.searchExercises('胸部');
      expect(results).toHaveLength(2);
    });

    it('should handle empty search query', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const results = result.current.searchExercises('');
      expect(results).toEqual(mockExercises);
      expect(results.length).toBe(3);
    });

    it('should return empty array for non-matching search', async () => {
      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const results = result.current.searchExercises('nonexistent exercise');
      expect(results).toEqual([]);
    });
  });

  describe('refetch method', () => {
    it('should refetch exercises', async () => {
      const updatedExercises = [
        ...mockExercises,
        {
          id: 'ex-4',
          name: 'Deadlift',
          exercise_type: 'resistance',
          targets: { primary: ['背部', '腘绳'] },
          equipment_required: ['barbell'],
          difficulty: 'advanced',
          modified_by: 'admin',
          modified_at: Date.now()
        }
      ];

      let mockCallCount = 0;
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockImplementation(() => {
            mockCallCount++;
            if (mockCallCount === 1) {
              return Promise.resolve(mockExercises);
            } else {
              return Promise.resolve(updatedExercises);
            }
          })
        }
      }));

      const { result } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.exercises.length).toBe(3);

      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.exercises.length).toBe(4);
      expect(result.current.getExerciseByName('Deadlift')).toBeDefined();
    });
  });

  describe('Cache behavior', () => {
    it('should use cached data for multiple hook instances', async () => {
      jest.doMock('../services/api/ExerciseServiceV2', () => {
        const ExerciseService = {
          getAllExercises: jest.fn().mockResolvedValue(mockExercises)
        };
        return { ExerciseService };
      });

      // First hook instance
      const { result: result1 } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
      });

      // Second hook instance should use cache
      const { result: result2 } = renderHook(() => useExercises());

      await waitFor(() => {
        expect(result2.current.loading).toBe(false);
      });

      expect(result1.current.exercises).toEqual(result2.current.exercises);
    });
  });

  describe('WebSocket event handling', () => {
    it('should subscribe to exercise update events', async () => {
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockResolvedValue(mockExercises)
        }
      }));

      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as jest.Mock).mockReturnValue(unsubscribe);

      renderHook(() => useExercises());

      expect(socketService.subscribe).toHaveBeenCalledWith('exercise_library_updated', expect.any(Function));
      expect(socketService.subscribe).toHaveBeenCalledWith('exercise_updated', expect.any(Function));
    });

    it('should unsubscribe from events on unmount', async () => {
      jest.doMock('../services/api/ExerciseServiceV2', () => ({
        ExerciseService: {
          getAllExercises: jest.fn().mockResolvedValue(mockExercises)
        }
      }));

      const { socketService } = require('@/v2/services/transport/WebSocketClient');
      const unsubscribe = jest.fn();
      (socketService.subscribe as jest.Mock).mockReturnValue(unsubscribe);

      const { unmount } = renderHook(() => useExercises());

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
