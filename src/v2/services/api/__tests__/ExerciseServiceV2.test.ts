/**
 * ExerciseServiceV2 Tests
 *
 * Unit tests for the ExerciseServiceV2 API client.
 * Uses mock fetch to simulate API responses.
 *
 * @version 2.0.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExerciseService, ExerciseServiceError, type ParsedExercise, type Exercise } from '../ExerciseServiceV2';

// Mock the geminiService imports
vi.mock('../../../services/geminiService', () => ({
  API_BASE: 'http://localhost:43111/api',
  getHeaders: (extra: Record<string, string> = {}, includeContentType = true) => ({
    'X-User-Id': 'test-user-id',
    'Content-Type': includeContentType ? 'application/json' : undefined,
    ...extra
  })
}));

describe('ExerciseServiceV2', () => {
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

  const mockExercise: Exercise = {
    id: 'exercise-123',
    name: 'Bench Press',
    exercise_type: 'resistance',
    targets: JSON.stringify({ primary: ['中下胸'], secondary: ['前束', '三头'] }),
    equipment_required: JSON.stringify(['barbell', 'bench']),
    difficulty: 'intermediate',
    content_html: '<p>Bench press instructions...</p>',
    assets_json: JSON.stringify({ cover: '/images/bench-press.jpg' }),
    tags_json: JSON.stringify(['push', 'compound']),
    modified_by: 'admin',
    modified_at: Date.now(),
    updated_at: Date.now(),
    protocol_version: '2.0.0',
    version: 1,
    metadata_json: JSON.stringify({ category: 'chest' })
  };

  const mockExerciseList: Exercise[] = [
    mockExercise,
    {
      id: 'exercise-456',
      name: 'Squat',
      exercise_type: 'resistance',
      targets: JSON.stringify({ primary: ['股四', '腘绳'], secondary: ['臀部'] }),
      equipment_required: JSON.stringify(['barbell', 'rack']),
      difficulty: 'advanced',
      modified_by: 'admin',
      modified_at: Date.now()
    }
  ];

  describe('getAllExercises', () => {
    it('should fetch and parse all exercises', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockExerciseList)
      } as Response);

      const result = await ExerciseService.getAllExercises();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises',
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'exercise-123',
        name: 'Bench Press',
        targets: { primary: ['中下胸'], secondary: ['前束', '三头'] },
        equipment_required: ['barbell', 'bench']
      });
    });

    it('should throw error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      await expect(ExerciseService.getAllExercises()).rejects.toThrow(ExerciseServiceError);
    });

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([])
      } as Response);

      const result = await ExerciseService.getAllExercises();

      expect(result).toEqual([]);
    });
  });

  describe('getExerciseById', () => {
    it('should fetch and parse exercise by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockExercise)
      } as Response);

      const result = await ExerciseService.getExerciseById('exercise-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/exercise-123',
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toMatchObject({
        id: 'exercise-123',
        name: 'Bench Press',
        exercise_type: 'resistance'
      });
    });

    it('should return null for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      const result = await ExerciseService.getExerciseById('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error for other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      } as Response);

      await expect(ExerciseService.getExerciseById('exercise-123')).rejects.toThrow(ExerciseServiceError);
    });
  });

  describe('getExerciseByName', () => {
    it('should fetch exercise by name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockExercise)
      } as Response);

      const result = await ExerciseService.getExerciseByName('Bench Press');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/by-name/Bench%20Press',
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toMatchObject({
        name: 'Bench Press'
      });
    });

    it('should return null for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      const result = await ExerciseService.getExerciseByName('Nonexistent Exercise');

      expect(result).toBeNull();
    });
  });

  describe('getExercisesByTarget', () => {
    it('should fetch exercises by target muscle', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockExercise])
      } as Response);

      const result = await ExerciseService.getExercisesByTarget('中下胸');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/target/%E4%B8%AD%E4%B8%8B%E8%83%B8',
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0].targets.primary).toContain('中下胸');
    });
  });

  describe('getExercisesByDifficulty', () => {
    it('should fetch exercises by difficulty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockExercise])
      } as Response);

      const result = await ExerciseService.getExercisesByDifficulty('intermediate');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/difficulty/intermediate',
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0].difficulty).toBe('intermediate');
    });
  });

  describe('getExercisesByEquipment', () => {
    it('should fetch exercises by equipment requirement', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([mockExercise])
      } as Response);

      const result = await ExerciseService.getExercisesByEquipment('barbell');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/by-equipment',
        expect.objectContaining({
          method: 'GET',
          body: expect.stringContaining('barbell')
        })
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('createExercise', () => {
    it('should create a new exercise', async () => {
      const newExercise = {
        name: 'Deadlift',
        exercise_type: 'resistance' as const,
        targets: JSON.stringify({ primary: ['背部', '腘绳'] }),
        equipment_required: JSON.stringify(['barbell']),
        difficulty: 'advanced' as const,
        modified_by: 'admin' as const
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          id: 'exercise-789',
          ...newExercise,
          modified_at: Date.now()
        })
      } as Response);

      const result = await ExerciseService.createExercise(newExercise);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Deadlift')
        })
      );

      expect(result.id).toBe('exercise-789');
      expect(result.name).toBe('Deadlift');
    });
  });

  describe('updateExercise', () => {
    it('should update an existing exercise', async () => {
      const update = {
        exerciseId: 'exercise-123',
        data: {
          name: 'Bench Press (Updated)',
          exercise_type: 'resistance' as const,
          targets: JSON.stringify({ primary: ['中下胸'] }),
          equipment_required: JSON.stringify(['barbell', 'bench']),
          difficulty: 'advanced' as const,
          modified_by: 'admin' as const
        },
        modifiedBy: 'admin' as const,
        changeReason: 'Update exercise info'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ...mockExercise,
          ...update.data
        })
      } as Response);

      const result = await ExerciseService.updateExercise(update);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/exercise-123',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('Updated')
        })
      );

      expect(result.name).toBe('Bench Press (Updated)');
    });
  });

  describe('deleteExercise', () => {
    it('should delete an exercise', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204
      } as Response);

      await ExerciseService.deleteExercise('exercise-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/exercise-123',
        expect.objectContaining({
          method: 'DELETE'
        })
      );
    });

    it('should throw error on failed deletion', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      await expect(ExerciseService.deleteExercise('exercise-123')).rejects.toThrow(ExerciseServiceError);
    });
  });

  describe('getExerciseStats', () => {
    it('should fetch exercise statistics', async () => {
      const mockStats = {
        total: 150,
        byType: {
          resistance: 80,
          bodyweight: 30,
          cardio: 20,
          flexibility: 20
        },
        byDifficulty: {
          beginner: 50,
          intermediate: 60,
          advanced: 40
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockStats)
      } as Response);

      const result = await ExerciseService.getExerciseStats();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:43111/api/exercises/stats',
        expect.objectContaining({
          method: 'GET'
        })
      );

      expect(result).toEqual(mockStats);
    });
  });
});
