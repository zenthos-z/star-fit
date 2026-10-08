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

import { createDeepAgent, type DeepAgent } from "deepagents";
import { AIMessageChunk } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import type { AgentEvent, ChatRequest } from "shared/contracts";
import type { AgentService } from "./AgentService.js";
import { loadModel, loadVisionModel } from "../llm.js";
// P006: inject the checkpointer; no business pool handle crosses this import.
import {
  ensureAgentRuntimeSchema,
  getAgentRuntimeCheckpointer,
} from "./agentRuntime.js";
// INT: inject the M5a uiHint card-format skill so the agent emits cards in the
// exact shape the M5 validator (and the INT extraction layer) expect.
import { loadUiHintFormatSkill } from "./uiHintFormat.js";
// MCP domain tools (R3): the Agent-only data adapter over the Repository layer.
// turnToolCacheMiddleware（#116）：同轮幂等只读工具结果缓存，实现见 mcpTools
// （Agent 工具执行层单一收口，覆盖 mcpTools 读工具 + deepagents read_file）。
import {
  buildMcpTools,
  ensureWeeklyPlanTemplateIdAudit,
  turnToolCacheMiddleware,
} from "./mcpTools.js";
// #151 S2 卡片工具通道：通道解析（DB > env > 默认）+ 卡汇排水/清理
// （submit_xxx 工具成功路径推卡，classifyAgentStream 发射）。
import {
  channelSignature,
  clearThreadCards,
  drainCardsFromSink,
  resolveCardChannels,
  type CardChannels,
} from "./cardSubmit.js";
// R5: mount every GOLD knowledge skill + operational skill via native
// deepagents Skills + Filesystem (read on demand).
import { mountAllSkills } from "./skillLoader.js";
// 拆出的纯函数（2026-09-22）：独立模块可在 jest CJS 下直接测试，
// 避免顶层 import.meta（skillLoader）把整条链拖进 ESM 域。
import { splitLeakedReasoning } from "./splitLeakedReasoning.js";
import { chunkAnswerText } from "./splitLeakedReasoning.js";
import { stripToolEchoPrefix } from "./splitLeakedReasoning.js";
import { stripToolEchoBlocks } from "./splitLeakedReasoning.js";
import { LiveEchoGate } from "./splitLeakedReasoning.js";
// 吞卡修复（refs #73）：tool_calls 消息正文里的卡片段切分器（围栏卡 /
// inline 卡 + 复述判别豁免），见 uiHintExtractor 的 splitCardSegments。
import { splitCardSegments } from "./uiHintExtractor.js";
export { splitLeakedReasoning };

// ---------------------------------------------------------------------------
// Streaming constants
// ---------------------------------------------------------------------------

