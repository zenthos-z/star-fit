/**
 * UserProfileService - Frontend service for user profile data
 *
 * 职责：
 * - L2 IDB 缓存（5分钟 TTL）
 * - L3 API 调用
 * - 降级策略
 *
 * 符合 MAS 数据契约：
 * - L1(State) -> L2(IDB) -> L3(DB)
 * - 前端通过 API 读取，不直连 DB
 */

import { API_BASE, getHeaders } from './geminiService';
import { storageGet, storageSet } from '../../storage';
import { LoadAnchors } from '../v2/types/protocol';

const USER_PROFILE_CACHE_KEY = (userId: string) => `user_profile_${userId}`;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedProfile<T> {
  data: T;
  timestamp: number;
}

interface UserProfile {
  user_id: string;
  fitness_level: string;
  red_flags: string[];
  basic_info: Record<string, any>;
  preferences: Record<string, any>;
  physiological: Record<string, any>;
  load_anchors: LoadAnchors;
  psychological: Record<string, any>;
  modified_by: string;
  updated_at: number;
}

/**
 * UserProfileService - Frontend service for user profile data
 */
export const UserProfileService = {
  /**
   * Get user profile with L2 IDB caching
   * @param userId - User ID
   * @returns User profile or default profile with empty load_anchors
   */
  async getProfile(userId: string): Promise<UserProfile> {
    // 1. Try L2 IDB cache
    const cached = await storageGet<CachedProfile<UserProfile>>(USER_PROFILE_CACHE_KEY(userId));
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log('[UserProfileService] Cache hit for user:', userId);
      return cached.data;
    }

    // 2. Fetch from L3 API
    console.log('[UserProfileService] Cache miss, fetching from API for user:', userId);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/profile`, {
        headers: getHeaders()
      });

      if (res.ok) {
        const profile = await res.json();

        // 3. Write to cache
        await storageSet(USER_PROFILE_CACHE_KEY(userId), {
          data: profile,
          timestamp: Date.now()
        });

        return profile;
      } else {
        console.warn('[UserProfileService] API request failed, returning default profile');
        // Return default profile with empty load_anchors
        return {
          user_id: userId,
          fitness_level: 'beginner',
          red_flags: [],
          basic_info: {},
          preferences: {},
          physiological: {},
          load_anchors: {},
          psychological: {},
          modified_by: 'system',
          updated_at: Date.now()
        };
      }
    } catch (error) {
      console.error('[UserProfileService] API request error:', error);
      // Return default profile on error
      return {
        user_id: userId,
        fitness_level: 'beginner',
        red_flags: [],
        basic_info: {},
        preferences: {},
        physiological: {},
        load_anchors: {},
        psychological: {},
        modified_by: 'system',
        updated_at: Date.now()
      };
    }
  },

  /**
   * Invalidate cache for a specific user
   * Call this after training completion to ensure fresh data on next fetch
   * @param userId - User ID
   */
  async invalidateCache(userId: string): Promise<void> {
    await storageSet(USER_PROFILE_CACHE_KEY(userId), null);
    console.log('[UserProfileService] Cache invalidated for user:', userId);
  },

  /**
   * Get load_anchors only (convenience method)
   * @param userId - User ID
   * @returns Load anchors or empty object
   */
  async getLoadAnchors(userId: string): Promise<LoadAnchors> {
    const profile = await this.getProfile(userId);
    return profile.load_anchors || {};
  },

  /**
   * Prefetch profile data (call during app initialization or training start)
   * @param userId - User ID
   */
  async prefetch(userId: string): Promise<void> {
    await this.getProfile(userId);
  }
};

export type { UserProfile };
