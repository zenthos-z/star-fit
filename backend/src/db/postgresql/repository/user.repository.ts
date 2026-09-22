/**
 * User Repository
 *
 * Handles all user profile data access with proper format conversion:
 * - Converts between camelCase (API) and snake_case (database)
 * - Handles JSONB parsing and stringifying
 * - Provides a clean interface for the application layer
 */

import { PostgresClient } from "../client/postgres-client.js";
import { BaseRepository } from "./base.repository.js";
import type {
  ProfileStatic,
  ProfileDynamic,
  HistorySummary,
} from "../../../../../shared/dist/contracts/index.js";
import { toApiFormat } from "../../../../../shared/dist/contracts/mapping/user-profile.mapper.js";
import { z } from "zod";

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

    const row = await this.queryOne<{ profile_static: unknown }>(sql, {
      userId,
    });

    if (!row) {
      return null;
    }

    // If profile_static is null or empty, return default profile
    if (!row.profile_static) {
      return {
        tags: [],
      };
    }

    // Parse JSONB and convert to API format
    // row.profile_static is the raw JSONB data from the database
    const dbData = this.parseJSONB(
      row.profile_static,
      z.any(), // Will be validated by toApiFormat
    );

    const result = toApiFormat(dbData);

    return result;
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

    const row = await this.queryOne<{ profile_dynamic: unknown }>(sql, {
      userId,
    });

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

    const row = await this.queryOne<{ history_summary: unknown }>(sql, {
      userId,
    });

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
}

/**
 * Export the repository factory function
 */
export function createUserRepository(client: PostgresClient): UserRepository {
  return new UserRepository(client);
}
