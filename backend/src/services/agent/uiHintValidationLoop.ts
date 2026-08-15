/**
 * uiHintValidationLoop (M5c) — the uiHint validation + feedback retry loop.
 *
 * L004 boundary pin: this wrapper is the SOLE home of the uiHint validation
 * loop. M3 `DeepAgentService.chat` yields the RAW `AgentEvent` stream
 * (`token` / `uiHint` / `done` / `error`) and intentionally does NOT integrate
 * any retry logic. INT AC4 verifies THIS wrapper.
 *
 * `chatWithValidationLoop(deepAgent, req)` consumes the raw stream from
 * `deepAgent.chat(req)`. For every `uiHint` event it runs `validateUiHint`:
 *   - valid  -> forward the event unchanged,
 *   - invalid -> suppress it, feed the structured errors back to the agent,
 *                and re-invoke `deepAgent.chat` with a correction request,
 *                up to `maxRetries`. Past `maxRetries`, yield a single
 *                `error` event (code `VALIDATION_ERROR`).
 *
 * Everything else (`token` / `done` / `error`, and `uiHint` events carrying
 * no card) is passed through untouched, preserving M3's raw-stream contract.
 *
 * P012 / L005: the retry predicate is `validateUiHint(card).ok === false`,
 * matched directly to the real `StructuredError[]` shape; the feedback
 * request embeds those same structured errors so the agent can correct them,
 * and tests assert the loop genuinely re-invoked `chat` (real retry, not a
 * silent skip).
 */

import type { AgentEvent, ChatRequest } from 'shared/contracts';
import type { AgentService } from './AgentService.js';
import {
  validateUiHint,
  type StructuredError,
} from './uiHintValidator.js';
import { ALLOWED_UIHINT_TYPES, BLACKLISTED_UIHINT_TYPES } from './uiHintFormat.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Default number of CORRECTION attempts after the first invalid card. With
 * `maxRetries = 2` the agent gets up to 3 total attempts (1 initial + 2
 * retries) before the loop gives up and yields an error.
 */
export const DEFAULT_MAX_RETRIES = 2;

/** Options for {@link chatWithValidationLoop}. */
export interface ValidationLoopOptions {
  /**
   * Maximum number of correction rounds after the first invalid card.
   * Defaults to {@link DEFAULT_MAX_RETRIES}.
   */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// chatWithValidationLoop
// ---------------------------------------------------------------------------

/**
 * Stream `AgentEvent`s from `deepAgent.chat`, validating every uiHint card
 * and feeding structured errors back for retry.
 *
 * Yields the same `AgentEvent` element type as the raw seam (`token` /
 * `uiHint` / `done` / `error`); consumers can drop this in wherever they
 * currently consume `deepAgent.chat` directly.
 */
export async function* chatWithValidationLoop(
  deepAgent: AgentService,
  req: ChatRequest,
  options?: ValidationLoopOptions,
): AsyncIterable<AgentEvent> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

  let attempt = 0;
  // Always rebuild feedback from the ORIGINAL request so corrections do not
  // accumulate stale prose across rounds; the `attempt` counter carries history.
  let currentReq: ChatRequest = req;

  // Loop until a stream completes cleanly (done/error already forwarded) or
  // the retry budget is exhausted.
  for (;;) {
    const invalid = consumeStreamLookingForInvalidCard(deepAgent, currentReq);

    let firstInvalid: { errors: StructuredError[] } | null = null;
    for await (const item of invalid) {
      if (item.kind === 'event') {
        // Forward token / done / error / valid-uiHint / cardless-uiHint.
        yield item.event;
      } else {
        // kind === 'invalid' — first invalid card in this stream.
        firstInvalid = { errors: item.errors };
        break;
      }
    }

    if (firstInvalid === null) {
      // Stream ended cleanly (a `done` or `error` was already yielded, or the
      // stream simply drained with no card). Nothing more to do.
      return;
    }

    // An invalid card was found. Decide retry vs. terminal error.
    if (attempt >= maxRetries) {
      // L005: predicate matched real shape — surface the structured errors.
      yield {
        type: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message:
            `uiHint card failed validation after ${attempt + 1} attempt(s): ` +
            formatErrors(firstInvalid.errors),
        },
      };
      return;
    }

