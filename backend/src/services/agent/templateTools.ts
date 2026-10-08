/**
 * #151 S3 接线层——pick_template / instantiate_weekly_plan 两个 Agent 工具
 * + #136 L1 启动期报损对拍。
 *
 * 职责边界（spec #151 §5.4 流）：
 *  - pick_template：模板目录决策面（键/分化/人群/器械面/天数档）。Agent 只做
 *    选择不展开；目录幂等只读 → 进 TURN_CACHEABLE_TOOLS（mcpTools 白名单）；
 *  - instantiate_weekly_plan：模板键 + 覆盖参数 → planTemplates 内核程序化
 *    展开（日期对齐/器械替换/剂量查表/伤病过滤/周次递进全量算好），Agent 把
 *    返回的 card 原样经 submit_weekly_plan 提交（S2 L2 闸门继续生效——内核
 *    出卡≠落库，交付仍走三闸门链）；
 *  - profile 缺参回填：Agent 未显式覆盖的字段从 load_history 同源 profile 读取
 *    （preferences.equipment / weekly_frequency_days、basic_info.gender /
 *    training_age、profile_dynamic.active_limitations 过期过滤后取 part）——
 *    profile 事实不信任 LLM 转述（zero-arithmetic 的数据面孪生：选什么可以
 *    听 Agent，是什么只能读库）；
 *  - L1 启动报损（#136 第一层的运行期侧）：createTemplateIdAuditOnce 工厂
 *    经 mcpTools 注入 ExerciseQuery 全集读取（防循环依赖，cardSubmit 同款
 *    DI 方向），Agent 首次组装时对拍，miss 显式 console.error 不阻断组装
 *    （报损模板回退自由生成路径，L2 submit 闸门兜底——spec R6 回滚语义）。
 *
 * 工具入参 schema 走宽松绑定 + func 内严格 zod 回路（cardSubmit 双段式同款：
 * 枚举/数值边界不在绑定层硬卡——模型可见性靠 describe，深校验失败回注结构化
 * 错误供 Agent 二级弹跳；z.enum 裸词风险见 DeepAgentService 组装注释）。
 *
 * @created 2026-10-08（S3 模板批，commit 3 接线）
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import {
  ExerciseEquipmentSchema,
  ProfileDynamicSchema,
  ProfileStaticSchema,
  filterExpiredLimitations,
} from "shared/contracts";

import { getPostgresClient } from "../../db/postgresql/index.js";
import { createUserRepository } from "../../db/postgresql/repository/index.js";
import {
  InstantiateWeeklyPlanParamsSchema,
  auditTemplateExerciseIds,
  instantiateWeeklyPlan,
  templateCatalog,
} from "./planTemplates.js";

/** 单一 PG 客户端类型（mcpTools 同款派生；本地派生避免 ↔ mcpTools 循环依赖）。 */
type DbClient = ReturnType<typeof getPostgresClient>;

// ============================================================================
// profile 缺省读取（load_history 同源；失败容错 → 空缺省）
// ============================================================================

/** profile 可回填的实例化缺省（全部字段可缺——缺省链继续落到模板默认）。 */
export interface ProfilePlanDefaults {
  /** preferences.equipment（越枚举值剔除；剔空 = 不回填）。 */
  equipment?: string[];
  /** profile_dynamic.active_limitations 过期过滤后的 part 原值。 */
  active_limitations?: string[];
  /** basic_info.gender（仅 male/female 参与 double 递进步进修正）。 */
  sex?: "male" | "female";
  /** basic_info.training_age（月）。 */
  training_age_months?: number;
  /** preferences.weekly_frequency_days。 */
  days_per_week?: number;
}

/** 从 profile 原始 JSON 提取实例化缺省（防御式：profile 是建议性输入，坏形状不炸工具）。 */
export function extractProfilePlanDefaults(
  profileStatic: unknown,
  profileDynamic: unknown,
): ProfilePlanDefaults {
  const defaults: ProfilePlanDefaults = {};

  const st = ProfileStaticSchema.safeParse(profileStatic ?? {});
  if (st.success) {
    const equipment = (st.data.preferences?.equipment ?? []).filter(
      (e) => ExerciseEquipmentSchema.safeParse(e).success,
    );
    if (equipment.length > 0) defaults.equipment = equipment;

    const days = st.data.preferences?.weekly_frequency_days;
    if (
      Number.isInteger(days) &&
      days !== undefined &&
      days >= 1 &&
      days <= 7
    ) {
      defaults.days_per_week = days;
    }

    const gender = st.data.basic_info?.gender;
    if (gender === "male" || gender === "female") {
      defaults.sex = gender;
    }
    const age = st.data.basic_info?.training_age;
    if (
      typeof age === "number" &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= 720
    ) {
      defaults.training_age_months = Math.round(age);
    }
  }

  const dy = ProfileDynamicSchema.safeParse(profileDynamic ?? {});
  if (dy.success) {
    const parts = filterExpiredLimitations(
      dy.data.active_limitations ?? [],
    ).map((l) => l.part);
    if (parts.length > 0) defaults.active_limitations = parts;
  }

  return defaults;
}

