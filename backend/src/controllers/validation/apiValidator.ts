/**
 * L1 API Boundary Validation
 *
 * First layer of defense: validates all incoming HTTP requests
 * before they reach the service layer.
 *
 * Core Principles:
 * 1. Never silently fail - always throw on validation errors
 * 2. Use validateOrThrow from shared/contracts/validation.ts
 * 3. Provide detailed error context for debugging
 * 4. Fail fast - catch invalid data at the boundary
 *
 * @version 1.0.0
 * @created 2026-02-09
 */

import type { ZodSchema, ZodType } from 'zod';
import { validateOrThrow } from '@shared/contracts/validation.js';
import type { Logger } from '../../utils/logger.js';

/**
 * Validation error with HTTP status code
 */
export class APIValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'APIValidationError';
  }
}

/**
 * Validate request body against a schema
 *
 * This is the L1 API boundary validation layer.
 * All HTTP requests must pass through this validation before reaching services.
 *
 * @param schema - Zod schema to validate against
 * @param data - Request body data (typically req.body)
 * @param context - Context string for error messages (e.g., "POST /api/profile")
 * @param logger - Optional logger for detailed error logging
 * @returns Validated and typed data
 * @throws APIValidationError if validation fails
 *
 * @example
 * ```typescript
 * // In an Express controller
 * try {
 *   const validatedProfile = validateRequestBody(
 *     UserProfileSchema,
 *     req.body,
 *     'POST /api/profile'
 *   );
 *   // Proceed with validated data...
 * } catch (error) {
 *   if (error instanceof APIValidationError) {
 *     return res.status(error.statusCode).json({
 *       error: error.message,
 *       details: error.details
 *     });
 *   }
 *   throw error;
 * }
 * ```
 */
export function validateRequestBody<T>(
  schema: ZodType<T>,
  data: unknown,
  context: string,
  logger?: Logger
): T {
  try {
    return validateOrThrow(schema, data, context);
  } catch (error) {
    // Re-throw as APIValidationError with HTTP status
    if (error instanceof Error) {
      throw new APIValidationError(
        `[${context}] Request validation failed: ${error.message}`,
        400,
        { originalError: error.name, input: data }
      );
    }
    throw new APIValidationError(
      `[${context}] Unknown validation error`,
      400,
      { error, input: data }
    );
  }
}

/**
 * Validate request query parameters against a schema
 *
 * @param schema - Zod schema to validate against
 * @param query - Request query parameters (typically req.query)
 * @param context - Context string for error messages
 * @param logger - Optional logger for detailed error logging
 * @returns Validated and typed query parameters
 * @throws APIValidationError if validation fails
 */
export function validateRequestQuery<T>(
  schema: ZodType<T>,
  query: unknown,
  context: string,
  logger?: Logger
): T {
  try {
    return validateOrThrow(schema, query, context);
  } catch (error) {
    if (error instanceof Error) {
      throw new APIValidationError(
        `[${context}] Query validation failed: ${error.message}`,
        400,
        { originalError: error.name, input: query }
      );
    }
    throw new APIValidationError(
      `[${context}] Unknown validation error`,
      400,
      { error, input: query }
    );
  }
}

/**
 * Validate request path parameters against a schema
 *
 * @param schema - Zod schema to validate against
 * @param params - Request path parameters (typically req.params)
 * @param context - Context string for error messages
 * @param logger - Optional logger for detailed error logging
 * @returns Validated and typed path parameters
 * @throws APIValidationError if validation fails
 */
export function validateRequestParams<T>(
  schema: ZodType<T>,
  params: unknown,
  context: string,
  logger?: Logger
): T {
  try {
    return validateOrThrow(schema, params, context);
  } catch (error) {
    if (error instanceof Error) {
      throw new APIValidationError(
        `[${context}] Path parameter validation failed: ${error.message}`,
        400,
        { originalError: error.name, input: params }
      );
    }
    throw new APIValidationError(
      `[${context}] Unknown validation error`,
      400,
      { error, input: params }
    );
  }
}

/**
 * Express middleware factory for request body validation
 *
 * @param schema - Zod schema to validate against
 * @param context - Context string for error messages
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { validateBody } from './apiValidator';
 * import { UserProfileSchema } from 'shared/contracts';
 *
 * const router = express.Router();
 *
 * router.post(
 *   '/profile',
 *   validateBody(UserProfileSchema, 'POST /api/profile'),
 *   (req, res) => {
 *     // req.body is now validated and typed
 *     const profile = req.body; // type: UserProfile
 *     // ... handle request
 *   }
 * );
 * ```
 */
export function validateBody<T>(
  schema: ZodSchema<T>,
  context: string
): (req: any, res: any, next: any) => void {
  return (req, res, next) => {
    try {
      req.body = validateRequestBody(schema, req.body, context);
      next();
    } catch (error) {
      if (error instanceof APIValidationError) {
        return res.status(error.statusCode).json({
          error: error.message,
          details: error.details
        });
      }
      next(error);
    }
  };
}

/**
 * Express middleware factory for query parameter validation
 *
 * @param schema - Zod schema to validate against
 * @param context - Context string for error messages
 * @returns Express middleware function
 */
export function validateQuery<T>(
  schema: ZodSchema<T>,
  context: string
): (req: any, res: any, next: any) => void {
  return (req, res, next) => {
    try {
      req.query = validateRequestQuery(schema, req.query, context);
      next();
    } catch (error) {
      if (error instanceof APIValidationError) {
        return res.status(error.statusCode).json({
          error: error.message,
          details: error.details
        });
      }
      next(error);
    }
  };
}

/**
 * Express middleware factory for path parameter validation
 *
 * @param schema - Zod schema to validate against
 * @param context - Context string for error messages
 * @returns Express middleware function
 */
export function validatePathParams<T>(
  schema: ZodSchema<T>,
  context: string
): (req: any, res: any, next: any) => void {
  return (req, res, next) => {
    try {
      req.params = validateRequestParams(schema, req.params, context);
      next();
    } catch (error) {
      if (error instanceof APIValidationError) {
        return res.status(error.statusCode).json({
          error: error.message,
          details: error.details
        });
      }
      next(error);
    }
  };
}
