/**
 * typeUnification — 类型体系统一映射完备性自检（W2 / issue #88 分册1）
 *
 * 验证门 6：枚举全集 × 存量数据值 双向映射无遗漏。
 * 真源 = shared/contracts/card-types.ts；本测试钉死：
 *
 *   1. 枚举完备性：5 大类/10 细类/cardType 派生关系自洽，无孤儿无重复
 *   2. 存量值兼容：旧 5 类协议值（strength/cardio/hiit/stretch/unknown）、
 *      legacy.ts 漂移值（weight_only/reps_only）、旧 cardType 键
 *      （running_gps/outdoor_gps）全部可归一到标准值，且归一幂等
 *   3. 跨层一致性：uiHintSchemas 枚举 / suggestions 词表 / 锚点字段表 /
 *      DB 迁移枚举（000_baseline.sql exercise_type_enum）与真源同集
 *   4. 契约行为：ExerciseAction.type 接受 12 值动作词表；旧值须经
 *      normalizeExerciseActionType 兼容读取（禁直接破坏存量数据语义）
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";

import {
  CARD_MAJOR_TYPES,
  CARD_MAJOR_LABELS_ZH,
  EXERCISE_TYPE_VALUES,
  EXERCISE_TYPE_DEFS,
  EXERCISE_TYPE_LABELS_ZH,
  CARD_TYPE_VALUES,
  MAJOR_CARD_TYPES,
  CARD_TYPE_ALIASES,
  cardTypeForExerciseType,
  normalizeCardType,
  EXERCISE_ACTION_TYPE_VALUES,
  ExerciseActionTypeEnum,
  normalizeExerciseType,
  normalizeExerciseActionType,
  LEGACY_EXERCISE_TYPE_ALIASES,
  EXERCISE_TYPE_FIELDS,
  CardTypeSchema,
  ExerciseActionSchema,
} from "shared/contracts";
import {
  SUGGESTION_EXERCISE_TYPES,
  normalizeSuggestionExerciseType,
} from "shared/contracts";
// 校验回路真源（backend）：枚举必须与 card-types 同集
import { ExerciseTypeEnum as uiHintExerciseTypeEnum } from "../../src/services/agent/schemas/uiHintSchemas";

// ---------------------------------------------------------------------------
// 1. 枚举完备性
// ---------------------------------------------------------------------------

describe("#88 分册1 · 枚举完备性", () => {
  it("5 大类：恰好 5 个、无重复、中文名齐全", () => {
    expect(CARD_MAJOR_TYPES).toHaveLength(5);
    expect(new Set(CARD_MAJOR_TYPES).size).toBe(5);
    for (const major of CARD_MAJOR_TYPES) {
      expect(CARD_MAJOR_LABELS_ZH[major]).toBeTruthy();
    }
  });

  it("10 细类：全集有定义、无重复、所属大类合法、中文名齐全", () => {
    expect(EXERCISE_TYPE_VALUES).toHaveLength(10);
    expect(new Set(EXERCISE_TYPE_VALUES).size).toBe(10);
    for (const fine of EXERCISE_TYPE_VALUES) {
      const def = EXERCISE_TYPE_DEFS[fine];
      expect(def).toBeDefined();
      expect(new Set(CARD_MAJOR_TYPES)).toContain(def.major);
      expect(def.label_zh).toBeTruthy();
      expect(def.variant).toMatch(/^[a-z][a-z_]*$/);
      expect(EXERCISE_TYPE_LABELS_ZH[fine]).toBe(def.label_zh);
    }
  });

  it("cardType 派生：细类派生键 ∪ 大类缺省卡 = CARD_TYPE_VALUES（全集可达）", () => {
    // hiit 无细类（编排格式），hiit_timer 仅由大类缺省卡产出——
    // 两条产出路径的并集必须恰好铺满标准值域，无孤儿无缺漏
    const derived = new Set([
      ...EXERCISE_TYPE_VALUES.map(cardTypeForExerciseType),
      ...Object.values(MAJOR_CARD_TYPES),
    ]);
    expect([...derived].sort()).toEqual([...CARD_TYPE_VALUES].sort());
  });

  it("每个标准 cardType 均为 {major}_{variant} 两级格式且前缀 ∈ 5 大类", () => {
    for (const cardType of CARD_TYPE_VALUES) {
      const major = cardType.split("_")[0];
      expect(new Set(CARD_MAJOR_TYPES)).toContain(major);
      expect(cardType).toMatch(/^[a-z]+_[a-z]+$/);
    }
  });

  it("5 大类缺省卡：键覆盖全部大类、值均在标准值域内", () => {
    expect(Object.keys(MAJOR_CARD_TYPES).sort()).toEqual(
      [...CARD_MAJOR_TYPES].sort(),
    );
    for (const value of Object.values(MAJOR_CARD_TYPES)) {
      expect(new Set(CARD_TYPE_VALUES)).toContain(value);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. 存量数据值 → 标准值 双向映射无遗漏
// ---------------------------------------------------------------------------

/** 旧 5 类协议枚举（contracts ExerciseAction.type 历史值，存量 sessions JSONB） */
const OLD_PROTOCOL_TYPES = [
  "unknown",
  "strength",
  "cardio",
  "hiit",
  "stretch",
] as const;

