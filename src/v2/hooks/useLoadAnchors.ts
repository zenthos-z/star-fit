/**
 * useLoadAnchors - React Hook for Load Anchors Management
 *
 * This hook provides a data binding layer for load anchors management with:
 * - Load anchors CRUD operations
 * - WebSocket real-time updates
 * - Data caching to avoid unnecessary refetches
 * - Type-safe contracts from shared/contracts
 *
 * @version 2.0.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LoadAnchors, LoadAnchor } from 'shared/contracts';
import { socketService } from '../services/transport/WebSocketClient';

/**
 * Result type for useLoadAnchors hook
 */
export interface UseLoadAnchorsResult {
  /** Complete load anchors object */
  anchors: LoadAnchors;
  /** Loading state indicator */
  loading: boolean;
  /** Error object if any error occurred */
  error: Error | null;
  /** Get a specific load anchor by exercise ID */
  getAnchor: (exerciseId: string) => LoadAnchor | undefined;
  /** Update or create a load anchor for a specific exercise */
  updateAnchor: (exerciseId: string, anchor: LoadAnchor) => Promise<void>;
  /** Delete a load anchor for a specific exercise */
  deleteAnchor: (exerciseId: string) => Promise<void>;
  /** Manually refetch load anchors data */
  refetch: () => Promise<void>;
}

/**
 * Cache entry for load anchors data
 */
interface AnchorsCacheEntry {
  data: LoadAnchors;
  timestamp: number;
}

/**
 * Load anchors cache with TTL
 */
const anchorsCache = new Map<string, AnchorsCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached load anchors if still valid
 */
