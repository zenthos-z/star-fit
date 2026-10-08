/**
 * planTemplates 内核单测（#151 S3 / #136 L1）— 模板契约 + 加载 + id 校验。
 *
 * 覆盖四块（任务书验收门「模板单测：全参数维度零 miss」的契约层）：
 *  1. 契约加载：4 模板全过 zod 真源（rank 连续 / offset 唯一 / 天数骨架一致）；
 *  2. L1 id 校验：主选 + 器械替代 + 伤病替代全收集；伪造 id 抽走 → 报损显式；
 *  3. schema.json 对拍：committed 文件与 deriveTemplateJsonSchema() 逐键一致
 *     （防 zod 真源与文档资产漂移——S2 deriveCardSubmitJsonSchemas 同款门）；
 *  4. 契约负例：破损模板（rank 断档 / 剂量缺档 / reps 区间倒置 / 文件名错键）
 *     → 加载期显式抛错（红线：不静默）。
 *
 * Runner: jest（tests/unit/**，npm run test:unit 计入）。
 * 真实 PG 全量对拍（exercises 表 → 零 miss 实测）在 tsx live 测试
 * src/services/agent/__tests__/planTemplatesLive.test.ts。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "@jest/globals";

import {
  TEMPLATE_TIERS,
  WeeklyPlanTemplateSchema,
  __resetTemplateCacheForTests,
  auditTemplateExerciseIds,
  collectSlotExerciseIds,
  collectTemplateExerciseIds,
  deriveTemplateJsonSchema,
  getWeeklyPlanTemplate,
  loadWeeklyPlanTemplates,
  parseWeeklyPlanTemplates,
  templateCatalog,
  validateTemplateIds,
  type TemplateSlot,
  type WeeklyPlanTemplate,
} from "../../../../src/services/agent/planTemplates.js";

// committed schema.json（drift 对拍用；tests/unit/services/agent → backend 根四跳）
const SCHEMA_JSON_PATH = path.resolve(
  __dirname,
  "../../../../src/services/mas/templates/weekly-plans/weekly-plan-template.schema.json",
);

/** 最小合法剂量（负例构造的基底）。 */
const dosage = (over: Record<string, unknown> = {}) => ({
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rpe_min: 6,
  rpe_max: 7.5,
  start_weight_kg: 10,
  ...over,
});

/** 双档剂量查表。 */
const tierDosage = (over: Record<string, unknown> = {}) => ({
  novice: dosage(over),
  intermediate: dosage(over),
});

/** 最小合法槽位（负例构造的基底）。 */
const slot = (over: Record<string, unknown> = {}): TemplateSlot =>
  ({
    exercise_id: "fake-ex-000000001",
    name_zh: "测试动作",
    equipment: "dumbbell",
    limb_zone: "upper",
    metric: "reps",
    contraindicated_parts: [],
    variants: [],
    dosage: tierDosage(),
    ...over,
  }) as TemplateSlot;

/** 最小合法模板基底（负例构造用）。 */
const baseTemplate = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schema_version: 1,
  key: "t9-fixture-template",
  name_zh: "测试模板",
  audience_zh: "测试人群",
  split: "full_body",
  tier_default: "novice",
  days_per_week: { min: 2, max: 2, default: 2 },
  default_equipment: ["dumbbell", "bodyweight"],
  days: [
    {
      rank: 1,
      offset: 0,
      label: "A",
      main: [slot()],
    },
    {
      rank: 2,
      offset: 2,
      label: "B",
      main: [slot()],
    },
  ],
  ...over,
});

beforeEach(() => {
  __resetTemplateCacheForTests();
});

// ---------------------------------------------------------------------------
// 1. 契约加载（4 模板真源对拍）
// ---------------------------------------------------------------------------

