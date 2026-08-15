/**
 * AgentClient — frontend port mirroring the frozen backend `AgentService` seam.
 *
 * P010 (signature-frozen seam migration): the MAS → Deep Agents kernel
 * replacement absorbs 100% of its contract drift inside this seam. Consumers
 * (hooks / UI) program only against `chat(req): AsyncIterable<AgentEvent>` and
 * never perceive the backend implementation swap. The signature is frozen
 * verbatim and intentionally identical to `backend/src/services/agent/AgentService.ts`.
 *
 * Types come from the shared single source of truth (`shared/contracts`), so the
 * shared / backend / frontend workspaces close TS2307 via workspace paths.
 */
import type { AgentEvent, ChatRequest } from 'shared/contracts';

/**
 * The single port every frontend agent consumer programs against.
 *
 * Adding methods here breaks the frozen seam (P010) — do not. New capabilities
 * are expressed as skills activated inside the agent loop, not as new methods.
 */
export interface AgentClient {
  /**
   * Stream agent output for a single chat turn.
   *
   * Yields `AgentEvent` elements (`token` / `uiHint` / `done` / `error`).
   * `scenario` on `req` only selects assembly-time configuration; it does not
   * branch to a different method.
   */
  chat(req: ChatRequest): AsyncIterable<AgentEvent>;
}
