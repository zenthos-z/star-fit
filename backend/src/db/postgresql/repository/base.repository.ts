/**
 * Base Repository
 *
 * Provides common functionality for all repositories:
 * - JSONB handling (parse/stringify)
 * - Common query patterns
 * - Error handling
 */

import { PostgresClient } from '../client/postgres-client.js';
import type { QueryResult, QueryResultRow } from 'pg';
import { z } from 'zod';
import { ServiceError, ServiceErrorCode } from '../../../services/errors/ServiceError.js';

/**
 * Base repository class
 *
 * All repositories should extend this class to get:
 * - Automatic JSONB handling
 * - Consistent error handling
 * - Common query utilities
 */
export abstract class BaseRepository {
  constructor(protected client: PostgresClient) {}

  /**
   * Parse JSONB data from database
   *
   * PostgreSQL automatically deserializes JSONB to objects,
   * but we need to handle both cases (object and string).
   *
   * @param data - Data from database (can be object, string, or null)
   * @param schema - Zod schema to validate the parsed data
   * @returns Validated and parsed data
   * @throws {ServiceError} If parsing or validation fails
   */
  protected parseJSONB<T>(
    data: unknown,
    schema: z.ZodType<T>
  ): T {
    try {
      // PostgreSQL JSONB returns already-parsed objects
      if (typeof data === 'object' && data !== null) {
        return schema.parse(data);
      }

      // SQLite or string inputs need parsing
      if (typeof data === 'string' && data.length > 0) {
        const parsed = JSON.parse(data);
        return schema.parse(parsed);
      }

      // Null or empty string
      if (data === null || data === '') {
        return schema.parse(null);
      }

      // Unknown format
      throw new Error(`Unexpected data type: ${typeof data}`);
    } catch (error) {
      throw new ServiceError(
        ServiceErrorCode.VALIDATION_ERROR,
        `Failed to parse JSONB data: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Convert data to JSONB string for database storage
   *
   * Always use JSON.stringify() to ensure consistent format.
   *
   * @param data - Data to convert
   * @returns JSON string
   */
  protected stringifyJSONB(data: unknown): string {
    try {
      return JSON.stringify(data);
    } catch (error) {
      throw new ServiceError(
        ServiceErrorCode.VALIDATION_ERROR,
        `Failed to stringify data for JSONB: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Execute a query and return the first row
   *
   * @param sql - SQL query
   * @param params - Query parameters
   * @returns First row or null
   */
  protected async queryOne<T extends QueryResultRow = any>(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<T | null> {
    const result = await this.client.query<T>(sql, params);
    return result.rows[0] || null;
  }

  /**
   * Execute a query and return all rows
   *
   * @param sql - SQL query
   * @param params - Query parameters
   * @returns All rows
   */
  protected async queryMany<T extends QueryResultRow = any>(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const result = await this.client.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Execute a query that affects data (INSERT, UPDATE, DELETE)
   *
   * @param sql - SQL query
   * @param params - Query parameters
   * @returns Number of affected rows
   */
  protected async execute(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<number> {
    const result = await this.client.query(sql, params);
    return result.rowCount ?? 0;
  }
}