describe("loadWeeklyPlanTemplates — 4 模板全过 zod 契约", () => {
  it("模板键与 spec §5.1 模板集一一对应", () => {
    expect(loadWeeklyPlanTemplates().map((t) => t.key)).toEqual([
      "t1-novice-fullbody-home",
      "t2-novice-fullbody-gym",
      "t3-int-upper-lower",
      "t4-int-ppl",
    ]);
  });

  it("分化与天数骨架对齐 spec（T1/T2 full_body×3、T3 upper_lower×4、T4 ppl×6）", () => {
    const byKey = Object.fromEntries(
      loadWeeklyPlanTemplates().map((t) => [t.key, t]),
    ) as Record<string, WeeklyPlanTemplate>;
    expect(byKey["t1-novice-fullbody-home"].split).toBe("full_body");
    expect(byKey["t1-novice-fullbody-home"].days_per_week).toEqual({
      min: 2,
      max: 3,
      default: 3,
    });
    expect(byKey["t2-novice-fullbody-gym"].days_per_week).toEqual({
      min: 2,
      max: 3,
      default: 3,
    });
    expect(byKey["t3-int-upper-lower"].split).toBe("upper_lower");
    expect(byKey["t3-int-upper-lower"].days_per_week.max).toBe(4);
    expect(byKey["t4-int-ppl"].days).toHaveLength(6);
    expect(byKey["t4-int-ppl"].days_per_week).toEqual({
      min: 5,
      max: 6,
      default: 6,
    });
  });

  it("每模板 rank 恰为 1..N、offset 互异且 ≤6（天数裁剪的骨架前提）", () => {
    for (const t of loadWeeklyPlanTemplates()) {
      const ranks = t.days.map((d) => d.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(
        Array.from({ length: t.days.length }, (_, i) => i + 1),
      );
      expect(new Set(t.days.map((d) => d.offset)).size).toBe(t.days.length);
      for (const d of t.days) {
        expect(d.offset).toBeLessThanOrEqual(6);
        expect(d.main.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("全部槽位剂量查表覆盖双档（tier 参数化的查表完备性）", () => {
    for (const t of loadWeeklyPlanTemplates()) {
      for (const day of t.days) {
        for (const s of [...day.warmup, ...day.main, ...day.cooldown]) {
          for (const tier of TEMPLATE_TIERS) {
            expect(s.dosage[tier]).toBeDefined();
          }
        }
      }
    }
  });

  it("计时类槽位（metric=duration）不处方 reps，且无重量锚", () => {
    const durationSlots = loadWeeklyPlanTemplates().flatMap((t) =>
      t.days.flatMap((d) =>
        [...d.warmup, ...d.main, ...d.cooldown].filter(
          (s) => s.metric === "duration",
        ),
      ),
    );
    expect(durationSlots.length).toBeGreaterThan(0); // T1 平板支撑
    for (const s of durationSlots) {
      expect(s.dosage.novice.duration_seconds).toBeDefined();
      expect(s.dosage.novice.start_weight_kg).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. L1 id 收集与存在性校验（#136 第一层）
// ---------------------------------------------------------------------------

describe("collect/validate — L1 全收集 + 报损显式", () => {
  const t1 = () => getWeeklyPlanTemplate("t1-novice-fullbody-home");

  it("槽位收集覆盖主选 + 器械替代 + 伤病替代", () => {
    const s: TemplateSlot = {
      ...slot(),
      variants: [
        {
          exercise_id: "fake-variant-001",
          name_zh: "替代",
          equipment: "bodyweight",
          start_weight_kg: null,
        },
      ],
      injury_substitute: {
        exercise_id: "fake-injury-001",
        name_zh: "伤替",
        equipment: "machine",
        start_weight_kg: 20,
      },
    };
    expect(collectSlotExerciseIds(s).sort()).toEqual([
      "fake-ex-000000001",
      "fake-injury-001",
      "fake-variant-001",
    ]);
  });

  it("整模板收集去重（同一动作多处引用只计一次）", () => {
    const ids = collectTemplateExerciseIds(t1());
    expect(new Set(ids).size).toBe(ids.length);
    // 臀桥在 T1 内既是伤替又可能多处出现——收集面必须包含它
    expect(ids).toContain("a3vf4Tfqw3CHAGc-ND0bv");
  });

  it("全库全集 → 零 miss；抽走一个 id → 报损命中", () => {
    const t = t1();
    const all = new Set(collectTemplateExerciseIds(t));
    expect(validateTemplateIds(t, all)).toEqual([]);

    const probe = collectTemplateExerciseIds(t)[0];
    all.delete(probe);
    expect(validateTemplateIds(t, all)).toContain(probe);
  });

  it("auditTemplateExerciseIds 汇总逐模板报损（miss 为空的不出现在清单）", () => {
    const t = t1();
    const probe = collectTemplateExerciseIds(t)[0];
    const universe = new Set(collectTemplateExerciseIds(t));
    universe.delete(probe);
    const report = auditTemplateExerciseIds(universe, [t]);
    expect(report).toEqual([{ key: t.key, misses: [probe] }]);
  });

  it("getWeeklyPlanTemplate 未知键抛错（错误信息携带可用键清单）", () => {
    expect(() => getWeeklyPlanTemplate("t99-nope")).toThrow(
      /t1-novice-fullbody-home/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. schema.json 对拍（防漂移门）
// ---------------------------------------------------------------------------

describe("weekly-plan-template.schema.json — zod 派生对拍", () => {
  it("committed 文件与 deriveTemplateJsonSchema() 深比较一致（漂移即 fail）", () => {
    const committed = JSON.parse(readFileSync(SCHEMA_JSON_PATH, "utf-8"));
    expect(committed).toEqual(deriveTemplateJsonSchema());
  });

  it("派生 schema 宽松化：无 $schema / additionalProperties 残留", () => {
    const scan = (node: unknown): string | null => {
      if (Array.isArray(node)) {
        for (const n of node) {
          const hit = scan(n);
          if (hit) return hit;
        }
        return null;
      }
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$schema" || k === "additionalProperties") return k;
          const hit = scan(v);
          if (hit) return hit;
        }
      }
      return null;
    };
    expect(scan(deriveTemplateJsonSchema())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. 契约负例（破损模板显式炸出，不静默）
// ---------------------------------------------------------------------------

describe("parseWeeklyPlanTemplates — 破损模板负例", () => {
  const parseExpectThrow = (json: unknown, key = "t9-fixture-template") => {
    expect(() => parseWeeklyPlanTemplates([{ key, json }])).toThrow(
      /契约校验失败/,
    );
  };

  it("rank 断档（1,3 缺 2）→ 拒绝", () => {
    const t = baseTemplate();
    (t.days as Array<Record<string, unknown>>)[1].rank = 3;
    parseExpectThrow(t);
  });

  it("days 数量不足 days_per_week.max → 拒绝", () => {
    parseExpectThrow(
      baseTemplate({ days_per_week: { min: 2, max: 3, default: 3 } }),
    );
  });

  it("offset 重复 → 拒绝（每天必须占独立日历位）", () => {
    const t = baseTemplate();
    (t.days as Array<Record<string, unknown>>)[1].offset = 0;
    parseExpectThrow(t);
  });

  it("剂量缺档（只有 novice）→ 拒绝", () => {
    const t = baseTemplate();
    const day = (t.days as Array<Record<string, unknown>>)[0] as {
      main: TemplateSlot[];
    };
    const { intermediate, ...noviceOnly } = day.main[0]
      .dosage as never as Record<string, unknown>;
    expect(intermediate).toBeDefined();
    day.main[0] = { ...day.main[0], dosage: noviceOnly };
    parseExpectThrow(t);
  });

  it("reps 区间倒置 → 拒绝", () => {
    const t = baseTemplate();
    const day = (t.days as Array<Record<string, unknown>>)[0] as {
      main: TemplateSlot[];
    };
    day.main[0] = {
      ...day.main[0],
      dosage: tierDosage({ reps_min: 12, reps_max: 8 }),
    };
    parseExpectThrow(t);
  });

  it("rpe 倒置 / 越界 → 拒绝", () => {
    const t = baseTemplate();
    const day = (t.days as Array<Record<string, unknown>>)[0] as {
      main: TemplateSlot[];
    };
    day.main[0] = {
      ...day.main[0],
      dosage: tierDosage({ rpe_min: 8, rpe_max: 7 }),
    };
    parseExpectThrow(t);
  });

  it("计时与次数双缺 → 拒绝", () => {
    const t = baseTemplate();
    const day = (t.days as Array<Record<string, unknown>>)[0] as {
      main: TemplateSlot[];
    };
    const { reps_min: _r1, reps_max: _r2, ...noReps } = noviceStrip(day);
    day.main[0] = {
      ...day.main[0],
      dosage: { novice: noReps, intermediate: noReps },
    };
    parseExpectThrow(t);
  });

  it("contraindicated_parts 越枚举 → 拒绝", () => {
    const t = baseTemplate();
    const day = (t.days as Array<Record<string, unknown>>)[0] as {
      main: TemplateSlot[];
    };
    day.main[0] = {
      ...day.main[0],
      contraindicated_parts: ["spine-xxx" as never],
    };
    parseExpectThrow(t);
  });

  it("文件名 key 与 JSON 内 key 不一致 → 拒绝", () => {
    expect(() =>
      parseWeeklyPlanTemplates([
        { key: "t9-other-name", json: baseTemplate() },
      ]),
    ).toThrow(/不一致/);
  });

  it("schema_version 不符 → 拒绝", () => {
    parseExpectThrow(baseTemplate({ schema_version: 2 }));
  });
});

/** 基底模板首槽 novice 剂量的 plain 拷贝（负例改写用）。 */
function noviceStrip(day: Record<string, unknown>): Record<string, unknown> {
  const main = day.main as TemplateSlot[];
  return { ...main[0].dosage.novice } as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 目录（pick_template 载荷面）
// ---------------------------------------------------------------------------

describe("templateCatalog — 选模板决策面", () => {
  it("4 条目录条目，键/分化/器械面齐全", () => {
    const catalog = templateCatalog();
    expect(catalog).toHaveLength(4);
    for (const c of catalog) {
      expect(c.key).toMatch(/^t\d-/);
      expect(c.audience_zh.length).toBeGreaterThan(0);
      expect(c.equipment.length).toBeGreaterThan(0);
    }
    expect(
      catalog.find((c) => c.key === "t1-novice-fullbody-home")?.equipment,
    ).not.toContain("machine"); // 居家模板器械面不含固定器械
  });
});

// WeeklyPlanTemplateSchema 直测（正例补底：基底模板全过）
describe("WeeklyPlanTemplateSchema — 基底正例", () => {
  it("最小合法模板通过", () => {
    expect(WeeklyPlanTemplateSchema.safeParse(baseTemplate()).success).toBe(
      true,
    );
  });
});
