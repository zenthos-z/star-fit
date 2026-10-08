/**
 * cardSubmit (#151 S2) — submit_card 工具通道内核：卡片经结构化工具提交，
 * JSON 中间件做程序化验证。
 *
 * 架构（owner 拍板 2026-10-08 / issue #151 S1 spec §4.2）：
 *   - 每卡型一个薄工具（submit_survey / submit_weekly_plan / submit_plan_card），
 *     parameters = 该卡型的 JSON Schema（由 zod 真源经 z.toJSONSchema 派生，
 *     无新增依赖；派生后剥 additionalProperties/$schema 做「宽松绑定」——
 *     真校验永远走下方 zod 回路，未知键 strip 语义与围栏管道一致）；
 *   - func 三层闸门（顺序对齐 uiHintValidationLoop 的校验回路，语义时点不变）：
 *       1. validateUiHint（zod 真源 + HC-4 黑名单）→ SCHEMA 结构化错误；
 *       2. 动作库存在性（carriesExerciseIds 卡型对拍 exercises 表全集，
 *          #136 伪造 id 在提案层拦截）→ UNKNOWN_EXERCISE_ID + ids + hint；
 *       3. surveyConvergence（#114 B5c 题库收敛）+ workoutQualityGate（Q1
 *          workout_complete 场景数据一致性）→ 结构化错误；
 *   - 全过 → 卡推入 cardSink（同 thread 同卡型 last-write-wins 幂等——GLM
 *     单轮可自重复调用同一工具，S1 实测实锤），由 DeepAgentService
 *     classifyAgentStream 在 updates 快照处排水发射为 {type:"uiHint", card}；
 *   - 失败返回结构化错误 JSON 字符串 → Agent 下一轮工具调用原生二级弹跳
 *     （增量修正，不再整流重跑）。
 *
 * 双轨（迁移期）：卡型级 feature flag `card_channel: "tool" | "fence"`，
 * app_configs DB（card_channel_<type> 键）> env（CARD_CHANNEL_<TYPE>）>
 * 默认（survey_card/weekly_plan=tool 试点，plan_card 及其余卡型=fence）。
 * 围栏管道（extractUiHintEvents + chatWithValidationLoop）冻结不动，继续
 * 服务未迁移卡型（S4 批次统一退役）。
 *
 * 数据契约红线：本模块不改 shared/contracts（zod 真源不动——JSON Schema 是
 * 派生物，仅作传输层描述给模型，运行期校验永远走 zod）。
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { getConfig } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { z } from "zod";
// 卡数据 zod 真源（UIHintSchema 判别联合成员的 data 面）+ survey 题库。
import {
  PlanCardDataSchema,
  PROFILE_INTAKE_QUESTIONS,
  SurveyQuestionSchema,
  WeeklyPlanCardDataSchema,
} from "./schemas/uiHintSchemas.js";
import { validateUiHint, type StructuredError } from "./uiHintValidator.js";
import { canonicalizeSurveyCard } from "./surveyConvergence.js";
import {
  cardToCheckableText,
  checkWorkoutCardQuality,
  extractSessionFacts,
  type WorkoutSessionFacts,
} from "./workoutQualityGate.js";
// Q1 质检的最新 session 真值（与 uiHintValidationLoop 同源：SessionRepo）。
import { SessionRepo } from "../sessionRepo.js";
import { safeGetConfig } from "../modelConfigService.js";

// ---------------------------------------------------------------------------
// 通道开关（卡型级 feature flag：DB > env > 默认）
// ---------------------------------------------------------------------------

/** 卡片交付通道：tool = submit_xxx 工具；fence = 正文围栏（现状管道）。 */
export type CardChannel = "tool" | "fence";

/** 卡型 → 通道 的解析结果（只覆盖可迁移卡型）。 */
export type CardChannels = Record<string, CardChannel>;

/** 本批构建了薄工具的卡型（其余卡型 S2 不迁移，恒走围栏）。 */
export const SUBMITTABLE_CARD_TYPES = [
  "survey_card",
  "weekly_plan",
  "plan_card",
] as const;