/** profile 读取依赖（默认 UserRepository 双读；测试替身注入）。 */
export type LoadPlanProfile = (
  userId: string,
) => Promise<{ static: unknown; dynamic: unknown } | null>;

async function loadProfileViaRepository(
  client: DbClient,
  userId: string,
): Promise<{ static: unknown; dynamic: unknown } | null> {
  const repo = createUserRepository(client);
  const [st, dy] = await Promise.all([
    repo.getProfileStatic(userId).catch(() => null),
    repo.getProfileDynamic(userId).catch(() => null),
  ]);
  return { static: st, dynamic: dy };
}

// ============================================================================
// 缺省合并（纯函数；显式参数 > profile 缺省 > 模板默认[内核处理]）
// ============================================================================

/**
 * 合并显式参数与 profile 缺省：
 *  - equipment / sex / training_age_months / days_per_week：显式替换（Agent 可
 *    刻意改面，如「本周出差只有自重」）；
 *  - active_limitations：恒并集（profile 已登记伤病是硬约束，对话新提及的
 *    部位追加——Agent 传 [] 不豁免已登记伤病）。
 *
 * 返回合并后的内核参数 + 回填清单（工具响应透出，回放/调试可见）。
 */
export function mergeProfilePlanDefaults(
  explicit: Record<string, unknown>,
  defaults: ProfilePlanDefaults,
): { params: Record<string, unknown>; applied: string[] } {
  const params: Record<string, unknown> = { ...explicit };
  const applied: string[] = [];

  if (params.equipment === undefined && defaults.equipment) {
    params.equipment = defaults.equipment;
    applied.push(`equipment ← profile (${defaults.equipment.join("/")})`);
  }
  if (params.sex === undefined && defaults.sex) {
    params.sex = defaults.sex;
    applied.push(`sex ← profile (${defaults.sex})`);
  }
  if (
    params.training_age_months === undefined &&
    defaults.training_age_months !== undefined
  ) {
    params.training_age_months = defaults.training_age_months;
    applied.push(
      `training_age_months ← profile (${defaults.training_age_months})`,
    );
  }
  if (
    params.days_per_week === undefined &&
    defaults.days_per_week !== undefined
  ) {
    params.days_per_week = defaults.days_per_week;
    applied.push(`days_per_week ← profile (${defaults.days_per_week})`);
  }

  const explicitParts = Array.isArray(params.active_limitations)
    ? (params.active_limitations as unknown[])
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
    : [];
  const profileParts = defaults.active_limitations ?? [];
  const seen = new Set<string>();
  const union: string[] = [];
  for (const part of [...explicitParts, ...profileParts]) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      union.push(part);
    }
  }
  if (union.length > 0) {
    params.active_limitations = union;
    if (profileParts.length > 0) {
      applied.push(
        `active_limitations ← profile 并集 (${profileParts.join("/")})`,
      );
    }
  } else {
    delete params.active_limitations;
  }

  return { params, applied };
}

// ============================================================================
// 工具构建（mcpTools 组装入口；依赖注入防循环依赖，cardSubmit 同款方向）
// ============================================================================

/** buildTemplateTools 依赖。resolveUserId/listExerciseIds 经 mcpTools 注入。 */
export interface TemplateToolDeps {
  client: DbClient;
  injectedUserId?: string;
  /** 用户解析（生产 = mcpTools.getUserIdFromContext；测试直调可注入桩）。 */
  resolveUserId: (opts: {
    explicitConfig?: unknown;
    injectedUserId?: string;
  }) => string;
  /** profile 双读（默认 UserRepository；测试替身注入）。 */
  loadProfile?: LoadPlanProfile;
}

const pickTemplateSchema = z
  .object({})
  .describe(
    "List the preset weekly training plan templates (read-only catalog). No parameters.",
  );

