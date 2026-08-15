/**
 * L3 Database Validation Layer
 *
 * Third and final layer of defense: validates data integrity
 * immediately before database writes.
 *
 * This is the last line of defense to ensure data integrity.
 * It should be called in repository methods before executing
 * INSERT, UPDATE, or DELETE operations.
 *
 * Core Principles:
 * 1. Never allow invalid data to be written to the database
 * 2. Always log detailed error information
 * 3. Use schemas from shared/contracts for consistency
 * 4. Fail hard - throw errors rather than silently accepting bad data
 *
 * @version 1.0.0
 * @created 2026-02-09
 */

import type { ZodSchema, ZodError } from 'zod';
import type { Logger } from '../../utils/logger.js';

/**
 * Data integrity error thrown when database validation fails
 */
export class DataIntegrityError extends Error {
  constructor(
    message: string,
    public readonly schema: string,
    public readonly input: unknown,
    public readonly zodError?: ZodError
  ) {
    super(message);
    this.name = 'DataIntegrityError';

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataIntegrityError);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      schema: this.schema,
      input: this.input,
      zodErrors: this.zodError?.issues,
      zodIssues: this.zodError?.issues
    };
  }
}

/**
 * Validate data before database write operation
 *
 * This is the L3 database validation layer - the last line of defense.
 * It should be called in repository methods before any write operation.
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to be written to the database
 * @param context - Context string for error messages (e.g., "users.insert", "load_anchors.update")
 * @param logger - Logger instance for detailed error logging
 * @returns Promise that resolves when validation passes
 * @throws DataIntegrityError if validation fails
 *
 * @example
 * ```typescript
 * // In a repository method
 * export async function insertUser(data: unknown): Promise<void> {
 *   await validateBeforeWrite(
 *     UserSchema,
 *     data,
 *     'users.insert',
 *     logger
 *   );
 *
 *   // Proceed with database operation
 *   await db.insert('users', data);
 * }
 * ```
 */
export async function validateBeforeWrite(
  schema: ZodSchema,
  data: unknown,
  context: string,
  logger?: Logger
): Promise<void> {
  const result = await schema.safeParseAsync(data);

  if (!result.success) {
    const errorMessage = `[${context}] Database validation failed - data integrity check prevented write operation`;

    // Log detailed error information
    const errorDetails = {
      context,
      schema: schema.description || context,
      input: data,
      errors: result.error.issues,
      issues: result.error.issues
    };

    if (logger) {
      logger.error(errorMessage, errorDetails);
    } else {
      console.error(errorMessage, errorDetails);
    }

    // Throw to prevent the write operation
    throw new DataIntegrityError(
      errorMessage,
      schema.description || context,
      data,
      result.error
    );
  }

  // Validation passed - log in debug mode
  if (logger) {
    logger.debug(`[${context}] Database validation passed`, { context });
  }
}

/**
 * Synchronous version of validateBeforeWrite for non-async schemas
 *
 * Use this when the schema validation doesn't need to be async.
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to be written to the database
 * @param context - Context string for error messages
 * @param logger - Logger instance for detailed error logging
 * @throws DataIntegrityError if validation fails
 */
export function validateBeforeWriteSync(
  schema: ZodSchema,
  data: unknown,
  context: string,
  logger?: Logger
): void {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorMessage = `[${context}] Database validation failed - data integrity check prevented write operation`;

    const errorDetails = {
      context,
      schema: schema.description || context,
      input: data,
      errors: result.error.issues,
      issues: result.error.issues
    };

    if (logger) {
      logger.error(errorMessage, errorDetails);
    } else {
      console.error(errorMessage, errorDetails);
    }

    throw new DataIntegrityError(
      errorMessage,
      schema.description || context,
      data,
      result.error
    );
  }

  if (logger) {
    logger.debug(`[${context}] Database validation passed`, { context });
  }
}

/**
 * Validate multiple records before batch database write
 *
 * Use this for batch insert/update operations.
 * Ensures all records are valid before any database operation.
 *
 * @param schema - Zod schema to validate against
 * @param records - Array of records to be written
 * @param context - Context string for error messages
 * @param logger - Logger instance for detailed error logging
 * @returns Promise that resolves when all records are valid
 * @throws DataIntegrityError if any record fails validation
 *
 * @example
 * ```typescript
 * export async function batchInsertLoadAnchors(records: unknown[]): Promise<void> {
 *   await validateBatchBeforeWrite(
 *     LoadAnchorSchema,
 *     records,
 *     'load_anchors.batch_insert',
 *     logger
 *   );
 *
 *   await db.batchInsert('load_anchors', records);
 * }
 * ```
 */
