/**
 * User Repository
 *
 * Handles all user profile data access with proper format conversion:
 * - Converts between camelCase (API) and snake_case (database)
 * - Handles JSONB parsing and stringifying
 * - Provides a clean interface for the application layer
 */

import { PostgresClient } from '../client/postgres-client.js';
import { BaseRepository } from './base.repository.js';
import type {
  ProfileStaticDatabase,
  ProfileDynamicDatabase
} from '../../../../../shared/dist/contracts/database/user-profile.schema.js';
import type {
  ProfileStatic,
  ProfileDynamic,
  HistorySummary
} from '../../../../../shared/dist/contracts/index.js';
import { toDatabaseFormat, toApiFormat } from '../../../../../shared/dist/contracts/mapping/user-profile.mapper.js';
import { z } from 'zod';
import { ServiceError, ServiceErrorCode } from '../../../services/errors/ServiceError.js';

/**
 * User Repository
 *
 * Provides methods for accessing and manipulating user profile data.
 * All methods work with API format (camelCase) internally,
 * and handle conversion to/from database format (snake_case).
 */
export class UserRepository extends BaseRepository {
  /**
   * Get user's static profile
   *
   * @param userId - User ID (UUID)
   * @returns User static profile in API format, or null if not found
   */
  async getProfileStatic(userId: string): Promise<ProfileStatic | null> {
    const sql = `
      SELECT profile_static
      FROM users
      WHERE id = $userId
    `;

    const row = await this.queryOne<{ profile_static: unknown }>(sql, { userId });

    // DEBUG: 记录原始数据库数据
    console.log('[UserRepository] getProfileStatic raw data:', {
      userId,
      hasRow: !!row,
      profile_static: row?.profile_static,
      profile_static_type: typeof row?.profile_static,
    });

    if (!row) {
      return null;
    }

    // If profile_static is null or empty, return default profile
    if (!row.profile_static) {
      return {
        fitness_level: 'UNKNOWN' as const,
        tags: [],
        red_flags: [],
      };
    }

    // Parse JSONB and convert to API format
    // row.profile_static is the raw JSONB data from the database
    const dbData = this.parseJSONB(
      row.profile_static,
      z.any() // Will be validated by toApiFormat
    );

    const result = toApiFormat(dbData);

    // DEBUG: 记录解析后的数据
    console.log('[UserRepository] getProfileStatic parsed data:', {
      userId,
      dbData: JSON.stringify(dbData),
      result_basic_info: result?.basic_info,
      result_keys: result ? Object.keys(result) : null,
    });

    return result;
  }

  /**
   * Update user's static profile
   *
   * @param userId - User ID (UUID)
   * @param data - Profile data in API format (camelCase)
   */
  async updateProfileStatic(userId: string, data: ProfileStatic): Promise<void> {
    // Convert to database format
    const dbData = toDatabaseFormat(data);

    const sql = `
      UPDATE users
      SET
        profile_static = $profileStatic::jsonb,
        updated_at = NOW()
      WHERE id = $userId
    `;

    const affectedRows = await this.execute(sql, {
      userId,
      profileStatic: this.stringifyJSONB(dbData),
    });

    if (affectedRows === 0) {
      throw new ServiceError(
        ServiceErrorCode.NOT_FOUND,
        `User not found: ${userId}`,
        { userId }
      );
    }
  }

  /**
   * Get user's dynamic profile
   *
   * @param userId - User ID (UUID)
   * @returns User dynamic profile in API format, or null if not found
   */
  async getProfileDynamic(userId: string): Promise<ProfileDynamic | null> {
    const sql = `
      SELECT profile_dynamic
      FROM users
      WHERE id = $userId
    `;

    const row = await this.queryOne<{ profile_dynamic: unknown }>(sql, { userId });

    if (!row) {
      return null;
    }

    // If profile_dynamic is null or empty, return empty object
    if (!row.profile_dynamic) {
      return {};
    }

    // Parse JSONB and return in API format
    return this.parseJSONB(row.profile_dynamic, z.any());
  }

