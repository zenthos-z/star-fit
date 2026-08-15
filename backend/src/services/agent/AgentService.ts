/**
 * AgentService — v3 port contract (Deep Agents kernel seam).
 *
 * P010 signature-frozen seam: the MAS → Deep Agents kernel replacement absorbs
 * 100% of its contract drift inside this seam. Consumers program only against
 * `chat(req): AsyncIterable<AgentEvent>`; the signature is frozen verbatim and
 * any backward-compatibility compromise must be digested here, never spilled to
 * callers (zero consumer change).
 *
 * 修订③ (v3 architecture amendment): only `chat` remains. The v2 multi-method
 * surface (separate plan / diagnose entrypoints) and their dedicated request
 * types are removed. Distinct goals (plan / diagnose / tutorial / ...) are
 * achieved by the LLM activating the corresponding skill inside the single
 * agent loop (system-prompt driven), NOT by separate service methods. `scenario` lives on
 * ChatRequest as an assembly-time config field (修订①), not a method and not a
 * runtime route.
 *
 * Types are imported from the shared single source of truth (P001) so the
 * shared / backend / frontend workspaces close TS2307 via workspace paths.
 *
 * Concrete implementation: M3 DeepAgentService.
 */

import type { AgentEvent, ChatRequest } from 'shared/contracts';

/**
 * The single port every agent consumer programs against.
 *
 * Adding methods here breaks the frozen seam (P010) — do not. New capabilities
 * are expressed as skills activated inside the agent loop, not as new methods.
 */
export interface AgentService {
  /**
   * Stream agent output for a single chat turn.
   *
   * Yields `AgentEvent` elements (`token` / `uiHint` / `done` / `error`).
   * The `scenario` field on `req` only selects assembly-time configuration
   * (skill set / systemPrompt / responseFormat); it does not branch to a
   * different method.
   */
  chat(req: ChatRequest): AsyncIterable<AgentEvent>;
}
