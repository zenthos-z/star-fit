/**
 * uiHintValidator (M5b) — pure Zod v3 validator for uiHint cards.
 *
 * P005 version-boundary-plain-schema: this validator runs on the project's
 * zod3 (^3.23.8), NOT zod4. It consumes the migrated canonical schema
 * (`./schemas/uiHintSchemas.js`, AC6 golden-master migration from
 * `mas/schemas/uiHintSchemas.ts`) verbatim — no schema rewrite — and only
 * layers the HC-4 HITL blacklist on top.
 *
 * HC-4 (hard constraint): `hitl_confirm` is a blacklisted HITL card type.
 * It is rejected BEFORE schema parsing so it gets a clear, intentional error
 * instead of a generic invalid-enum message.
 *
 * Note: `survey_card` is NOW ALLOWED for workout_complete scenario (v3 amendment).
 * The agent may emit survey_card after training ends to collect user feedback.
 *
 * Pure function: no IO, no side effects, no logging — fully unit-testable.
 * The M5c loop (`uiHintValidationLoop.ts`) consumes this to decide retry vs.
 * forward; the structured `errors` shape is exactly what the loop feeds back
 * to the agent (L005: retry predicate matches the real error shape).
 */

import type { z } from 'zod';
// P008 / AC6: import the migrated canonical schema verbatim — do not rewrite.
import { UIHintSchema } from './schemas/uiHintSchemas.js';
import type { UIHint } from './schemas/uiHintSchemas.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured validation error. Mirrors the useful fields of a Zod issue plus
 * a stable `code`. This is the shape the validation loop feeds back to the
 * agent and the shape tests assert on (L005).
 */
export interface StructuredError {
  /** Zod issue code (e.g. 'invalid_type', 'too_small') or 'hitl_blacklist'. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Dotted path into the rejected card (numbers for array indices). */
  path: (string | number)[];
}

/** Successful validation: the card is a fully-typed {@link UIHint}. */
export interface ValidateUiHintOk {
  ok: true;
  card: UIHint;
}

/** Failed validation: structured errors describing every problem found. */
export interface ValidateUiHintErr {
  ok: false;
  errors: StructuredError[];
}

/** Discriminated result returned by {@link validateUiHint}. */
export type ValidateUiHintResult = ValidateUiHintOk | ValidateUiHintErr;

// ---------------------------------------------------------------------------
// HC-4 HITL blacklist
// ---------------------------------------------------------------------------

/**
 * Card types that must NEVER be produced by the agent (HC-4).
 *
 * `hitl_confirm` is not in the schema enum at all; listing it explicitly
 * yields a precise error instead of a generic enum failure.
 *
 * Note: `survey_card` is now ALLOWED for workout_complete scenario (v3 amendment).
 * The agent may emit survey_card after training ends to collect user feedback.
 */
export const HITL_BLACKLISTED_TYPES: ReadonlySet<string> = new Set([
  'hitl_confirm',
]);

/**
 * Stable code attached to HC-4 blacklist rejections so callers/tests can
 * distinguish them from ordinary shape errors.
 */
export const HITL_BLACKLIST_CODE = 'hitl_blacklist';

// ---------------------------------------------------------------------------
// validateUiHint
// ---------------------------------------------------------------------------

/**
 * Validate a uiHint card against the canonical schema + HC-4 HITL blacklist.
 *
 * Pure, synchronous, no IO. Order of checks:
 *   1. HC-4 blacklist — reject `hitl_confirm` up front with a precise error.
 *   2. `UIHintSchema.safeParse` — enforce type whitelist (the 6-type
 *      discriminated union), required fields, per-type data shape, and the
 *      preserved business rules (e.g. ExercisePlan `sets`/`reps` positive
 *      integers). Zod issues are projected to {@link StructuredError}[].
 *
 * @returns `{ ok: true, card }` on success, or `{ ok: false, errors }` with
 *          at least one structured error on any failure.
 */
export function validateUiHint(card: unknown): ValidateUiHintResult {
  // HC-4: reject blacklisted HITL types before parsing.
  if (isPlainObject(card)) {
    const typeValue = (card as { type?: unknown }).type;
    if (typeof typeValue === 'string' && HITL_BLACKLISTED_TYPES.has(typeValue)) {
      return {
        ok: false,
        errors: [
          {
            code: HITL_BLACKLIST_CODE,
            message: `HITL card type "${typeValue}" is blacklisted (HC-4) and must not be emitted.`,
            path: ['type'],
          },
        ],
      };
    }
  }

  // P005: parse with the project zod3 canonical schema (AC6, verbatim import).
  const parsed = UIHintSchema.safeParse(card);
  if (parsed.success) {
    return { ok: true, card: parsed.data };
  }

  // P012: project Zod issues into the structured shape the loop feeds back.
  const errors = projectZodErrors(parsed.error);
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Project a `ZodError` into {@link StructuredError}[].
 *
 * `z.ZodError` is imported as a type only (no runtime zod4 coupling); the
 * real error object comes from the project's zod3 and exposes `.issues`.
 */
function projectZodErrors(error: z.ZodError): StructuredError[] {
  // `issues` is the canonical accessor on ZodError in zod3; defensive `??`
  // guards against any non-conforming error shape.
  const issues = error.issues ?? [];
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: Array.isArray(issue.path) ? issue.path.map(String) : [],
  }));
}