export type SubmittableCardType = (typeof SUBMITTABLE_CARD_TYPES)[number];

/**
 * 工具名（spec §4.2 指定，非 `submit_${cardType}` 机械拼接——survey_card 的
 * 工具名是 submit_survey；uiHintFormat 双轨文案与此处必须同名）。
 */
export const CARD_TOOL_NAMES: Record<SubmittableCardType, string> = {
  survey_card: "submit_survey",
  weekly_plan: "submit_weekly_plan",
  plan_card: "submit_plan_card",
};

/**
 * 默认通道（spec §6 S2 批：survey_card 试点 + weekly_plan 迁移优先级 1；
 * plan_card 建内核但保持 fence——「其余卡型不动」）。
 */
export const DEFAULT_CARD_CHANNELS: Readonly<CardChannels> = {
  survey_card: "tool",
  weekly_plan: "tool",
  plan_card: "fence",
};

/** flag 值合法性（DB/env 里写了别的值 → 回落默认，不炸 Agent 组装）。 */
function normalizeChannel(
  value: string | null | undefined,
): CardChannel | null {
  if (value === "tool" || value === "fence") return value;
  return null;
}

/** env 键名：survey_card → CARD_CHANNEL_SURVEY_CARD。 */
function channelEnvKey(cardType: string): string {
  return `CARD_CHANNEL_${cardType.toUpperCase()}`;
}

/**
 * 解析全部可迁移卡型的通道（DB > env > 默认）。
 *
 * DB 读走 safeGetConfig（ConfigRepo "system" 命名空间，读失败回落 env——
 * 单测/库不可用不阻断组装）。`readConfig` 依赖注入仅供测试替身。
 */
export async function resolveCardChannels(
  deps: { readConfig?: (key: string) => Promise<string | null> } = {},
): Promise<CardChannels> {
  const read = deps.readConfig ?? safeGetConfig;
  const resolved: CardChannels = {};
  for (const cardType of SUBMITTABLE_CARD_TYPES) {
    const fromDb = normalizeChannel(await read(`card_channel_${cardType}`));
    if (fromDb) {
      resolved[cardType] = fromDb;
      continue;
    }
    const fromEnv = normalizeChannel(process.env[channelEnvKey(cardType)]);
    if (fromEnv) {
      resolved[cardType] = fromEnv;
      continue;
    }
    resolved[cardType] = DEFAULT_CARD_CHANNELS[cardType];
  }
  return resolved;
}

/** 通道签章（agent 缓存失效判定用：DB flag 翻转 → 重建 agent）。 */
export function channelSignature(channels: CardChannels): string {
  return SUBMITTABLE_CARD_TYPES.map(
    (t) => `${t}=${channels[t] ?? "fence"}`,
  ).join("|");
}

// ---------------------------------------------------------------------------
// JSON Schema 派生（zod 真源 → 传输层描述）
// ---------------------------------------------------------------------------

/**
 * 宽松化：深拷贝并剥 `$schema` 与 `additionalProperties`。
 *
 * z.toJSONSchema 默认输出 draft 2020-12 + additionalProperties:false；后者会
 * 让 @langchain/core 的入参前置校验（@cfworker/json-schema）对多余键硬失败，
 * 而围栏管道的 zod 校验对未知键是 strip——剥掉后两侧语义一致（宽松绑定，
 * 深校验在 func 内的 zod 回路）。$schema 声明头对 provider 无信息量，同剥。
 */
function loosenJsonSchemaForBinding(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(loosenJsonSchemaForBinding);
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (key === "$schema" || key === "additionalProperties") continue;
      out[key] = loosenJsonSchemaForBinding(value);
    }
    return out;
  }
  return node;
}

/**
 * submit_survey 的意图契约（spec §0.7「只收 intent」）：
 * Agent 只给 purpose + 题库 id 子集 + 话术；workout_feedback（练后反馈，
 * #114 本期不动的自由出题）用 questions 全量字段。题目内容一律由后端
 * 题库替换（canonicalizeSurveyCard），载荷小、失败半径小。
 */
