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

import type { AgentEvent, ChatRequest } from "shared/contracts";
import type { AgentService } from "./AgentService.js";
import { validateUiHint, type StructuredError } from "./uiHintValidator.js";
import {
  ALLOWED_UIHINT_TYPES,
  BLACKLISTED_UIHINT_TYPES,
} from "./uiHintFormat.js";
import {
  checkWorkoutCardQuality,
  cardToCheckableText,
  extractSessionFacts,
} from "./workoutQualityGate.js";
import type { WorkoutSessionFacts } from "./workoutQualityGate.js";

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

  // Q1: workout_complete 场景加载数据一致性检测所需的最新 session 真值。
  // 读取失败不阻断主流程（质量检测降级为跳过，而不是把整个聊天打断）。
  let sessionFacts: WorkoutSessionFacts | null = null;
  if (req.scenario === "workout_complete") {
    try {
      const { getLatestSessionFacts } =
        await import("./qualityFactsResolver.js");
      sessionFacts = await getLatestSessionFacts(req.userId);
    } catch {
      sessionFacts = null;
    }
  }

  let attempt = 0;
  // Always rebuild feedback from the ORIGINAL request so corrections do not
  // accumulate stale prose across rounds; the `attempt` counter carries history.
  let currentReq: ChatRequest = req;

  // Loop until a stream completes cleanly (done/error already forwarded) or
  // the retry budget is exhausted.
  for (;;) {
    const invalid = consumeStreamLookingForInvalidCard(
      deepAgent,
      currentReq,
      sessionFacts,
    );

    let firstInvalid: { errors: StructuredError[] } | null = null;
    for await (const item of invalid) {
      if (item.kind === "event") {
        // Forward token / done / error / valid-uiHint / cardless-uiHint.
        yield item.event;
      } else if (item.kind === "rejected_thinking") {
        // Prose written around a rejected card — surface as collapsible
        // thinking context, never as answer text.
        yield { type: "thinking", text: item.text };
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
        type: "error",
        error: {
          code: "VALIDATION_ERROR",
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
  | { kind: "event"; event: AgentEvent }
  | { kind: "invalid"; errors: StructuredError[]; rejectedText: string }
  | { kind: "rejected_thinking"; text: string };

/**
 * Wrap `deepAgent.chat(req)` as an async iterable of {@link StreamItem}.
 *
 * Tokens are BUFFERED per attempt (not forwarded live). Rationale: a rejected
 * card invalidates everything the model said in that attempt (the prose was
 * written around the bad card), so re-emitting it to the user would leak the
 * agent's mid-revision monologue into the chat as fake "chain of thought".
 * Instead:
 *   - valid card  -> flush the buffered tokens, then forward the card;
 *   - invalid card-> yield the buffered prose as a `rejected_thinking` item
 *     (the caller surfaces it as a collapsible thinking block), then
 *     `{ kind: 'invalid' }` and the caller retries.
 * - `done` / `error` events and cardless `uiHint` events flush the buffer and
 *   are forwarded verbatim.
 */
async function* consumeStreamLookingForInvalidCard(
  deepAgent: AgentService,
  req: ChatRequest,
  sessionFacts: WorkoutSessionFacts | null,
): AsyncIterable<StreamItem> {
  const stream = deepAgent.chat(req);
  let bufferedText = ""; // this attempt's prose, held until the card verdict
  for await (const event of stream) {
    if (event.type === "uiHint" && event.card !== undefined) {
      const result = validateUiHint(event.card);
      if (!result.ok) {
        if (bufferedText) {
          yield { kind: "rejected_thinking", text: bufferedText };
        }
        yield {
          kind: "invalid",
          errors: result.errors,
          rejectedText: bufferedText,
        };
        return; // stop this stream; caller decides retry
      }
      // Q1 (workout_complete): schema 合法之后追加数据一致性检测。
      // 引用了与真实训练数据不符数字的卡片按 invalid 处理，走同一反馈重试回路。
      if (sessionFacts) {
        const quality = checkWorkoutCardQuality(
          cardToCheckableText(event.card),
          sessionFacts,
        );
        if (!quality.ok) {
          if (bufferedText) {
            yield { kind: "rejected_thinking", text: bufferedText };
          }
          yield {
            kind: "invalid",
            errors: quality.issues,
            rejectedText: bufferedText,
          };
          return;
        }
      }
      // Valid card — flush the buffered prose first, then forward the card.
      if (bufferedText) {
        yield { kind: "event", event: { type: "token", text: bufferedText } };
        bufferedText = "";
      }
      yield { kind: "event", event };
      continue;
    }
    if (event.type === "token") {
      bufferedText += event.text ?? "";
      continue;
    }
    // done / error / cardless uiHint — flush any pending prose, pass through.
    if (bufferedText) {
      yield { kind: "event", event: { type: "token", text: bufferedText } };
      bufferedText = "";
    }
    yield { kind: "event", event };
  }
  // Stream drained with no card (cardless chat turn) — flush remaining prose.
  if (bufferedText) {
    yield { kind: "event", event: { type: "token", text: bufferedText } };
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
  const typeErrors = errors.filter((e) =>
    e.path.some(
      (p) =>
        p === "exercise_type" ||
        p === "duration" ||
        p === "weight" ||
        p === "distance",
    ),
  );

  const typeGuidance =
    typeErrors.length > 0
      ? [
          "",
          "### Exercise Type Field Requirements Quick Reference:",
          "- isometric: duration > 0 (required), reps=1",
          "- cardio: duration > 0 (required)",
          "- outdoor: distance > 0 (required)",
          "- resistance/unilateral/heavy_weight: weight optional (0 = user self-selects on first attempt)",
          "- assisted: weight MUST be <= 0 (negative = assistance kg, e.g. -20 = 20kg assist)",
          "- bodyweight/rep_training: no required fields (weight defaults to 0)",
          "- flexibility: no required fields",
          "",
          "Read exercise-type-guide/knowledge-index.md for full details.",
        ].join("\n")
      : "";

  const correction = [
    "",
    `--- uiHint validation feedback (attempt ${attempt} was rejected) ---`,
    "The uiHint card you emitted was invalid. Fix every error below and",
    "re-emit a single corrected uiHint card.",
    "Errors:",
    errors
      .map((e) => `- [${e.code}] at ${pathToString(e.path)}: ${e.message}`)
      .join("\n"),
    typeGuidance,
    `Allowed types: ${ALLOWED_UIHINT_TYPES.join(", ")}.`,
    `Blacklisted HITL types (never emit): ${BLACKLISTED_UIHINT_TYPES.join(", ")}.`,
  ].join("\n");

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
    .join("; ");
}

function pathToString(path: (string | number)[]): string {
  return path.length === 0 ? "<root>" : path.join(".");
}
