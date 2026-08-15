import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AgentService } from "../services/agent/AgentService.js";
import type { AgentEvent, ChatRequest } from "shared/contracts";
import { streamAgentSSE } from "../sse/agentSse.js";
import { getUserId } from "../utils/requestUtils.js";
// INT: card extraction + M5 validation loop compose the production agent stream.
import { extractUiHintEvents } from "../services/agent/uiHintExtractor.js";
import { chatWithValidationLoop } from "../services/agent/uiHintValidationLoop.js";

// P010: /api/chat crosses ONLY the frozen `AgentService.chat(req): AsyncIterable<AgentEvent>`
// seam. The MAS->Deep Agents kernel swap is absorbed inside that seam; this
// controller (and the frontend) change nothing for the migration.

/**
 * Request body for /api/chat. `scenario` is accepted for the P010 frozen seam
 * but the generic DeepAgent ignores it (one agent, all skills/tools mounted);
 * it is no longer an assembly selector. Kept optional so the frontend contract
 * does not change.
 */
const ChatSchema = z.object({
  message: z.string().min(1),
  scenario: z
    .enum(["chat", "plan", "workout_complete", "update_profile"])
    .optional(),
  threadId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// P006 injectable IO seam: AgentService resolver.
// ---------------------------------------------------------------------------
// Default lazily imports the real DeepAgentService so this module does not drag
// the langchain/deepagents/PG graph into tests that only exercise the SSE layer.
// Tests inject a probe/fake agent (L009: fake only the unstable LLM; the SSE
// transport — hijack/sseEncode/raw.end — stays 100% real per A018/L100).

type AgentServiceResolver = () => Promise<AgentService>;

let cachedDefault: AgentService | null = null;

/**
 * Compose the production {@link AgentService}: raw DeepAgentService -> INT
 * uiHint extraction -> M5 validation/retry loop.
 *
 * The result still exposes the frozen `chat(req): AsyncIterable<AgentEvent>`
 * seam (P010), so {@link postChat} and the frontend change nothing. Two stages:
 *  - Stage 1 (INT, {@link extractUiHintEvents}): peel fenced JSON cards out of
 *    the raw `token` stream into structured `uiHint` events. Liberal — invalid
 *    cards pass through so the validator can see and reject them (B4).
 *  - Stage 2 (M5, {@link chatWithValidationLoop}): validate every uiHint card;
 *    feed structured errors back and re-invoke the extracting service up to
 *    `maxRetries`, else yield `VALIDATION_ERROR`.
 *
 * L004: the validation loop's SOLE home is M5 `chatWithValidationLoop`; this
 * factory only composes existing stages, it does not implement retry. M3
 * `DeepAgentService.chat` stays a raw stream.
 */
export function composeCardValidatingService(raw: AgentService): AgentService {
  const extracting: AgentService = {
    async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
      yield* extractUiHintEvents(raw.chat(req));
    },
  };
  return {
    async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
      yield* chatWithValidationLoop(extracting, req);
    },
  };
}

/** Production resolver: the composed real DeepAgentService (imported lazily). */
const defaultResolver: AgentServiceResolver = async () => {
  if (cachedDefault === null) {
    const { deepAgentService } = await import("../services/agent/DeepAgentService.js");
    cachedDefault = composeCardValidatingService(deepAgentService);
  }
  return cachedDefault;
};

let resolveAgentService: AgentServiceResolver = defaultResolver;

/**
 * Override the AgentService resolver (tests inject a probe/fake agent). Pass
 * `null` to restore the real DeepAgentService resolver.
 */
export function setAgentServiceResolver(resolver: AgentServiceResolver | null): void {
  resolveAgentService = resolver ?? defaultResolver;
}

// ---------------------------------------------------------------------------
// POST /api/chat — SSE streaming over the frozen AgentService.chat seam.
// ---------------------------------------------------------------------------

/**
 * Stream one chat turn as SSE (`token` | `uiHint` | `done` | `error` frames).
 *
 * P007 error isolation lives in {@link streamAgentSSE} (hijack + try/catch/finally
 * with `raw.end()`). This handler only assembles the {@link ChatRequest}, pulls
 * the `AsyncIterable<AgentEvent>` from the seam, and hands both to the transport.
 */
export async function postChat(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = getUserId(req);
  const parsed = ChatSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    reply.status(400).send({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { message, scenario, threadId, metadata } = parsed.data;
  const chatRequest: ChatRequest = {
    userId,
    message,
    ...(scenario !== undefined ? { scenario } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };

  const service = await resolveAgentService();
  const events = service.chat(chatRequest);

  // Return the streaming promise so Fastify does not finalize before the stream
  // ends; streamAgentSSE hijacks the reply and owns raw.end().
  return streamAgentSSE(reply, events);
}
