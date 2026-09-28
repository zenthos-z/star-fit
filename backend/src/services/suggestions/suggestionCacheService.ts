/**
 * Suggestion Cache Service - 建议参数缓存（issue #39 B6，确定性整批重算）
 *
 * 「打开 App 即得，静默无感知」的公式层核心：
 *   ① Repository 取画像/历史/动作库/当日计划（禁止直连库）
 *   ② buildCapabilityProfile 四级锚点降级（复用，勿复制公式）
 *   ③ computeBaseline 纯公式（shared/contracts 单一算术来源）
 *   ④ 计划上下文调制：当日已排容量→肌群疲劳叠加降载（suggestionPlanContext，
 *      有界可配置，本批新增的调制链一环）
 *   ⑤ Agent 精调（可关）：仅对「当日计划涉及的动作」走 AdjustmentIntent 通道；
 *      全量动作库（354 条）永远只走公式层 —— 红线：AI 不做算术
 *   ⑥ applyAdjustment 钳制 + finalizeValues 取整裁剪 + CachedSuggestion 校验
 *   ⑦ 整批落 suggestion_cache（单事务替换），指纹对账语义见 GET 端点
 *
 * 调制链顺序（固定）：computeBaseline（injury/novice/recovery）
 *   → applyPlanContextFactor（当日疲劳降载）→ applyAdjustment（Agent 有界）
 *   → finalizeValues（取整/裁剪）。
 *
 * 指纹语义：画像（goal/体重/伤病/锚点更新时间，含公式版本）+ 动作库签名
 *   + 当日计划签名 + 计划上下文版本 + agent 模式。任一变化 → 指纹变化
 *   → 整批重算。matched 只反映「客户端回传指纹 vs 当前后端指纹」。
 */

import {
  CachedSuggestionSchema,
  applyAdjustment,
  computeBaseline,
  computeContextFingerprint,
  finalizeValues,
  validateOrThrow,
  type AdjustmentIntent,
  type CachedSuggestion,
  type CapabilityProfile,
  type ExerciseLibraryItem,
  type SuggestionCacheResponse,
  type SuggestionPlanContext,
  type SuggestionValues,
} from "shared/contracts";

import {
  buildCapabilityProfile,
  collectFingerprintInput,
  type SuggestionUserContext,
} from "./suggestionProfiles.js";
import {
  PLAN_CONTEXT_VERSION,
  aggregateDailyMuscleLoads,
  applyPlanContextFactor,
  planContextFactor,
  resolvePlanContextConfig,
  type PlanContextEntry,
} from "./suggestionPlanContext.js";
import type {
  AgentAdjustmentInput,
  SuggestionAgentPort,
  SuggestionLogger,
} from "./suggestionService.js";

// ---------------------------------------------------------------------------
// 端口定义（依赖注入，便于单测 fake）
// ---------------------------------------------------------------------------

export interface SuggestionCacheUserRepoPort {
  getProfileStatic(
    userId: string,
  ): Promise<SuggestionUserContext["profileStatic"] | null>;
  getProfileDynamic(
    userId: string,
  ): Promise<SuggestionUserContext["profileDynamic"] | null>;
  getHistorySummary(userId: string): Promise<unknown>;
}

export interface SuggestionCachePlanRepoPort {
  getTodayMuscleContextEntries(
    userId: string,
    entryDate: string,
  ): Promise<PlanContextEntry[]>;
}

export interface SuggestionCacheExerciseRepoPort {
  /** 用户可见动作库全集（公共 ∪ 本人自建）——不得混入他人自建动作 */
  getItemsVisibleToUser(userId: string): Promise<ExerciseLibraryItem[]>;
}

/** 整批替换写入的单行（Repository SuggestionCacheWriteRow 的结构化端口形态） */
export interface SuggestionCacheWritePortRow {
  exercise_id: string;
  exercise_name: string;
  exercise_type: string;
  baseline_rpe: number;
  values: SuggestionValues;
  profile: CapabilityProfile;
  adjustment: AdjustmentIntent | null;
  plan_context: SuggestionPlanContext;
  source: "formula" | "hybrid";
}

/** 出库行端口形态（SuggestionCacheReadEntry 的结构化子集） */
export interface SuggestionCacheReadPortRow {
  exercise_name: string;
  exercise_type: string;
  baseline_rpe: number;
  values: SuggestionValues;
  profile: CapabilityProfile;
  adjustment: AdjustmentIntent | null;
  plan_context: SuggestionPlanContext;
  source: "formula" | "hybrid";
  generated_at: number;
}

