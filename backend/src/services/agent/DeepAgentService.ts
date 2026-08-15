/**
 * DeepAgentService (M3) — concrete {@link AgentService} over deepagents.js
 * `createDeepAgent`.
 *
 * This is the MAS -> Deep Agents kernel. It absorbs 100% of the deepagents
 * contract drift inside the frozen `chat(req): AsyncIterable<AgentEvent>` seam
 * (P010); consumers never see deepagents types.
 *
 * ## Architecture — ONE generic agent (v3 amendments ①②③)
 * - **Single Deep Agent** (修订①): exactly ONE agent is assembled and cached.
 *   It carries the full MCP data-tool set (`buildMcpTools()`) AND the full skill
 *   set (`mountAllSkills()` — every GOLD knowledge skill + the operational
 *   skills). The runtime is a single shared agent loop. Distinct goals (plan /
 *   diagnose / workout review / profile update / tutorial Q&A) are reached by
 *   the LLM activating the matching skill inside that one loop, NOT by separate
 *   methods, isolated sub-agents, or per-scenario assemblies.
 * - `scenario` on `ChatRequest` is accepted but **ignored** at assembly time
 *   (kept only for the P010 frozen seam). The frontend keeps sending it; it no
 *   longer routes anything.
 * - `resetAgentCache()` is retained as a perf-only invalidator (drops the one
 *   cached instance so the next `chat` rebuilds).
 *
 * ## Per-request userId (P006 / P012)
 * The agent is built ONCE with no userId; each `chat()` call passes
 * `configurable.userId` into the LangGraph runnable config. The MCP write tools
 * resolve that userId at invoke time via `getConfig()` (AsyncLocalStorage), so
 * the cached agent safely serves every user.
 *
 * ## Injectable side-effect boundary (P006)
 * The checkpointer is injected from M-RT's `getAgentRuntimeCheckpointer()`
 * (agent_runtime schema, isolated pool). DeepAgentService holds NO business DB
 * handle and imports no `pg`/pool.
 *
 * ## Scope boundary (L004)
 * `chat` yields the RAW `AgentEvent` stream (`token`/`done`/`error`). The M5b
 * uiHint validation loop (`validateUiHint` + feedback retry) is NOT integrated
 * here — M5 wraps it, INT AC4 verifies it.
 */

import { createDeepAgent, type DeepAgent } from 'deepagents';
import type { AIMessageChunk } from '@langchain/core/messages';

import type { AgentEvent, ChatRequest } from 'shared/contracts';
import type { AgentService } from './AgentService.js';
import { loadModel } from '../llm.js';
// P006: inject the checkpointer; no business pool handle crosses this import.
import {
  ensureAgentRuntimeSchema,
  getAgentRuntimeCheckpointer,
} from './agentRuntime.js';
// INT: inject the M5a uiHint card-format skill so the agent emits cards in the
// exact shape the M5 validator (and the INT extraction layer) expect.
import { loadUiHintFormatSkill } from './uiHintFormat.js';
// MCP domain tools (R3): the Agent-only data adapter over the Repository layer.
import { buildMcpTools } from './mcpTools.js';
// R5: mount every GOLD knowledge skill + operational skill via native
// deepagents Skills + Filesystem (read on demand).
import { mountAllSkills } from './skillLoader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A compiled, stateful deep agent (`DeepAgent extends ReactAgent`).
 *
 * `DeepAgent`'s generics encode the response format / tools / child agents it
 * was built with; across the seam we only need "it has `.stream` / `.invoke`",
 * so we fix one concrete instantiation rather than drag deepagents' parameterised
 * generics onto every consumer.
 */
export type CompiledStatefulAgent = DeepAgent;

// ---------------------------------------------------------------------------
// System prompt (the "skill" is system-prompt + native-skill driven, 修订①)
// ---------------------------------------------------------------------------

/**
 * The single systemPrompt every chat turn shares: the uiHint output-format
 * guidance (HC-1 M5a format contract) + the rule that the agent is one loop that
 * picks its own skill and uses its data tools.
 */
const BASE_SYSTEM_PROMPT = [
  'You are the Starfit training agent, a single autonomous agent loop.',
  'Multiple skills are available to you simultaneously; choose which to apply',
  'based on the user intent — do NOT ask which skill to use.',
  '',
  'You also have domain data tools (load_history, list_exercises,',
  'get_exercise_detail, write_session, update_profile, write_memory). Use them',
  'to ground answers in THIS user real data and the real exercise library — see',
  'the fitness-data-tools skill for when/how. list_exercises returns the WHOLE',
  'library (small enough to fit in context) as [{id, name, description}] — call',
  'it once, then pick safe actions in-context. Never invent exercises that are',
  'not in the library; always respect the user equipment + active limitations.',
  '',
  '## uiHint output format (HC-1)',
  'When a structured card is the right response, emit it as a JSON object with',
  'one of these `type` values: plan | summary | survey | instruction | deviation | unknown.',
  'Include `title` (string), `data` (object), `priority` (number, default 0), and',
  'optional `actionUri` (string). Keep prose tokens flowing before/after the card',
  'so the UI can stream naturally. (Programmatic validation of this card is',
  'applied upstream, not in this loop.)',
].join('\n');