// NOTE: the per-step paragraph release machinery (BLOCK_SEP / BLOCK_SEP_RE)
// was removed with the 2026-09-23 tool-leak fix — paragraph classification
// at delta time cannot know whether the running step is terminal, and that
// premature `isAnswerStartBlock` flip was the regression vector. The batch
// splitter (splitLeakedReasoning) now owns all text classification at the
// `updates` snapshot boundary.

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
 * The single systemPrompt every chat turn shares: identity/voice, the
 * proposal-confirm + delivery contract (rule detail converged into the
 * plan-generation skill, 42a/issue #42) and the rule that the agent is one
 * loop that picks its own skill and uses its data tools. Card FORMAT lives in
 * the injected uiHint card-format skill (loadUiHintFormatSkill), not here.
 */
const BASE_SYSTEM_PROMPT = [
  "You are the Starfit training agent, a single autonomous agent loop.",
  "",
  "## Identity & coaching voice (灵魂设定)",
  "You are the user's personal strength & conditioning coach inside the Starfit",
  "app. Address the user by their display name, in natural Chinese. Voice:",
  "professional, warm, direct — like a trusted coach, never preachy, never",
  "generic. In workout flows be brief and instructional; in consulting turns",
  "explain the reasoning in one or two sentences before the advice.",
  "Coaching philosophy (apply in EVERY plan and adjustment):",
  "- Progressive overload first: change ONE variable at a time against the",
  "  user's load_anchors, never jump weights arbitrarily.",
  "- Recovery outranks volume: when status is unclear, down-regulate rather",
  "  than push. 宁轻勿伤 — a conservative plan the user completes beats an",
  "  aggressive one they abandon or get hurt doing.",
  "- Never prescribe an exercise the user has no history with AND that is not",
  "  in the library; respect equipment and active limitations at all times.",
  "Hard boundaries: you are NOT a medical service. Pain/injury questions get",
  "load reduction advice plus a clear recommendation to see a doctor or",
  "physiotherapist — never diagnosis, never medication, never diet-prescription",
  "(general nutrition habits are fine to discuss). Say so plainly when asked",
  "beyond these boundaries.",
  "",
  "Multiple skills are available to you simultaneously; choose which to apply",
  "based on the user intent — do NOT ask which skill to use.",
  "",
  "## Tool-call efficiency (latency matters — the user watches you think)",
  "Every tool round-trip costs the user 5-15 seconds of waiting. When you need",
  "SEVERAL independent reads (e.g. two skill files, or skill + load_history),",
  "issue them ALL as parallel tool calls in ONE turn instead of one per turn —",
  "sequential reads of independent files are the most common avoidable delay.",
  "For a brand-new plan request the expected fast path is exactly TWO model",
  "rounds before the first card: (1) parallel reads [plan-generation skill",
  "entry + load_history] → (2) survey_card or plan_card. Do not read files you",
  "already read earlier in this thread — prior tool results stay in context.",
  "",
  "## Profile auto-update trigger (ANY scenario, incl. plain chat)",
  "Whenever the user's message SEMANTICALLY signals a state change — injury or",
  'discomfort ("肩膀僵", "右边使不上劲"), unusual fatigue, sleep disruption,',
  "continuous training days, or a training-day wrap-up — you MUST, in that same",
  "turn (after load_history), also propose a profile update by emitting a",
  "`profile_update_confirm` card (see the profile-update-reviewer skill).",
  "You may give training advice in the same reply, but the confirm card is NOT",
  'optional and is NOT skipped in favor of "wait for more info": ask targeted',
  "follow-up questions inside the card's message if needed. NEVER call",
  "`update_profile` in that turn. Every proposal carries its FINAL applicable",
  "value in `value` (the app writes it deterministically on bubble-confirm —",
  "no second LLM round), and when your reply interrupts a main user task",
  "(e.g. 根据我的信息调整一下周计划), ALSO set `pending_intent` so the app can",
  "resume it after the write. A later message starting with （系统续跑指令）",
  "means the profile is ALREADY updated — continue the user's original task",
  "instead of updating the profile again.",
  "",
  "## Weekly-plan proposal rules (proposal-confirm — B5b, ANY scenario)",
  "Weekly plans are PROPOSALS: there is NO save tool — compute the full",
  "entries this turn, emit a weekly_plan card carrying data.apply, and the",
  "app persists ONLY after the user taps confirm. Never say 已保存/已生效",
  "for a proposed plan; say 确认后生效.",
  "Weekly/daily granularity (survey-first gate / whole-week-first / day-",
  "adjust vs framework-recompute / ask when unclear), the apply payload",
  "contract (PlanEntryInput incl. T9 structured fields day_focus / rationale /",
  "category warmup|main|cooldown / per-set prescription sets, strict split",
  "enum, server-resolved week_id, sets.length = target_sets) and the name_zh",
  "Chinese-first rule have ONE source: the plan-generation skill — read its",
  "SKILL.md then knowledge.md §11.1 granularity table before any plan work.",
  "Delivery rule: every plan-delivery turn (weekly proposal, day adjust,",
  "tomorrow-plan request) MUST contain the fenced card — never prose-only;",
  "a prose summary is a failed delivery. Re-emitting on a repeat ask is",
  "correct, not spam.",
  "",
  "## Output length & formatting",
  "NON-CARD PROSE LIMIT: plain explanations and chat replies that contain no",
  "structured card MUST stay under 200 Chinese characters per reply. This is a",
  "soft guideline you enforce by self-discipline — never pad, never ramble.",
  "Structured cards do not count toward the limit, but keep their prose",
  "wrapper to one sentence. If more detail is genuinely needed, move it into",
  "a card rather than growing the prose.",
  "FORMATTING: structure every non-card reply for scanability — lead with the",
  'conclusion in one line, then at most 2-3 short points (use "-" bullets or',
  "line breaks, never a wall of text). Drop filler, greetings and repetition.",
  "",
  "## No visible reasoning (思考泄漏禁令 — CRITICAL)",
  "Your final reply (any AI message with NO tool calls) is shown to the user",
  "VERBATIM as the answer prose. It must contain ONLY the user-facing answer:",
  "- NEVER write internal deliberation, self-questioning, option weighing, or",
  '  English planning notes ("Given I\'ve already...", "Actually, re-reading...",',
  '  "I\'ll ask...") in the final message. Decide silently, then answer.',
  "- The final reply starts directly with the answer (Chinese, coaching voice).",
  "- Reasoning OUTLOUD is only allowed on INTERMEDIATE steps — messages that",
  "  carry tool_calls (that narration is shown collapsed in a thinking panel).",
  "  If you need to think, call a tool; a tool-free message is PURE answer.",
  "",
  "## Plan prerequisites (最小信息集 — before ANY plan or adjustment)",
  "A training plan or plan adjustment is only as good as its inputs. Before",
  "producing or materially changing a plan you MUST know, from load_history",
  "(profile_static / profile_dynamic) or from this conversation: (1) the goal",
  "(preferences.goal — muscle_gain / fat_loss / strength / general_fitness /",
  "body_recomp), (2) training experience level, (3) available equipment",
  "(preferences.equipment, values = EXERCISE_EQUIPMENT), (4) weekly frequency",
  "(preferences.weekly_frequency_days), (5) active limitations / injuries",
  "(profile_dynamic.active_limitations — entries may carry `note` with the",
  "user's original injury wording; respect it, not just the severity number),",
  "and (6) body weight (basic_info.weight — needed for resistance estimation,",
  "assisted-exercise assistance sizing, and bodyweight effective-load",
  "semantics). If any of these is genuinely unknown and NOT answerable from",
  "tools, ask FIRST — emit a survey_card listing the missing bank question",
  "ids: purpose='plan_gap' for a few specific gaps, 'profile_intake' when the",
  "profile is mostly empty (the backend canonicalizes question content from",
  "the shared bank by id — never invent profile question wording/options;",
  "see the survey_card format section) — instead of silently assuming",
  "defaults. Exception: the user explicitly asks for a quick improvised",
  "session; then state your one assumption in a single line and proceed.",
  "Missing-data semantics when you DO build the plan:",
  "- PRE WEIGHT RULE — a plan card must NEVER contain a resistance-type",
  "  exercise with weight 0; missing load_anchor branches on experience level",
  "  (beginner starter loads / experienced PRE-test): plan-generation",
  "  knowledge.md §3.2.0 is the single source — never invent a weight.",
  "- BODY WEIGHT RULE (symmetric to PRE WEIGHT) — never silently emit a plan",
  "  containing assisted or resistance exercises when basic_info.weight is",
  "  unknown: assistance sizing and load estimation both anchor to body weight",
  "  (see plan-generation knowledge §3.2.0). Ask via survey card first; if the",
  "  user declines, fall back to self-selected weights and say so. Bodyweight",
  "  exercises with weight 0 are correct as-is and never require asking.",
  "- recovery_state empty → treat as a normal week but say the assumption.",
  "- New user with empty history → prefer foundational movements from the",
  "  library, conservative volumes (below MEV), and say it is a starting",
  "  point to calibrate in the first 2 weeks.",
  "- HISTORY IMPORT OFFER — when the user has empty load_anchors and looks",
  "  experienced (or asks about past training), offer: 「你也可以把以前训练",
  "  记录的截图/照片发给我（App 里点输入框的图片按钮），我能读出你练过的动",
  "  作和重量，直接写进训练锚点，计划就不用从空杆开始了」. When the user",
  "  sends a training-log screenshot: read the exercises + weights + reps",
  "  from the image, confirm with the user via profile_update_confirm card,",
  "  then save as load_anchors via update_profile.",
  "For plan ADJUSTMENTS, state the trigger in one line before the change",
  "(performance plateau / persistent fatigue / schedule change / pain), then",
  "change the minimum number of variables needed.",
  "",
  "You also have domain data tools (load_history, find_exercises,",
  "list_exercises, get_exercise_detail, write_session, update_profile,",
  "write_memory). Use them to ground answers in THIS user real data and the",
  "real exercise library — see the fitness-data-tools skill for when/how.",
  "Exercise picking in plan flows uses find_exercises: ONE call combines",
  "muscle_groups + movement_pattern + equipment + difficulty and returns a",
  "RANKED short list — converge in ≤3 calls (merge days into one query;",
  "relax ONE dimension per relax_hint), NEVER page through the library.",
  "list_exercises stays for keyword lookup / browsing only (paginated,",
  "default 30 rows per call). Never invent exercises that are not in the",
  "library; always respect the user equipment + active limitations.",
].join("\n");

/**
 * Per-scenario data interpretation addendum for the systemPrompt. The agent
 * stays single and generic (修订①) — the scenario only teaches it how to READ
 * the pre-formatted training records stored by POST /api/sessions per exercise
 * type, so load_history output is interpreted correctly.
 */
const SCENARIO_DATA_GUIDES: Record<string, string> = {
  workout_complete: [
    "## Reading pre-formatted workout records (workout_complete)",
    "Each persisted session row under history_summary.sessions contains:",
    "- start_time / end_time (ISO) — actual workout window.",
    "- exercises[]: ONE AGGREGATE ROW PER EXERCISE (not raw sets). Fields are",
    "  type-dependent — always read them by the row's `type`:",
    "  * resistance/unilateral/assisted/bodyweight → weight (avg kg), reps",
    "    (avg per set), sets (planned), completed_sets (done). The session",
    "    total is already in stats.totalVolume — do NOT recompute from",
    "    incomplete data.",
    "  * cardio/outdoor → duration (total seconds), distance (total meters),",
    "    avg_hr (bpm). Session-level cardio stats: stats.totalCardioDurationSec,",
    "    stats.totalDistanceM, stats.avgHr.",
    "  * isometric → duration (total seconds), optional weight.",
    "- stats: { totalVolume (kg), setsCount, totalCardioDurationSec (s),",
    "  totalDistanceM (m), durationMinutes?, avgHr? }.",
    "A missing field means the type does not record it (e.g. no distance for",
    "general cardio) or no HR device was connected — treat it as absent data,",
    "never as zero performance, and never invent numbers.",
    "",
    "When analyzing the latest session (last element of sessions[]): compare",
    "completed_sets vs sets for incomplete work, weight vs profile_dynamic",
    "load_anchors for PRs/down-regulation, and report cardio minutes /",
    "distance / avg HR when present. Then follow the workout-complete-handler",
    "skill for survey questions and profile updates.",
  ].join("\n"),

  update_profile: [
    "## User-profile update confirmation flow (update_profile)",
    "The user-profile auto-update feature is gated by explicit user consent.",
    "Follow the profile-update-reviewer skill exactly:",
    "",
    "1. TRIGGER detected (day training wrap-up, injury report, or a change to",
    "   a key profile parameter) -> call `load_history` to read the CURRENT",
    "   profile_dynamic and the relevant sessions FIRST.",
    "2. PROPOSE, never write: emit a `profile_update_confirm` card. Every",
    "   proposal carries its FINAL applicable `value` computed NOW (shapes:",
    "   load_anchors = map { exerciseKey: anchorObj }; active_limitations =",
    "   array of NEW entries [{ part, severity }]; recovery_state = object",
    "   { total_score }; memories = map { key: content } — expire_at /",
    "   logged_at / last_assessed are stamped server-side, do not compute",
    "   them). If the user's message had a MAIN TASK beyond the update (e.g.",
    "   调整周计划), ALSO set `pending_intent` { user_message, summary,",
    "   scenario }. Do NOT call `update_profile` in this turn.",
    "3. BUBBLE CONFIRM (primary path): the app applies the values directly",
    "   via a deterministic endpoint — you are NOT invoked for the write.",
    "   The next turn arrives marked （系统续跑指令）: the profile is already",
    "   updated. Resume the pending task (e.g. produce the adjusted weekly",
    "   plan card) WITHOUT re-proposing or re-writing the profile.",
    "4. TEXT CONFIRM (fallback): if the user confirms in plain text (「好 /",
    "   更新吧」), follow the skill's manual path: load_history -> merge ->",
    "   `update_profile` -> audit_complete card. If the user declined,",
    "   acknowledge briefly and change nothing.",
    "5. Only propose changes grounded in real tool data — never invent",
    "   anchors, limitations, or recovery values.",
  ].join("\n"),
};

/**
 * plan 场景速查表（2026-09-28 收敛）— 仅保留提示性 reminder（幻影工具禁令 /
 * 出卡自检 / 校验重试语义）。周/日粒度规则、新手起步重量、apply 载荷契约已
 * 收敛到 plan-generation 技能单一真源（SKILL.md 判定表 + knowledge.md §3.2.0），
 * 本表只留指针，不再复述规则全文（42a/issue #42，消除多份近似规则的
 * 思考对齐负担）。长度约束：注入后 buildSystemPrompt 总长不得超出现状 +70 行。
 */
const PLAN_SCENARIO_QUICKREF = [
  "## Plan scenario quick reference (condensed reminders only)",
  "Granularity rules (survey-first gate, whole-week-first, day-adjust vs",
  "framework-recompute, ask when unclear), beginner starter loads and the",
  "apply payload contract are NOT restated here — the plan-generation skill",
  "(SKILL.md + knowledge.md §11.1 granularity table, §3.2.0) is the single",
  "source; read it for any plan request.",
  "Card reminders (full format: uiHint card-format skill): no",
  "submit_plan/calculate_capacity tools exist — emit the card directly as a",
  "```json fenced block; id MUST come from list_exercises real entries;",
  "explanation non-empty; respect equipment + active limitations (hard).",
  "SELF-CHECK before emitting the card: real ids / type matches library /",
  "integer sets+reps / no weight=0 on resistance / target marker if tomorrow.",
  "Validation failures come back as feedback retries (rejected turn shows as",
  "thinking) — fix the named fields and re-emit the whole card.",
].join("\n");

/**
 * Build the single systemPrompt: base + scenario data guide (when known) + the
 * M5a uiHint card-format skill (so the agent emits cards in the exact validated
 * shape). No scenario branching of the agent itself — one generic agent serves
 * every intent; the scenario only adds data-interpretation guidance.
 *
 * plan 场景额外注入 PLAN_SCENARIO_QUICKREF（收敛后的精简 reminder 指针，
 * 规则全文只在 plan-generation 技能单一真源）。
 * 导出仅供单测断言各场景 systemPrompt 组装；运行时仅模块内部调用。
 */
export function buildSystemPrompt(
  scenario?: string,
  cardChannels?: CardChannels,
): string {
  const parts = [BASE_SYSTEM_PROMPT];
  const guide = scenario ? SCENARIO_DATA_GUIDES[scenario] : undefined;
  if (guide) {
    parts.push(guide);
  }
  if (scenario === "plan") {
    parts.push(PLAN_SCENARIO_QUICKREF);
  }
  // #151 S2 双轨：tool 通道卡型的文案切「调用 submit_xxx 提交」；缺省
  // （不传 channels）= 全 fence，输出与改造前逐字节一致。
  parts.push(loadUiHintFormatSkill(cardChannels));
  return parts.join("\n\n");
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
   * Cached agent instances, keyed by scenario (the ONLY per-scenario state is
   * the systemPrompt data guide). The value is a PROMISE so two concurrent
   * `chat` calls share a single construction (no duplicate model loads /
   * checkpointer wiring). `resetAgentCache` drops them all.
   */
  private cached: Map<string, Promise<CompiledStatefulAgent>> = new Map();

  /**
   * #151 S2 双轨：每个缓存键（scenario::img/txt）组装时的通道签章。
   * `chat()` 每轮解析通道对拍——DB/env flag 翻转 → resetAgentCache，
   * 下一轮按新通道重建（prompt 文案 + submit_xxx 工具面一起换）。
   */
  private channelSignatures: Map<string, string> = new Map();

  /**
   * Return the cached single agent, constructing it on first call.
   *
   * Generic (修订①): the SAME agent serves every intent — there is no
   * per-scenario assembly and no runtime routing.
   *
   * `hasImage`：带图轮次用多模态视觉模型（doubao-seed-2.1-turbo）构建 agent，
   * 与无图（deepseek 文本）实例分开缓存，互不污染。
   *
   * #151 S2：卡型通道在缓存 promise **之前**解析（签章先行——chat() 的
   * flag 对拍不会撞上「promise 已缓存但签章未写」的窗口），同一份 channels
   * 传给 assembleAgent（prompt + 工具面一致）。
   */
  async buildAgent(
    scenario?: string,
    hasImage = false,
  ): Promise<CompiledStatefulAgent> {
    const key = `${scenario ?? "default"}::${hasImage ? "img" : "txt"}`;
    const existing = this.cached.get(key);
    if (existing) {
      return existing;
    }
    const cardChannels = await resolveCardChannels();
    this.channelSignatures.set(key, channelSignature(cardChannels));
    // Cache the PROMISE so concurrent callers join the same construction.
    const building = this.assembleAgent(scenario, hasImage, cardChannels).catch(
      (err) => {
        // Drop the failed construction so the next call can retry.
        this.cached.delete(key);
        this.channelSignatures.delete(key);
        throw err;
      },
    );
    this.cached.set(key, building);
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
  private async assembleAgent(
    scenario?: string,
    hasImage = false,
    cardChannels: CardChannels = {},
  ): Promise<CompiledStatefulAgent> {
    // P006: model loaded via loadModel (no provider hardcoded). scenario now
    // flows through (was hardcoded 'default'): task-scoped model config keys
    // (GLM_MODEL_<TASK>) resolve per scenario, and fast-lane scenarios
    // (workout_complete — B5b SSE ③) get GLM thinking disabled to shorten
    // turn latency. chat/plan/tutorial remain equivalent to 'default'.
    // hasImage → 多模态视觉模型（doubao-seed-2.1-turbo @ ark），图片直接进模型。
    // 文本模型（DeepSeek）不吃图：thread 的 checkpoint 里会留着带图轮次的
    // image_url 块，若不清洗，带图轮之后的下一个纯文本轮会 400
    // "Model do not support image input"。stripImageMiddleware 在每次模型调用前
    // 把历史消息里的 image 块替换为文字占位（checkpoint 保留原图不丢上下文）。
    const model = hasImage
      ? await loadVisionModel()
      : await loadModel(scenario ?? "default");
    // 42b (issue #42)：框架死重裁剪中间件对文本/带图两种 agent 都挂——
    // subagent(task)/todo(write_todos) 与只读场景用不到的 edit_file/write_file
    // schema 不再进模型上下文，TASK/todo 系统提示同步剥离（见该中间件注释）。
    // turnToolCacheMiddleware（#116）：同轮幂等工具缓存，两种 agent 同挂。
    const middleware = hasImage
      ? [frameworkTrimMiddleware, turnToolCacheMiddleware]
      : [
          stripImageMiddleware,
          frameworkTrimMiddleware,
          turnToolCacheMiddleware,
        ];

    // P006: checkpointer injected from M-RT (agent_runtime schema). Ensure the
    // schema exists before the graph first reads/writes checkpoint state.
    await ensureRuntimeReady();
    const checkpointer = getAgentRuntimeCheckpointer();

    // #151 S2 双轨：通道由 buildAgent 在缓存 promise 前解析并传入（同一份
    // channels 同时决定 systemPrompt 文案与 submit_xxx 工具暴露面）；
    // chat() 每轮对拍签章，flag 翻转 → resetAgentCache 重建
    // （回滚 = 切 flag，无代码回退）。
    const systemPrompt = buildSystemPrompt(scenario, cardChannels);

    // R3: the Agent-only data adapter (read user/exercise data, write sessions/
    // profile). Parameterless — userId is resolved per-request via configurable.
    const tools = buildMcpTools(cardChannels);

    // #151 S3 L1（#136 第一层）：Agent 首次组装时对拍模板 exercise_id ↔ 动作库
    // 全集，miss 显式报损不阻断组装（报损模板回退自由生成路径，L2 submit 闸门
    // 兜底——spec R6 回滚语义）；进程内只跑一次（once 工厂，flag 翻转重建不重查）。
    void ensureWeeklyPlanTemplateIdAudit();

    // R5: every skill under mas/skills/ mounted via native Skills + Filesystem.
    const skillMount = mountAllSkills();

    return createDeepAgent({
      model,
      tools,
      systemPrompt,
      // 文本轮洗历史图块（stripImageMiddleware）；两种 agent 都裁框架死重
      // （frameworkTrimMiddleware，见其注释）。
      middleware,
      // DeepSeek V4 (current default provider) rejects structured-output
      // `response_format`; the plan card is driven by the M5a skill in the
      // systemPrompt and peeled out by uiHintExtractor instead.
      responseFormat: undefined,
      checkpointer,
      name: "starfit-agent",
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
    // [治理 2026-09-18] threadId 必传（契约层已 required）。旧 fallback 到 userId
    // 会让该用户所有对话共享一个隐形大 thread（跨窗口上下文泄漏根因），彻底移除。
    // checkpoint 键加 userId 命名空间前缀：跨用户即使拿到对方 clientThreadId 也
    // 无法读写其上下文（全局用户隔离）；清理端点按同一前缀校验归属。
    const threadId = `${req.userId}:${req.threadId}`;

    // 提取照片附件（metadata.intent_context type='image'，mediaId 已上传图床）。
    // 带图 → 多模态 content 直接进视觉模型（doubao-seed-2.1-turbo），零转写无损。
    const imageAttachments = extractImageAttachments(req);

    let agent: CompiledStatefulAgent;
    try {
      // #151 S2 双轨 flag 对拍：DB/env 通道与本缓存键组装时的签章不一致
      // → 弃缓存重建（prompt 文案 + submit_xxx 工具面一起切换）。
      // 每轮 2-3 次 app_configs 点读（safeGetConfig，读失败回落 env）。
      const key = `${req.scenario ?? "default"}::${imageAttachments.length > 0 ? "img" : "txt"}`;
      const liveChannels = await resolveCardChannels();
      if (
        this.cached.has(key) &&
        this.channelSignatures.get(key) !== channelSignature(liveChannels)
      ) {
        this.cached.delete(key);
        this.channelSignatures.delete(key);
      }
      agent = await this.buildAgent(req.scenario, imageAttachments.length > 0);
    } catch (err) {
      yield toErrorEvent(err);
      return;
    }

    try {
      // Stream the full agent loop live (model→tool→…→final answer). Per-step
      // model narration (intermediate AI messages that carry tool_calls, e.g.
      // "先看看你的状态…") streams to the UI as `thinking` events — visible in
      // the collapsible thinking block WHILE the agent works — but only the
      // terminal tool-free AI message is surfaced as answer prose (`token`).
      // Checkpoint state still persists via the injected checkpointer.
      //
      // Time grounding: the model has NO clock tool and the system prompt is
      // built once (cached), so "today" is injected as a per-request context
      // prefix on the user message. Without this the agent hallucinates dates
      // (e.g. injury auto-heal set to a past date) and cannot recognize
      // "trained earlier today".
      const now = new Date();
      const timeContext =
        `[System context] Current time: ${now.toISOString()} ` +
        `(user local date: ${now.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}, ` +
        `${now.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Shanghai" })}). ` +
        'All "today / tomorrow / this week" references and any auto-heal / expiry ' +
        "dates must be computed from this timestamp.\n\n";

      const userContent = await buildUserContent(
        req,
        timeContext,
        imageAttachments,
      );

      const config = {
        configurable: {
          thread_id: threadId,
          // P006/P012: per-request userId for the MCP write tools.
          userId: req.userId,
          // #151 S2: submit_xxx 卡片工具按场景闸 Q1 质检（workout_complete
          // 才开，与 uiHintValidationLoop 同口径）。
          scenario: req.scenario,
        },
      };

      // Dual stream mode: 'updates' gives us each completed graph step's state
      // (so the final answer can be pulled from the FULL message list exactly
      // as `.invoke` did), while 'messages' gives per-token text deltas for the
      // live streaming. A step is classified as FINAL once its state contains
      // a tool-free AI message; until then every streamed text delta belongs
      // to intermediate narration and is emitted as `thinking`.
      const stream = await agent.stream(
        { messages: [{ role: "user", content: userContent }] },
        {
          ...config,
          streamMode: ["messages", "updates"] as ["messages", "updates"],
        },
      );

      // Track which AI messages are FINAL (no tool_calls). LangGraph multi-mode
      // stream yields `[mode, data]` tuples: 'messages' data = [chunk, metadata]
      // (per-token deltas), 'updates' data = { node: { messages } } (per-step
      // completed state).
      //
      // 真流式（2026-09-23 修复 tool-leak 回归）：deltas 到达时无法判定当前步
      // 是终步还是中间步——上一版让 `isAnswerStartBlock` 在 messages 流里提前
      // 翻转 answerStarted，结果工具调用轮的中间叙述（模型复述 read_file 的
      // 技能全文 / list_exercises 的动作库 JSON，CJK 主导）被误判为答案起点
      // 实时放行，泄漏 7-11k 字符进正文（回放实测回归）。
      //
      // 修复后的判定锚唯一：`updates.model_request` 快照的 tool_calls 标志
      // （实现见模块级 classifyAgentStream()，2026-09-23 抽出以便单测注入
      // 合成流）。messages 流只做缓冲，终步快照确认后才 flush+直通。
      // #151 S2：同传 threadId——submit_xxx 工具成功路径推入卡汇，
      // classifyAgentStream 在 updates 快照处排水发射 {type:"uiHint", card}。
      yield* classifyAgentStream(stream, { threadId });
    } catch (err) {
      yield toErrorEvent(err);
    }
  }

  /**
   * Drop the cached agent. Perf-only invalidator (修订①): the next `chat`
   * rebuilds a fresh single agent (AC3 / B3).
   */
  resetAgentCache(): void {
    this.cached.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a LangGraph dual-mode stream into `AgentEvent`s (2026-09-23 抽出，
 * 修复 tool-leak 回归后成为流分类唯一实现)。
 *
 * LangGraph multi-mode stream yields `[mode, data]` tuples: 'messages' data =
 * [AIMessageChunk, metadata] (per-token deltas), 'updates' data =
 * { nodeName: { messages } } (per-step completed state).
 *
 * 判定锚唯一（零提前猜测）：`updates.model_request` 快照里的 AI 消息是否带
 * tool_calls。
 *   - messages delta 只进缓冲（stepRaw），绝不在快照前翻转为 token；
 *   - 快照确认「无 tool_calls」→ 终步：批量拆分器切缓冲 [推理→thinking,
 *     答案→逐段 token]，随后该步剩余 delta 直通（answerLive=true）；
 *   - 快照确认「有 tool_calls」→ 中间步：缓冲正文转 thinking、零散文 token。
 *     唯一例外（吞卡修复，2026-09-30 refs #73）：正文里的卡片段（完整围栏
 *     且 body 解析为 uiHint 卡 / 平衡 inline 卡，且非工具返回复述）→ 以
 *     token 放行走卡片路径（uiHintExtractor → 校验回路），与终步卡片同终点；
 *   - 流在快照前结束 → 未分类缓冲按叙述转 thinking（绝不猜 token）。
 * 这封死了 2026-09-23 回归：旧版在 messages 流里用 isAnswerStartBlock 提前
 * 翻转 answerStarted，工具调用轮复述的技能全文/动作库 JSON（CJK 主导）被误判
 * 为答案起点实时放行，泄漏 7-11k 字符进正文。
 */
export async function* classifyAgentStream(
  stream: AsyncIterable<unknown>,
  options: { threadId?: string } = {},
): AsyncIterable<AgentEvent> {
  let leakedThinking = ""; // reasoning stripped from terminal messages

  // ★空终步守卫（refs #110 §5.4 / #112）：记录本轮是否放过任何答案载荷。
  // uiHint 卡只能随 token 文本下发（extractUiHintEvents 在本层下游剥卡），
  // 故「零 token」⟺「零 token 且零 uiHint」。整轮零载荷时在 done 前发
  // error 兜底事件——前端走既有 error 渲染路径，「正在解析数据…」死占位
  // 由后端保证不再出现（thinking 不算答案：纯思考轮对用户同样是空轮）。
  let sawAnswerPayload = false;

  // #151 S2 工具通道卡汇排水：submit_xxx 工具成功路径推卡进卡汇
  // （cardSubmit.ts，同 thread 同卡型 last-write-wins），本层在 updates
  // 快照处取走并以 uiHint 事件发射——工具卡与终步散文 token 同一下游
  // （extractUiHintEvents verbatim 转发 → 校验回路幂等复验 → SSE）。
  // 排水即清空：before_agent 历史重放不含新推卡（工具不重执行），
  // 排过水的卡不会二次发射（幂等）；卡也是答案载荷（见空终步守卫）。
  const threadId = options.threadId;
  const drainSinkCards = function* (): Generator<AgentEvent> {
    if (!threadId) return;
    for (const card of drainCardsFromSink(threadId)) {
      sawAnswerPayload = true;
      yield { type: "uiHint", card: card as AgentEvent["card"] };
    }
  };

  // ★吞卡修复（refs #73）：本轮（含 before_agent 重放的历史）全部工具返回的
  // 扁平文本（去空白）。卡片段若逐字出现在任一工具返回里 → 是复述不是交付
  // （典型：read_file plan-generation knowledge.md §9 的示例卡围栏被复述），
  // 不救——防止把技能文档里的示例卡当真卡送给用户。
  const toolResultFlats: string[] = [];
  const isToolResultEcho = (segment: string): boolean => {
    const flat = segment.replace(/\s+/g, "");
    if (flat.length === 0) return false;
    return toolResultFlats.some((t) => t.includes(flat));
  };

  // Per-step streaming state (reset at every `updates` classification).
  let stepRaw = ""; // this step's buffered delta text (classified at snapshot)
  let answerLive = false; // snapshot confirmed terminal → deltas stream live
  // ★直通段复述闸门（返工 v5）：answerLive 后的增量也必须过复述判定——
  // v4 剥离链只在快照时对缓冲 stepRaw 跑一次，直通段裸放行（真根因）。
  const liveGate = new LiveEchoGate();
  const resetStep = (): void => {
    stepRaw = "";
    answerLive = false;
    liveGate.reset();
  };

  // #151 S2：全程 try/finally——流异常（LLM 中断）或下游早断（SSE 掐断）时
  // 清空该线程卡汇，未发射的卡不滞留到下一轮（陈旧卡绝不跨轮泄漏）。
  // finally 只清理不 yield（消费者 break 路径安全）。
  try {
    for await (const raw of stream) {
      // Unwrap the [mode, data] tuple (defensive: also accept untagged).
      let mode: string | undefined;
      let data: unknown = raw;
      if (
        Array.isArray(raw) &&
        typeof raw[0] === "string" &&
        (raw[0] === "messages" || raw[0] === "updates")
      ) {
        mode = raw[0];
        data = raw[1];
      }

      const isMessages =
        mode === "messages" || (mode === undefined && Array.isArray(data));
      if (isMessages) {
        // [AIMessageChunk, metadata] — per-token delta of the running step.
        // 零提前判定：delta 只进缓冲，终步/中间步由 updates 快照裁决。
        // 终步确认后（answerLive）才逐 delta 直通放行为 token。
        const delta = extractText(data);
        if (delta) {
          if (answerLive) {
            // Snapshot already confirmed this step is the terminal answer —
            // stream every remaining delta live (真流式收益保留在终步). 不再
            // 回写 stepRaw：终步快照后缓冲已 flush，若继续累积，流尾
            // `if (stepRaw.trim())` 会把刚直通的答案二次转进 thinking 面板。
            //
            // ★返工 v5（2026-09-23）：v4 剥离链（stripToolEchoPrefix +
            // stripToolEchoBlocks）只在快照那一刻对缓冲 stepRaw 跑一次；这里
            // 的直通分支在 v4 里完全绕过剥离检查——DeepSeek「先出快照再补
            // 输出」时，模型在直通段复述 read_file 返回（编号行 frontmatter）
            // 全部裸奔进正文（协调者实测 5 轮 3 泄漏 / 全新用户 4 轮 3 泄漏，
            // 且泄漏从正文开头就在 = flush/直通一次性吐出）。v5 在直通分支挂
            // LiveEchoGate：delta 先入闸门缓冲，完整块/阈值到达时按
            // stripToolEchoBlocks 同款判定链判定——命中复述特征 → 转 thinking
            // （绝不 yield token）；未命中 → 放行 token。普通正文增量（非复述
            // 可疑）立即放行，流式首字收益保留；仅复述可疑形态或复述链内才
            // 缓冲等待判定（块尾部延迟 ≤ 1 个块大小，秒级流式）。
            const gated = liveGate.feed(delta);
            if (gated.echoes) {
              leakedThinking = leakedThinking
                ? `${leakedThinking}\n\n${gated.echoes}`
                : gated.echoes;
            }
            if (gated.tokens) {
              sawAnswerPayload = true;
              for (const chunk of chunkAnswerText(gated.tokens)) {
                yield { type: "token", text: chunk };
              }
            }
          } else {
            stepRaw += delta;
          }
        }
        // ★字段级思考链（2026-09-16）：thinking 开启时 DeepSeek 把推理放在
        // reasoning_content（ChatDeepSeek 透传到 additional_kwargs），协议级
        // 与正文分离——每个 delta 到达即 yield 为 thinking 事件（实时流式，
        // 前端折叠区逐字渲染）。这取代了靠文本启发式猜测的旧思路；
        // splitLeakedReasoning 退为「thinking 关闭时的兜底」。
        // （2026-09-17 修订：原实现聚合到流结束一次性 yield，思考链不流式——
        //  改为逐 delta 直通，并删除流尾的聚合下发避免重复。）
        const rc = extractReasoningContent(data);
        if (rc) {
          yield { type: "thinking", text: rc };
        }
        continue;
      }

      // updates: { nodeName: { messages: [...] } } — a graph step completed.
      // Only the `model_request` node carries the model's own output. Other
      // nodes (SkillsMiddleware.before_agent re-emits checkpoint history;
      // *Middleware.after_model carry no messages) must NOT be classified:
      // Object.values order is graph-internal, and before_agent snapshots
      // would mislabel persisted history as the final answer while trailing
      // after_model snapshots would clobber a captured finalText with
      // undefined.
      const update = data as Record<string, { messages?: unknown[] }>;
      // ★吞卡修复（refs #73）：先收集本快照（任意节点）里的工具返回文本作
      // 复述判别锚——必须在 model_request 分类前执行：卡所在步的快照只含 AI
      // 消息，工具返回在相邻的 tools 节点快照 / before_agent 历史重放里。
      collectToolResults(update, toolResultFlats);
      // #151 S2：tools 节点快照落地时（submit_xxx 已执行完毕）排水发射。
      // 放在快照分类之前：任意节点快照都可能携带新工具结果，先发卡再分类。
      yield* drainSinkCards();
      const state = update?.["model_request"];
      const msgs = state?.messages;
      if (!Array.isArray(msgs) || msgs.length === 0) continue;
      const last = msgs[msgs.length - 1] as {
        _getType?: () => string;
        role?: string;
        tool_calls?: unknown[];
        additional_kwargs?: { tool_calls?: unknown[] };
        content?: unknown;
      } | null;
      if (!last) continue;
      const isAi =
        typeof last._getType === "function"
          ? last._getType() === "ai"
          : last.role === "assistant";
      if (!isAi) continue; // tool / system step — narration stays buffered
      const hasTools =
        (Array.isArray(last.tool_calls) && last.tool_calls.length > 0) ||
        (Array.isArray(last.additional_kwargs?.tool_calls) &&
          last.additional_kwargs!.tool_calls!.length > 0);
      if (hasTools) {
        // Intermediate model step: the buffered text is narration around a tool
        // call — surface it as thinking, never as prose token.
        // 这正是 2026-09-23 泄漏回归的封堵点：上一版在快照前就靠
        // isAnswerStartBlock 放行，工具调用轮复述的技能全文/动作库 JSON
        // 直接进了正文；现在缓冲在快照前绝不出门。
        // ★吞卡修复（2026-09-30，refs #73）：唯一例外——GLM「边调工具边出卡」
        // 形态下，卡片正文就写在携带 tool_calls 的消息里，整段归 thinking 会
        // 把 12k 字符的 weekly_plan 吞进思考链、用户永远收不到（T9 验收回放二
        // 实锤：92,277 thinking 字符中 42,851 是被吞的卡）。卡片段（围栏卡 /
        // inline 卡，经工具返回复述判别豁免）以 token 放行，交给下游
        // uiHintExtractor 提取 + 校验回路——与终步卡片同一条路径；其余正文
        // （叙述 / 复述 / 非卡围栏）照旧全量转 thinking，零散文 token。
        if (stepRaw.trim()) {
          const { cards, rest } = splitCardSegments(stepRaw, isToolResultEcho);
          if (rest.trim()) {
            yield { type: "thinking", text: rest.trim() };
          }
          for (const card of cards) {
            sawAnswerPayload = true;
            yield { type: "token", text: card };
          }
        }
        resetStep();
      } else {
        // Terminal answer step (first snapshot of the turn with a tool-free
        // AI message). Flush the buffered step text through the batch
        // splitter — deliberation → leakedThinking, answer → chunked token
        // events (exact parity with the pre-streaming `.invoke` path) —
        // then flip `answerLive` so subsequent deltas of THIS step stream
        // live as tokens (首字延迟 = 该步 prefill + 生成中已缓冲的首段，
        // 秒级而非整轮)。
        //
        // ★终步工具复述剥离（2026-09-23 返工 v3 + v4）：v2 在 flush 前对「整个
        // stepRaw」跑 looksLikeToolReturnEcho，命中就把复述+正常回答+围栏卡片
        // 整体吞进 thinking（回放 3 轮正文 0 字符 + 卡片 0 张）。v3 只精确剥
        // 离「开头的裸工具返回复述段」（stripToolEchoPrefix：动作库/历史 JSON
        // 粘接串、read_file 编号行、技能文件头签名块）进 thinking，其余
        // （正常回答 + 围栏卡片）继续走 splitLeakedReasoning：answer 进 token、
        // 围栏卡片经 uiHint 提取正常落地。拦截只能摘「裸复述」，不能误伤以
        // ``` 开头的围栏卡片。
        // ★v4（返工）：v3 只覆盖「前缀」复述，真实模型会在任意位置复述工具
        // 返回——先写引导语（如"好的我来看看计划生成指南"）再整段 echo
        // read_file 返回（编号行 frontmatter），复述落在中间/后置时 v3 的
        // 前导判定全部失效，整段被 splitLeakedReasoning 误判成 answer 放行成
        // token（协调者实测 6115 / 2480 字符泄漏）。v4 在 splitLeakedReasoning
        // 之后对 answer 部分再做「全段扫描剥离」（stripToolEchoBlocks）：逐块
        // 命中复述特征 → 摘进 thinking；未命中 → 保留为 token。双保险：前缀
        // 剥离（pass 1）+ 任意位置剥离（pass 2）。
        const { echo, rest } = stripToolEchoPrefix(stepRaw);
        if (echo) {
          leakedThinking = leakedThinking
            ? `${leakedThinking}\n\n${echo}`
            : echo;
        }
        const split = splitLeakedReasoning(rest);
        if (split.reasoning) {
          leakedThinking = leakedThinking
            ? `${leakedThinking}\n\n${split.reasoning}`
            : split.reasoning;
        }
        if (split.answer) {
          // pass 2（v4）：对 answer 部分逐块扫描，摘任意位置的工具复述块。
          const mid = stripToolEchoBlocks(split.answer);
          if (mid.echo) {
            leakedThinking = leakedThinking
              ? `${leakedThinking}\n\n${mid.echo}`
              : mid.echo;
          }
          if (mid.rest) {
            sawAnswerPayload = true;
            for (const chunk of chunkAnswerText(mid.rest)) {
              yield { type: "token", text: chunk };
            }
          }
        }
        // 终步 flush 后清空缓冲：已 flush 的 stepRaw 不得在流尾被二次转
        // thinking（v1 遗漏——流尾 `if (stepRaw.trim())` 会把刚放行的整段答案
        // 重复进 thinking 面板）。
        stepRaw = "";
        // 复述段剥离后不翻 answerLive 的旧保守行为会再次吞掉「快照之后到达」
        // 的正常回答 delta——v3 目标是保留正常回答：剥离完复述，剩余/后续 delta
        // 一律按 token 直通。
        answerLive = true;
      }
    }

    // Stream ended mid-step (no closing updates): the undecided buffered
    // tail is narration by definition — the final answer path always
    // arrives via an `updates` snapshot, and once it does `answerLive`
    // streams deltas directly (nothing buffered left). Surface the
    // residual as thinking so nothing is silently lost — NEVER as token:
    // an un-snapshotted step has no proof it isn't tool-call narration
    // (the exact regression this anchor fixes).
    // ★返工 v5：直通段闸门残余 flush——answerLive 后未完成块的最终判定
    // （复述 → thinking，正常 → token），避免流尾把待判定内容吞掉。
    const gateTail = liveGate.flush();
    if (gateTail.echoes) {
      leakedThinking = leakedThinking
        ? `${leakedThinking}\n\n${gateTail.echoes}`
        : gateTail.echoes;
    }
    if (gateTail.tokens) {
      sawAnswerPayload = true;
      for (const chunk of chunkAnswerText(gateTail.tokens)) {
        yield { type: "token", text: chunk };
      }
    }
    if (stepRaw.trim()) {
      yield { type: "thinking", text: stepRaw.trim() };
    }

    // Reasoning that leaked into terminal messages goes to the collapsible
    // thinking panel, never the answer prose.
    if (leakedThinking) {
      yield { type: "thinking", text: leakedThinking };
    }

    // （字段级思考链已在循环内逐 delta 实时 yield，此处不再聚合下发。
    //   最终答案同样已在循环内逐段/逐 token 实时转发，流尾不再补发。）

    // #151 S2 流尾兜底排水：最后一个 updates 快照之后执行的 submit（理论
    // 上不存在——终步 model 快照后不再跑工具）也不丢卡。
    yield* drainSinkCards();

    // ★空终步守卫（refs #110 §5.4 / #112）：整轮零 token 零 uiHint 零 error
    // 而流正常收尾 → 发兜底 error 事件（消息内嵌 EMPTY_ANSWER 标识，code 用
    // 契约既有 MODEL_ERROR——AgentErrorCode 为封闭枚举且本任务冻结
    // shared/contracts，见 PR 说明），随后 done 照常收流。中间件重滚（见
    // frameworkTrimMiddleware）已挡住 #110 的主签名，这里是同链路纵深：任何
    // 残余形态的空轮（真空回、纯思考轮等）都不再以「正在解析数据…」死占位
    // 呈现给用户。
    if (!sawAnswerPayload) {
      yield {
        type: "error",
        error: {
          code: "MODEL_ERROR",
          message: "本轮回复为空（EMPTY_ANSWER）——模型未产生任何内容，请重试。",
        },
      };
    }
    yield { type: "done" };
  } finally {
    if (threadId) clearThreadCards(threadId);
  }
}

/**
 * Collect tool-result texts from an `updates` snapshot (any node) into `sink`
 * (whitespace-flattened) — the echo anchor for the card-segment rescue
 * (吞卡修复, refs #73): a "card" whose text appears verbatim (modulo
 * whitespace) inside a tool result is an echo — e.g. the example card fence
 * inside a read_file return of plan-generation/knowledge.md — not a delivery,
 * and must not be rescued to the token stream.
 */
function collectToolResults(
  update: Record<string, { messages?: unknown[] }> | undefined,
  sink: string[],
): void {
  for (const nodeState of Object.values(update ?? {})) {
    const ms = nodeState?.messages;
    if (!Array.isArray(ms)) continue;
    for (const m of ms) {
      const msg = m as {
        _getType?: () => string;
        role?: string;
        content?: unknown;
      } | null;
      if (!msg) continue;
      const kind =
        typeof msg._getType === "function" ? msg._getType() : msg.role;
      if (kind !== "tool") continue;
      const flat = flattenMessageText(msg.content);
      if (flat) sink.push(flat);
    }
  }
}

/** Message content (string or text blocks) flattened to a whitespace-free string. */
function flattenMessageText(content: unknown): string | undefined {
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        text += (block as { text: string }).text;
      }
    }
  }
  const flat = text.replace(/\s+/g, "");
  return flat.length > 0 ? flat : undefined;
}

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
  if (typeof content === "string") {
    return content.length > 0 ? content : undefined;
  }
  // Multimodal content blocks: concatenate any text blocks.
  if (Array.isArray(content)) {
    let text = "";
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        text += block.text;
      }
    }
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

/**
 * Pull reasoning out of a `streamMode: 'messages'` chunk.
 *
 * 两种协议形态（B4，issue #35）：
 * 1. reasoning_content：DeepSeek / GLM coding 端点把推理放在响应的
 *    reasoning_content 字段（协议级与 content 分离），langchain 封装透传到
 *    AIMessageChunk 的 additional_kwargs.reasoning_content；
 * 2. thinking 块：Anthropic Messages 协议（glm-anthropic 备选路径）把推理
 *    放在 content 块数组里的 {type:'thinking', thinking:'…'}，ChatAnthropic
 *    按 delta 下发同构块。
 * Chunk 形态是 [chunk, metadata] 元组，与 extractText 同构。两者都归并成
 * reasoning 增量（前端折叠思考区）；无推理内容返回 undefined。
 */
function extractReasoningContent(chunk: unknown): string | undefined {
  if (!Array.isArray(chunk)) {
    return undefined;
  }
  const message = chunk[0] as
    | {
        additional_kwargs?: { reasoning_content?: unknown };
        content?: unknown;
      }
    | undefined;
  let reasoning = "";
  const rc = message?.additional_kwargs?.reasoning_content;
  if (typeof rc === "string") reasoning += rc;
  const content = message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "thinking" &&
        typeof (block as { thinking?: unknown }).thinking === "string"
      ) {
        reasoning += (block as { thinking: string }).thinking;
      }
    }
  }
  return reasoning.length > 0 ? reasoning : undefined;
}

