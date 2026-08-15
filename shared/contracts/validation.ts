/**
 * Data Validation Utilities
 *
 * Provides safe JSON parsing and validation functions that:
 * 1. Never silently fail - always log detailed errors
 * 2. Throw in development for fast feedback
 * 3. Log in production for observability
 * 4. Provide type-safe parsing
 *
 * Core Principles:
 * - No silent fallbacks that mask errors
 * - Detailed error logging for debugging
 * - Consistent error handling across all code paths
 *
 * @version 2.0.0
 */

import { z } from 'zod';
import type { ZodSchema, ZodError } from 'zod';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Validation error with detailed context
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly schema: string,
    public readonly input: unknown,
    public readonly zodError?: ZodError
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * JSON Parse error with detailed context
 */
export class JSONParseError extends Error {
  constructor(
    message: string,
    public readonly input: string,
    public readonly originalError: SyntaxError | Error
  ) {
    super(message);
    this.name = 'JSONParseError';
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate data against a schema and throw if invalid
 * Use in development to catch errors early
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param context - Context string for error messages (e.g., "LoadAnchor parsing")
 * @returns Validated data
 * @throws ValidationError if validation fails
 */
export function validateOrThrow<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context: string = 'Validation'
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorDetails = formatZodError(result.error);
    const errorMessage = `[${context}] Validation failed:\n${errorDetails}`;

    // Log detailed error for debugging
    console.error(errorMessage, {
      context,
      input: data,
      zodError: result.error
    });

    throw new ValidationError(
      errorMessage,
      schema.description || context,
      data,
      result.error
    );
  }

  return result.data;
}

/**
 * Validate data against a schema with logging
 * Use in production to log validation failures without throwing
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param context - Context string for error messages
 * @param defaultValue - Default value if validation fails (optional)
 * @returns Validated data or default value
 */
export function validateWithLogging<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context: string = 'Validation',
  defaultValue?: T
): T | undefined {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorDetails = formatZodError(result.error);
    const errorMessage = `[${context}] Validation failed:\n${errorDetails}`;

    // Log detailed error for observability
    console.error(errorMessage, {
      context,
      input: data,
      zodError: result.error,
      hasDefault: defaultValue !== undefined
    });

    if (defaultValue !== undefined) {
      console.warn(`[${context}] Using default value due to validation failure`);
      return defaultValue;
    }

    return undefined;
  }

  return result.data;
}

/**
 * Safely parse JSON with detailed error handling
 * Never returns silently - always logs errors
 *
 * @param jsonString - JSON string to parse
 * @param context - Context string for error messages
 * @returns Parsed object or null if parsing fails
 * @throws JSONParseError in development (NODE_ENV !== 'production')
 */
export function parseJSONSafe<T = unknown>(
  jsonString: string | null | undefined,
  context: string = 'JSON parsing'
): T | null {
  // Handle null/undefined input
  if (jsonString === null || jsonString === undefined) {
    console.warn(`[${context}] Input is null/undefined, returning null`);
    return null;
  }

  // Handle already-parsed objects (PostgreSQL JSONB)
  if (typeof jsonString === 'object') {
    console.warn(`[${context}] Input is already an object (likely JSONB), returning as-is`);
    return jsonString as T;
  }

  // Handle empty string
  if ((jsonString as string).trim() === '') {
    console.warn(`[${context}] Input is empty string, returning null`);
    return null;
  }

  try {
    return JSON.parse(jsonString as string) as T;
  } catch (error) {
    const errorMessage = `[${context}] Failed to parse JSON: ${(error as Error).message}`;

    // Always log the error
    console.error(errorMessage, {
      context,
      input: jsonString,
      error
    });

    // In development, throw for fast feedback
    if (process?.env?.NODE_ENV !== 'production') {
      throw new JSONParseError(
        errorMessage,
        jsonString,
        error as SyntaxError | Error
      );
    }

    return null;
  }
}

/**
 * Parse JSON and validate against schema in one step
 *
 * @param jsonString - JSON string to parse
 * @param schema - Zod schema to validate against
 * @param context - Context string for error messages
 * @returns Validated data or null
 */
export function parseAndValidate<T>(
  jsonString: string | null | undefined,
  schema: ZodSchema<T>,
  context: string = 'Parse and validate'
): T | null {
  const parsed = parseJSONSafe(jsonString, context);
  if (parsed === null) {
    return null;
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    const errorDetails = formatZodError(result.error);
    console.error(`[${context}] Validation failed after parsing:\n${errorDetails}`, {
      context,
      parsed,
      zodError: result.error
    });
    return null;
  }

  return result.data;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format Zod error for readable output
 */
function formatZodError(error: ZodError): string {
  const lines: string[] = [];

  error.issues.forEach((err: any) => {
    const path = err.path.length > 0 ? err.path.join('.') : 'root';
    lines.push(`  - ${path}: ${err.message}`);
    if (err.code === 'invalid_union') {
      lines.push(`    Expected one of: ${err.unionErrors.map((e: any) => e.errors[0]?.message).join(', ')}`);
    }
  });

  return lines.join('\n');
}

/**
 * Create a validation error for logging
 */
export function createValidationError(
  context: string,
  schema: string,
  input: unknown,
  zodError?: ZodError
): ValidationError {
  const errorDetails = zodError ? formatZodError(zodError) : 'Unknown error';
  const message = `[${context}] Validation failed for ${schema}:\n${errorDetails}`;

  return new ValidationError(message, schema, input, zodError);
}

/**
 * Check if data matches schema without throwing
 */
export function isValid<T>(
  schema: ZodSchema<T>,
  data: unknown
): data is T {
  return schema.safeParse(data).success;
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Validate multiple items and return all errors
 */
export function validateBatch<T>(
  schema: ZodSchema<T>,
  items: unknown[],
  context: string = 'Batch validation'
): { valid: T[]; errors: Array<{ index: number; error: ValidationError }> } {
  const valid: T[] = [];
  const errors: Array<{ index: number; error: ValidationError }> = [];

  items.forEach((item, index) => {
    const result = schema.safeParse(item);

    if (!result.success) {
      errors.push({
        index,
        error: new ValidationError(
          `[${context}] Item ${index} validation failed`,
          schema.description || context,
          item,
          result.error
        )
      });

      // Log each error
      console.error(`[${context}] Item ${index} failed validation`, {
        index,
        item,
        zodError: result.error
      });
    } else {
      valid.push(result.data);
    }
  });

  return { valid, errors };
}
