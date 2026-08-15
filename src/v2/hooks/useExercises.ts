/**
 * useExercises - React Hook for Exercise Library Management
 *
 * This hook provides a data binding layer for exercise library data with:
 * - Exercise library CRUD operations
 * - Filtering and search capabilities
 * - WebSocket real-time updates
 * - Data caching to avoid unnecessary refetches
 * - Type-safe contracts from ExerciseServiceV2
 *
 * @version 2.0.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ParsedExercise,
  ExerciseType,
  Difficulty,
  MuscleTarget
} from '../services/api/ExerciseServiceV2';
import { socketService } from '../services/transport/WebSocketClient';

/**
 * Result type for useExercises hook
 */
export interface UseExercisesResult {
  /** Complete list of exercises */
  exercises: ParsedExercise[];
  /** Loading state indicator */
  loading: boolean;
  /** Error object if any error occurred */
  error: Error | null;
  /** Get a specific exercise by ID */
  getExerciseById: (id: string) => ParsedExercise | undefined;
  /** Get a specific exercise by name */
  getExerciseByName: (name: string) => ParsedExercise | undefined;
  /** Filter exercises by target muscle */
  getExercisesByTarget: (target: MuscleTarget) => ParsedExercise[];
  /** Filter exercises by difficulty */
  getExercisesByDifficulty: (difficulty: Difficulty) => ParsedExercise[];
  /** Filter exercises by type */
  getExercisesByType: (type: ExerciseType) => ParsedExercise[];
  /** Search exercises by name or tags */
  searchExercises: (query: string) => ParsedExercise[];
  /** Manually refetch exercises */
  refetch: () => Promise<void>;
}

/**
 * Cache entry for exercises data
 */
interface ExercisesCacheEntry {
  data: ParsedExercise[];
  timestamp: number;
}

/**
 * Exercises cache with TTL
 */
let exercisesCache: ExercisesCacheEntry | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes - exercises change less frequently

/**
 * Fetch exercises from Service Layer
 */
async function fetchExercises(): Promise<ParsedExercise[]> {
  const { ExerciseService } = await import('../services/api');
  return await ExerciseService.getAllExercises();
}

/**
 * React Hook for Exercise Library Management
 *
 * @returns Exercise data and management functions
 *
 * @example
 * ```tsx
 * function ExerciseLibrary() {
 *   const { exercises, loading, getExercisesByDifficulty } = useExercises();
 *
 *   if (loading) return <div>Loading...</div>;
 *
 *   const beginnerExercises = getExercisesByDifficulty('beginner');
 *
 *   return (
 *     <div>
 *       {beginnerExercises.map(ex => (
 *         <ExerciseCard key={ex.id} exercise={ex} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useExercises(): UseExercisesResult {
// TS2484: interface UseExercisesResult is defined in this same file and
// re-exported via hooks/index.ts — no extra export type line needed.
  const [exercises, setExercises] = useState<ParsedExercise[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Ref to track if component is mounted
  const isMountedRef = useRef<boolean>(true);

  /**
   * Load exercises from cache or API
   */
  const loadExercises = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Check cache first (module-level cache for exercises)
      if (exercisesCache &&
          Date.now() - exercisesCache.timestamp < CACHE_TTL) {
        if (isMountedRef.current) {
          setExercises(exercisesCache.data);
          setLoading(false);
        }
        return;
      }

      // Fetch from API
      const data = await fetchExercises();

      // Update cache
      (exercisesCache as any) = {
        data,
        timestamp: Date.now()
      };

      if (isMountedRef.current) {
        setExercises(data);
      }
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      if (isMountedRef.current) {
        setError(errorObj);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  /**
   * Manually refetch exercises
   */
  const refetch = useCallback(async () => {
    // Invalidate cache
    (exercisesCache as any) = null;
    await loadExercises();
  }, [loadExercises]);

  /**
   * Get a specific exercise by ID
   */
  const getExerciseById = useCallback((id: string): ParsedExercise | undefined => {
    return exercises.find(ex => ex.id === id);
  }, [exercises]);

  /**
   * Get a specific exercise by name
   */
  const getExerciseByName = useCallback((name: string): ParsedExercise | undefined => {
    return exercises.find(ex => ex.name === name);
  }, [exercises]);

  /**
   * Filter exercises by target muscle
   */
  const getExercisesByTarget = useCallback((target: MuscleTarget): ParsedExercise[] => {
    return exercises.filter(ex =>
      ex.targets.primary.includes(target) ||
      ex.targets.secondary?.includes(target)
    );
  }, [exercises]);

  /**
   * Filter exercises by difficulty
   */
  const getExercisesByDifficulty = useCallback((difficulty: Difficulty): ParsedExercise[] => {
    return exercises.filter(ex => ex.difficulty === difficulty);
  }, [exercises]);

  /**
   * Filter exercises by type
   */
  const getExercisesByType = useCallback((type: ExerciseType): ParsedExercise[] => {
    return exercises.filter(ex => ex.exercise_type === type);
  }, [exercises]);

  /**
   * Search exercises by name or tags
   */
  const searchExercises = useCallback((query: string): ParsedExercise[] => {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return exercises;

    return exercises.filter(ex => {
      // Search in name
      if (ex.name.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Search in tags
      if (ex.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))) {
        return true;
      }

      // Search in targets
      const allTargets = [
        ...ex.targets.primary,
        ...(ex.targets.secondary || [])
      ];
      if (allTargets.some(target => target.toLowerCase().includes(lowerQuery))) {
        return true;
      }

      return false;
    });
  }, [exercises]);

  /**
   * Fetch exercises on mount
   */
  useEffect(() => {
    loadExercises();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadExercises]);

  /**
   * Subscribe to WebSocket events for real-time updates
   */
  useEffect(() => {
    // Subscribe to exercise library updates
    const unsubscribe = socketService.subscribe('exercise_library_updated', () => {
      // Invalidate cache and refetch
      (exercisesCache as any) = null;
      loadExercises();
    });

    // Subscribe to individual exercise updates
    const unsubscribeExercise = socketService.subscribe('exercise_updated', () => {
      (exercisesCache as any) = null;
      loadExercises();
    });

    return () => {
      unsubscribe();
      unsubscribeExercise();
    };
  }, [loadExercises]);

  return {
    exercises,
    loading,
    error,
    getExerciseById,
    getExerciseByName,
    getExercisesByTarget,
    getExercisesByDifficulty,
    getExercisesByType,
    searchExercises,
    refetch
  };
}

// UseExercisesResult is defined as a named interface above; re-export from
// hooks/index.ts uses `export { type UseExercisesResult }` — no extra line here.
