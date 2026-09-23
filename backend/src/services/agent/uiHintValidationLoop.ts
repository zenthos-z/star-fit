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
// batch4-4: 最新 session 真值改走 SessionRepo（原 qualityFactsResolver 动态
// import + 直连 SQL 已收编，消除 Agent 层第二条数据缝）。
import { SessionRepo } from "../sessionRepo.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Default number of CORRECTION attempts after the first invalid card. With
 * `maxRetries = 2` the agent gets up to 3 total attempts (1 initial + 2
 * retries) before the loop gives up and yields an error.
 */
export const DEFAULT_MAX_RETRIES = 2;

/**
 * Lightweight user-facing status token yielded at the START of each retry
 * round (feature C — kill the dead 30-90s re-roll gap).
 *
 * It is a plain `token` AgentEvent: the frontend renders it as ordinary text
 * (zero frontend change). Hard rules:
 *   - backend-injected ONLY by this loop (never composed by the model),
 *   - NEVER part of any uiHint card payload,
 *   - NEVER fed to the quality-gate text comparison (`cardToCheckableText`
 *     only ever sees `event.card`, so this string cannot influence a verdict).
 */
export const RETRY_STATUS_TOKEN = "\n\n正在修订卡片…";

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
      const latestRaw = await SessionRepo.getLatestSessionRaw(req.userId);
      if (latestRaw != null) {
        // extractSessionFacts 读 history 形状 { sessions: [...] }，取最后一条为最新。
        sessionFacts = extractSessionFacts({ sessions: [latestRaw] });
      }
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

    let firstInvalid: {
      errors: StructuredError[];
      rejectedCard: unknown;
    } | null = null;
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
        firstInvalid = { errors: item.errors, rejectedCard: item.rejectedCard };
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
    // Feature C — retry-round user perception: before re-invoking the model,
    // yield the backend-injected status token so the user sees progress
    // instead of a dead 30-90s gap while the card is being re-rolled.
    // The token is a plain `token` event (frontend zero change) and never
    // enters any card payload or the quality-gate text comparison.
    yield { type: "token", text: RETRY_STATUS_TOKEN };
    currentReq = buildFeedbackRequest(
      req,
      firstInvalid.errors,
      attempt,
      firstInvalid.rejectedCard,
    );
  }
}

// ---------------------------------------------------------------------------
// Stream consumer (separated so the generator body stays readable)
// ---------------------------------------------------------------------------

type StreamItem =
  | { kind: "event"; event: AgentEvent }
  | {
      kind: "invalid";
      errors: StructuredError[];
      rejectedCard: unknown;
      rejectedText: string;
    }
  | { kind: "rejected_thinking"; text: string };

/**
 * Wrap `deepAgent.chat(req)` as an async iterable of {@link StreamItem}.
 *
 * Two-phase release (M5c real streaming):
 *   - Phase 1 — prose tokens arriving BEFORE the attempt's first card event
 *     cannot be card body: a card only ever begins at a ``` fence, and
 *     anything the upstream extractor flushed before that point is standalone
 *     prose (it would be shown verbatim whether or not the card validates).
 *     Those tokens are forwarded LIVE, so cardless turns stream end-to-end and
 *     card turns stream their preamble immediately — no per-attempt buffering.
 *   - Phase 2 — once a card event has been seen, whatever follows (closing
 *     prose, further cards) is BUFFERED until that card's verdict settles: a
 *     rejected card invalidates the prose written around it, so:
 *       - valid card  -> flush the held post-card prose as tokens, forward the
 *         card, and keep holding for whatever comes after;
 *       - invalid card-> yield the held post-card prose as a
 *         `rejected_thinking` item (the caller surfaces it as a collapsible
 *         thinking block), then `{ kind: 'invalid' }` and the caller retries.
 * - `done` / `error` events and cardless `uiHint` events flush the held buffer
 *   and are forwarded verbatim.
 */