/**
 * Split a terminal (tool-free) AI message into [reasoning, answer].
 *
 * deepseek-v4-flash with thinking disabled sometimes writes multi-paragraph
 * English deliberation into the final message body before the user-facing
 * Chinese answer (it has no separate reasoning_content field to hold it).
 * Heuristic: the deliberation is English-dominant, the answer is
 * Chinese-dominant. Walk paragraph blocks; once the running text turns
 * majority-CJK, everything from that block on is answer. Blocks before that
 * point (and any majority-Latin block at the very start) are reasoning.
 * A message that is already majority-CJK (or majority-Latin throughout, e.g.
 * an English-language app test) is returned untouched.
 */
/**
 * 从请求 metadata.intent_context 提取照片附件（type='image' 且有 mediaId）。
 * 兼容单对象与数组两种形态。
 */
function extractImageAttachments(
  req: ChatRequest,
): Array<{ mediaId: string; mime?: string }> {
  const ic = (req.metadata ?? {})["intent_context"] as unknown;
  const items = Array.isArray(ic) ? ic : ic ? [ic] : [];
  return items.filter(
    (x: any) => x && typeof x === "object" && x.type === "image" && x.mediaId,
  ) as Array<{ mediaId: string; mime?: string }>;
}

/**
 * 从请求 metadata.intent_context 提取文件附件（type='file' 且带 textContent 文本）。
 * 兼容单对象与数组两种形态。
 */
