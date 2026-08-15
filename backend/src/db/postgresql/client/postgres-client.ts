/**
 * PostgreSQL Client for Starfit
 * Provides safe, validated database operations for Core-Flex architecture
 *
 * Features:
 * - Connection pooling with pg Pool
 * - Transaction support with proper error handling
 * - Query logging and performance monitoring
 * - Type-safe query execution
 * - JSONB validation with Zod schemas
 *
 * @version 3.0.0
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { createLogger } from '../../../utils/logger.js';
import { DatabaseError } from '../../../utils/errorHandler.js';
import { parseJSONSafe, validateOrThrow, validateWithLogging } from '../../../../../shared/dist/contracts/validation.js';
import { getPostgresConfig, getConfigForLogging, type PostgresConfig } from '../config.js';
import type { z } from 'zod';

// Type alias for ZodType to avoid import issues (zod v4: ZodTypeDef removed)
type ZodTypeAny = z.ZodType<any>;
import type { ZodType } from 'zod';

// ============================================================================
// Types
// ============================================================================

export interface PostgresClientOptions extends Partial<PostgresConfig> {
  // Override config from environment
  preset?: 'development' | 'test' | 'production';
}

export interface QueryOptions {
  requestId?: string;
  userId?: string;
  operation?: string;
}

export interface TransactionOptions extends QueryOptions {
  isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
}

export type QueryParams = Record<string, any>;

// ============================================================================
// PostgreSQL Client
// ============================================================================

export class PostgresClient {
  private pool: Pool;
  private logger: ReturnType<typeof createLogger>;
  private readonly maxConnections: number;

  constructor(options: PostgresClientOptions = {}) {
    this.logger = createLogger({ component: 'PostgresClient' });

    // Load base config from environment
    const baseConfig = getPostgresConfig(options.preset);

    // Merge with options
    const mergedConfig: any = {
      ...baseConfig,
      ...options,
      pool: {
        ...baseConfig.pool,
        ...options.pool,
      },
    };

    this.maxConnections = mergedConfig.pool.max;

    // When connection string is provided, use it exclusively
    // Otherwise, use individual connection parameters
    const poolConfig = mergedConfig.connectionString
      ? {
          connectionString: mergedConfig.connectionString,
          ...mergedConfig.pool,
        }
      : {
          host: mergedConfig.host,
          port: mergedConfig.port,
          database: mergedConfig.database,
          user: mergedConfig.user,
          password: mergedConfig.password,
          ssl: mergedConfig.ssl,
          ...mergedConfig.pool,
        };

    this.pool = new Pool(poolConfig);

    // Pool error handler
    this.pool.on('error', (err) => {
      this.logger.error('Unexpected pool error', err);
    });

    this.logger.info('PostgreSQL connection pool created', getConfigForLogging(mergedConfig));
  }

  // ========================================================================
  // Connection Management
  // ========================================================================

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();

      this.logger.info('PostgreSQL connection pool verified');
    } catch (error) {
      this.logger.error('Failed to connect to PostgreSQL', error as Error);
      throw new DatabaseError(
        'PostgreSQL connection failed',
        'connect',
        { error }
      );
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.info('PostgreSQL connection pool closed');
    } catch (error) {
      this.logger.error('Error closing PostgreSQL pool', error as Error);
      throw error;
    }
  }

  async healthCheck(): Promise<{
    connected: boolean;
    totalConnections: number;
    idleConnections: number;
    waitingClients: number;
  }> {
    try {
      const result = await this.pool.query('SELECT NOW() as now');

      return {
        connected: true,
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingClients: this.pool.waitingCount,
      };
    } catch (error) {
      this.logger.error('Health check failed', error as Error);
      return {
        connected: false,
        totalConnections: 0,
        idleConnections: 0,
        waitingClients: 0,
      };
    }
  }

  // ========================================================================
  // Query Execution
  // ========================================================================

  async query<T extends QueryResultRow = any>(
    sql: string,
    params: QueryParams = {},
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const { requestId, userId, operation } = options;
    const logger = requestId ? createLogger({ requestId }) : this.logger;

    const startTime = Date.now();

    try {
      // Convert named parameters to PostgreSQL $1, $2 format
      const { processedSql, values } = this.processParameters(sql, params);

      const result = await this.pool.query<T>(processedSql, values);
      const duration = Date.now() - startTime;

      logger.debug('PostgreSQL query executed', {
        sql,
        params: PostgresClient.sanitizeParams(params),
        rowCount: result.rowCount,
        duration,
        operation,
        userId,
      });

      // Slow query warning
      if (duration > 1000) {
        logger.warn('Slow PostgreSQL query detected', {
          sql,
          duration,
          operation,
          userId,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('PostgreSQL query failed', error as Error, {
        operation,
        userId,
      });

      throw new DatabaseError(
        `PostgreSQL query failed: ${(error as Error).message}`,
        operation || 'query',
        { sql, params, error }
      );
    }
  }

  async queryOne<T extends QueryResultRow = any>(
    sql: string,
    params: QueryParams = {},
    options: QueryOptions = {}
  ): Promise<T | undefined> {
    const result = await this.query<T>(sql, params, options);
    return result.rows[0];
  }

  async queryMany<T extends QueryResultRow = any>(
    sql: string,
    params: QueryParams = {},
    options: QueryOptions = {}
  ): Promise<T[]> {
    const result = await this.query<T>(sql, params, options);
    return result.rows;
  }

  // ========================================================================
  // JSONB Operations with Validation
  // ========================================================================

  /**
   * Query and validate JSONB field against Zod schema
   */
  async queryJsonb<T extends ZodTypeAny>(
    sql: string,
    schema: T,
    params: QueryParams = {},
    options: QueryOptions = {}
  ): Promise<z.infer<T> | undefined> {
    const row = await this.queryOne<any>(sql, params, options);

    if (!row) {
      return undefined;
    }

    // Handle both direct JSONB and JSONB stored as text
    const jsonData = typeof row.jsonb_data === 'string'
      ? parseJSONSafe(row.jsonb_data, options.operation || 'JSONB query')
      : row.jsonb_data;

    if (!jsonData) {
      return undefined;
    }

    return validateWithLogging(schema as any, jsonData, options.operation || 'JSONB validation');
  }

  /**
   * Update JSONB field with validation
   */
  async updateJsonb<T extends ZodTypeAny>(
    tableName: string,
    id: string | number,
    jsonbColumn: string,
    data: any,
    schema: T,
    options: QueryOptions = {}
  ): Promise<void> {
    // Validate before storing
    const validated = validateOrThrow(schema as any, data, `${tableName}.${jsonbColumn} update`);

    const sql = `
      UPDATE ${tableName}
      SET ${jsonbColumn} = $1::jsonb, updated_at = NOW()
      WHERE id = $2
    `;

    await this.query(sql, [JSON.stringify(validated), id], options);
  }

  /**
   * Merge data into JSONB field (partial update)
   */
  async mergeJsonb<T extends ZodTypeAny>(
    tableName: string,
    id: string | number,
    jsonbColumn: string,
    data: Partial<z.infer<T>>,
    schema: T,
    options: QueryOptions = {}
  ): Promise<void> {
    const sql = `
      UPDATE ${tableName}
      SET ${jsonbColumn} = COALESCE(${jsonbColumn}, '{}'::jsonb) || $1::jsonb,
          updated_at = NOW()
      WHERE id = $2
      RETURNING ${jsonbColumn}
    `;

    const result = await this.query(sql, [JSON.stringify(data), id], options);
    const merged = result.rows[0]?.[jsonbColumn];

    // Validate merged result
    if (merged) {
      validateOrThrow(schema as any, merged, `${tableName}.${jsonbColumn} merge`);
    }
  }

  // ========================================================================
  // Transaction Support
  // ========================================================================

  async transaction<T>(
    callback: (client: TransactionClient) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    const client = await this.pool.connect();
    const txClient = new TransactionClient(client, this.logger, options);

    try {
      await txClient.begin();

      const result = await callback(txClient);

      await txClient.commit();

      return result;
    } catch (error) {
      await txClient.rollback();
      throw error;
    } finally {
      client.release();
    }
  }

  // ========================================================================
  // Utility Functions
  // ========================================================================

  /**
   * Convert named parameters to PostgreSQL format
   */
  private processParameters(
    sql: string,
    params: QueryParams
  ): { processedSql: string; values: any[] } {
    const values: any[] = [];
    let paramIndex = 0;

    const processedSql = sql.replace(/\$(\w+)/g, (match, paramName) => {
      if (paramName in params) {
        values.push(params[paramName]);
        return `$${++paramIndex}`;
      }
      return match;
    });

    return { processedSql, values };
  }

  private static sanitizeParams(params: QueryParams): QueryParams {
    const sanitized: QueryParams = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'auth'];
    const truncateKeys = ['embedding', 'vector'];
    const MAX_ARRAY_DISPLAY = 5;

    for (const [key, value] of Object.entries(params)) {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        sanitized[key] = '***REDACTED***';
      } else if (truncateKeys.some((k) => key.toLowerCase().includes(k))) {
        // Truncate long arrays for vector/embedding params
        if (Array.isArray(value) && value.length > MAX_ARRAY_DISPLAY) {
          sanitized[key] = `[${value.slice(0, MAX_ARRAY_DISPLAY).join(', ')}... +${value.length - MAX_ARRAY_DISPLAY} more]`;
        } else if (typeof value === 'string' && value.startsWith('[') && value.length > 100) {
          // Handle string representation of arrays (e.g., "[0.1,0.2,...]")
          const parsed = value.match(/^[\[\]]/);
          if (parsed) {
            const parts = value.slice(1, -1).split(',');
            sanitized[key] = `[${parts.slice(0, MAX_ARRAY_DISPLAY).join(', ')}... +${parts.length - MAX_ARRAY_DISPLAY} more]`;
          } else {
            sanitized[key] = value.length > 50 ? value.slice(0, 50) + '...' : value;
          }
        } else {
          sanitized[key] = value;
        }
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

// ============================================================================
// Transaction Client
// ============================================================================

export class TransactionClient {
  private client: PoolClient;
  private logger: ReturnType<typeof createLogger>;
  private options: TransactionOptions;
  private begun: boolean = false;

  constructor(
    client: PoolClient,
    logger: ReturnType<typeof createLogger>,
    options: TransactionOptions
  ) {
    this.client = client;
    this.logger = logger;
    this.options = options;
  }

  async begin(): Promise<void> {
    if (this.begun) {
      throw new Error('Transaction already begun');
    }

    const isolationLevel = this.options.isolationLevel || 'READ COMMITTED';
    await this.client.query(`BEGIN TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    this.begun = true;

    this.logger.debug('Transaction begun', { isolationLevel });
  }

  async commit(): Promise<void> {
    if (!this.begun) {
      throw new Error('Transaction not begun');
    }

    await this.client.query('COMMIT');
    this.begun = false;

    this.logger.debug('Transaction committed');
  }

  async rollback(): Promise<void> {
    if (!this.begun) {
      return; // Nothing to rollback
    }

    await this.client.query('ROLLBACK');
    this.begun = false;

    this.logger.warn('Transaction rolled back');
  }

  async query<T extends QueryResultRow = any>(
    sql: string,
    params: QueryParams = {}
  ): Promise<QueryResult<T>> {
    if (!this.begun) {
      throw new Error('Transaction not begun');
    }

    const startTime = Date.now();

    try {
      const { processedSql, values } = this.processParameters(sql, params);
      const result = await this.client.query<T>(processedSql, values);
      const duration = Date.now() - startTime;

      this.logger.debug('Transaction query executed', {
        sql,
        rowCount: result.rowCount,
        duration,
      });

      return result;
    } catch (error) {
      this.logger.error('Transaction query failed', error as Error);
      throw error;
    }
  }

  async queryOne<T extends QueryResultRow = any>(
    sql: string,
    params: QueryParams = {}
  ): Promise<T | undefined> {
    const result = await this.query<T>(sql, params);
    return result.rows[0];
  }

  private processParameters(
    sql: string,
    params: QueryParams
  ): { processedSql: string; values: any[] } {
    const values: any[] = [];
    let paramIndex = 0;

    const processedSql = sql.replace(/\$(\w+)/g, (match, paramName) => {
      if (paramName in params) {
        values.push(params[paramName]);
        return `$${++paramIndex}`;
      }
      return match;
    });

    return { processedSql, values };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let postgresClient: PostgresClient | null = null;

export function getPostgresClient(options?: PostgresClientOptions): PostgresClient {
  if (!postgresClient) {
    postgresClient = new PostgresClient(options);
  }

  return postgresClient;
}

export async function closePostgresClient(): Promise<void> {
  if (postgresClient) {
    await postgresClient.close();
    postgresClient = null;
  }
}

// ============================================================================
// User ID Resolution Utility
// ============================================================================

/**
 * Resolve user identifier to UUID
 *
 * Accepts:
 * - UUID (already valid) - verifies user exists and returns it
 * - username (2-20 chars) - queries by username and returns UUID
 * - device_id (for new users created via login-or-create) - queries by device_id and returns UUID
 *
 * @param userIdInput - User identifier (UUID, username, or device_id)
 * @returns Promise<string> - The resolved UUID
 * @throws Error if userIdInput is invalid or user doesn't exist
 */
export async function resolveUserId(userIdInput: string): Promise<string> {
  if (!userIdInput || typeof userIdInput !== 'string') {
    throw new Error('User ID cannot be empty or non-string');
  }

  const { validateUsername, normalizeUsername } = await import('../../../utils/shortIdGenerator.js');
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const client = getPostgresClient();
  const logger = createLogger();

  try {
    // Path 1: If valid UUID, directly verify and return
    if (UUID_REGEX.test(userIdInput)) {
      const existingUser = await client.queryOne(
        'SELECT id FROM users WHERE id = $userId',
        { userId: userIdInput }
      );
      if (existingUser?.id) return userIdInput;
      throw new Error(`User not found: "${userIdInput}"`);
    }

    // Path 2: Validate as username format and query
    const validation = validateUsername(userIdInput);
    if (validation.valid) {
      const normalizedUsername = normalizeUsername(userIdInput);
      const user = await client.queryOne<{ id: string }>(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($username)',
        { username: normalizedUsername }
      );

      if (user?.id) {
        logger.info(`[resolveUserId] Resolved username "${userIdInput}" to UUID "${user.id}"`);
        return user.id;
      }
    }

    // Path 3: Try device_id lookup (for users created via login-or-create endpoint)
    // This is used when frontend passes userId that was actually created via device_id
    const deviceUser = await client.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE device_id = $deviceId',
      { deviceId: userIdInput }
    );

    if (deviceUser?.id) {
      logger.info(`[resolveUserId] Resolved device_id "${userIdInput}" to UUID "${deviceUser.id}"`);
      return deviceUser.id;
    }

    throw new Error(`User not found: "${userIdInput}"`);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('User not found') || message.includes('Invalid')) {
      throw error;
    }
    logger.error(`[resolveUserId] Database error:`, error as Error);
    throw error;
  }
}