export async function validateBatchBeforeWrite<T>(
  schema: ZodSchema<T>,
  records: unknown[],
  context: string,
  logger?: Logger
): Promise<void> {
  const errors: Array<{ index: number; error: ZodError }> = [];

  // Validate all records
  for (let i = 0; i < records.length; i++) {
    const result = await schema.safeParseAsync(records[i]);

    if (!result.success) {
      errors.push({ index: i, error: result.error });
    }
  }

  // If any errors, throw with details
  if (errors.length > 0) {
    const errorMessage = `[${context}] Batch database validation failed - ${errors.length} of ${records.length} records are invalid`;

    const errorDetails = {
      context,
      schema: schema.description || context,
      totalRecords: records.length,
      failedRecords: errors.length,
      errors: errors.map(e => ({
        index: e.index,
        errors: e.error.issues,
        input: records[e.index]
      }))
    };

    if (logger) {
      logger.error(errorMessage, errorDetails);
    } else {
      console.error(errorMessage, errorDetails);
    }

    throw new DataIntegrityError(
      errorMessage,
      schema.description || context,
      { records, errors },
      errors[0]?.error // Include first error for reference
    );
  }

  if (logger) {
    logger.debug(`[${context}] Batch database validation passed`, {
      context,
      recordCount: records.length
    });
  }
}

/**
 * Validate a partial update before database write
 *
 * Use this for partial update operations where only some fields are being updated.
 *
 * @param schema - Zod schema for the partial update (should use .partial() or .deepPartial())
 * @param data - Partial data to be updated
 * @param context - Context string for error messages
 * @param logger - Logger instance for detailed error logging
 * @throws DataIntegrityError if validation fails
 *
 * @example
 * ```typescript
 * const PartialProfileSchema = ProfileSchema.partial();
 *
 * export async function updateProfilePartial(id: string, data: unknown): Promise<void> {
 *   await validatePartialBeforeWrite(
 *     PartialProfileSchema,
 *     data,
 *     `profiles.update.${id}`,
 *     logger
 *   );
 *
 *   await db.update('profiles', id, data);
 * }
 * ```
 */
export async function validatePartialBeforeWrite(
  schema: ZodSchema,
  data: unknown,
  context: string,
  logger?: Logger
): Promise<void> {
  const result = await schema.safeParseAsync(data);

  if (!result.success) {
    const errorMessage = `[${context}] Partial update validation failed - data integrity check prevented write operation`;

    const errorDetails = {
      context,
      schema: schema.description || context,
      input: data,
      errors: result.error.issues,
      issues: result.error.issues
    };

    if (logger) {
      logger.error(errorMessage, errorDetails);
    } else {
      console.error(errorMessage, errorDetails);
    }

    throw new DataIntegrityError(
      errorMessage,
      schema.description || context,
      data,
      result.error
    );
  }

  if (logger) {
    logger.debug(`[${context}] Partial update validation passed`, { context });
  }
}

/**
 * Create a database validator instance with a pre-configured logger
 *
 * This is useful for dependency injection in repository classes.
 *
 * @example
 * ```typescript
 * class UserRepository {
 *   private validator: DatabaseValidator;
 *
 *   constructor(logger: Logger) {
 *     this.validator = createDatabaseValidator(logger);
 *   }
 *
 *   async insertUser(data: unknown) {
 *     await this.validator.validate(UserSchema, data, 'users.insert');
 *     // ... database operation
 *   }
 * }
 * ```
 */
export interface DatabaseValidator {
  validate(schema: ZodSchema, data: unknown, context: string): Promise<void>;
  validateSync(schema: ZodSchema, data: unknown, context: string): void;
  validateBatch<T>(schema: ZodSchema<T>, records: unknown[], context: string): Promise<void>;
  validatePartial(schema: ZodSchema, data: unknown, context: string): Promise<void>;
}

export function createDatabaseValidator(logger: Logger): DatabaseValidator {
  return {
    validate: (schema, data, context) => validateBeforeWrite(schema, data, context, logger),
    validateSync: (schema, data, context) => validateBeforeWriteSync(schema, data, context, logger),
    validateBatch: (schema, records, context) => validateBatchBeforeWrite(schema, records, context, logger),
    validatePartial: (schema, data, context) => validatePartialBeforeWrite(schema, data, context, logger)
  };
}