function extractFileAttachments(
  req: ChatRequest,
): Array<{ title: string; mime?: string; textContent: string }> {
  const ic = (req.metadata ?? {})["intent_context"] as unknown;
  const items = Array.isArray(ic) ? ic : ic ? [ic] : [];
  return items
    .filter(
      (x: any) =>
        x &&
        typeof x === "object" &&
        x.type === "file" &&
        typeof x.textContent === "string",
    )
    .map((x: any) => ({
      title: String(x.title || "附件文件"),
      mime: typeof x.mime === "string" ? x.mime : undefined,
      textContent: x.textContent,
    }));
}

/**
 * 从请求 metadata.intent_context 提取上下文附件（type='interaction_context'，
 * 由动作教学 sheet「咨询教练」等入口产生，携带动作 ID/名称等结构化上下文）。
 * 兼容单对象与数组两种形态。
 */
/** 导出仅供验证脚本使用；运行时仅模块内部调用 */
export function extractInteractionContexts(
  req: ChatRequest,
): Array<Record<string, any>> {
  const ic = (req.metadata ?? {})["intent_context"] as unknown;
  const items = Array.isArray(ic) ? ic : ic ? [ic] : [];
  return items.filter(
    (x: any) => x && typeof x === "object" && x.type === "interaction_context",
  ) as Array<Record<string, any>>;
}