export function makePickTemplateTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "pick_template",
    description:
      "List the preset weekly plan templates: each entry carries key / name / audience / " +
      "split / tier_default / days_per_week range / required equipment face. Call " +
      "load_history FIRST — pick the template whose split matches select_split's " +
      "recommendation, whose equipment the user actually has, and whose audience matches " +
      "their training age. Then call instantiate_weekly_plan with the chosen key. " +
      "You choose the template; you never expand dosages or dates yourself.",
    schema: pickTemplateSchema,
    func: async () =>
      JSON.stringify({
        templates: templateCatalog(),
        usage:
          "选定模板键后调 instantiate_weekly_plan(template_key + 覆盖参数)；展开返回的 card " +
          "原样经 submit_weekly_plan 提交。未覆盖的字段自动从用户 profile 回填（器械面/性别/" +
          "训练龄/周频率/已登记伤病）。",
      }),
  });
}

/**
 * instantiate_weekly_plan 工具入参（宽松绑定层）。
 *
 * 枚举/边界刻意不在绑定层硬卡（z.enum 裸词风险 + 结构化回注优先）：
 * describe 承载模型可见性，深校验在 func 内经内核
 * InstantiateWeeklyPlanParamsSchema（.strict()）执行——未知键/坏值回注
 * INVALID_PARAMS。passthrough 保未知键进 func（typo 可被严格层点名）。
 */
export const InstantiateWeeklyPlanToolArgsSchema = z
  .object({
    template_key: z
      .string()
      .min(1)
      .max(64)
      .describe(
        "Template key from pick_template, e.g. t1-novice-fullbody-home.",
      ),
    tier: z
      .string()
      .optional()
      .describe(
        'Capacity tier for dosage lookup: "novice" | "intermediate". Omit = template ' +
          "tier_default. Rule of thumb: <6 months training age → novice.",
      ),
    days_per_week: z
      .number()
      .optional()
      .describe(
        "Integer 1-7 training days per week. Omit = user profile weekly_frequency_days, " +
          "else template default. Out-of-range values are clamped to the template's " +
          "[min, max] with an adjustment note.",
      ),
    week_offset: z
      .number()
      .optional()
      .describe(
        "Integer week offset from the current ISO week (-4..12): 0=this week (default), " +
          "1=next week, negative=backfill. Drives entry_date alignment AND weight progression.",
      ),
    equipment: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "Hard equipment face (EXERCISE_EQUIPMENT vocab: bodyweight/barbell/dumbbell/" +
          "kettlebell/cable/machine/band/bench/rack/pull_up_bar/stability_ball/" +
          "medicine_ball/foam_roller/weighted/other). REPLACES the profile default when " +
          'given (e.g. traveling → ["bodyweight"]). Slots with no primary/variant inside ' +
          "the face are dropped with an adjustment note.",
      ),
    sex: z
      .string()
      .optional()
      .describe(
        '"male" | "female" — biological sex for the double-progression upper-body step. ' +
          "Omit = profile basic_info.gender.",
      ),
    training_age_months: z
      .number()
      .optional()
      .describe(
        "Integer 0-720 months of training age (progression strategy input). Omit = " +
          "profile basic_info.training_age.",
      ),
    active_limitations: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Injured body parts from THIS conversation (free text, zh/en aliases ok: 膝盖/" +
          "lower_back/肩…). Union-merged with recorded profile injuries — passing [] does " +
          "NOT waive recorded ones.",
      ),
  })
  .passthrough()
  .describe(
    "Programmatically expand a preset weekly plan template: dates, dosages, weight " +
      "progression and the apply payload are ALL computed server-side — never do this " +
      "arithmetic yourself.",
  );

/** 工具回注的结构化错误（Agent 读 JSON 修正参数后重调 = 二级弹跳）。 */
interface InstantiateToolError {
  ok: false;
  code: "UNKNOWN_TEMPLATE" | "INVALID_PARAMS" | "INTERNAL";
  message: string;
  errors?: Array<{ path: string; message: string }>;
  hint?: string;
}

