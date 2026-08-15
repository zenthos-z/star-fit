/**
 * ProfileServiceV2 - User Profile API Client Service
 *
 * Provides type-safe API calls for user profile operations.
 * All types are imported from shared/contracts (data contract redline).
 * Uses parseJSONSafe for all JSON parsing (no bare JSON.parse).
 *
 * @version 2.0.0
 */

import type {
  UserProfileV2,
  ProfileStatic,
  ProfileDynamic,
  HistorySummary,
  LoadAnchors,
  LoadAnchor,
  ActiveLimitation
} from 'shared/contracts';
import { parseJSONSafe, validateWithLogging, UserProfileV2Schema, ProfileStaticSchema, ProfileDynamicSchema } from 'shared/contracts';

// Re-export API_BASE and helper functions from the existing service
import { API_BASE, getHeaders } from '../../../services/geminiService';

// ============================================================================
// Error Types
// ============================================================================

export class ProfileServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'ProfileServiceError';
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build the full API URL for profile endpoints
 */
function buildUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * Handle API response with proper error handling
 */
async function handleResponse<T>(
  response: Response,
  context: string
): Promise<T> {
  if (!response.ok) {
    const errorMessage = `ProfileService ${context} failed: ${response.status} ${response.statusText}`;
    throw new ProfileServiceError(errorMessage, response.status, context);
  }

  const text = await response.text();
  if (!text) {
    throw new ProfileServiceError(`${context}: Empty response`, response.status, context);
  }

  const data = parseJSONSafe<T>(text, `${context} response`);
  if (!data) {
    throw new ProfileServiceError(`${context}: Failed to parse response`, response.status, context);
  }

  return data;
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * ProfileServiceV2 Interface
 *
 * All methods return validated data types from shared/contracts.
 */
export interface ProfileServiceV2 {
  getProfile(userId: string): Promise<UserProfileV2>;
  getProfileStatic(userId: string): Promise<ProfileStatic>;
  getProfileDynamic(userId: string): Promise<ProfileDynamic>;
  updateProfileStatic(userId: string, updates: Partial<ProfileStatic>): Promise<void>;
  updateProfileDynamic(userId: string, updates: Partial<ProfileDynamic>): Promise<void>;
  getLoadAnchors(userId: string): Promise<LoadAnchors>;
  updateLoadAnchor(userId: string, exerciseId: string, anchor: LoadAnchor): Promise<void>;
  addActiveLimitation(userId: string, limitation: ActiveLimitation): Promise<void>;
  removeActiveLimitation(userId: string, part: string): Promise<void>;
}

/**
 * ProfileServiceV2 Implementation
 */
class ProfileServiceV2Impl implements ProfileServiceV2 {
  /**
   * Get complete user profile (V2 format)
   * @param userId - User ID
   * @returns Validated UserProfileV2
   */
  async getProfile(userId: string): Promise<UserProfileV2> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/profile`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    const responseData = await handleResponse<{ success: boolean; data?: any }>(response, 'getProfile');

    // Extract profile from response wrapper
    // Backend returns: { success: true, data: UserProfileV2 }
    const profileData = responseData.data || responseData;

    // Validate with schema
    const validated = validateWithLogging(
      UserProfileV2Schema,
      profileData,
      'getProfile',
      undefined
    );

    if (!validated) {
      throw new ProfileServiceError('getProfile: Validation failed', 500, 'getProfile');
    }

    return validated;
  }

  /**
   * Get profile static data (long-term characteristics)
   * @param userId - User ID
   * @returns Validated ProfileStatic
   */
  async getProfileStatic(userId: string): Promise<ProfileStatic> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/profile`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    const responseData = await handleResponse<{ success: boolean; data?: any }>(response, 'getProfileStatic');

    // Extract profile from response wrapper
    const data = responseData.data || responseData;

    // Extract profile_static from the response
    const staticData = data.profile_static || {};

    // Validate with schema
    const validated = validateWithLogging(
      ProfileStaticSchema,
      staticData,
      'getProfileStatic',
      {} as ProfileStatic
    );

    return validated || {};
  }

  /**
   * Get profile dynamic data (high-frequency changing states)
   * @param userId - User ID
   * @returns Validated ProfileDynamic
   */
  async getProfileDynamic(userId: string): Promise<ProfileDynamic> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/profile`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    const responseData = await handleResponse<{ success: boolean; data?: any }>(response, 'getProfileDynamic');

    // Extract profile from response wrapper
    const data = responseData.data || responseData;

    // Extract profile_dynamic from the response
    const dynamicData = data.profile_dynamic || {};

    // Validate with schema
    const validated = validateWithLogging(
      ProfileDynamicSchema,
      dynamicData,
      'getProfileDynamic',
      {} as ProfileDynamic
    );

    return validated || {};
  }

  /**
   * Update profile static data
   * @param userId - User ID
   * @param updates - Partial ProfileStatic updates
   */
  async updateProfileStatic(userId: string, updates: Partial<ProfileStatic>): Promise<void> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/profile/static`);
    const response = await fetch(url, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });

    await handleResponse<{ message: string }>(response, 'updateProfileStatic');
  }

  /**
   * Update profile dynamic data
   * @param userId - User ID
   * @param updates - Partial ProfileDynamic updates
   */
  async updateProfileDynamic(userId: string, updates: Partial<ProfileDynamic>): Promise<void> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/profile/dynamic`);
    const response = await fetch(url, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });

    await handleResponse<{ message: string }>(response, 'updateProfileDynamic');
  }

  /**
   * Get load anchors for a user
   * @param userId - User ID
   * @returns Load anchors mapping
   */
  async getLoadAnchors(userId: string): Promise<LoadAnchors> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/profile`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    const responseData = await handleResponse<{ success: boolean; data?: any }>(response, 'getLoadAnchors');

    // Extract profile from response wrapper
    const data = responseData.data || responseData;

    // Extract load_anchors from profile_dynamic
    const anchors = data.profile_dynamic?.load_anchors || data.load_anchors || {};

    return anchors as LoadAnchors;
  }

  /**
   * Update a single load anchor
   * @param userId - User ID
   * @param exerciseId - Exercise identifier
   * @param anchor - Load anchor data
   */
  async updateLoadAnchor(userId: string, exerciseId: string, anchor: LoadAnchor): Promise<void> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/anchors/${encodeURIComponent(exerciseId)}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(anchor)
    });

    await handleResponse<{ message: string }>(response, 'updateLoadAnchor');
  }

  /**
   * Add an active limitation
   * @param userId - User ID
   * @param limitation - Active limitation to add
   */
  async addActiveLimitation(userId: string, limitation: ActiveLimitation): Promise<void> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/limitations`);
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(limitation)
    });

    await handleResponse<{ message: string }>(response, 'addActiveLimitation');
  }

  /**
   * Remove an active limitation by body part
   * @param userId - User ID
   * @param part - Body part to remove
   */
  async removeActiveLimitation(userId: string, part: string): Promise<void> {
    const url = buildUrl(`/admin/users/${encodeURIComponent(userId)}/limitations/${encodeURIComponent(part)}`);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getHeaders({}, false)
    });

    await handleResponse<{ message: string }>(response, 'removeActiveLimitation');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance of ProfileServiceV2
 */
export const ProfileService = new ProfileServiceV2Impl();
// TS2484: interface ProfileServiceV2 is defined in this same file and
// re-exported via services/api/index.ts — no extra export type needed here.
