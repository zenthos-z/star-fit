/**
 * Suggestion Service - 动作建议值生成（混合模式编排层）
 *
 * 分层（每层独立可测，红线：AI 不做算术）：
 *   ① Repository 取画像/历史（禁止直连库）
 *   ② buildCapabilityProfile 四级锚点降级
 *   ③ computeBaseline 纯公式计算（shared/contracts 单一算术来源）
 *   ④ Agent 只产出有界 AdjustmentIntent + 理由（可关：SUGGESTION_AGENT_MODE）
 *   ⑤ applyAdjustment 钳制 + finalizeValues 取整裁剪
 *   ⑥ validateOrThrow(ExerciseSuggestionSchema) + context_fingerprint
 *
 * Agent 任何故障（超时/坏 JSON/校验失败）都降级为 source='formula'，
 * 本端点绝不因 LLM 5xx。
 */

import {
  ExerciseSuggestionSchema,
  applyAdjustment,
  computeBaseline,
  computeContextFingerprint,
  finalizeValues,
  validateOrThrow,
  type AdjustmentIntent,
  type ExerciseSuggestion,
  type HistorySummary,
  type ProfileDynamic,
  type ProfileStatic,
  type SuggestionRequest,
  type SuggestionResponse,
  type SuggestionValues,
} from 'shared/contracts';

import {
  buildCapabilityProfile,
  collectFingerprintInput,
  type SuggestionExerciseInput,
  type SuggestionUserContext,
} from './suggestionProfiles.js';

// ---------------------------------------------------------------------------
// 端口定义（依赖注入，便于单测 fake）
// ---------------------------------------------------------------------------

/** 画像数据访问端口（UserRepository 子集） */
export interface SuggestionUserRepoPort {
  getProfileStatic(userId: string): Promise<ProfileStatic | null>;
  getProfileDynamic(userId: string): Promise<ProfileDynamic | null>;
  getHistorySummary(userId: string): Promise<HistorySummary | null>;
}

/** Agent 调整端口（M4 的 suggestionAgentAdapter 实现此接口） */
export interface SuggestionAgentPort {
  adjust(input: AgentAdjustmentInput): Promise<AdjustmentIntent[] | null>;
}

export interface AgentAdjustmentItem {
  name: string;
  type: string;
  /** Service 已算好的公式基准值（Agent 只读参考，不许计算） */
  baseline: SuggestionValues;
  /** 锚点摘要（人类可读，如 "est_1rm 99.3kg（3 天前）" / "无锚点，按体重系数推算"） */
  anchorSummary: string;
  /** 用户当前配置（只读参考） */
  current?: SuggestionValues;
  /** 是否有未过期伤病限制（该动作只许下调） */
  injuryLimited: boolean;
}

export interface AgentAdjustmentInput {
  userId: string;
  profileSummary: {
    goal: string;
    fitness_level: string;
    training_age_months: number | undefined;
    bodyweight_kg: number | undefined;
    limitations: string[];
    recovery: string;
  };
  items: AgentAdjustmentItem[];
}

export interface SuggestionLogger {
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
}

// ---------------------------------------------------------------------------
// 环境开关
// ---------------------------------------------------------------------------