describe("#88 分册1 · 存量值兼容映射", () => {
  it("旧 5 类协议值全部可归一（前向完备，无遗漏）", () => {
    for (const old of OLD_PROTOCOL_TYPES) {
      const normalized = normalizeExerciseActionType(old);
      expect(EXERCISE_ACTION_TYPE_VALUES).toContain(normalized);
    }
  });

  it("旧 5 类语义映射钉死：strength→resistance、stretch→flexibility、hiit 保持", () => {
    expect(normalizeExerciseActionType("strength")).toBe("resistance");
    expect(normalizeExerciseActionType("stretch")).toBe("flexibility");
    expect(normalizeExerciseActionType("cardio")).toBe("cardio");
    expect(normalizeExerciseActionType("unknown")).toBe("unknown");
    // hiit 为动作层合法值（编排格式），禁语义降级为 cardio
    expect(normalizeExerciseActionType("hiit")).toBe("hiit");
  });

  it("legacy.ts 历史漂移值归一：weight_only→heavy_weight、reps_only→rep_training", () => {
    expect(normalizeExerciseType("weight_only")).toBe("heavy_weight");
    expect(normalizeExerciseType("reps_only")).toBe("rep_training");
  });

  it("细类归一入口 normalizeExerciseType：合法细类恒等、未知值→unknown、大小写/空白宽容", () => {
    for (const fine of EXERCISE_TYPE_VALUES) {
      expect(normalizeExerciseType(fine)).toBe(fine);
    }
    expect(normalizeExerciseType("Strength")).toBe("resistance");
    expect(normalizeExerciseType("  cardio ")).toBe("cardio");
    expect(normalizeExerciseType("yoga")).toBe("unknown");
    expect(normalizeExerciseType("")).toBe("unknown");
  });

  it("归一幂等：全部输入域（细类 ∪ 旧值 ∪ 漂移值）二次归一结果不变", () => {
    const inputs = [
      ...EXERCISE_ACTION_TYPE_VALUES,
      ...OLD_PROTOCOL_TYPES,
      ...Object.keys(LEGACY_EXERCISE_TYPE_ALIASES),
    ];
    for (const input of inputs) {
      const once = normalizeExerciseActionType(input);
      expect(normalizeExerciseActionType(once)).toBe(once);
    }
  });

  it("反向覆盖：5 大类每个都是可达目标（细类或旧值落入，无孤儿大类）", () => {
    for (const major of CARD_MAJOR_TYPES) {
      const hasFine = EXERCISE_TYPE_VALUES.some(
        (fine) => EXERCISE_TYPE_DEFS[fine].major === major,
      );
      const hasLegacy =
        major === "hiit" || // hiit 大类由旧协议 hiit 动作值直达
        Object.values(LEGACY_EXERCISE_TYPE_ALIASES).some(
          (fine) => EXERCISE_TYPE_DEFS[fine].major === major,
        ) ||
        EXERCISE_TYPE_VALUES.includes(
          major as (typeof EXERCISE_TYPE_VALUES)[number],
        ); // cardio/stretch 等大类存在同名细类
      expect(hasFine || hasLegacy).toBe(true);
    }
  });

  it("旧 cardType 键归一：running_gps/outdoor_gps → cardio_outdoor；未知→UNKNOWN", () => {
    expect(normalizeCardType("running_gps")).toBe("cardio_outdoor");
    expect(normalizeCardType("outdoor_gps")).toBe("cardio_outdoor");
    for (const cardType of CARD_TYPE_VALUES) {
      expect(normalizeCardType(cardType)).toBe(cardType);
    }
    expect(normalizeCardType("strength_card")).toBe("UNKNOWN");
  });

  it("别名表键集 = 枚举中的别名值（Schema 与归一函数同源）", () => {
    const aliasKeys = Object.keys(CARD_TYPE_ALIASES).sort();
    const canonical = new Set(CARD_TYPE_VALUES as readonly string[]);
    for (const key of aliasKeys) {
      // 别名不得与标准值重名（重名即失去别名意义）
      expect(canonical.has(key)).toBe(false);
      // 别名必须能通过 Schema 校验（存量数据兼容读取）
      expect(CardTypeSchema.safeParse(key).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. 跨层一致性（真源 ↔ 各消费层）
// ---------------------------------------------------------------------------

describe("#88 分册1 · 跨层一致性", () => {
  it("uiHintSchemas 校验回路枚举 = 细类真源（禁第二套手写）", () => {
    expect([...uiHintExerciseTypeEnum.options].sort()).toEqual(
      [...EXERCISE_TYPE_VALUES].sort(),
    );
  });

  it("suggestions 词表 = 细类真源 + unknown 兜底", () => {
    expect([...SUGGESTION_EXERCISE_TYPES].sort()).toEqual(
      [...EXERCISE_TYPE_VALUES, "unknown"].sort(),
    );
    expect(normalizeSuggestionExerciseType("strength")).toBe("resistance");
    expect(normalizeSuggestionExerciseType("hiit")).toBe("cardio");
    expect(normalizeSuggestionExerciseType("stretch")).toBe("flexibility");
  });

  it("锚点字段表：键 = 细类全集，值 = 真源 anchor_fields", () => {
    expect(Object.keys(EXERCISE_TYPE_FIELDS).sort()).toEqual(
      [...EXERCISE_TYPE_VALUES].sort(),
    );
    for (const fine of EXERCISE_TYPE_VALUES) {
      expect(EXERCISE_TYPE_FIELDS[fine]).toEqual(
        EXERCISE_TYPE_DEFS[fine].anchor_fields,
      );
    }
  });

  it("DB 迁移枚举（000_baseline.sql exercise_type_enum）= 细类真源", () => {
    const sqlPath = path.resolve(
      __dirname,
      "../../src/db/postgresql/migrations/000_baseline.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");
    const match = sql.match(
      /CREATE TYPE public\.exercise_type_enum AS ENUM \(([^)]*)\)/,
    );
    expect(match).not.toBeNull();
    const dbValues = match![1]
      .split(",")
      .map((v) => v.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(dbValues.sort()).toEqual([...EXERCISE_TYPE_VALUES].sort());
  });

  it("会话动作词表 = 细类 + hiit + unknown（12 值）", () => {
    expect([...EXERCISE_ACTION_TYPE_VALUES].sort()).toEqual(
      [...EXERCISE_TYPE_VALUES, "hiit", "unknown"].sort(),
    );
    expect([...ExerciseActionTypeEnum.options].sort()).toEqual(
      [...EXERCISE_ACTION_TYPE_VALUES].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. 契约行为（Zod 回路）
// ---------------------------------------------------------------------------

describe("#88 分册1 · 契约行为", () => {
  const baseAction = {
    protocol_version: "2.0.0",
    id: "00000000-0000-4000-8000-000000000000",
    exerciseId: "V1StGXR8_Z5jdHi6b2-my",
    sets: [],
  };

  it("ExerciseAction.type 接受全部 12 值动作词表", () => {
    for (const t of EXERCISE_ACTION_TYPE_VALUES) {
      const parsed = ExerciseActionSchema.safeParse({ ...baseAction, type: t });
      expect(parsed.success).toBe(true);
    }
  });

  it("旧 5 类值直接解析被拒 → 须过 normalizeExerciseActionType 兼容读取", () => {
    // 这是有意为之：契约层保持标准词表，存量数据经归一入口进入
    for (const old of ["strength", "stretch"] as const) {
      expect(
        ExerciseActionSchema.safeParse({ ...baseAction, type: old }).success,
      ).toBe(false);
      const normalized = normalizeExerciseActionType(old);
      expect(
        ExerciseActionSchema.safeParse({
          ...baseAction,
          type: normalized,
        }).success,
      ).toBe(true);
    }
    // hiit/cardio/unknown 本就在动作词表内，直接可解析
    for (const old of ["hiit", "cardio", "unknown"] as const) {
      expect(
        ExerciseActionSchema.safeParse({ ...baseAction, type: old }).success,
      ).toBe(true);
    }
  });

  it("ExerciseAction.type 缺省 unknown、CardType 缺省 UNKNOWN", () => {
    const parsed = ExerciseActionSchema.parse(baseAction);
    expect(parsed.type).toBe("unknown");
    expect(CardTypeSchema.parse(undefined)).toBe("UNKNOWN");
  });

  it("CardTypeSchema 接受标准值与存量别名，拒绝非法值", () => {
    const accepted = [
      "UNKNOWN",
      ...CARD_TYPE_VALUES,
      ...Object.keys(CARD_TYPE_ALIASES),
    ];
    for (const value of accepted) {
      expect(CardTypeSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [
      "standard",
      "strength",
      "resistance",
      "hiit_",
    ] as const) {
      expect(CardTypeSchema.safeParse(value).success).toBe(false);
    }
  });
});