const SurveySubmitIntentSchema = z.object({
  purpose: z.enum(["profile_intake", "plan_gap", "workout_feedback"]),
  /** profile_intake 可省略（后端收敛为题库全量）；plan_gap = 缺口 id 子集。 */
  question_ids: z.array(z.string().min(1)).default([]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  message: z.string().optional(),
  sessionId: z.string().optional(),
  /** workout_feedback 专用：自由出题（≤3 题，围栏时代同一约束）。 */
  questions: z.array(SurveyQuestionSchema).optional(),
});

/**
 * 派生各卡型 submit 工具的 parameters JSON Schema（io:"input"——.default()
 * 字段变可选；构建期一次派生，运行期只作传输描述不作校验）。
 *
 * plan_card 的 data 面是数组，而 tool parameters 必须是 object schema
 * （OpenAI 协议约定），故包一层 { data: [...] }；survey/weekly 的 data 面
 * 本身是 object，平铺直传（bench A1 5/5 即此形态，schema 可见性 = 首过质量）。
 */
export function deriveCardSubmitJsonSchemas(): Record<
  SubmittableCardType,
  Record<string, unknown>
> {
  return {
    survey_card: loosenJsonSchemaForBinding(
      z.toJSONSchema(SurveySubmitIntentSchema, { io: "input" }),
    ) as Record<string, unknown>,
    weekly_plan: loosenJsonSchemaForBinding(
      z.toJSONSchema(WeeklyPlanCardDataSchema, { io: "input" }),
    ) as Record<string, unknown>,
    plan_card: loosenJsonSchemaForBinding(
      z.toJSONSchema(z.object({ data: PlanCardDataSchema }), { io: "input" }),
    ) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// 动作库存在性（#136 伪造 id 提案层拦截）
// ---------------------------------------------------------------------------

/** 携带 exercise_id 的卡型（对拍 exercises 表全集，miss 即打回）。 */
export function carriesExerciseIds(cardType: string): boolean {
  return cardType === "weekly_plan" || cardType === "plan_card";
}

/**
 * 收集卡数据里的全部动作 id：
 *  - weekly_plan：days[].exercises[].exercise_id（展示面）+
 *    apply.entries[].exercise_id（落库面，两处都引用 exercises 表）；
 *  - plan_card：data[].exerciseId（camelCase，ExercisePlanSchema 契约）。
 */
export function collectExerciseIds(cardType: string, data: unknown): string[] {
  const ids: string[] = [];
  const pushIfString = (v: unknown): void => {
    if (typeof v === "string" && v.length > 0) ids.push(v);
  };
  if (cardType === "weekly_plan" && isPlainObject(data)) {
    const days = data.days;
    if (Array.isArray(days)) {
      for (const day of days) {
        if (!isPlainObject(day) || !Array.isArray(day.exercises)) continue;
        for (const ex of day.exercises) {
          if (isPlainObject(ex)) pushIfString(ex.exercise_id);
        }
      }
    }
    const entries = isPlainObject(data.apply)
      ? (data.apply as { entries?: unknown }).entries
      : undefined;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (isPlainObject(entry)) pushIfString(entry.exercise_id);
      }
    }
  } else if (cardType === "plan_card" && Array.isArray(data)) {
    for (const ex of data) {
      if (isPlainObject(ex)) pushIfString(ex.exerciseId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 卡汇（cardSink）：同 thread 同卡型 last-write-wins 幂等
// ---------------------------------------------------------------------------

/**
 * 线程级卡汇：threadId → cardType → 已过闸门的卡。
 *
 * 工具执行时推入（push），DeepAgentService.classifyAgentStream 在 updates
 * 快照处排水（drain）发射。幂等语义（spec §4.2 实测发现）：GLM 可单轮自
 * 重复调用同一 submit 工具（bench A1 预跑 r2 实锤同轮两份参数）——同 thread
 * 同卡型后到覆盖先到，前端事件只发一张卡；不假设「一轮一卡」。
 *
 * 只收「本轮存活工具执行」的推送：checkpoint 重放（before_agent 历史回滚）
 * 不再执行工具函数，故重放轮不会重复推卡（回放零重复的结构性保证）。
 */
const cardSink = new Map<string, Map<string, unknown>>();

/** 工具成功路径推卡（覆盖同卡型旧卡）。 */
export function pushCardToSink(threadId: string, card: unknown): void {
  let byType = cardSink.get(threadId);
  if (!byType) {
    byType = new Map();
    cardSink.set(threadId, byType);
  }
  byType.set(String((card as { type?: unknown })?.type ?? "unknown"), card);
}

/**
 * 排水：取走并清空该线程全部待发卡（按推入顺序）。
 * classifyAgentStream 每个 updates 快照调用 + 流尾兜底一次。
 */
export function drainCardsFromSink(threadId: string): unknown[] {
  const byType = cardSink.get(threadId);
  if (!byType) return [];
  cardSink.delete(threadId);
  return [...byType.values()];
}

/** 清空线程卡汇（异常终态防陈旧卡泄漏进下一轮；不发射）。 */
export function clearThreadCards(threadId: string): void {
  cardSink.delete(threadId);
}

/** 仅供测试隔离使用。 */
export function __resetCardSinkForTests(): void {
  cardSink.clear();
}

// ---------------------------------------------------------------------------
// 运行时上下文（userId / threadId / scenario，ALS 同源）
// ---------------------------------------------------------------------------

interface ToolContextOpts {
  explicitConfig?: unknown;
  injectedUserId?: string;
  injectedThreadId?: string;
  injectedScenario?: string;
}

/** 从 LangGraph ALS / 显式 config / 测试注入解析 configurable 字段。 */
function readConfigurable(
  opts: ToolContextOpts,
): Record<string, unknown> | undefined {
  // 1. LangGraph ALS（生产主路径——chat() 设置 configurable；无运行上下文
  // 时 getConfig 抛错，catch 后走显式回退，与 mcpTools 同款模式）。
  try {
    const cfg = getConfig() as
      { configurable?: Record<string, unknown> } | undefined;
    if (cfg?.configurable) return cfg.configurable;
  } catch {
    // ALS 外调用（测试直调 func）：正常回退。
  }
  // 2/3. DynamicStructuredTool 第三参 RunnableConfig / 测试注入。
  const cfg = opts.explicitConfig as
    | { configurable?: Record<string, unknown> }
    | { config?: { configurable?: Record<string, unknown> } }
    | undefined;
  return (
    (cfg as { configurable?: Record<string, unknown> } | undefined)
      ?.configurable ??
    (cfg as { config?: { configurable?: Record<string, unknown> } } | undefined)
      ?.config?.configurable
  );
}

/** 解析调用线程 id（chat() 的 `${userId}:${clientThreadId}` 复合键）。 */
function resolveThreadId(opts: ToolContextOpts): string | null {
  const tid = readConfigurable(opts)?.thread_id;
  if (typeof tid === "string" && tid.length > 0) return tid;
  if (opts.injectedThreadId) return opts.injectedThreadId;
  return null;
}

/** 解析调用用户（UUID 断言与 mcpTools.assertValidUserId 同规则）。 */
const MCP_USER_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/i;

function resolveUserId(opts: ToolContextOpts): string | null {
  const uid = readConfigurable(opts)?.userId;
  if (typeof uid === "string" && MCP_USER_ID_UUID_RE.test(uid)) return uid;
  if (opts.injectedUserId && MCP_USER_ID_UUID_RE.test(opts.injectedUserId)) {
    return opts.injectedUserId;
  }
  return null;
}

/** 解析场景（Q1 质检只在 workout_complete 开启，与校验回路同口径）。 */
function resolveScenario(opts: ToolContextOpts): string | undefined {
  const sc = readConfigurable(opts)?.scenario;
  if (typeof sc === "string" && sc.length > 0) return sc;
  return opts.injectedScenario;
}

// ---------------------------------------------------------------------------
// 工具内核
// ---------------------------------------------------------------------------

/** makeCardSubmitTool 依赖（client 由 mcpTools 传入；注入项仅供测试）。 */
export interface CardSubmitToolDeps {
  /** 动作库全集读取（mcpTools 注入 ExerciseQuery 实现，防循环依赖）。 */
  listExerciseIds: () => Promise<Set<string>>;
  injectedUserId?: string;
  injectedThreadId?: string;
  injectedScenario?: string;
  /** Q1 质检 facts 加载器（默认 SessionRepo；测试替身可注入）。 */
  loadSessionFacts?: (userId: string) => Promise<WorkoutSessionFacts | null>;
}

/** 工具返回的结构化错误（Agent 读 JSON 修正参数后重交 = 二级弹跳）。 */
interface SubmitError {
  ok: false;
  code: string;
  errors?: StructuredError[];
  ids?: string[];
  hint?: string;
}

function structuredErrorPayload(err: SubmitError): string {
  return JSON.stringify(err);
}

/**
 * 构建单卡型 submit 薄工具（spec §4.2 伪码的落地；内核同一套，卡型只差
 * parameters schema 与 intent→card 装配）。schema 层深校验在 func 内做——
 * parameters JSON Schema 仅宽松绑定 + 模型可见性引导。
 */
export function makeCardSubmitTool(
  cardType: SubmittableCardType,
  deps: CardSubmitToolDeps,
): DynamicStructuredTool {
  const paramsSchema = deriveCardSubmitJsonSchemas()[cardType];
  const description = buildToolDescription(cardType);

  return new DynamicStructuredTool({
    name: CARD_TOOL_NAMES[cardType],
    description,
    // 宽松绑定：raw JSON Schema（@langchain/core 1.x 原生支持，直通 provider
    // 作 tool parameters；入参前置校验为宽松版——深校验在 func 内 zod 回路）。
    // 经 z.toJSONSchema 派生的 schema 对象满足 ToolInputSchemaBase 的
    // JsonSchema7Type 分支（结构子集），ts 层直收。
    schema: paramsSchema,
    func: async (input: unknown, _runManager, config) => {
      const opts: ToolContextOpts = {
        explicitConfig: config,
        injectedUserId: deps.injectedUserId,
        injectedThreadId: deps.injectedThreadId,
        injectedScenario: deps.injectedScenario,
      };
      try {
        return await runSubmitGateChain(cardType, input, deps, opts);
      } catch (err) {
        // 闸门链只抛结构化错误（parse 断言类）；意外异常也走结构化回注，
        // 不让 ToolNode 把原始堆栈直接灌给模型。
        console.error(`[submit_${cardType}] unexpected error:`, err);
        return structuredErrorPayload({
          ok: false,
          code: "INTERNAL",
          hint: "提交通道内部错误，请稍后重试同一调用。",
        });
      }
    },
  });
}

/** 三层闸门 + 卡汇推入。返回给模型的 JSON 字符串。 */
async function runSubmitGateChain(
  cardType: SubmittableCardType,
  input: unknown,
  deps: CardSubmitToolDeps,
  opts: ToolContextOpts,
): Promise<string> {
  // ── 装配：卡型各自的 intent → {type, data} 卡形态 ──
  let card: unknown;
  if (cardType === "survey_card") {
    const assembled = assembleSurveyCard(input);
    if (!assembled.ok) return structuredErrorPayload(assembled.error);
    card = assembled.card;
  } else if (cardType === "plan_card") {
    card = { type: "plan_card", data: (input as { data?: unknown })?.data };
  } else {
    card = { type: cardType, data: input };
  }

  // ── 闸门 1：zod 真源校验（UIHintSchema + HC-4 黑名单，回路复用）──
  const validated = validateUiHint(card);
  if (!validated.ok) {
    return structuredErrorPayload({
      ok: false,
      code: "SCHEMA",
      errors: validated.errors,
      hint: "参数未通过卡数据 schema 校验，按 errors 修正后重新调用本工具。",
    });
  }

  // ── 闸门 2：动作库存在性（#136 提案层拦截）──
  if (carriesExerciseIds(cardType)) {
    const ids = collectExerciseIds(cardType, validated.card.data);
    if (ids.length > 0) {
      let universe: Set<string>;
      try {
        universe = await deps.listExerciseIds();
      } catch (err) {
        console.error(
          `[submit_${cardType}] exercise id universe unavailable:`,
          err,
        );
        return structuredErrorPayload({
          ok: false,
          code: "EXERCISE_DB_UNAVAILABLE",
          hint: "动作库暂时读不到，无法校验 exercise_id，请稍后重新调用。",
        });
      }
      const misses = ids.filter((id) => !universe.has(id));
      if (misses.length > 0) {
        return structuredErrorPayload({
          ok: false,
          code: "UNKNOWN_EXERCISE_ID",
          ids: misses,
          hint: "exercise_id 不在动作库（exercises 表）里。只能使用 list_exercises/find_exercises 返回的 id，禁止编造。",
        });
      }
    }
  }

  // ── 闸门 3a：survey 题库收敛（#114 B5c，语义时点不变）──
  let canonicalCard: unknown = validated.card;
  if (cardType === "survey_card") {
    const converged = canonicalizeSurveyCard(validated.card);
    if (!converged.ok) {
      return structuredErrorPayload({
        ok: false,
        code: "SURVEY_OFF_BANK",
        errors: converged.errors,
        hint: "题目 id 不在共享题库里。缺哪几项就传对应题库 id，禁止自造题目。",
      });
    }
    canonicalCard = converged.card;
  }

  // ── 闸门 3b：Q1 数据一致性（workout_complete 场景，与校验回路同口径）──
  const scenario = resolveScenario(opts);
  if (scenario === "workout_complete") {
    const userId = resolveUserId(opts);
    if (userId) {
      const facts = await loadFacts(deps, userId);
      if (facts) {
        const quality = checkWorkoutCardQuality(
          cardToCheckableText(canonicalCard),
          facts,
        );
        if (!quality.ok) {
          return structuredErrorPayload({
            ok: false,
            code: "QUALITY",
            errors: quality.issues,
            hint: "卡片数字与真实训练数据不符。所有数字必须来自 load_history 返回的数据，禁止编造或估算。",
          });
        }
      }
    }
  }

  // ── 全过 → 卡汇推入（幂等：同 thread 同卡型 last-write-wins）──
  const threadId = resolveThreadId(opts);
  if (threadId === null) {
    // 无线程锚点：无法进卡汇（也就无法发射）——显式打回而非静默丢卡。
    return structuredErrorPayload({
      ok: false,
      code: "NO_THREAD_CONTEXT",
      hint: "提交通道缺少线程上下文（thread_id），卡片无法投递。请直接以 ```json 围栏在正文输出该卡。",
    });
  }
  pushCardToSink(threadId, canonicalCard);

  return JSON.stringify({
    ok: true,
    cardId: randomUUID().slice(0, 8),
    channel: "tool",
  });
}

/** Q1 facts：默认 SessionRepo 最新 session（读失败降级跳过，回路同款）。 */
async function loadFacts(
  deps: CardSubmitToolDeps,
  userId: string,
): Promise<WorkoutSessionFacts | null> {
  if (deps.loadSessionFacts) {
    return deps.loadSessionFacts(userId).catch(() => null);
  }
  try {
    const latestRaw = await SessionRepo.getLatestSessionRaw(userId);
    if (latestRaw == null) return null;
    return extractSessionFacts({ sessions: [latestRaw] });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// survey intent → 卡装配
// ---------------------------------------------------------------------------

type AssembleResult =
  { ok: true; card: unknown } | { ok: false; error: SubmitError };

/**
 * submit_survey 意图 → survey_card 卡形态。
 *
 * 意图先过 SurveySubmitIntentSchema 深校验（结构化错误回注），再装配：
 *  - profile_intake：题目桩 = 题库全量（canonicalize 随后原样收敛，幂等）；
 *  - plan_gap：题目桩 = question_ids ∩ 题库（题外 id 由 canonicalize 丢弃，
 *    交集空 → SURVEY_OFF_BANK 结构化错误——与围栏回路同一重试语义）；
 *  - workout_feedback：questions 原样进卡（自由出题，#114 本期不动）。
 *
 * 桩只带 {id, question}（zod 最小合法形态），题面原文由 canonicalize 替换。
 */
function assembleSurveyCard(input: unknown): AssembleResult {
  const parsed = SurveySubmitIntentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        ok: false,
        code: "SCHEMA",
        errors: parsed.error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path.map(String),
        })),
        hint: "submit_survey 参数形状不对，按 errors 修正后重新调用。",
      },
    };
  }
  const intent = parsed.data;

  let questions: Array<{ id: string; question: string }>;
  if (intent.purpose === "workout_feedback") {
    questions = (intent.questions ?? []).map((q) => ({
      id: q.id,
      question: q.question,
    }));
  } else {
    const bankIds =
      intent.purpose === "profile_intake"
        ? PROFILE_INTAKE_QUESTIONS.map((q) => q.id)
        : intent.question_ids;
    const stubs: Array<{ id: string; question: string }> = [];
    for (const id of bankIds) {
      const bank = PROFILE_INTAKE_QUESTIONS.find((q) => q.id === id);
      stubs.push({ id, question: bank?.question ?? id });
    }
    questions = stubs;
  }

  return {
    ok: true,
    card: {
      type: "survey_card",
      data: {
        purpose: intent.purpose,
        ...(intent.title !== undefined ? { title: intent.title } : {}),
        ...(intent.subtitle !== undefined ? { subtitle: intent.subtitle } : {}),
        ...(intent.message !== undefined ? { message: intent.message } : {}),
        ...(intent.sessionId !== undefined
          ? { sessionId: intent.sessionId }
          : {}),
        questions,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 工具描述（模型可见文案）
// ---------------------------------------------------------------------------

function buildToolDescription(cardType: SubmittableCardType): string {
  const head =
    `提交 ${cardType} 卡（唯一交付通道）。schema 与动作库存在性校验在本工具内执行；` +
    `失败返回结构化错误（ok:false + errors/ids），按错误修正参数后重新调用本工具。` +
    `不要把该卡 JSON 写进正文或围栏。`;
  if (cardType === "survey_card") {
    return (
      head +
      ` 只收意图：purpose（profile_intake=首用全量画像 / plan_gap=缺口补全 / ` +
      `workout_feedback=练后反馈）+ question_ids（题库 id；profile_intake 可省略=全量）+ ` +
      `title/message 话术；workout_feedback 用 questions 自由出题（≤3 题）。` +
      `题目内容后端按共享题库替换——只给 id，禁止自造题目。`
    );
  }
  if (cardType === "weekly_plan") {
    return (
      head +
      ` 参数即完整卡数据（week_label/split_summary/days + apply 落库载荷）；` +
      `exercise_id 必须来自 list_exercises/find_exercises 返回的 id。`
    );
  }
  return (
    head +
    ` 参数为 { data: [...] }——data 是动作数组（exerciseId/name/exercise_type/` +
    `sets/reps + 按类型的必需字段）。`
  );
}

// ---------------------------------------------------------------------------
// 批量构建（mcpTools 组装入口）
// ---------------------------------------------------------------------------

/**
 * 按解析出的通道构建 submit 工具集（channel=fence 的卡型不暴露工具，
 * 继续走围栏管道）。
 */
export function buildCardSubmitTools(
  deps: CardSubmitToolDeps,
  channels: CardChannels,
): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];
  for (const cardType of SUBMITTABLE_CARD_TYPES) {
    if (channels[cardType] === "tool") {
      tools.push(makeCardSubmitTool(cardType, deps));
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
