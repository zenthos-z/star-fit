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
} from "shared/contracts";

import { loosenJsonSchemaForBinding } from "./cardSubmit.js";

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
