/**
 * 预制周计划模板内核（#151 S3 / #136 L1）— 模板契约真源 + 加载 + id 校验。
 *
 * 职责边界（spec #151 §5）：
 *  - 模板 = 结构与剂量骨架：动作槽位引用真实库 id（主选 + 器械替代位），
 *    剂量按 tier ∈ {novice, intermediate} 参数化查表；
 *  - zod Schema 是模板 JSON 的唯一校验真源；weekly-plan-template.schema.json
 *    由 z.toJSONSchema 派生（宽松化），构建期对拍防漂移——运行期校验只走 zod；
 *  - L1（#136 第一层）：模板加载期做 exercise_id 存在性校验——启动期对拍
 *    动作库全集，miss 即显式报损（模板 JSON 里不允许存在伪造 id 的可能）；
 *  - 实例化展开（日期对齐/器械替换/伤病过滤/周次递进）见 instantiateWeeklyPlan
 *    （同文件下半部）——算术全部在程序层，Agent 零算术（CLAUDE.md 红线）。
 *
 * 存储：backend/src/services/mas/templates/weekly-plans/*.json；
 * 经 tsconfig resolveJsonModule 静态 import（构建产物内联，Docker 零拷贝面）。
 *
 * @created 2026-10-08（S3 模板批）
 */

import { z } from "zod";

import {
  ExerciseEquipmentSchema,
  WeeklyPlanSplitSchema,
  getIsoWeekId,
  type WeeklyPlanCardData,
} from "shared/contracts";

import { loosenJsonSchemaForBinding } from "./cardSubmit.js";
import {
  nextDoubleProgressionWeight,
  nextLinearProgressionWeight,
  selectProgressionStrategy,
  type BiologicalSex,
  type LimbZone,
  type ProgressionStrategy,
} from "../schedule/progressionPolicy.js";
import { WeeklyPlanCardDataSchema } from "./schemas/uiHintSchemas.js";

// 静态 import（构建期内联；zod 解析在 loadWeeklyPlanTemplates 运行时执行；
// NodeNext 模块约定 JSON import 需显式 type 属性）
import t1Json from "../mas/templates/weekly-plans/t1-novice-fullbody-home.json" with { type: "json" };
import t2Json from "../mas/templates/weekly-plans/t2-novice-fullbody-gym.json" with { type: "json" };
import t3Json from "../mas/templates/weekly-plans/t3-int-upper-lower.json" with { type: "json" };
import t4Json from "../mas/templates/weekly-plans/t4-int-ppl.json" with { type: "json" };

// ============================================================================
// 模板契约（zod 真源）
// ============================================================================

/** 模板文件 schema 版本（结构不兼容变更时递增）。 */
export const TEMPLATE_SCHEMA_VERSION = 1;

/** 容量档位：组数/次数/RPE 锚查表的键。 */
export const TEMPLATE_TIERS = ["novice", "intermediate"] as const;
export type TemplateTier = (typeof TEMPLATE_TIERS)[number];

/** 训练日部位禁区 token（与 profile active_limitations 经 kernel 别名归一后对拍）。 */
export const TEMPLATE_INJURY_PARTS = [
  "knee",
  "lower_back",
  "shoulder",
  "wrist",
  "elbow",
  "ankle",
] as const;
export type TemplateInjuryPart = (typeof TEMPLATE_INJURY_PARTS)[number];

/**
 * 剂量档：单动作在某 tier 下的处方锚。
 *  - reps_min/reps_max：次数区间（逐组展开取中值，见 expandSlotDosage）
 *  - rpe_min/rpe_max：RPE 区间（逐组线性递增，0.5 步进取整）
 *  - start_weight_kg：该 tier 的起始重量锚；null = 自重/计时类（不处方重量、
 *    不做周次递进——progressionPolicy 的 weight 链只对有重量锚的槽位生效）
 *  - duration_seconds：metric="duration" 时替代 reps 的计时处方
 */