    attempt += 1;
    currentReq = buildFeedbackRequest(req, firstInvalid.errors, attempt);
  }
}

// ---------------------------------------------------------------------------
// Stream consumer (separated so the generator body stays readable)
// ---------------------------------------------------------------------------

type StreamItem =
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'invalid'; errors: StructuredError[] };

/**
 * Wrap `deepAgent.chat(req)` as an async iterable of {@link StreamItem}.
 *
 * - `token` / `done` / `error` events and cardless `uiHint` events are
 *   emitted as `{ kind: 'event' }` (forwarded verbatim).
 * - A `uiHint` event whose card FAILS validation is emitted ONCE as
 *   `{ kind: 'invalid' }` and the stream stops (the caller retries).
 * - A `uiHint` event whose card PASSES validation is emitted as
 *   `{ kind: 'event' }` and the stream continues.
 */
async function* consumeStreamLookingForInvalidCard(
  deepAgent: AgentService,
  req: ChatRequest,
): AsyncIterable<StreamItem> {
  const stream = deepAgent.chat(req);
  for await (const event of stream) {
    if (event.type === 'uiHint' && event.card !== undefined) {
      const result = validateUiHint(event.card);
      if (!result.ok) {
        yield { kind: 'invalid', errors: result.errors };
        return; // stop this stream; caller decides retry
      }
      // Valid card — forward the original event unchanged.
      yield { kind: 'event', event };
      continue;
    }
    // Pass through everything else (token / done / error / cardless uiHint).
    yield { kind: 'event', event };
  }
}

// ---------------------------------------------------------------------------
// Feedback request builder
// ---------------------------------------------------------------------------

/**
 * Build a correction request from the ORIGINAL request + the structured
 * errors from the just-rejected card.
 *
 * The correction is carried both as LLM-readable prose (appended to
 * `message`) and as structured data (under `metadata.uiHintValidationFeedback`)
 * so programmatic consumers can inspect it.
 */
function buildFeedbackRequest(
  original: ChatRequest,
  errors: StructuredError[],
  attempt: number,
): ChatRequest {
  // Detect type-related errors for enhanced guidance
  const typeErrors = errors.filter(e =>
    e.path.some(p => p === 'exercise_type' || p === 'duration' || p === 'weight' || p === 'distance')
  );

  const typeGuidance = typeErrors.length > 0
    ? [
        '',
        '### Exercise Type Field Requirements Quick Reference:',
        '- isometric: duration > 0 (required), reps=1',
        '- cardio: duration > 0 (required)',
        '- outdoor: distance > 0 (required)',
        '- resistance/unilateral/heavy_weight/assisted: weight > 0 (required)',
        '- bodyweight/rep_training: no required fields (weight defaults to 0)',
        '- flexibility: no required fields',
        '',
        'Read exercise-type-guide/knowledge-index.md for full details.',
      ].join('\n')
    : '';

  const correction = [
    '',
    `--- uiHint validation feedback (attempt ${attempt} was rejected) ---`,
    'The uiHint card you emitted was invalid. Fix every error below and',
    're-emit a single corrected uiHint card.',
    'Errors:',
    errors
      .map((e) => `- [${e.code}] at ${pathToString(e.path)}: ${e.message}`)
      .join('\n'),
    typeGuidance,
    `Allowed types: ${ALLOWED_UIHINT_TYPES.join(', ')}.`,
    `Blacklisted HITL types (never emit): ${BLACKLISTED_UIHINT_TYPES.join(', ')}.`,
  ].join('\n');

  return {
    ...original,
    message: `${original.message}\n${correction}`,
    metadata: {
      ...(original.metadata ?? {}),
      uiHintValidationFeedback: { attempt, errors },
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatErrors(errors: StructuredError[]): string {
  return errors
    .map((e) => `[${e.code}] at ${pathToString(e.path)}: ${e.message}`)
    .join('; ');
}

function pathToString(path: (string | number)[]): string {
  return path.length === 0 ? '<root>' : path.join('.');
}