  /**
   * Update user's dynamic profile
   *
   * @param userId - User ID (UUID)
   * @param data - Profile data in API format (camelCase)
   */
  async updateProfileDynamic(userId: string, data: Partial<ProfileDynamic>): Promise<void> {
    const sql = `
      UPDATE users
      SET
        profile_dynamic = jsonb_set(
          COALESCE(profile_dynamic, '{}'::jsonb),
          $updates::jsonb
        ),
        updated_at = NOW()
      WHERE id = $userId
    `;

    await this.execute(sql, {
      userId,
      updates: this.stringifyJSONB(data),
    });
  }

  /**
   * Get user by username
   *
   * @param username - Username
   * @returns User ID (UUID), or null if not found
   */
  async getIdByUsername(username: string): Promise<string | null> {
    const sql = `
      SELECT id
      FROM users
      WHERE username = $username
    `;

    const row = await this.queryOne<{ id: string }>(sql, { username });
    return row?.id || null;
  }

  /**
   * Get username by ID
   *
   * @param userId - User ID (UUID)
   * @returns Username, or null if not found
   */
  async getUsernameById(userId: string): Promise<string | null> {
    const sql = `
      SELECT username
      FROM users
      WHERE id = $userId
    `;

    const row = await this.queryOne<{ username: string }>(sql, { userId });
    return row?.username || null;
  }

  /**
   * Get user's history summary
   *
   * @param userId - User ID (UUID)
   * @returns User history summary in API format, or null if not found
   */
  async getHistorySummary(userId: string): Promise<HistorySummary | null> {
    const sql = `
      SELECT history_summary
      FROM users
      WHERE id = $userId
    `;

    const row = await this.queryOne<{ history_summary: unknown }>(sql, { userId });

    if (!row) {
      return null;
    }

    // If history_summary is null or empty, return empty object
    if (!row.history_summary) {
      return {};
    }

    // Parse JSONB and return in API format
    return this.parseJSONB(row.history_summary, z.any());
  }

  /**
   * Update user's history summary
   *
   * @param userId - User ID (UUID)
   * @param data - History summary data in API format (camelCase)
   */
  async updateHistorySummary(userId: string, data: Partial<HistorySummary>): Promise<void> {
    const sql = `
      UPDATE users
      SET
        history_summary = jsonb_set(
          COALESCE(history_summary, '{}'::jsonb),
          $updates::jsonb
        ),
        updated_at = NOW()
      WHERE id = $userId
    `;

    await this.execute(sql, {
      userId,
      updates: this.stringifyJSONB(data),
    });
  }

  /**
   * Merge data into user's history summary (partial update)
   *
   * @param userId - User ID (UUID)
   * @param data - Partial history summary data to merge
   */
  async mergeHistorySummary(userId: string, data: Partial<HistorySummary>): Promise<HistorySummary> {
    // First get current history summary
    const current = await this.getHistorySummary(userId);

    // Merge with new data
    const merged: HistorySummary = {
      ...current,
      ...data,
    };

    // Update the merged data
    await this.updateHistorySummary(userId, merged);

    return merged;
  }

  /**
   * Resolve user reference (ID or username)
   *
   * @param userRef - User reference (ID or username)
   * @returns User ID (UUID)
   * @throws {ServiceError} If user not found
   */
  async resolveUserId(userRef: string): Promise<string> {
    // Check if it's a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    if (userRef.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return userRef;
    }

    // Try to resolve as username
    const userId = await this.getIdByUsername(userRef);
    if (userId) {
      return userId;
    }

    throw new ServiceError(
      ServiceErrorCode.NOT_FOUND,
      `User not found: ${userRef}`,
      { userRef }
    );
  }
}

/**
 * Export the repository factory function
 */
export function createUserRepository(client: PostgresClient): UserRepository {
  return new UserRepository(client);
}