/**
 * Build the single systemPrompt: base + the M5a uiHint card-format skill (so the
 * agent emits cards in the exact validated shape). No scenario branching — one
 * generic agent serves every intent.
 */
function buildSystemPrompt(): string {
  return [BASE_SYSTEM_PROMPT, '', loadUiHintFormatSkill()].join('\n');
}

// ---------------------------------------------------------------------------
// Schema-readiness guard (idempotent one-shot)
// ---------------------------------------------------------------------------

/**
 * Resolves once the agent_runtime schema + checkpoint tables exist. Setup is
 * idempotent (`CREATE SCHEMA IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS`), so
 * racing callers share the same promise. Must complete before a compiled graph
 * first uses the checkpointer (M-RT contract).
 */
let schemaReady: Promise<void> | null = null;
function ensureRuntimeReady(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureAgentRuntimeSchema().catch((err) => {
      // Allow the next attempt to retry rather than caching a rejection.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// DeepAgentService
// ---------------------------------------------------------------------------

/**
 * Concrete {@link AgentService}. Programs only against `chat`; the assembly
 * methods (`buildAgent`, `resetAgentCache`) are internal to this module and its
 * tests, not part of the frozen seam.
 */
export class DeepAgentService implements AgentService {
  /**
   * The single cached agent instance. The value is a PROMISE so two concurrent
   * `chat` calls share a single construction (no duplicate model loads /
   * checkpointer wiring). `resetAgentCache` drops it.
   */
  private cached: Promise<CompiledStatefulAgent> | null = null;

  /**
   * Return the cached single agent, constructing it on first call.
   *
   * Generic (修订①): the SAME agent serves every intent — there is no
   * per-scenario assembly and no runtime routing.
   */
  async buildAgent(): Promise<CompiledStatefulAgent> {
    if (this.cached) {
      return this.cached;
    }
    // Cache the PROMISE so concurrent callers join the same construction.
    const building = this.assembleAgent().catch((err) => {
      // Drop the failed construction so the next call can retry.
      this.cached = null;
      throw err;
    });
    this.cached = building;
    return building;
  }

  /**
   * Materialise the single deep agent: model + MCP tools + full skill mount +
   * systemPrompt + checkpointer.
   *
   * Tools (`buildMcpTools()`, DynamicStructuredTool[]) and skills (native
   * SkillsMiddleware) are orthogonal and coexist in one `createDeepAgent` call.
   * Tool names do not collide with the built-in filesystem tools.
   */
  private async assembleAgent(): Promise<CompiledStatefulAgent> {
    // P006: model loaded via loadModel (no provider hardcoded). 'default' is
    // equivalent to chat/plan/tutorial in current config (same provider+model).
    const model = await loadModel('default');

    // P006: checkpointer injected from M-RT (agent_runtime schema). Ensure the
    // schema exists before the graph first reads/writes checkpoint state.
    await ensureRuntimeReady();
    const checkpointer = getAgentRuntimeCheckpointer();

    const systemPrompt = buildSystemPrompt();

    // R3: the Agent-only data adapter (read user/exercise data, write sessions/
    // profile). Parameterless — userId is resolved per-request via configurable.
    const tools = buildMcpTools();

    // R5: every skill under mas/skills/ mounted via native Skills + Filesystem.
    const skillMount = mountAllSkills();

    return createDeepAgent({
      model,
      tools,
      systemPrompt,
      // DeepSeek V4 (current default provider) rejects structured-output
      // `response_format`; the plan card is driven by the M5a skill in the
      // systemPrompt and peeled out by uiHintExtractor instead.
      responseFormat: undefined,
      checkpointer,
      name: 'starfit-agent',
      backend: skillMount.backend,
      skills: skillMount.skills,
      permissions: skillMount.permissions,
      // Note: deepagents auto-includes createPatchToolCallsMiddleware (tool_call
      // / ToolMessage parity guard) in its default stack. It heals dangling
      // VALID tool_calls, but does NOT cover INVALID tool_calls (the args are
      // malformed JSON → langchain drops the call → agent ends the turn). The
      // tool schemas therefore avoid z.enum (DeepSeek emits enum values as
      // unquoted bare words → invalid JSON); see mcpTools.ts queryExercisesSchema.
    });
  }

  /**
   * Run one chat turn and yield the FINAL answer as `AgentEvent`s (P010 seam).
   *
   * A multi-step turn produces several AIMessages; every one except the last
   * carries tool_calls and is intermediate narration ("先看看你的状态…", "没有找到
   * 历史记录，我先…") that must NOT reach the UI — only the terminal, tool-free
   * AI message is the user-facing result. So we run the agent to completion with
   * `.invoke` (no live token stream — the UI shows a spinner while tools run),
   * then emit only that final answer as a single `token` batch. The downstream
   * uiHint extractor still sees the final text and peels any plan/summary card
   * out of it. On failure yields a single `error` and stops.
   *
   * `scenario` on the request is accepted but ignored (generic agent, 修订①).
   * `userId` is threaded into `configurable` so the MCP write tools resolve the
   * calling user via the LangGraph AsyncLocalStorage context.
   */
  async *chat(req: ChatRequest): AsyncIterable<AgentEvent> {
    const threadId = req.threadId ?? req.userId;

    let agent: CompiledStatefulAgent;
    try {
      agent = await this.buildAgent();
    } catch (err) {
      yield toErrorEvent(err);
      return;
    }

    try {
      // Run the full agent loop to completion (model→tool→…→final answer). We
      // do NOT stream intermediate tokens here — only the final answer is
      // surfaced, after the whole turn finishes. Checkpoint state still
      // persists in agent_runtime via the injected checkpointer, so the thread
      // resumes correctly on the next message.
      const result = (await agent.invoke(
        { messages: [{ role: 'user', content: req.message }] },
        {
          configurable: {
            thread_id: threadId,
            // P006/P012: per-request userId for the MCP write tools.
            userId: req.userId,
          },
        },
      )) as { messages?: unknown[] };

      const finalText = finalAnswerText(result?.messages ?? []);
      if (finalText) {
        yield { type: 'token', text: finalText };
      }
      yield { type: 'done' };
    } catch (err) {
      yield toErrorEvent(err);
    }
  }

  /**
   * Drop the cached agent. Perf-only invalidator (修订①): the next `chat`
   * rebuilds a fresh single agent (AC3 / B3).
   */
  resetAgentCache(): void {
    this.cached = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pull incremental text out of a `streamMode: 'messages'` chunk.
 *
 * Chunks are `[AIMessageChunk, metadata]` tuples; `.content` is a string for
 * text models (or a content-block array for multimodal). Non-text / empty
 * content (e.g. tool-call chunks, metadata-only chunks) yields no token.
 */
function extractText(chunk: unknown): string | undefined {
  if (!Array.isArray(chunk)) {
    return undefined;
  }
  const message = chunk[0] as AIMessageChunk | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content.length > 0 ? content : undefined;
  }
  // Multimodal content blocks: concatenate any text blocks.
  if (Array.isArray(content)) {
    let text = '';
    for (const block of content) {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      }
    }
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

/**
 * Pull the user-facing answer out of a COMPLETED agent turn's messages: the
 * LAST AI message that carries NO tool_calls (the react loop's terminal
 * answer). Every earlier AI message carries tool_calls (intermediate narration
 * — "let me check your history…" — plus its accompanying prose) and is dropped
 * on purpose so the UI only ever sees the final result. Returns `''` when no
 * tool-free AI message exists (e.g. the turn ended on a tool call).
 *
 * Messages come back from `agent.invoke(...)` as deserialized langchain
 * instances (`AIMessage` etc.), so `_getType()` and the parsed `.tool_calls`
 * are available; the `role==='assistant'` / `additional_kwargs.tool_calls`
 * fallbacks keep this robust for plain-object shapes too.
 */
function finalAnswerText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      _getType?: () => string;
      role?: string;
      tool_calls?: unknown[];
      additional_kwargs?: { tool_calls?: unknown[] };
      content?: unknown;
    } | null;
    if (!m) continue;
    const isAi =
      typeof m._getType === 'function' ? m._getType() === 'ai' : m.role === 'assistant';
    if (!isAi) continue;
    const hasTools =
      (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) ||
      (Array.isArray(m.additional_kwargs?.tool_calls) &&
        m.additional_kwargs!.tool_calls!.length > 0);
    if (hasTools) continue;
    return extractText([m, {}]) ?? '';
  }
  return '';
}

/** Normalise a thrown value into an `AgentEvent` error element. */
function toErrorEvent(err: unknown): AgentEvent {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'DeepAgentService chat failed';
  return {
    type: 'error',
    error: { code: 'INTERNAL', message },
  };
}

// ---------------------------------------------------------------------------
// Default export: a shared singleton instance (consumers inject this as needed).
// ---------------------------------------------------------------------------

export const deepAgentService: AgentService = new DeepAgentService();