export interface SuggestionCacheRepoPort {
  replaceUserCache(
    userId: string,
    fingerprint: string,
    rows: readonly SuggestionCacheWritePortRow[],
  ): Promise<number>;
  getByUserAndFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<SuggestionCacheReadPortRow[]>;
}

// ---------------------------------------------------------------------------
// 常量与工具
// ---------------------------------------------------------------------------

/** 缓存批次的目标 RPE（其他 RPE 前端用 profile 本地 derive，缓存不重复存） */
export const SUGGESTION_CACHE_BASELINE_RPE = 7;

/** FNV-1a 32 位 → 8 位十六进制（与 contracts fnv1a 同算法的本地副本） */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 快照：指纹与重算共用一次数据装载（避免对账路径双查） */
interface CacheSnapshot {
  ctx: SuggestionUserContext;
  library: ExerciseLibraryItem[];
  planEntries: PlanContextEntry[];
  today: string;
  fingerprint: string;
  agentMode: "off" | "hybrid";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SuggestionCacheService {
  constructor(
    private readonly userRepo: SuggestionCacheUserRepoPort,
    private readonly planRepo: SuggestionCachePlanRepoPort,
    private readonly exerciseRepo: SuggestionCacheExerciseRepoPort,
    private readonly cacheRepo: SuggestionCacheRepoPort,
    private readonly agent: SuggestionAgentPort | null,
  ) {}

  /**
   * 对账拉取（GET /api/suggestions/cache 核心）：
   * - 客户端指纹 = 当前后端指纹，且缓存行数 = 动作库数 → matched=true 回缓存
   * - 客户端指纹过期但缓存新鲜 → matched=false 回现缓存（客户端需全量刷新）
   * - 缓存缺失/不完整 → 同步整批重算落库（公式层毫秒级）→ matched=false 全量
   */
  async getCache(
    userId: string,
    clientFingerprint?: string,
    log?: SuggestionLogger,
  ): Promise<SuggestionCacheResponse> {
    const snapshot = await this.loadSnapshot(userId);
    const cached = await this.cacheRepo
      .getByUserAndFingerprint(userId, snapshot.fingerprint)
      .catch((err) => {
        log?.warn({ err, userId }, "suggestion_cache_read_failed");
        return [] as SuggestionCacheReadPortRow[];
      });

    const fingerprintMatches =
      clientFingerprint === undefined ||
      clientFingerprint === snapshot.fingerprint;
    const cacheComplete =
      cached.length > 0 && cached.length === snapshot.library.length;

    if (cacheComplete) {
      const suggestions = cached.map((row) => rowToSuggestion(row, snapshot));
      return {
        fingerprint: snapshot.fingerprint,
        matched: fingerprintMatches,
        baseline_rpe: SUGGESTION_CACHE_BASELINE_RPE,
        agent_mode: snapshot.agentMode,
        generated_at: Math.max(...cached.map((r) => r.generated_at)),
        suggestions,
      };
    }

    // 未命中：同步重算（打开 App 即得 —— 公式层批量毫秒级，不依赖空闲任务）
    const { suggestions, generatedAt } = await this.recomputeFromSnapshot(
      userId,
      snapshot,
      log,
    );
    return {
      fingerprint: snapshot.fingerprint,
      matched: false,
      baseline_rpe: SUGGESTION_CACHE_BASELINE_RPE,
      agent_mode: snapshot.agentMode,
      generated_at: generatedAt,
      suggestions,
    };
  }

  /**
   * 整批重算落缓存（心跳空闲任务 / 测试入口）。确定性：同一 DB 状态永远
   * 产出同一指纹与同一批值。Agent 段（hybrid 且端口可用时）只精调当日
   * 计划涉及的动作，故障降级为 formula（与 POST /suggestions 同哲学）。
   */
  async recomputeUserCache(
    userId: string,
    log?: SuggestionLogger,
  ): Promise<{ fingerprint: string; rowCount: number }> {
    const snapshot = await this.loadSnapshot(userId);
    const { suggestions } = await this.recomputeFromSnapshot(
      userId,
      snapshot,
      log,
    );
    return {
      fingerprint: snapshot.fingerprint,
      rowCount: suggestions.length,
    };
  }

  /** 只算指纹（不落库）——对账探针/测试用 */
  async computeFingerprint(userId: string): Promise<string> {
    const snapshot = await this.loadSnapshot(userId);
    return snapshot.fingerprint;
  }

  // -------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------

  private async loadSnapshot(userId: string): Promise<CacheSnapshot> {
    const today = utcToday();
    const [profileStatic, profileDynamic, history, library, planEntries] =
      await Promise.all([
        this.userRepo.getProfileStatic(userId).catch(() => null),
        this.userRepo.getProfileDynamic(userId).catch(() => null),
        this.userRepo.getHistorySummary(userId).catch(() => null),
        this.exerciseRepo
          .getItemsVisibleToUser(userId)
          .catch(() => [] as ExerciseLibraryItem[]),
        this.planRepo
          .getTodayMuscleContextEntries(userId, today)
          .catch(() => [] as PlanContextEntry[]),
      ]);

    const agentMode =
      process.env.SUGGESTION_AGENT_MODE === "hybrid" ? "hybrid" : "off";
    const ctx: SuggestionUserContext = {
      profileStatic,
      profileDynamic,
      history: history as SuggestionUserContext["history"],
    };

    const fingerprint = this.computeFingerprintFrom(
      ctx,
      library,
      planEntries,
      today,
      agentMode,
    );
    return { ctx, library, planEntries, today, fingerprint, agentMode };
  }

  /** 指纹 = 画像指纹（含公式版本）⊕ 动作库签名 ⊕ 当日计划签名 ⊕ 上下文版本 */
  private computeFingerprintFrom(
    ctx: SuggestionUserContext,
    library: readonly ExerciseLibraryItem[],
    planEntries: readonly PlanContextEntry[],
    today: string,
    agentMode: "off" | "hybrid",
  ): string {
    // 复用契约指纹（空 exercises → 不含批量动作段；锚点/伤病/体重/目标全入）
    const base = computeContextFingerprint(
      collectFingerprintInput(ctx, [], agentMode),
    );
    const libStamp = fnv1a(
      library
        .map((e) => `${e.id}:${e.exercise_type}`)
        .sort()
        .join(","),
    );
    const planStamp = fnv1a(
      planEntries
        .map((e) => `${e.exercise_id}:${e.target_sets}`)
        .sort()
        .join(","),
    );
    return fnv1a(
      `${base}|lib:${libStamp}|plan:${today}@${planStamp}` +
        `|pcv:${PLAN_CONTEXT_VERSION}` +
        `|rpe:${SUGGESTION_CACHE_BASELINE_RPE}` +
        `|agent:${agentMode}`,
    );
  }

  private async recomputeFromSnapshot(
    userId: string,
    snapshot: CacheSnapshot,
    log?: SuggestionLogger,
  ): Promise<{ suggestions: CachedSuggestion[]; generatedAt: number }> {
    const { ctx, library, planEntries, fingerprint, agentMode } = snapshot;
    const goal = ctx.profileStatic?.preferences?.goal;
    const config = resolvePlanContextConfig();
    const loads = aggregateDailyMuscleLoads(planEntries);
    const generatedAt = Date.now();

    // ②③④ 公式层全量：profile → baseline → 计划上下文降载
    const staged = library.map((exercise) => {
      const profile = buildCapabilityProfile(
        exercise.name,
        exercise.exercise_type,
        ctx,
      );
      const baseline = computeBaseline(
        profile,
        profile.exercise_type,
        SUGGESTION_CACHE_BASELINE_RPE,
        goal,
      );
      const factor = planContextFactor(
        {
          exercise_id: exercise.id,
          primary_muscles: exercise.primary_muscles ?? [],
        },
        loads,
        config,
      );
      const modulated = applyPlanContextFactor(baseline, factor.factor);
      return { exercise, profile, modulated, factor };
    });

    // ⑤ Agent 精调：仅「当日计划涉及的动作」（购物车是前端态，计划是后端
    //    可见集合；下一批前端对账时以本通道为准）。全量 354 条永远只走公式层。
    const planExerciseIds = new Set(planEntries.map((e) => e.exercise_id));
    let intents = new Map<string, AdjustmentIntent>();
    if (agentMode === "hybrid" && this.agent) {
      const planItems = staged.filter((s) =>
        planExerciseIds.has(s.exercise.id),
      );
      if (planItems.length > 0) {
        try {
          const result = await this.agent.adjust(
            this.buildAgentInput(userId, ctx, planItems),
          );
          if (result) {
            intents = new Map(
              result.map((intent) => [intent.exercise_name, intent]),
            );
          } else {
            log?.warn({ userId }, "suggestion_cache_agent_degraded");
          }
        } catch (err) {
          // Agent 故障降级：全部回公式层，缓存路径绝不因 LLM 5xx（红线）
          log?.warn({ err, userId }, "suggestion_cache_agent_error");
        }
      }
    }

    // ⑥ 终值整备 + 校验 + ⑦ 写入行组装（同一次遍历，id 取自 staged 元组）
    const suggestions: CachedSuggestion[] = [];
    const writeRows: SuggestionCacheWritePortRow[] = [];
    for (const { exercise, profile, modulated, factor } of staged) {
      const intent = intents.get(exercise.name);
      const injuryLimited = profile.modifiers.injury_scale < 1;
      const adjusted = applyAdjustment(modulated, intent, { injuryLimited });
      const values = finalizeValues(adjusted, profile.exercise_type);
      const planContext: SuggestionPlanContext = {
        factor: factor.factor,
        prior_same_muscle_exercises: factor.prior_same_muscle_exercises,
        ...(factor.muscle ? { muscle: factor.muscle } : {}),
        today_planned_sets: factor.today_planned_sets,
      };
      const suggestion = validateOrThrow(
        CachedSuggestionSchema,
        {
          exercise_name: exercise.name,
          exercise_type: profile.exercise_type,
          baseline_rpe: SUGGESTION_CACHE_BASELINE_RPE,
          values,
          profile,
          ...(intent ? { adjustment: intent } : {}),
          source: intent ? "hybrid" : "formula",
          generated_at: generatedAt,
          context_fingerprint: fingerprint,
          plan_context: planContext,
        },
        "SuggestionCacheService.recompute.entry",
      );
      suggestions.push(suggestion);
      writeRows.push({
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        exercise_type: profile.exercise_type,
        baseline_rpe: SUGGESTION_CACHE_BASELINE_RPE,
        values,
        profile,
        adjustment: intent ?? null,
        plan_context: planContext,
        source: intent ? "hybrid" : "formula",
      });
    }

    await this.cacheRepo.replaceUserCache(userId, fingerprint, writeRows);
    return { suggestions, generatedAt };
  }

  /** Agent 输入组装（与 SuggestionService.buildAgentInput 同形状的压缩摘要） */
  private buildAgentInput(
    userId: string,
    ctx: SuggestionUserContext,
    items: Array<{
      exercise: ExerciseLibraryItem;
      modulated: SuggestionValues;
      profile: ReturnType<typeof buildCapabilityProfile>;
    }>,
  ): AgentAdjustmentInput {
    const now = Date.now();
    const dynamicRaw = ctx.profileDynamic as unknown as Record<
      string,
      unknown
    > | null;
    const limitations = (
      (dynamicRaw?.active_limitations ?? []) as Array<{
        part: string;
        severity?: number;
        expire_at: string;
      }>
    )
      .filter((l) => l?.part && Date.parse(l.expire_at) > now)
      .map((l) => `${l.part}(severity ${l.severity ?? "?"})`);
    const recoveryRaw = dynamicRaw?.recovery_state as
      Record<string, unknown> | undefined;

    return {
      userId,
      profileSummary: {
        goal: ctx.profileStatic?.preferences?.goal ?? "UNKNOWN",
        training_age_months: ctx.profileStatic?.basic_info?.training_age,
        bodyweight_kg:
          ctx.profileStatic?.weight ?? ctx.profileStatic?.basic_info?.weight,
        limitations,
        recovery: recoveryRaw ? JSON.stringify(recoveryRaw) : "UNKNOWN",
      },
      items: items.map(({ exercise, modulated, profile }) => ({
        name: exercise.name,
        type: profile.exercise_type,
        baseline: modulated,
        anchorSummary: `cache 精调（当日计划涉及；data_basis=${profile.data_basis}）`,
        injuryLimited: profile.modifiers.injury_scale < 1,
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 出库行 → CachedSuggestion（行内指纹即批次指纹；组装后再经校验回路） */
function rowToSuggestion(
  row: SuggestionCacheReadPortRow,
  snapshot: CacheSnapshot,
): CachedSuggestion {
  return validateOrThrow(
    CachedSuggestionSchema,
    {
      exercise_name: row.exercise_name,
      exercise_type: row.exercise_type,
      baseline_rpe: row.baseline_rpe,
      values: row.values,
      profile: row.profile,
      ...(row.adjustment ? { adjustment: row.adjustment } : {}),
      source: row.source,
      generated_at: row.generated_at,
      context_fingerprint: snapshot.fingerprint,
      plan_context: row.plan_context,
    },
    "SuggestionCacheService.rowToSuggestion",
  );
}