async function* consumeStreamLookingForInvalidCard(
  deepAgent: AgentService,
  req: ChatRequest,
  sessionFacts: WorkoutSessionFacts | null,
): AsyncIterable<StreamItem> {
  const stream = deepAgent.chat(req);
  // Phase 1 (live) vs Phase 2 (held): see the docstring above. `pastFirstCard`
  // flips only after a VALID card is forwarded — an invalid card terminates
  // the attempt immediately, so nothing after it is ever read.
  let pastFirstCard = false;
  let heldText = ""; // post-first-card prose, held until the verdict settles
  for await (const event of stream) {
    if (event.type === "uiHint" && event.card !== undefined) {
      const result = validateUiHint(event.card);
      if (!result.ok) {
        if (heldText) {
          yield { kind: "rejected_thinking", text: heldText };
        }
        yield {
          kind: "invalid",
          errors: result.errors,
          rejectedCard: event.card,
          rejectedText: heldText,
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
          if (heldText) {
            yield { kind: "rejected_thinking", text: heldText };
          }
          yield {
            kind: "invalid",
            errors: quality.issues,
            rejectedCard: event.card,
            rejectedText: heldText,
          };
          return;
        }
      }
      // Valid card — flush post-card prose held since the previous card, then
      // forward the card and enter hold mode for whatever follows it.
      if (heldText) {
        yield { kind: "event", event: { type: "token", text: heldText } };
        heldText = "";
      }
      pastFirstCard = true;
      yield { kind: "event", event };
      continue;
    }
    if (event.type === "token") {
      const text = event.text ?? "";
      if (!text) continue;
      if (!pastFirstCard) {
        // Phase 1: pre-card prose cannot be card body — release live (real
        // streaming). A rejected card does not invalidate this text.
        yield { kind: "event", event };
      } else {
        heldText += text;
      }
      continue;
    }
    // done / error / cardless uiHint — flush any held prose, pass through.
    if (heldText) {
      yield { kind: "event", event: { type: "token", text: heldText } };
      heldText = "";
    }
    yield { kind: "event", event };
  }
  // Stream drained with no card (cardless chat turn) — flush remaining prose.
  if (heldText) {
    yield { kind: "event", event: { type: "token", text: heldText } };
  }
}

// ---------------------------------------------------------------------------
// Feedback request builder
// ---------------------------------------------------------------------------

/**
 * Build a correction request from the ORIGINAL request + the structured
 * errors from the just-rejected card + the rejected card's raw JSON.
 *
 * Feature A — "只修卡不重写" (card-only correction): the feedback text is an
 * explicit directive that tells the model to re-emit ONLY the corrected card
 * inside a json fence, and to NOT rewrite surrounding prose, NOT re-call any
 * tools, and NOT re-read any skill files. The rejected card's verbatim JSON
 * is attached so the model can diff against it without re-deriving it from
 * context. Goal: retry-round decode tokens drop from a full reply to a single
 * card, cutting the 30-90s re-roll window to seconds.
 *
 * Feature B — retry context slimming: the correction request keeps only the
 * ORIGINAL user message + the card JSON + the structured errors. The LangGraph
 * checkpointer thread (keyed by `userId:threadId`) still replays the full
 * prior turn history into the model's context on every `deepAgent.chat` call —
 * that history cannot be trimmed from this seam without forking the thread /
 * rewriting the checkpointer (a structural constraint of Deep Agents). The
 * tradeoff is accepted: context re-READ stays the same, but the instruction
 * constraint in A is what drives the token win (decode, not read). Any future
 * thread-truncation work belongs in DeepAgentService, not here.
 *
 * The correction is carried both as LLM-readable prose (appended to
 * `message`) and as structured data (under `metadata.uiHintValidationFeedback`)
 * so programmatic consumers can inspect it.
 */
/**
 * 导出仅供验证脚本使用；运行时仅模块内部调用。
 */
export function buildFeedbackRequest(
  original: ChatRequest,
  errors: StructuredError[],
  attempt: number,
  rejectedCard: unknown,
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
          "- resistance/unilateral/heavy_weight: beginner/自选 → 给空杆20kg或最小配重2.5-5kg（不能为0）；有经验用户用其报出的具体重量",
          "- assisted: weight MUST be <= 0 (negative = assistance kg, e.g. -20 = 20kg assist)",
          "- bodyweight/rep_training: no required fields (weight defaults to 0)",
          "- flexibility: no required fields",
          "",
          "Read exercise-type-guide/knowledge-index.md for full details.",
        ].join("\n")
      : "";

  const rejectedCardJson = stringifyCard(rejectedCard);

  const correction = [
    "",
    `--- uiHint validation feedback (attempt ${attempt} was rejected) ---`,
    "Your uiHint card was rejected. Fix the errors below and RE-EMIT ONLY THE",
    "CORRECTED CARD, wrapped in a json fence (```json ... ```).",
    "HARD CONSTRAINTS — do not do anything else:",
    "- Do NOT rewrite or repeat the surrounding prose.",
    "- Do NOT re-call any tools.",
    "- Do NOT re-read any skill files.",
    "- Output a single card, nothing before or after the fence.",
    "",
    "Rejected card (verbatim JSON — fix this exact card):",
    "```json",
    rejectedCardJson,
    "```",
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
      uiHintValidationFeedback: {
        attempt,
        errors,
        rejectedCard,
      },
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

/**
 * Serialise a rejected card for embedding in the feedback message.
 *
 * A plain `JSON.stringify` is used (pretty-printed) so the model sees the
 * card exactly as emitted — key order, field casing and all — which it can
 * diff against without re-deriving from context. If serialisation fails
 * (non-JSON-serialisable card), fall back to a stable placeholder rather than
 * crashing the retry path: the structured errors in `metadata` still carry
 * the rejection reason.
 */
function stringifyCard(card: unknown): string {
  try {
    return JSON.stringify(card, null, 2);
  } catch {
    return "<card JSON could not be serialised — see structured errors>";
  }
}