function getCachedAnchors(userId: string): LoadAnchors | null {
  const cached = anchorsCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Set load anchors in cache
 */
function setCachedAnchors(userId: string, data: LoadAnchors): void {
  anchorsCache.set(userId, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Invalidate cache for a specific user
 */
function invalidateCache(userId: string): void {
  anchorsCache.delete(userId);
}

/**
 * Fetch load anchors from Service Layer
 */
async function fetchLoadAnchors(userId: string): Promise<LoadAnchors> {
  const { ProfileService } = await import('../services/api');
  return await ProfileService.getLoadAnchors(userId);
}

/**
 * Update a load anchor via Service Layer
 */
async function updateLoadAnchor(
  userId: string,
  exerciseId: string,
  anchor: LoadAnchor
): Promise<void> {
  const { ProfileService } = await import('../services/api');
  await ProfileService.updateLoadAnchor(userId, exerciseId, anchor);
}

/**
 * Delete a load anchor via Service Layer
 */
async function deleteLoadAnchorApi(userId: string, exerciseId: string): Promise<void> {
  const { API_BASE, getHeaders } = await import('@/services/geminiService');
  // Note: Delete anchor uses direct API call as it's a specific endpoint
  const response = await fetch(`${API_BASE}/admin/users/${userId}/anchors/${encodeURIComponent(exerciseId)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });

  if (!response.ok) {
    throw new Error(`Failed to delete load anchor: ${response.status} ${response.statusText}`);
  }
}

/**
 * React Hook for Load Anchors Management
 *
 * @param userId - User ID to fetch load anchors for
 * @returns Load anchors data and management functions
 *
 * @example
 * ```tsx
 * function LoadAnchorsComponent() {
 *   const { anchors, loading, updateAnchor } = useLoadAnchors('user123');
 *
 *   if (loading) return <div>Loading...</div>;
 *
 *   const benchPress = anchors['bench_press'];
 *
 *   return (
 *     <div>
 *       <h2>Bench Press: {benchPress?.best_weight}kg</h2>
 *       <button onClick={() => updateAnchor('bench_press', {
 *         best_weight: 100,
 *         best_reps: 5,
 *         est_1rm: 115,
 *         last_updated: Date.now()
 *       })}>
 *         Update Record
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useLoadAnchors(userId: string): UseLoadAnchorsResult {
  const [anchors, setAnchors] = useState<LoadAnchors>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Ref to track if component is mounted
  const isMountedRef = useRef<boolean>(true);

  /**
   * Load anchors data from cache or API
   */
  const loadAnchors = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = getCachedAnchors(userId);
      if (cached) {
        if (isMountedRef.current) {
          setAnchors(cached);
          setLoading(false);
        }
        return;
      }

      // Fetch from API
      const data = await fetchLoadAnchors(userId);
      setCachedAnchors(userId, data);

      if (isMountedRef.current) {
        setAnchors(data);
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
  }, [userId]);

  /**
   * Manually refetch load anchors
   */
  const refetch = useCallback(async () => {
    invalidateCache(userId);
    await loadAnchors();
  }, [userId, loadAnchors]);

  /**
   * Get a specific load anchor by exercise ID
   */
  const getAnchor = useCallback((exerciseId: string): LoadAnchor | undefined => {
    return anchors[exerciseId];
  }, [anchors]);

  /**
   * Update or create a load anchor for a specific exercise
   */
  const updateAnchor = useCallback(async (exerciseId: string, anchor: LoadAnchor) => {
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!exerciseId) {
      throw new Error('Exercise ID is required');
    }

    try {
      await updateLoadAnchor(userId, exerciseId, anchor);

      // Optimistic update
      if (isMountedRef.current) {
        setAnchors(prev => ({
          ...prev,
          [exerciseId]: anchor
        }));
      }

      // Invalidate cache and refetch for consistency
      invalidateCache(userId);
      await loadAnchors();
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to update load anchor');
      setError(errorObj);
      throw errorObj;
    }
  }, [userId, loadAnchors]);

  /**
   * Delete a load anchor for a specific exercise
   */
  const deleteAnchor = useCallback(async (exerciseId: string) => {
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!exerciseId) {
      throw new Error('Exercise ID is required');
    }

    try {
      await deleteLoadAnchorApi(userId, exerciseId);

      // Optimistic update
      if (isMountedRef.current) {
        setAnchors(prev => {
          const newAnchors = { ...prev };
          delete newAnchors[exerciseId];
          return newAnchors;
        });
      }

      // Invalidate cache and refetch for consistency
      invalidateCache(userId);
      await loadAnchors();
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to delete load anchor');
      setError(errorObj);
      throw errorObj;
    }
  }, [userId, loadAnchors]);

  /**
   * Fetch load anchors on mount and when userId changes
   */
  useEffect(() => {
    loadAnchors();

    return () => {
      isMountedRef.current = false;
    };
  }, [userId, loadAnchors]);

  /**
   * Subscribe to WebSocket events for real-time updates
   */
  useEffect(() => {
    // Subscribe to load anchors update events
    const unsubscribe = socketService.subscribe('load_anchors_updated', (payload: any) => {
      if (payload.userId === userId) {
        // Invalidate cache and refetch
        invalidateCache(userId);
        loadAnchors();
      }
    });

    // Also subscribe to profile updates which may include anchors
    const unsubscribeProfile = socketService.subscribe('profile_updated', (payload: any) => {
      if (payload.userId === userId && payload.field === 'load_anchors') {
        invalidateCache(userId);
        loadAnchors();
      }
    });

    // Subscribe to dynamic state updates (load anchors are part of dynamic state)
    const unsubscribeDynamic = socketService.subscribe('profile_dynamic_updated', (payload: any) => {
      if (payload.userId === userId && payload.updates?.load_anchors) {
        invalidateCache(userId);
        loadAnchors();
      }
    });

    return () => {
      unsubscribe();
      unsubscribeProfile();
      unsubscribeDynamic();
    };
  }, [userId, loadAnchors]);

  return {
    anchors,
    loading,
    error,
    getAnchor,
    updateAnchor,
    deleteAnchor,
    refetch
  };
}

// UseLoadAnchorsResult is defined as a named interface above; re-export from
// hooks/index.ts uses `export { type UseLoadAnchorsResult }` — no extra line here.
