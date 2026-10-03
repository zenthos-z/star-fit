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
 * 泄漏重试通道（refs #73/#56 机制升级）：Stage1 提取器把写歪在正文的卡片
 * JSON 降级为 `thinking`（不产生 uiHint 事件）时，本循环在流终态（done）识别
 * 降级残片（isDegradedCardFragment：自报卡型 + parse 失败）且本 Attempt 无卡
 * 可校验 → 走同一重试通道（同一 attempt 计数 / RETRY_STATUS_TOKEN /
 * buildLeakFeedbackRequest 围栏协议纠错）。重试成功 → 残片已扣留不下发
 * （等效「从正文剥离」）；重试耗尽 → 残片按现状降级放行（thinking）+ done，
 * 不新增用户可见错误。
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
// #114 B5c：画像域 survey_card 收敛共享题库（Agent 给 purpose+id 意图，
// Service 按题库原文替换题目内容）——schema 校验通过后、下发前执行。
import { canonicalizeSurveyCard } from "./surveyConvergence.js";
// 泄漏重试通道（refs #73/#56 机制升级）：Stage1 降级的卡型残片识别谓词。
import { isDegradedCardFragment } from "./uiHintExtractor.js";
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
    let leak: { fragments: string[] } | null = null;
    for await (const item of invalid) {
      if (item.kind === "event") {
        // Forward token / done / error / valid-uiHint / cardless-uiHint.
        yield item.event;
      } else if (item.kind === "rejected_thinking") {
        // Prose written around a rejected card — surface as collapsible
        // thinking context, never as answer text.
        yield { type: "thinking", text: item.text };
      } else if (item.kind === "leak") {
        // 终态泄漏裁决（refs #73/#56）：降级残片自报卡型，本 Attempt 无卡
        // 可校验。
        leak = { fragments: item.fragments };
        break;
      } else {
        // kind === 'invalid' — first invalid card in this stream.
        firstInvalid = { errors: item.errors, rejectedCard: item.rejectedCard };
        break;
      }
    }

    if (leak !== null) {
      // 泄漏重试通道：复用本循环的重试计数与 RETRY_STATUS_TOKEN。
      if (attempt >= maxRetries) {
        // 重试耗尽 → 维持现状：残片按降级放行（thinking）+ 补发被暂扣的
        // done 收尾。不新增用户可见错误（前端 cardLeakRecovery 兜底仍在）。
        for (const frag of leak.fragments) {
          yield { type: "thinking", text: frag };
        }
        yield { type: "done" };
        return;
      }
      attempt += 1;
      yield { type: "token", text: RETRY_STATUS_TOKEN };
      currentReq = buildLeakFeedbackRequest(req, leak.fragments, attempt);
      continue;
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
  | { kind: "rejected_thinking"; text: string }
  /**
   * 终态泄漏裁决（refs #73/#56）：本 Attempt 无卡可校验，但 Stage1 降级的
   * thinking 残片自报卡型（isDegradedCardFragment）。携带扣留的残片清单交
   * 上层重试；done 已被吞——重试成功则本轮作废，耗尽则由上层补发残片 +
   * done（维持现状）。
   */
  | { kind: "leak"; fragments: string[] };

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
 * - 泄漏残片（Stage1 降级的卡型 thinking，refs #73/#56）：首个有效卡之前
 *   到达的残片扣留不下发（不 flush heldText——此阶段它恒为空）；`done` 时
 *   本 Attempt 仍无卡可校验 → yield `{kind:'leak'}`（done 暂扣）交上层重试；
 *   error 终态 / 已发卡的 done → 残片按现状放行（thinking）。
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
  // 卡型泄漏残片（Stage1 降级 thinking）——扣留至终态裁决：命中重试则由重试
  // 轮重新产卡（残片不下发，等效从正文剥离）；其余终态按现状放行。
  let leakFragments: string[] = [];
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
      // #114 B5c：schema 合法后、下发前，把画像域 survey_card（purpose =
      // profile_intake / plan_gap）的题目集收敛到共享题库原文（Agent 只给
      // purpose + 题库 id 意图，题目内容由 Service 确定性替换）。子集选不中
      // 任何题库 id → 结构化错误，走与 Zod shape 错误同一反馈重试通道。
      const converged = canonicalizeSurveyCard(result.card);
      if (!converged.ok) {
        if (heldText) {
          yield { kind: "rejected_thinking", text: heldText };
        }
        yield {
          kind: "invalid",
          errors: converged.errors,
          rejectedCard: event.card,
          rejectedText: heldText,
        };
        return; // stop this stream; caller decides retry
      }
      // 运行时卡片载荷是 UIHint 形状（契约 AgentEvent.card 为前向兼容
      // UiHintCard），与上游 extractor 同一约定——收敛结果原样承载。
      const canonicalCard = converged.card as typeof event.card;
      // Q1 (workout_complete): schema 合法之后追加数据一致性检测。
      // 引用了与真实训练数据不符数字的卡片按 invalid 处理，走同一反馈重试回路。
      if (sessionFacts) {
        const quality = checkWorkoutCardQuality(
          cardToCheckableText(canonicalCard),
          sessionFacts,
        );
        if (!quality.ok) {
          if (heldText) {
            yield { kind: "rejected_thinking", text: heldText };
          }
          yield {
            kind: "invalid",
            errors: quality.issues,
            rejectedCard: canonicalCard,
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
      yield { kind: "event", event: { ...event, card: canonicalCard } };
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
    if (
      event.type === "thinking" &&
      !pastFirstCard &&
      typeof event.text === "string" &&
      isDegradedCardFragment(event.text)
    ) {
      // 卡型泄漏残片（首卡前到达）：扣留至终态裁决，不即时下发。重试成功则
      // 由重试轮的合法卡替代（残片永不下发）；耗尽/异常终态再按现状放行。
      // （首卡已发后的残片是冗余卡载荷——照现状即时放行 thinking，前端已有
      // 卡时会静默摘除。）
      leakFragments.push(event.text);
      continue;
    }
    if (event.type === "done" && leakFragments.length > 0 && !pastFirstCard) {
      // 终态泄漏裁决：本 Attempt 无卡可校验、降级残片自报卡型 → 走重试通道。
      // done 暂扣不下发：重试成功则本轮作废；耗尽则上层补发残片 + done。
      yield { kind: "leak", fragments: [...leakFragments] };
      return;
    }
    // done / error / cardless uiHint / 非残片 thinking — flush any held
    // prose, release held leak fragments (现状降级放行), pass through.
    if (heldText) {
      yield { kind: "event", event: { type: "token", text: heldText } };
      heldText = "";
    }
    for (const frag of leakFragments) {
      yield { kind: "event", event: { type: "thinking", text: frag } };
    }
    leakFragments = [];
    yield { kind: "event", event };
  }
  // Stream drained with no card (cardless chat turn) — flush remaining prose.
  // 残片在无终态事件（异常流）下不触发重试，按现状降级放行。
  for (const frag of leakFragments) {
    yield { kind: "event", event: { type: "thinking", text: frag } };
  }
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
// Leak-retry feedback builder（refs #73/#56 机制升级）
// ---------------------------------------------------------------------------

/** 泄漏重试的稳定错误码（区别于 Zod shape 错误；程序化消费方可识别）。 */
export const CARD_LEAK_ERROR_CODE = "card_leak";

/**
 * Build a leak-retry correction request: the degraded fragment(s) + a
 * structured fence-protocol error fed back to the agent.
 *
 * 与 {@link buildFeedbackRequest} 同构（只修卡不重写 / 基于原始请求瘦身 /
 * 结构化 metadata 携带反馈），差异点：
 *   - 错误是围栏协议违规而非 Zod shape 错误（任务书话术：卡片未按围栏协议
 *     输出，请用 ```json 围栏重新输出完整卡片）；
 *   - 残片是 parse 失败的破损 JSON，用无语言标注围栏承载（标 json 会误导
 *     模型以为它是合法 JSON 示例）。
 */
export function buildLeakFeedbackRequest(
  original: ChatRequest,
  fragments: string[],
  attempt: number,
): ChatRequest {
  const errors: StructuredError[] = [
    {
      code: CARD_LEAK_ERROR_CODE,
      message:
        "卡片未按围栏协议输出：卡片 JSON 出现在正文散文里（未用 ```json 围栏包裹，" +
        "或语法破损/括号不闭合），无法被提取成卡片。请用 ```json 围栏重新输出完整卡片。",
      path: [],
    },
  ];

  const correction = [
    "",
    `--- uiHint validation feedback (attempt ${attempt} was rejected) ---`,
    "Your uiHint card LEAKED into the prose: the card JSON was not wrapped in",
    "a ```json fence (or its syntax was broken / braces unbalanced), so it",
    "could NOT be extracted as a card and was downgraded. Re-emit the COMPLETE",
    "card, wrapped in a json fence (```json ... ```).",
    "HARD CONSTRAINTS — do not do anything else:",
    "- Do NOT rewrite or repeat the surrounding prose.",
    "- Do NOT re-call any tools.",
    "- Do NOT re-read any skill files.",
    "- Output a single card, nothing before or after the fence.",
    "",
    "Degraded fragment (verbatim — fix this exact card):",
    "```",
    fragments.join("\n\n"),
    "```",
    "Errors:",
    errors
      .map((e) => `- [${e.code}] at ${pathToString(e.path)}: ${e.message}`)
      .join("\n"),
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
        leakFragments: fragments,
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
