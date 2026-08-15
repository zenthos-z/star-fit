/**
 * useProfileV2 - React Hook for User Profile Data Management
 *
 * This hook provides a data binding layer for user profile data with:
 * - Three-state model support (ProfileStatic, ProfileDynamic, HistorySummary)
 * - WebSocket real-time updates
 * - Data caching to avoid unnecessary refetches
 * - Type-safe contracts from shared/contracts
 *
 * @version 2.0.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  UserProfileV2,
  ProfileStatic,
  ProfileDynamic,
  HistorySummary
} from 'shared/contracts';
import { socketService } from '../services/transport/WebSocketClient';

/**
 * Result type for useProfileV2 hook
 */
export interface UseProfileV2Result {
  /** Complete user profile v2 */
  profile: UserProfileV2 | null;
  /** Static state data (long-term biological/psychological characteristics) */
  profileStatic: ProfileStatic | null;
  /** Dynamic state data (high-frequency changing states like load anchors) */
  profileDynamic: ProfileDynamic | null;
  /** History summary data (compressed historical data) */
  historySummary: HistorySummary | null;
  /** Loading state indicator */
  loading: boolean;
  /** Error object if any error occurred */
  error: Error | null;
  /** Function to manually refetch profile data */
  refetch: () => Promise<void>;
  /** Function to update static state data */
  updateStatic: (updates: Partial<ProfileStatic>) => Promise<void>;
  /** Function to update dynamic state data */
  updateDynamic: (updates: Partial<ProfileDynamic>) => Promise<void>;
}

/**
 * Cache entry for profile data
 */
interface ProfileCacheEntry {
  data: UserProfileV2;
  timestamp: number;
}

/**
 * Profile data cache with TTL
 */
const profileCache = new Map<string, ProfileCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached profile data if still valid
 */
function getCachedProfile(userId: string): UserProfileV2 | null {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Set profile data in cache
 */
function setCachedProfile(userId: string, data: UserProfileV2): void {
  profileCache.set(userId, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Invalidate cache for a specific user
 */
function invalidateCache(userId: string): void {
  profileCache.delete(userId);
}

/**
 * Fetch user profile from Service Layer
 */
async function fetchProfile(userId: string): Promise<UserProfileV2> {
  const { ProfileService } = await import('../services/api');
  return await ProfileService.getProfile(userId);
}

/**
 * Update profile static state via Service Layer
 */
async function updateProfileStatic(
  userId: string,
  updates: Partial<ProfileStatic>
): Promise<void> {
  const { ProfileService } = await import('../services/api');
  await ProfileService.updateProfileStatic(userId, updates);
}

/**
 * Update profile dynamic state via Service Layer
 */
async function updateProfileDynamic(
  userId: string,
  updates: Partial<ProfileDynamic>
): Promise<void> {
  const { ProfileService } = await import('../services/api');
  await ProfileService.updateProfileDynamic(userId, updates);
}

/**
 * React Hook for User Profile V2 Data Management
 *
 * @param userId - User ID to fetch profile for
 * @returns Profile data and management functions
 *
 * @example
 * ```tsx
 * function ProfileComponent() {
 *   const { profile, loading, error, updateStatic } = useProfileV2('user123');
 *
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <div>
 *       <h1>{profile?.profile_static?.age} years old</h1>
 *       <button onClick={() => updateStatic({ age: 25 })}>
 *         Update Age
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useProfileV2(userId: string): UseProfileV2Result {
  const [profile, setProfile] = useState<UserProfileV2 | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Ref to track if component is mounted
  const isMountedRef = useRef<boolean>(true);
  // Ref to track current userId for proper cleanup
  const currentUserIdRef = useRef<string>(userId);

  // Reset isMountedRef on mount (handles React Strict Mode)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Load profile data from cache or API
   */
  const loadProfile = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = getCachedProfile(userId);
      if (cached) {
        if (isMountedRef.current) {
          setProfile(cached);
          setLoading(false);
        }
        return;
      }

      // Fetch from API
      const data = await fetchProfile(userId);
      setCachedProfile(userId, data);

      if (isMountedRef.current) {
        setProfile(data);
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
   * Manually refetch profile data
   */
  const refetch = useCallback(async () => {
    invalidateCache(userId);
    await loadProfile();
  }, [userId, loadProfile]);

  /**
   * Update static state data
   */
  const updateStatic = useCallback(async (updates: Partial<ProfileStatic>) => {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      await updateProfileStatic(userId, updates);

      // Invalidate cache and refetch
      invalidateCache(userId);
      await loadProfile();
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to update static state');
      setError(errorObj);
      throw errorObj;
    }
  }, [userId, loadProfile]);

  /**
   * Update dynamic state data
   */
  const updateDynamic = useCallback(async (updates: Partial<ProfileDynamic>) => {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      await updateProfileDynamic(userId, updates);

      // Invalidate cache and refetch
      invalidateCache(userId);
      await loadProfile();
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to update dynamic state');
      setError(errorObj);
      throw errorObj;
    }
  }, [userId, loadProfile]);

  /**
   * Fetch profile on mount and when userId changes
   */
  useEffect(() => {
    currentUserIdRef.current = userId;
    loadProfile();
    // Note: isMountedRef cleanup is handled in a separate useEffect
  }, [userId, loadProfile]);

  /**
   * Subscribe to WebSocket events for real-time updates
   */
  useEffect(() => {
    // Subscribe to profile update events
    const unsubscribe = socketService.subscribe('profile_updated', (payload: any) => {
      if (payload.userId === userId) {
        // Invalidate cache and refetch
        invalidateCache(userId);
        loadProfile();
      }
    });

    // Also subscribe to three-state specific events
    const unsubscribeStatic = socketService.subscribe('profile_static_updated', (payload: any) => {
      if (payload.userId === userId) {
        invalidateCache(userId);
        loadProfile();
      }
    });

    const unsubscribeDynamic = socketService.subscribe('profile_dynamic_updated', (payload: any) => {
      if (payload.userId === userId) {
        invalidateCache(userId);
        loadProfile();
      }
    });

    const unsubscribeSummary = socketService.subscribe('history_summary_updated', (payload: any) => {
      if (payload.userId === userId) {
        invalidateCache(userId);
        loadProfile();
      }
    });

    return () => {
      unsubscribe();
      unsubscribeStatic();
      unsubscribeDynamic();
      unsubscribeSummary();
    };
  }, [userId, loadProfile]);

  return {
    profile,
    profileStatic: profile?.profile_static || null,
    profileDynamic: profile?.profile_dynamic || null,
    historySummary: profile?.history_summary || null,
    loading,
    error,
    refetch,
    updateStatic,
    updateDynamic
  };
}

// UseProfileV2Result is defined as a named interface above; re-export from
// hooks/index.ts uses `export { type UseProfileV2Result }` — no extra line here.