export function resolveAgentMode(): 'off' | 'hybrid' {
  return process.env.SUGGESTION_AGENT_MODE === 'hybrid' ? 'hybrid' : 'off';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SuggestionService {
  constructor(
    private readonly userRepo: SuggestionUserRepoPort,
    private readonly agent: SuggestionAgentPort | null,
  ) {}

  async generateBatch(
    userId: string,
    req: SuggestionRequest,
    log?: SuggestionLogger,
  ): Promise<SuggestionResponse> {
    const agentMode = resolveAgentMode();
    const ctx = await this.loadContext(userId);

    const exercises: SuggestionExerciseInput[] = req.exercises.map((e) => ({
      name: e.name,
      type: e.type,
      current: e.current,
    }));
    const goal = ctx.profileStatic?.preferences?.goal;

    // ② 剖面 + ③ 公式基准
    const staged = exercises.map((exercise) => {
      const profile = buildCapabilityProfile(exercise.name, exercise.type, ctx);
      const baseline = computeBaseline(profile, profile.exercise_type, req.target_rpe, goal);
      return { exercise, profile, baseline };
    });

    // ④ Agent 调整（可关；故障降级）
    let intents = new Map<string, AdjustmentIntent>();
    let degradedReason: string | undefined;
    if (agentMode === 'hybrid' && this.agent) {
      try {
        const result = await this.agent.adjust(this.buildAgentInput(userId, ctx, staged));
        if (result) {
          intents = new Map(result.map((intent) => [intent.exercise_name, intent]));
        } else {
          degradedReason = 'agent_adjustment_unavailable';
          log?.warn({ userId }, 'suggestion_agent_degraded');
        }
      } catch (err) {
        degradedReason = 'agent_adjustment_failed';
        log?.warn({ err, userId }, 'suggestion_agent_error');
      }
    }

    // ⑤ 合并 + 终值整备 + ⑥ 校验
    const fingerprint = computeContextFingerprint(
      collectFingerprintInput(ctx, exercises, agentMode),
    );
    const suggestions: ExerciseSuggestion[] = staged.map(({ exercise, profile, baseline }) => {
      const intent = matchIntent(intents, exercise.name);
      const injuryLimited = profile.modifiers.injury_scale < 1;
      const adjusted = applyAdjustment(baseline, intent, { injuryLimited });
      const values = finalizeValues(adjusted, profile.exercise_type);
      const entry: ExerciseSuggestion = {
        exercise_name: exercise.name,
        exercise_type: profile.exercise_type,
        baseline_rpe: req.target_rpe,
        values,
        profile,
        adjustment: intent,
        source: intent ? 'hybrid' : 'formula',
        generated_at: Date.now(),
        context_fingerprint: fingerprint,
      };
      return validateOrThrow(ExerciseSuggestionSchema, entry);
    });

    return {
      suggestions,
      meta: {
        context_fingerprint: fingerprint,
        agent_mode: agentMode,
        ...(degradedReason ? { degraded_reason: degradedReason } : {}),
      },
    };
  }

  /** ① 画像/历史加载（单项失败不阻塞 — 与 mcpTools load_history 同哲学） */
  private async loadContext(userId: string): Promise<SuggestionUserContext> {
    const [profileStatic, profileDynamic, history] = await Promise.all([
      this.userRepo.getProfileStatic(userId).catch(() => null),
      this.userRepo.getProfileDynamic(userId).catch(() => null),
      this.userRepo
        .getHistorySummary(userId)
        .catch(() => null),
    ]);
    // HistorySummary typed schema 落后于运行时 JSONB（sessions[]），按原始形状消费
    return {
      profileStatic,
      profileDynamic,
      history: history as Record<string, unknown> | null,
    };
  }

  /** Agent 输入组装：画像压缩摘要 + 每动作基准/锚点（prompt 由 adapter 负责） */
  private buildAgentInput(
    userId: string,
    ctx: SuggestionUserContext,
    staged: Array<{
      exercise: SuggestionExerciseInput;
      baseline: SuggestionValues;
      profile: ReturnType<typeof buildCapabilityProfile>;
    }>,
  ): AgentAdjustmentInput {
    const now = Date.now();
    const limitations = ((ctx.profileDynamic?.active_limitations ?? []) as Array<{
      part: string;
      severity?: number;
      expire_at: string;
    }>)
      .filter((l) => l?.part && Date.parse(l.expire_at) > now)
      .map((l) => `${l.part}(severity ${l.severity ?? '?'})`);

    const recoveryRaw = (ctx.profileDynamic as unknown as Record<string, unknown> | null)
      ?.recovery_state as Record<string, unknown> | undefined;

    return {
      userId,
      profileSummary: {
        goal: ctx.profileStatic?.preferences?.goal ?? 'UNKNOWN',
        fitness_level: ctx.profileStatic?.fitness_level ?? 'UNKNOWN',
        training_age_months: ctx.profileStatic?.basic_info?.training_age,
        bodyweight_kg: ctx.profileStatic?.weight ?? ctx.profileStatic?.basic_info?.weight,
        limitations,
        recovery: recoveryRaw ? JSON.stringify(recoveryRaw) : 'UNKNOWN',
      },
      items: staged.map(({ exercise, baseline, profile }) => ({
        name: exercise.name,
        type: profile.exercise_type,
        baseline,
        anchorSummary: summarizeAnchor(profile),
        current: exercise.current,
        injuryLimited: profile.modifiers.injury_scale < 1,
      })),
    };
  }
}

function matchIntent(
  intents: Map<string, AdjustmentIntent>,
  exerciseName: string,
): AdjustmentIntent | undefined {
  const exact = intents.get(exerciseName);
  if (exact) return exact;
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_（）()]/g, '');
  for (const [key, intent] of intents) {
    if (norm(key) === norm(exerciseName)) return intent;
  }
  return undefined;
}

function summarizeAnchor(profile: ReturnType<typeof buildCapabilityProfile>): string {
  switch (profile.data_basis) {
    case 'anchor':
      return `锚点 est_1rm ${profile.est_1rm?.toFixed(1)}kg（置信度 ${profile.anchor_confidence ?? '未知'}）`;
    case 'history':
      return `历史最佳推导 est_1rm ${profile.est_1rm?.toFixed(1)}kg（置信度 ${profile.anchor_confidence ?? '未知'}）`;
    case 'bodyweight_estimate':
      return '无历史，按体重系数推算（保守）';
    default:
      return '无任何锚点，类型默认值（保守）';
  }
}
