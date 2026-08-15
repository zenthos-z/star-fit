/**
 * Data Validation Utilities
 *
 * Provides safe JSON parsing and validation functions.
 * This is a backend-specific version of the shared validation utilities.
 *
 * For the canonical version, see: shared/contracts/validation.ts
 */

import { z } from 'zod';

// ============================================================================
// Error Types
// ============================================================================

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly schema: string,
    public readonly input: unknown,
    public readonly zodError?: z.ZodError
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

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

export function validateOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string = 'Validation'
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorDetails = formatZodError(result.error);
    const errorMessage = `[${context}] Validation failed:\n${errorDetails}`;

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

export function validateWithLogging<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string = 'Validation',
  defaultValue?: T
): T | undefined {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorDetails = formatZodError(result.error);
    const errorMessage = `[${context}] Validation failed:\n${errorDetails}`;

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

export function parseJSONSafe<T = unknown>(
  jsonString: string | object | null | undefined,
  context: string = 'JSON parsing'
): T | null {
  if (jsonString === null || jsonString === undefined) {
    console.warn(`[${context}] Input is null/undefined, returning null`);
    return null;
  }

  // Handle PostgreSQL JSONB columns that are already parsed to objects
  if (typeof jsonString === 'object') {
    return jsonString as T;
  }

  // Handle string input (legacy format)
  if (typeof jsonString === 'string') {
    if (jsonString.trim() === '') {
      console.warn(`[${context}] Input is empty string, returning null`);
      return null;
    }

    try {
      return JSON.parse(jsonString) as T;
    } catch (error) {
      const errorMessage = `[${context}] Failed to parse JSON: ${(error as Error).message}`;

      console.error(errorMessage, {
        context,
        input: jsonString,
        error
      });

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

  console.warn(`[${context}] Unexpected input type: ${typeof jsonString}, returning null`);
  return null;
}

export function parseAndValidate<T>(
  jsonString: string | null | undefined,
  schema: z.ZodSchema<T>,
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

function formatZodError(error: z.ZodError): string {
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

export function createValidationError(
  context: string,
  schema: string,
  input: unknown,
  zodError?: z.ZodError
): ValidationError {
  const errorDetails = zodError ? formatZodError(zodError) : 'Unknown error';
  const message = `[${context}] Validation failed for ${schema}:\n${errorDetails}`;

  return new ValidationError(message, schema, input, zodError);
}

export function isValid<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): data is T {
  return schema.safeParse(data).success;
}
