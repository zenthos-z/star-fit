/**
 * Validation Utilities Re-exports for Frontend
 *
 * This file re-exports validation utilities for the frontend.
 * The actual utilities are defined in: shared/contracts/validation.ts
 */

export {
  parseJSONSafe,
  validateOrThrow,
  validateWithLogging,
  parseAndValidate,
  createValidationError,
  isValid,
  validateBatch
} from '../../shared/contracts/validation';

export {
  ValidationError,
  JSONParseError
} from '../../shared/contracts/validation';