export const TemplateDosageSchema = z
  .object({
    sets: z.number().int().min(1).max(8),
    reps_min: z.number().int().positive().max(50).optional(),
    reps_max: z.number().int().positive().max(50).optional(),
    rpe_min: z.number().min(0).max(10),
    rpe_max: z.number().min(0).max(10),
    start_weight_kg: z.number().positive().nullable().default(null),
    duration_seconds: z.number().int().positive().max(600).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.reps_min === undefined && d.duration_seconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "剂量必须携带 reps_min（metric=reps）或 duration_seconds（metric=duration）",
        path: ["reps_min"],
      });
      return;
    }
    if (d.reps_min !== undefined && d.reps_max === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "携带 reps_min 时必须同时携带 reps_max（区间语义）",
        path: ["reps_max"],
      });
    }
    if (
      d.reps_min !== undefined &&
      d.reps_max !== undefined &&
      d.reps_min > d.reps_max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `reps_min (${d.reps_min}) 不能大于 reps_max (${d.reps_max})`,
        path: ["reps_min"],
      });
    }
    if (d.rpe_min > d.rpe_max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rpe_min (${d.rpe_min}) 不能大于 rpe_max (${d.rpe_max})`,
        path: ["rpe_min"],
      });
    }
  });

export type TemplateDosage = z.infer<typeof TemplateDosageSchema>;

/**
 * 器械替代位 / 伤病替代位：主选不可用（器械约束 / 伤病禁区）时的替补。
 * 剂量继承所属槽位（sets/reps/rpe 同槽位查表），仅覆盖动作 id/器械/重量锚。
 */
export const TemplateVariantSchema = z.object({
  exercise_id: z.string().min(12).max(24), // NanoID（对齐 exercises.id）
  name_zh: z.string().min(1),
  equipment: ExerciseEquipmentSchema,
  start_weight_kg: z.number().positive().nullable().default(null),
});

export type TemplateVariant = z.infer<typeof TemplateVariantSchema>;

/**
 * 动作槽位。tier 剂量查表全档必填（warmup/cooldown 两档同值——统一代码路径，
 * 不为段位开特例）。
 *  - limb_zone：周次递进步长分区（progressionPolicy doubleProgressionStepKg
 *    的 upper/lower）；null = 不参与重量递进（自重/拉伸/计时）
 *  - contraindicated_parts：伤病禁区 token；命中 → injury_substitute 替换，
 *    无替补则删槽（adjustments 记录）
 *  - metric：reps（默认）/ duration（计时类，apply 面不落 sets）
 */
export const TemplateSlotSchema = z.object({
  exercise_id: z.string().min(12).max(24),
  name_zh: z.string().min(1),
  equipment: ExerciseEquipmentSchema,
  limb_zone: z.enum(["upper", "lower"]).nullable().default(null),
  metric: z.enum(["reps", "duration"]).default("reps"),
  note: z.string().optional(),
  contraindicated_parts: z.array(z.enum(TEMPLATE_INJURY_PARTS)).default([]),
  injury_substitute: TemplateVariantSchema.optional(),
  variants: z.array(TemplateVariantSchema).default([]),
  dosage: z
    .record(z.enum(TEMPLATE_TIERS), TemplateDosageSchema)
    .refine((d) => TEMPLATE_TIERS.every((t) => d[t] !== undefined), {
      message: `剂量查表必须覆盖全部档位：${TEMPLATE_TIERS.join("/")}`,
    }),
});

export type TemplateSlot = z.infer<typeof TemplateSlotSchema>;

/** 模板训练日：offset = 相对周一的天偏移（0=周一…6=周日）；rank = 天数裁剪序。 */
export const TemplateDaySchema = z.object({
  rank: z.number().int().positive(),
  offset: z.number().int().min(0).max(6),
  label: z.string().min(1),
  focus: z.string().optional(),
  rationale: z.string().optional(),
  warmup: z.array(TemplateSlotSchema).default([]),
  main: z.array(TemplateSlotSchema).min(1),
  cooldown: z.array(TemplateSlotSchema).default([]),
});

export type TemplateDay = z.infer<typeof TemplateDaySchema>;

/** 模板顶层契约（weekly-plan-template.schema.json 的 zod 真源）。 */
export const WeeklyPlanTemplateSchema = z
  .object({
    schema_version: z.literal(TEMPLATE_SCHEMA_VERSION),
    key: z.string().regex(/^t\d-[a-z0-9-]+$/, "模板键格式 t{n}-{kebab-case}"),
    name_zh: z.string().min(1),
    audience_zh: z.string().min(1),
    description_zh: z.string().optional(),
    split: WeeklyPlanSplitSchema, // 模板集只覆盖 full_body/upper_lower/push_pull_legs
    tier_default: z.enum(TEMPLATE_TIERS),
    days_per_week: z
      .object({
        min: z.number().int().min(1).max(7),
        max: z.number().int().min(1).max(7),
        default: z.number().int().min(1).max(7),
      })
      .superRefine((d, ctx) => {
        if (d.min > d.max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `days_per_week.min (${d.min}) 不能大于 max (${d.max})`,
            path: ["min"],
          });
        }
        if (d.default < d.min || d.default > d.max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `days_per_week.default (${d.default}) 必须落在 [min, max] 内`,
            path: ["default"],
          });
        }
      }),
    default_equipment: z.array(ExerciseEquipmentSchema).min(1),
    days: z.array(TemplateDaySchema).min(1),
  })
  .superRefine((t, ctx) => {
    // 天数骨架一致性：days 数量 ≥ max；rank 恰为 1..N 连续（天数裁剪按 rank 取前 K 天）
    if (t.days.length < t.days_per_week.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `days 数量 (${t.days.length}) 必须覆盖 days_per_week.max (${t.days_per_week.max})`,
        path: ["days"],
      });
    }
    const ranks = t.days.map((d) => d.rank).sort((a, b) => a - b);
    const expected = Array.from({ length: t.days.length }, (_, i) => i + 1);
    if (ranks.some((r, i) => r !== expected[i])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `day.rank 必须为 1..${t.days.length} 连续编号（当前: ${ranks.join(",")}）`,
        path: ["days"],
      });
    }
    // 同模板内 offset 不重复（一周内每天占一个日历位）
    const offsets = new Set<number>();
    for (const d of t.days) {
      if (offsets.has(d.offset)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `day.offset ${d.offset} 在模板内重复（每天必须占独立日历位）`,
          path: ["days"],
        });
      }
      offsets.add(d.offset);
    }
  });

export type WeeklyPlanTemplate = z.infer<typeof WeeklyPlanTemplateSchema>;

// ============================================================================
// 加载（zod 解析 + 显式报损）
// ============================================================================

const TEMPLATE_FILES: ReadonlyArray<{ key: string; json: unknown }> = [
  { key: "t1-novice-fullbody-home", json: t1Json },
  { key: "t2-novice-fullbody-gym", json: t2Json },
  { key: "t3-int-upper-lower", json: t3Json },
  { key: "t4-int-ppl", json: t4Json },
];

/**
 * 解析全部模板 JSON。zod 失败即抛（红线：不静默）——模板是构建资产，
 * 损坏模板在加载期显式炸出，错误信息携带 key 定位文件。
 */
export function parseWeeklyPlanTemplates(
  files: ReadonlyArray<{ key: string; json: unknown }> = TEMPLATE_FILES,
): WeeklyPlanTemplate[] {
  return files.map(({ key, json }) => {
    const parsed = WeeklyPlanTemplateSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      throw new Error(
        `weekly-plan 模板 ${key} 契约校验失败（weekly-plan-template.schema 真源对拍）: ${issues}`,
      );
    }
    if (parsed.data.key !== key) {
      throw new Error(
        `weekly-plan 模板文件名 key (${key}) 与 JSON 内 key (${parsed.data.key}) 不一致`,
      );
    }
    return parsed.data;
  });
}

/** 全量模板（模块级缓存：静态 import 的 JSON 不可变，解析一次即可）。 */
let cachedTemplates: WeeklyPlanTemplate[] | null = null;

export function loadWeeklyPlanTemplates(): WeeklyPlanTemplate[] {
  cachedTemplates ??= parseWeeklyPlanTemplates();
  return cachedTemplates;
}

/** 按键取模板；未知键抛错（工具层转结构化错误给 Agent）。 */
export function getWeeklyPlanTemplate(key: string): WeeklyPlanTemplate {
  const t = loadWeeklyPlanTemplates().find((t) => t.key === key);
  if (!t) {
    throw new Error(
      `未知模板键 ${key}（可用: ${loadWeeklyPlanTemplates()
        .map((t) => t.key)
        .join(", ")}）`,
    );
  }
  return t;
}

// ============================================================================
// #136 L1：exercise_id 全收集 + 存在性校验
// ============================================================================

/** 收集单个槽位引用的全部动作 id（主选 + 器械替代 + 伤病替代）。 */
export function collectSlotExerciseIds(slot: TemplateSlot): string[] {
  return [
    slot.exercise_id,
    ...slot.variants.map((v) => v.exercise_id),
    ...(slot.injury_substitute ? [slot.injury_substitute.exercise_id] : []),
  ];
}

/** 收集整模板全部动作 id（去重不排序——报损清单保留出现序便于定位）。 */
export function collectTemplateExerciseIds(
  template: WeeklyPlanTemplate,
): string[] {
  const seen = new Set<string>();
  for (const day of template.days) {
    for (const slot of [...day.warmup, ...day.main, ...day.cooldown]) {
      for (const id of collectSlotExerciseIds(slot)) seen.add(id);
    }
  }
  return [...seen];
}

/** 单模板 L1 校验：返回 miss 清单（空 = 全部在库）。 */
export function validateTemplateIds(
  template: WeeklyPlanTemplate,
  universe: ReadonlySet<string>,
): string[] {
  return collectTemplateExerciseIds(template).filter((id) => !universe.has(id));
}

/**
 * 全量模板 L1 报损检查（启动期 / CI 对拍入口）。
 *
 * 返回逐模板 miss 清单；miss 非空时由调用方决定处置——Agent 组装路径
 * （buildTemplateTools）选择 console.error 显式报损并继续（模板退场回退
 * Agent 自由生成，spec R6 回滚语义），CI 路径直接 fail。
 */
export function auditTemplateExerciseIds(
  universe: ReadonlySet<string>,
  templates: WeeklyPlanTemplate[] = loadWeeklyPlanTemplates(),
): { key: string; misses: string[] }[] {
  return templates
    .map((t) => ({ key: t.key, misses: validateTemplateIds(t, universe) }))
    .filter((r) => r.misses.length > 0);
}

// ============================================================================
// JSON Schema 派生（zod 真源 → weekly-plan-template.schema.json 对拍）
// ============================================================================

/**
 * 派生模板 JSON Schema（宽松化，与 cardSubmit 同语义）。
 * committed weekly-plan-template.schema.json 必须与本函数输出逐字节一致
 * （drift 测试守门）；运行期校验只走 zod（真源），schema 仅作文档/对拍资产。
 */
export function deriveTemplateJsonSchema(): Record<string, unknown> {
  return loosenJsonSchemaForBinding(
    z.toJSONSchema(WeeklyPlanTemplateSchema, { io: "input" }),
  ) as Record<string, unknown>;
}

// ============================================================================
// 目录（pick_template 工具的载荷；Agent 只做选择，不展开）
// ============================================================================

/** 模板目录条目：Agent 选模板所需的全部决策面（不含剂量细节）。 */
export type TemplateCatalogEntry = {
  key: string;
  name_zh: string;
  audience_zh: string;
  description_zh?: string;
  split: string;
  tier_default: string;
  days_per_week: { min: number; max: number; default: number };
  equipment: string[];
};

export function templateCatalog(): TemplateCatalogEntry[] {
  return loadWeeklyPlanTemplates().map((t) => ({
    key: t.key,
    name_zh: t.name_zh,
    audience_zh: t.audience_zh,
    ...(t.description_zh ? { description_zh: t.description_zh } : {}),
    split: t.split,
    tier_default: t.tier_default,
    days_per_week: t.days_per_week,
    equipment: t.default_equipment,
  }));
}

// 测试隔离钩子（jest/tsx 重置模块级缓存用）
export function __resetTemplateCacheForTests(): void {
  cachedTemplates = null;
}

// ============================================================================
// 实例化内核（spec §5.2 参数化维度——Agent 只选参数，算术全在本层）
// ============================================================================

/**
 * 伤病部位别名归一表：profile active_limitations.part 的常见中文/英文原值
 * → 模板禁区 token。未命中别名的部位不影响展开（adjustments 记录原值）。
 */
const INJURY_PART_ALIASES: Readonly<Record<string, TemplateInjuryPart>> = {
  knee: "knee",
  膝盖: "knee",
  膝: "knee",
  膝关节: "knee",
  lower_back: "lower_back",
  下背: "lower_back",
  下腰部: "lower_back",
  腰: "lower_back",
  腰部: "lower_back",
  shoulder: "shoulder",
  肩: "shoulder",
  肩膀: "shoulder",
  肩关节: "shoulder",
  wrist: "wrist",
  手腕: "wrist",
  腕: "wrist",
  腕关节: "wrist",
  elbow: "elbow",
  肘: "elbow",
  肘部: "elbow",
  肘关节: "elbow",
  ankle: "ankle",
  脚踝: "ankle",
  踝: "ankle",
  踝关节: "ankle",
};

/** 实例化参数（Agent 只做选择：档位/天数/器械面/伤病；日历与剂量全在内核算）。 */
export const InstantiateWeeklyPlanParamsSchema = z
  .object({
    tier: z.enum(TEMPLATE_TIERS).optional(),
    days_per_week: z.number().int().min(1).max(7).optional(),
    /** 相对本周的周偏移：0=本周（默认），1=下周……负值用于补排过去周。 */
    week_offset: z.number().int().min(-4).max(12).default(0),
    /** 器械面硬约束（EXERCISE_EQUIPMENT 值）；缺省 = 模板 default_equipment。 */
    equipment: z.array(ExerciseEquipmentSchema).min(1).optional(),
    /** 加重步进性别修正（progressionPolicy doubleProgressionStepKg）。 */
    sex: z.enum(["male", "female"]).optional(),
    /** 训练年龄（月）——递进策略选择输入；缺省按 tier 取代表值。 */
    training_age_months: z.number().int().min(0).max(720).optional(),
    /** 活动伤病部位（active_limitations.part 原值，中英文别名归一）。 */
    active_limitations: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type InstantiateWeeklyPlanParams = z.infer<
  typeof InstantiateWeeklyPlanParamsSchema
>;

/** 实例化结果：程序化展开完毕的整周卡（Agent 原样经 submit_weekly_plan 提交）。 */
export interface WeeklyPlanInstantiation {
  ok: true;
  template_key: string;
  week_id: string;
  split: string;
  tier: TemplateTier;
  days_per_week: number;
  /** 展开期间的显式改写记录（器械替换/伤病替换/删槽/天数裁剪）。 */
  adjustments: string[];
  /** 递进策略（Agent 可原样转述 rationale，不自行推演）。 */
  progression: { strategy: ProgressionStrategy; rationale: string };
  /** 完整 weekly_plan 卡数据（已过 WeeklyPlanCardDataSchema 自检）。 */
  card: WeeklyPlanCardData;
}

// ---------------------------------------------------------------------------
// 周历算术（内核内部；Agent 侧零日历算术——apply payload 服务器推导惯例同源）
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** ISO 周 id（YYYY-Www）→ 该周周一的 UTC Date。 */
function isoWeekMonday(weekId: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) throw new Error(`isoWeekMonday: week_id 非法（当前: ${weekId}）`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  // 周四规则逆推：1 月 4 日恒在本年第 1 周；回退到该周周一
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // 周日=7
  const week1Monday = jan4.getTime() - (jan4Day - 1) * DAY_MS;
  return new Date(week1Monday + (week - 1) * 7 * DAY_MS);
}

/** UTC Date → YYYY-MM-DD。 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 剂量展开（纯算术：次数中值 / RPE 线性爬坡 0.5 步进 / 周次递进链）
// ---------------------------------------------------------------------------

/** RPE 0.5 步进取整。 */
function roundHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

/** 组间 RPE 线性爬坡：min → max 均分到 N 组（单组 = min）。 */
function rpeRamp(min: number, max: number, sets: number): number[] {
  if (sets <= 1) return [roundHalf(min)];
  return Array.from({ length: sets }, (_, i) =>
    roundHalf(min + ((max - min) * i) / (sets - 1)),
  );
}

/** 周次递进链：起始锚 → 应用 weekIndex 次加重步进（progressionPolicy 纯函数）。 */
function progressWeight(
  startWeightKg: number,
  weekIndex: number,
  strategy: ProgressionStrategy,
  limbZone: LimbZone,
  sex: BiologicalSex,
): number {
  let w = startWeightKg;
  for (let i = 0; i < Math.max(0, weekIndex); i++) {
    w =
      strategy === "linear"
        ? nextLinearProgressionWeight(w, limbZone)
        : nextDoubleProgressionWeight(w, limbZone, sex);
  }
  return w;
}

// ---------------------------------------------------------------------------
// 槽位解析（器械硬约束 + 伤病禁区）
// ---------------------------------------------------------------------------

interface ResolvedSlot {
  /** 命中动作（dropped 时为 null）。 */
  exerciseId: string | null;
  name: string;
  /** 重量锚（主选/替代位各自的 start_weight_kg；null = 自重不处方）。 */
  weightAnchor: number | null;
  kind: "primary" | "variant" | "injury_substitute" | "dropped";
  /** 器械面可用集合（bodyweight 恒可用）。 */
  note?: string;
}

function equipmentAllowed(
  equipment: string,
  allowed: ReadonlySet<string>,
): boolean {
  return equipment === "bodyweight" || allowed.has(equipment);
}

function resolveSlot(
  slot: TemplateSlot,
  allowed: ReadonlySet<string>,
  injuryParts: ReadonlySet<TemplateInjuryPart>,
): ResolvedSlot {
  // 1) 伤病禁区优先于器械（伤替动作本身也要过器械面）
  const hits = slot.contraindicated_parts.filter((p) => injuryParts.has(p));
  if (hits.length > 0) {
    const sub = slot.injury_substitute;
    if (sub && equipmentAllowed(sub.equipment, allowed)) {
      return {
        exerciseId: sub.exercise_id,
        name: sub.name_zh,
        weightAnchor: sub.start_weight_kg,
        kind: "injury_substitute",
        note: `伤病禁区（${hits.join("/")}）：${slot.name_zh} → ${sub.name_zh}`,
      };
    }
    return {
      exerciseId: null,
      name: slot.name_zh,
      weightAnchor: null,
      kind: "dropped",
      note: `伤病禁区（${hits.join("/")}）：${slot.name_zh} 无可用替代，已删除`,
    };
  }
  // 2) 器械面：主选 → 按序变体 → 删槽
  if (equipmentAllowed(slot.equipment, allowed)) {
    // 主选的重量锚按 tier 查剂量表（调用方取 dosage[tier].start_weight_kg）；
    // 此处 weightAnchor 仅承载替代位的单值锚。
    return {
      exerciseId: slot.exercise_id,
      name: slot.name_zh,
      weightAnchor: null,
      kind: "primary",
    };
  }
  for (const v of slot.variants) {
    if (equipmentAllowed(v.equipment, allowed)) {
      return {
        exerciseId: v.exercise_id,
        name: v.name_zh,
        weightAnchor: v.start_weight_kg,
        kind: "variant",
        note: `器械约束（${slot.equipment} 不可用）：${slot.name_zh} → ${v.name_zh}`,
      };
    }
  }
  return {
    exerciseId: null,
    name: slot.name_zh,
    weightAnchor: null,
    kind: "dropped",
    note: `器械约束（${slot.equipment} 不可用）：${slot.name_zh} 无可用替代，已删除`,
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 实例化周计划（spec §5.2 五个参数化维度全落位）：
 *  1. 日期对齐：week_offset → week_id（getIsoWeekId 单一真源）→ 周一 → entry_date
 *  2. 器械替换：equipment ∪ bodyweight 硬约束选支（主选→变体→删槽）
 *  3. 容量档位：tier 剂量查表（缺省 = 模板 tier_default）
 *  4. 伤病过滤：active_limitations 别名归一 → 禁区替换/删槽
 *  5. 周次递进：week_offset × progressionPolicy 步进链（只对有重量锚的主选生效）
 *
 * 产出过 WeeklyPlanCardDataSchema 自检（含 apply payload 跨字段校验）；
 * 返回值由 Agent 经 submit_weekly_plan 原样提交（S2 L2 闸门继续生效）。
 *
 * @param now 时钟注入（测试定值用；生产缺省系统时钟）
 */
export function instantiateWeeklyPlan(
  templateKey: string,
  rawParams: unknown,
  now: () => Date = () => new Date(),
): WeeklyPlanInstantiation {
  const template = getWeeklyPlanTemplate(templateKey); // 未知键显式抛错
  const params = InstantiateWeeklyPlanParamsSchema.parse(rawParams); // 非法参数显式抛错

  const adjustments: string[] = [];

  // ---- tier / 天数（越界回落 + 记录）----
  const tier: TemplateTier = params.tier ?? template.tier_default;
  const requestedDays = params.days_per_week ?? template.days_per_week.default;
  const clampedDays = Math.min(
    Math.max(requestedDays, template.days_per_week.min),
    template.days_per_week.max,
  );
  if (clampedDays !== requestedDays) {
    adjustments.push(
      `每周天数 ${requestedDays} 超出模板可调范围 [${template.days_per_week.min}, ${template.days_per_week.max}]，已回落为 ${clampedDays}`,
    );
  }

  // ---- 器械面（缺省 = 模板默认面）----
  const equipment = params.equipment ?? template.default_equipment;
  if (!params.equipment) {
    adjustments.push(`未指定器械面，按模板默认面展开：${equipment.join("/")}`);
  }
  const allowed = new Set(equipment);

  // ---- 伤病部位别名归一 ----
  const injuryParts = new Set<TemplateInjuryPart>();
  for (const raw of params.active_limitations ?? []) {
    const token =
      INJURY_PART_ALIASES[raw.trim()] ??
      INJURY_PART_ALIASES[raw.trim().toLowerCase()];
    if (token) injuryParts.add(token);
    else adjustments.push(`伤病部位「${raw}」未命中禁区映射，未参与过滤`);
  }

  // ---- 周历（Agent 零日历算术）----
  const anchorDate = toIsoDate(
    new Date(now().getTime() + params.week_offset * 7 * DAY_MS),
  );
  const weekId = getIsoWeekId(anchorDate);
  const monday = isoWeekMonday(weekId);

  // ---- 递进策略（progressionPolicy 决策表；tier → 经验等级代表值）----
  const fitnessLevel = tier === "novice" ? "beginner" : "intermediate";
  const trainingAge =
    params.training_age_months ?? (tier === "novice" ? 4 : 12);
  const sex: BiologicalSex = params.sex ?? "male";
  const strategyDecision = selectProgressionStrategy(
    fitnessLevel,
    trainingAge,
    false,
  );
  const strategy = strategyDecision.value;

  // ---- 天数裁剪（rank 升序取前 K 天）----
  const selected = [...template.days]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, clampedDays);
  for (const dropped of template.days
    .filter((d) => !selected.includes(d))
    .sort((a, b) => a.rank - b.rank)) {
    adjustments.push(
      `每周 ${clampedDays} 练：按裁剪序省略「${dropped.label}」（rank ${dropped.rank}）`,
    );
  }

  // ---- 逐日展开 ----
  type CardExercise = WeeklyPlanCardData["days"][number]["exercises"][number];
  type ApplyEntry = NonNullable<WeeklyPlanCardData["apply"]>["entries"][number];

  const dayCardById = new Map<string, WeeklyPlanCardData["days"][number]>();
  const applyEntries: ApplyEntry[] = [];

  for (const day of selected) {
    const entryDate = toIsoDate(
      new Date(monday.getTime() + day.offset * DAY_MS),
    );
    const exercises: CardExercise[] = [];
    let sortOrder = 0;

    for (const [category, slots] of [
      ["warmup", day.warmup],
      ["main", day.main],
      ["cooldown", day.cooldown],
    ] as const) {
      for (const slot of slots) {
        const resolved = resolveSlot(slot, allowed, injuryParts);
        if (resolved.note) adjustments.push(resolved.note);
        if (!resolved.exerciseId) continue; // dropped

        const dosage = slot.dosage[tier];
        // 重量：主选锚查 tier 档；替代位锚单值；无锚 = 自重不处方
        const anchor =
          resolved.kind === "primary"
            ? dosage.start_weight_kg
            : resolved.weightAnchor;
        const limbZone: LimbZone = slot.limb_zone ?? "upper";
        const weightKg =
          anchor != null && slot.metric === "reps"
            ? progressWeight(
                anchor,
                params.week_offset,
                strategy,
                limbZone,
                sex,
              )
            : null;

        // 展示面逐组（duration 类走 duration；reps 类 weight+reps）
        const rpes = rpeRamp(dosage.rpe_min, dosage.rpe_max, dosage.sets);
        // set_type 语义化：热身段标 warmup，其余默认 working（契约缺省值显式化）
        const setType =
          category === "warmup" ? ("warmup" as const) : ("working" as const);
        const sets: CardExercise["sets"] =
          slot.metric === "duration"
            ? Array.from({ length: dosage.sets }, (_, i) => ({
                set: i + 1,
                duration: dosage.duration_seconds,
                set_type: setType,
              }))
            : Array.from({ length: dosage.sets }, (_, i) => ({
                set: i + 1,
                ...(weightKg != null ? { weight: weightKg } : {}),
                reps: Math.round((dosage.reps_min! + dosage.reps_max!) / 2),
                set_type: setType,
              }));

        exercises.push({
          exercise_id: resolved.exerciseId,
          name: resolved.name,
          sets,
          ...(slot.note ? { note: slot.note } : {}),
          category,
        });

        // 落库面（PlanEntryInput；duration 类不落逐组处方——reps 语义不适用）
        const targetLoad = {
          type: "rpe" as const,
          min: dosage.rpe_min,
          max: dosage.rpe_max,
        };
        applyEntries.push({
          entry_date: entryDate,
          exercise_id: resolved.exerciseId,
          target_sets: dosage.sets,
          target_load: targetLoad,
          status: "planned" as const,
          sort_order: sortOrder++,
          day_focus: day.focus,
          ...(day.rationale ? { rationale: day.rationale } : {}),
          category,
          ...(slot.metric === "reps"
            ? {
                sets: Array.from({ length: dosage.sets }, (_, i) => ({
                  set_no: i + 1,
                  ...(weightKg != null ? { weight_kg: weightKg } : {}),
                  reps: Math.round((dosage.reps_min! + dosage.reps_max!) / 2),
                  rpe: rpes[i],
                })),
              }
            : {}),
        });
      }
    }

    dayCardById.set(entryDate, {
      entry_date: entryDate,
      split_label: day.label,
      ...(day.focus ? { focus: day.focus } : {}),
      ...(day.rationale ? { rationale: day.rationale } : {}),
      rest: false,
      exercises,
    });
  }

  // ---- 补齐休息日（整周 7 天视图）----
  const days: WeeklyPlanCardData["days"] = Array.from({ length: 7 }, (_, i) => {
    const entryDate = toIsoDate(new Date(monday.getTime() + i * DAY_MS));
    return (
      dayCardById.get(entryDate) ?? {
        entry_date: entryDate,
        rest: true,
        focus: "休息日 · 恢复",
        exercises: [],
      }
    );
  });

  // ---- 组装 + 契约自检（WeeklyPlanCardDataSchema 含 apply 跨字段校验）----
  const tierLabel = tier === "novice" ? "新手档" : "进阶档";
  const card = WeeklyPlanCardDataSchema.parse({
    week_label: `${weekId} 训练周`,
    phase_label: template.name_zh,
    split_summary: `${template.name_zh} · 每周 ${clampedDays} 练 · ${tierLabel}`,
    days,
    apply: {
      week_id: weekId,
      scope: "week",
      split: template.split,
      dates: [], // scope=week 时忽略（契约缺省值显式化）
      entries: applyEntries,
    },
  } satisfies WeeklyPlanCardData) as WeeklyPlanCardData;

  return {
    ok: true,
    template_key: template.key,
    week_id: weekId,
    split: template.split,
    tier,
    days_per_week: clampedDays,
    adjustments,
    progression: {
      strategy,
      rationale: strategyDecision.rationale,
    },
    card,
  };
}