export function makeInstantiateWeeklyPlanTool(
  deps: TemplateToolDeps,
): DynamicStructuredTool {
  const loadProfile: LoadPlanProfile =
    deps.loadProfile ??
    ((userId) => loadProfileViaRepository(deps.client, userId));

  return new DynamicStructuredTool({
    name: "instantiate_weekly_plan",
    description:
      "Expand a preset weekly plan template into a full week card (all dates/dosages/" +
      "progression computed server-side; omit params to auto-fill from the user profile " +
      "— equipment/sex/training age/weekly frequency/recorded injuries are union-merged). " +
      "Relay the returned card VERBATIM via submit_weekly_plan (card field) — never rewrite " +
      "dosages, dates or exercise ids. ok:false → fix the listed fields and retry.",
    schema: InstantiateWeeklyPlanToolArgsSchema,
    func: async (input, _runManager, config) => {
      try {
        const { template_key, ...explicit } = input as Record<string, unknown>;

        // profile 缺省读取（容错：无用户上下文/读取失败 = 空缺省，绝不让画像
        // 旁路读失败炸掉实例化——显式参数仍可完整展开）
        let defaults: ProfilePlanDefaults = {};
        try {
          const userId = deps.resolveUserId({
            explicitConfig: config,
            injectedUserId: deps.injectedUserId,
          });
          const profile = await loadProfile(userId);
          defaults = extractProfilePlanDefaults(
            profile?.static,
            profile?.dynamic,
          );
        } catch {
          // 测试直调（无用户上下文）或画像读取失败——走空缺省。
        }

        const { params, applied } = mergeProfilePlanDefaults(
          explicit,
          defaults,
        );

        // 模板键存在性先行（精确错误码 + 可用键清单，供 Agent 自纠）
        const catalogKeys = templateCatalog().map((c) => c.key);
        if (
          typeof template_key !== "string" ||
          !catalogKeys.includes(template_key)
        ) {
          const err: InstantiateToolError = {
            ok: false,
            code: "UNKNOWN_TEMPLATE",
            message: `未知模板键 ${JSON.stringify(template_key)}`,
            hint: `可用键：${catalogKeys.join(", ")}（经 pick_template 获取）`,
          };
          return JSON.stringify(err);
        }

        const instantiation = instantiateWeeklyPlan(template_key, params);
        return JSON.stringify({
          ...instantiation,
          profile_defaults_applied: applied,
        });
      } catch (err) {
        // 内核 zod 严格校验失败 → 参数问题清单回注（含未知键点名）
        if (err instanceof z.ZodError) {
          const e: InstantiateToolError = {
            ok: false,
            code: "INVALID_PARAMS",
            message:
              "实例化参数未过契约校验（严格 schema：未知键/越界值/坏枚举均拒绝）",
            errors: err.issues.map((i) => ({
              path: i.path.join(".") || "<root>",
              message: i.message,
            })),
          };
          return JSON.stringify(e);
        }
        console.error("[instantiate_weekly_plan] unexpected error:", err);
        return JSON.stringify({
          ok: false,
          code: "INTERNAL",
          message: "实例化内核内部错误，请稍后重试同一调用。",
        } satisfies InstantiateToolError);
      }
    },
  });
}

/** 模板工具集（pick_template + instantiate_weekly_plan；mcpTools 组装）。 */
export function buildTemplateTools(
  deps: TemplateToolDeps,
): DynamicStructuredTool[] {
  return [makePickTemplateTool(), makeInstantiateWeeklyPlanTool(deps)];
}

// ============================================================================
// #136 L1 启动期报损对拍（once 工厂经 mcpTools 注入全集读取）
// ============================================================================

/** 对拍全部模板 exercise_id ↔ 动作库全集。miss 非空时显式 console.error。 */
export async function auditWeeklyPlanTemplates(
  listExerciseIds: () => Promise<Set<string>>,
): Promise<Array<{ key: string; misses: string[] }>> {
  const universe = await listExerciseIds();
  const report = auditTemplateExerciseIds(universe);
  if (report.length > 0) {
    console.error(
      "[L1][weekly-plan 模板] exercise_id 报损（模板引用了动作库中不存在的 id——实例化产物" +
        "将被 L2 submit 闸门拦截；请修模板 JSON 或回填动作库）：",
      JSON.stringify(report),
    );
  }
  return report;
}

/**
 * 进程内一次性 L1 对拍（DeepAgentService.assembleAgent 调用；fire-and-forget
 * 不阻断组装）。失败也置位不重试——动作库读取故障由 L2 运行期闸门兜底，
 * 不值得每次 agent 重建（flag 翻转）都重打全库扫描。
 */
export function createTemplateIdAuditOnce(
  listExerciseIds: () => Promise<Set<string>>,
): () => Promise<Array<{ key: string; misses: string[] }>> {
  let once: Promise<Array<{ key: string; misses: string[] }>> | null = null;
  return () => {
    once ??= auditWeeklyPlanTemplates(listExerciseIds).catch((err) => {
      console.error(
        "[L1][weekly-plan 模板] 启动期 id 对拍不可用（动作库读取失败，跳过；L2 submit 闸门仍在）：",
        err,
      );
      return [];
    });
    return once;
  };
}