/**
 * 组装 user content：无图 → 纯文本；带图 → 多模态 content 数组
 * [{type:'text'}, {type:'image_url', image_url:{url:dataUrl}}...] 直接进视觉模型。
 * 图片下载失败 → 降级为纯文本 + 提示，不阻塞主链路。
 */
/** 导出仅供验证脚本使用；运行时仅模块内部调用 */
export async function buildUserContent(
  req: ChatRequest,
  timeContext: string,
  images: Array<{ mediaId: string; mime?: string }>,
): Promise<string | Array<Record<string, unknown>>> {
  // 上下文附件（咨询教练等）：结构化字段注入为文本前缀，Agent 可感知动作 ID/名称
  const interactions = extractInteractionContexts(req);
  const interactionContext = interactions
    .map((ctx) => {
      const parts: string[] = [];
      if (ctx.exerciseName) parts.push(`动作名称: ${ctx.exerciseName}`);
      if (ctx.exerciseId) parts.push(`动作ID: ${ctx.exerciseId}`);
      if (ctx.exerciseType) parts.push(`动作类型: ${ctx.exerciseType}`);
      if (typeof ctx.content === "string" && ctx.content) {
        parts.push(`说明: ${ctx.content}`);
      }
      return parts.length > 0 ? parts.join("；") : null;
    })
    .filter((s): s is string => s !== null)
    .map((s) => `\n\n[用户上下文附件] ${s}`)
    .join("");
  // 文件附件：文本全文注入 user 消息（带文件名），模型可直接读取。
  const files = extractFileAttachments(req);
  const fileContext = files
    .map(
      (f) =>
        `\n\n[用户附件文件：${f.title}${f.mime ? ` (${f.mime})` : ""}]\n` +
        "--- 文件内容开始 ---\n" +
        f.textContent +
        "\n--- 文件内容结束 ---\n",
    )
    .join("");
  if (images.length === 0) {
    return `${timeContext}${req.message}${interactionContext}${fileContext}`;
  }
  const { getObject } = await import("../mediaStorage.js");
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `${timeContext}${req.message}${interactionContext}${fileContext}`,
    },
  ];
  let failed = 0;
  for (const img of images) {
    try {
      const found = await getObject(img.mediaId);
      if (!found?.content) {
        failed++;
        continue;
      }
      const b64 = Buffer.from(found.content).toString("base64");
      const mime = img.mime || found.mime || "image/jpeg";
      blocks.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${b64}` },
      });
    } catch {
      failed++;
    }
  }
  if (failed > 0) {
    blocks.push({
      type: "text",
      text: `（注意：有 ${failed} 张图片读取失败，无法展示，请如实告知用户。）`,
    });
  }
  return blocks;
}

/**
 * Normalise a thrown value into an `AgentEvent` error element.
 *
 * ★#112：EmptyAgentTurnError（空终步重滚穷尽，见 emptyTurnRetry.ts）映射
 * 分支拆到 emptyTurnToErrorEvent（jest 可直接断言）；其余错误照旧 INTERNAL。
 * 导出仅供测试断言映射；运行时仅模块内部调用。
 */
export function toErrorEvent(err: unknown): AgentEvent {
  const emptyTurn = emptyTurnToErrorEvent(err);
  if (emptyTurn !== null) {
    return emptyTurn;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "DeepAgentService chat failed";
  return {
    type: "error",
    error: { code: "INTERNAL", message },
  };
}

/**
 * 文本模型的"洗图"中间件：deepagents 每次（每步）模型调用前触发 wrapModelCall，
 * 把消息序列里的多模态 image 块替换为纯文本占位。只影响喂给模型的输入；
 * LangGraph checkpointer 持久化的仍是原始消息（带图轮的视觉上下文不丢）。
 * 背景：DeepSeek 文本模型收到历史里的 image_url 块会 400
 * "Model do not support image input"（带图轮用视觉模型、后续文本轮回文本模型的
 * 混合 thread 场景）。
 */
const stripImageMiddleware = createMiddleware({
  name: "stripImageForTextModel",
  wrapModelCall: async (request, handler) => {
    const { messages } = request;
    let touched = false;
    const cleaned = messages.map((msg) => {
      const content = (msg as { content?: unknown }).content;
      if (!Array.isArray(content)) return msg;
      const hasImage = content.some(
        (part) => (part as { type?: string })?.type === "image_url",
      );
      if (!hasImage) return msg;
      touched = true;
      const textParts = content
        .filter((part) => (part as { type?: string })?.type === "text")
        .map((part) => (part as { text?: string }).text ?? "");
      return new HumanMessage({
        content:
          textParts.join("\n") +
          "\n（此前的图片附件内容已在当时由视觉模型读取并分析，图片本身不再附带。）",
        additional_kwargs: (
          msg as { additional_kwargs?: Record<string, unknown> }
        ).additional_kwargs,
      });
    });
    return touched
      ? handler({ ...request, messages: cleaned })
      : handler(request);
  },
});

// ---------------------------------------------------------------------------
// 框架死重裁剪（42b，issue #42）
// ---------------------------------------------------------------------------

// 空终步检测 + 模型重滚（refs #110 #111，#112）随框架裁剪中间件一起拆到
// emptyTurnRetry.ts（2026-10-03）：DeepAgentService 顶层 import 链含
// skillLoader 的 import.meta，jest CJS 加载不了整条链；拆出后核心语义
// （三条件谓词 / 重滚一次 / abort 守卫 / EmptyAgentTurnError）可在
// `npm run test:unit`（tests/unit/services/agent/emptyTurnRetry.test.ts）
// 里直接测试（与 splitLeakedReasoning 的拆分同款先例）。
// 重导出保持既有消费方（scripts/system-area-probe.mjs、测试）的导入面不变。
export {
  frameworkTrimMiddleware,
  EmptyAgentTurnError,
} from "./emptyTurnRetry.js";
import {
  EmptyAgentTurnError,
  emptyTurnToErrorEvent,
  frameworkTrimMiddleware,
} from "./emptyTurnRetry.js";

// ---------------------------------------------------------------------------
// Default export: a shared singleton instance (consumers inject this as needed).
// ---------------------------------------------------------------------------

export const deepAgentService: AgentService = new DeepAgentService();
