/**
 * A3 导入管线单测（issue #11）——纯函数，无 DB。
 *
 * 覆盖：名称 token 化/相似度、六模式分类、三元组判重、双源归一映射
 * （以 shared/contracts 受控词表为真源）、库3 内部重名去重、精确重名冲突
 * 标记、端到端 buildImportPlan 计数与补缺上限、确定性 id、契约行校验。
 */

import {
  ExerciseLibraryItemSchema,
  EXERCISE_EQUIPMENT,
} from "../../../../../shared/contracts/index.js";
import {
  buildImportPlan,
  classifyPatterns,
  isTripleDuplicate,
  jaccard,
  nameKey,
  nameTokens,
} from "../../../../src/services/exerciseImport/index.js";
import {
  buildItem,
  createCollector,
  dedupeLib3ByName,
  normalizeLib1Row,
  normalizeLib3Row,
} from "../../../../src/services/exerciseImport/normalizeSources.js";
import type {
  Lib1Raw,
  Lib3Raw,
} from "../../../../src/services/exerciseImport/types.js";

const NOW = "2026-09-26T00:00:00.000Z";

// ============================================================================
// 名称 token 与相似度
// ============================================================================

describe("nameTokens / jaccard / nameKey", () => {
  it("去括号与标点、小写化", () => {
    expect(nameTokens("EZ-Bar Curl")).toEqual(new Set(["ez", "bar", "curl"]));
    expect(nameTokens("Squat (bodyweight only)")).toEqual(new Set(["squat"]));
    expect(nameKey("Barbell  Curl")).toBe(nameKey("barbell curl"));
  });

  it("jaccard: 全等=1、无交=0、近似按交并比", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
    expect(
      jaccard(
        new Set(["dumbbell", "bench", "press"]),
        new Set(["incline", "dumbbell", "press"]),
      ),
    ).toBeCloseTo(2 / 4);
  });
});

// ============================================================================
// 六大模式分类
// ============================================================================

describe("classifyPatterns", () => {
  const item = (
    name: string,
    extra: Partial<Parameters<typeof classifyPatterns>[0]> = {},
  ) => ({
    name,
    force_type: null,
    primary_muscles: [] as string[],
    body_part: null,
    ...extra,
  });

  it("蹲/铰链/负重行走按名称关键词", () => {
    expect(classifyPatterns(item("Barbell Back Squat"))).toContain("squat");
    expect(classifyPatterns(item("Romanian Deadlift"))).toContain("hip_hinge");
    expect(classifyPatterns(item("Farmer's Walk"))).toContain("loaded_carry");
  });

  it("推拉：force_type 优先，无 force 时按主肌群兜底", () => {
    expect(classifyPatterns(item("X", { force_type: "push" }))).toContain(
      "push",
    );
    expect(classifyPatterns(item("X", { force_type: "pull" }))).toContain(
      "pull",
    );
    expect(
      classifyPatterns(item("Bench Press", { primary_muscles: ["chest"] })),
    ).toContain("push");
    expect(
      classifyPatterns(item("Lat Pull-Down", { primary_muscles: ["lats"] })),
    ).toContain("pull");
    // 股四头肌目标不落入推/拉（蹲类目标肌）
    expect(
      classifyPatterns(
        item("Leg Extension", { primary_muscles: ["quadriceps"] }),
      ).has("push"),
    ).toBe(false);
  });

  it("核心：body_part=waist 或 abdominals 主肌群或名称关键词", () => {
    expect(
      classifyPatterns(item("Plank", { primary_muscles: ["abdominals"] })),
    ).toContain("core");
    expect(
      classifyPatterns(item("Whatever", { body_part: "waist" })),
    ).toContain("core");
  });

  it("可多模式：deadlift = hip_hinge + pull", () => {
    const patterns = classifyPatterns(
      item("Barbell Deadlift", { primary_muscles: ["hamstrings"] }),
    );
    expect(patterns.has("hip_hinge")).toBe(true);
    expect(patterns.has("pull")).toBe(false); // 腘绳肌目标不入拉，铰链关键词接管
  });
});

// ============================================================================
// 三元组判重
// ============================================================================

describe("isTripleDuplicate", () => {
  const base = {
    name: "Dumbbell Bench Press",
    equipment: "dumbbell",
    primary_muscles: ["chest"],
  };

  it("主名近似 + 同器材 + 主肌群交集 → 重复", () => {
    expect(
      isTripleDuplicate(base, {
        name: "Dumbbell Incline Bench Press",
        equipment: "dumbbell",
        primary_muscles: ["chest", "shoulders"],
      }),
    ).toBe(true);
  });

  it("器材不同 → 非重复（合法变体）", () => {
    expect(
      isTripleDuplicate(base, {
        name: "Dumbbell Press",
        equipment: "barbell",
        primary_muscles: ["chest"],
      }),
    ).toBe(false);
  });

  it("名称相似不足 → 非重复", () => {
    expect(
      isTripleDuplicate(base, {
        name: "Dumbbell Curl",
        equipment: "dumbbell",
        primary_muscles: ["chest"],
      }),
    ).toBe(false);
  });

  it("双方主肌群均空仍可判重（token 集合等价即同名）", () => {
    expect(
      isTripleDuplicate(
        { name: "Jump Rope", equipment: "other", primary_muscles: [] },
        { name: "Rope Jump", equipment: "other", primary_muscles: [] },
      ),
    ).toBe(true);
  });
});

// ============================================================================
// 库3 归一
// ============================================================================

describe("normalizeLib3Row", () => {
  const collector = createCollector();

  const raw: Lib3Raw = {
    id: "drv-test",
    name: "Barbell Back Squat",
    aliases: ["Back Squat", "barbell back squat", "Barbell Back Squat"],
    bodyPart: "upper legs",
    target: "quads",
    secondaryMuscles: [
      "gluteus maximus",
      "trapezius",
      "cardiovascular system",
      "quads",
    ],
    equipment: "leverage machine",
    difficulty: "intermediate",
    compound: true,
    unilateral: false,
    shortDescription: "A compound lower body lift.",
    instructions: "long text",
    steps: ["Step one.", "Step two."],
    formCues: ["Chest up"],
    commonMistakes: ["Knees cave"],
    breathing: "Inhale on descent",
    videos: {
      male: "https://cdn.example.com/male/squat.mp4",
      female: "https://cdn.example.com/female/squat.mp4",
    },
    thumbnails: {
      male: "https://cdn.example.com/posters/male/squat.jpg",
      female: "https://cdn.example.com/posters/female/squat.jpg",
    },
  };

  it("全字段映射：词表归一/教学列/资产引用/别称清洗", () => {
    const item = normalizeLib3Row(raw, collector);
    expect(item.equipment).toBe("machine"); // leverage machine → machine
    expect(item.body_part).toBe("upper_legs");
    expect(item.primary_muscles).toEqual(["quadriceps"]); // quads → quadriceps
    expect(item.secondary_muscles).toEqual(["glutes", "traps"]); // gluteus maximus→glutes；trapezius→traps；quads 与主肌群重叠剔除
    expect(item.mechanic).toBe("compound");
    expect(item.exercise_type).toBe("resistance");
    expect(item.difficulty).toBe("intermediate");
    expect(item.instructions).toEqual(raw.steps); // steps 口径 → instructions
    expect(item.form_cues).toEqual(["Chest up"]);
    expect(item.common_mistakes).toEqual(["Knees cave"]);
    expect(item.breathing).toBe("Inhale on descent");
    expect(item.aliases).toEqual(["Back Squat"]); // 去重 + 剔除主名本身
    expect(item.video_urls).toEqual(raw.videos);
    expect(item.image_refs).toEqual([
      raw.thumbnails?.male,
      raw.thumbnails?.female,
    ]);
    expect(item.poster_url).toBe(raw.thumbnails?.male);
    expect(item.content_html).toBe("A compound lower body lift."); // shortDescription 保全
    expect(item.name_zh).toBeNull(); // 中文管道后续
    expect(item.force_type).toBeNull(); // 库3 无此维度
    expect(item.category).toBe("strength");
  });

  it("拉伸名 → flexibility/stretching（优先于 bodyPart=cardio 源噪声）", () => {
    const stretch = normalizeLib3Row(
      {
        ...raw,
        name: "Runner's Stretch",
        bodyPart: "cardio",
        target: "hip flexors",
      },
      collector,
    );
    expect(stretch.exercise_type).toBe("flexibility");
    expect(stretch.category).toBe("stretching");
  });

  it("bodyPart=cardio 非拉伸名 → cardio", () => {
    const cardio = normalizeLib3Row(
      {
        ...raw,
        name: "Burpee",
        bodyPart: "cardio",
        target: "cardiovascular system",
      },
      collector,
    );
    expect(cardio.exercise_type).toBe("cardio");
    expect(cardio.category).toBe("cardio");
    expect(cardio.primary_muscles).toEqual([]); // 非肌群目标 → 空数组
  });

  it("unilateral=true → exercise_type=unilateral", () => {
    const uni = normalizeLib3Row(
      { ...raw, name: "Bulgarian Split Squat", unilateral: true },
      collector,
    );
    expect(uni.exercise_type).toBe("unilateral");
  });

  it("未知原值不静默：unmapped 计数上报", () => {
    const local = createCollector();
    normalizeLib3Row(
      {
        ...raw,
        target: "mystery muscle",
        secondaryMuscles: ["another mystery"],
      },
      local,
    );
    const fields = [...local.unmapped.values()].map(
      (u) => `${u.field}|${u.value}`,
    );
    expect(fields).toContain("lib3.target|mystery muscle");
    expect(fields).toContain("lib3.secondaryMuscles|another mystery");
  });
});

// ============================================================================
// 库1 归一
// ============================================================================

describe("normalizeLib1Row", () => {
  const collector = createCollector();

  it("equipment null/'body only' → bodyweight；'e-z curl bar' → barbell", () => {
    const a = normalizeLib1Row(
      { name: "A", level: "beginner", equipment: null },
      collector,
    );
    const b = normalizeLib1Row(
      { name: "B", level: "beginner", equipment: "body only" },
      collector,
    );
    const c = normalizeLib1Row(
      { name: "C", level: "beginner", equipment: "e-z curl bar" },
      collector,
    );
    expect(a.equipment).toBe("bodyweight");
    expect(b.equipment).toBe("bodyweight");
    expect(c.equipment).toBe("barbell");
  });

  it("level expert → advanced；force/mechanic 直通；category 空格转 snake_case", () => {
    const item = normalizeLib1Row(
      {
        name: "Power Clean",
        level: "expert",
        force: "pull",
        mechanic: "compound",
        equipment: "barbell",
        primaryMuscles: ["hamstrings"],
        secondaryMuscles: ["calves"],
        instructions: ["Pull."],
        category: "olympic weightlifting",
        images: ["Power_Clean/0.jpg"],
      },
      collector,
    );
    expect(item.difficulty).toBe("advanced");
    expect(item.force_type).toBe("pull");
    expect(item.mechanic).toBe("compound");
    expect(item.category).toBe("olympic_weightlifting");
    expect(item.exercise_type).toBe("resistance");
    expect(item.image_refs).toEqual([
      "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Power_Clean/0.jpg",
    ]);
    expect(item.poster_url).toBe(item.image_refs?.[0]);
    expect(item.body_part).toBeNull(); // 库1 无此维度
    expect(item.form_cues).toBeNull(); // 库1 无教学字段
  });

  it("category=cardio/stretching/plyometrics → exercise_type=cardio/flexibility/bodyweight", () => {
    const mk = (category: string) =>
      normalizeLib1Row(
        { name: `X ${category}`, level: "beginner", category },
        collector,
      );
    expect(mk("cardio").exercise_type).toBe("cardio");
    expect(mk("stretching").exercise_type).toBe("flexibility");
    expect(mk("plyometrics").exercise_type).toBe("bodyweight");
  });
});

// ============================================================================
// 库3 内部重名
// ============================================================================

describe("dedupeLib3ByName", () => {
  it("同重名保留首条并输出丢弃记录", () => {
    const { kept, drops } = dedupeLib3ByName([
      { id: "a", name: "Sit-Up", target: "rectus abdominis" },
      { id: "b", name: "Sit-Up", target: "rectus abdominis" },
      { id: "c", name: "Crunch" },
    ]);
    expect(kept.map((r) => r.id)).toEqual(["a", "c"]);
    expect(drops).toHaveLength(1);
    expect(drops[0].droppedId).toBe("b");
  });
});

// ============================================================================
// 端到端管线
// ============================================================================

const lib3Fixture: Lib3Raw[] = [
  {
    id: "d1",
    name: "Barbell Back Squat",
    bodyPart: "upper legs",
    target: "quadriceps",
    secondaryMuscles: ["glutes"],
    equipment: "barbell",
    difficulty: "intermediate",
    compound: true,
    steps: ["Squat."],
    formCues: ["Chest up"],
    commonMistakes: ["Butt wink"],
    breathing: "Inhale",
    aliases: ["Back Squat"],
    videos: { male: "https://v.example.com/m.mp4" },
    thumbnails: { male: "https://v.example.com/pm.jpg" },
  },
  {
    id: "d2",
    name: "Pull-Up",
    bodyPart: "back",
    target: "lats",
    secondaryMuscles: ["biceps"],
    equipment: "body weight",
    difficulty: "beginner",
    compound: true,
    steps: ["Pull."],
    formCues: [],
    commonMistakes: [],
    breathing: "Exhale",
    aliases: [],
    videos: { male: "https://v.example.com/pull.mp4" },
    thumbnails: {},
  },
];

const lib1Fixture: Lib1Raw[] = [
  // 精确重名：库3 胜出，跳过
  {
    name: "Barbell Back Squat",
    level: "beginner",
    equipment: "barbell",
    primaryMuscles: ["quadriceps"],
    secondaryMuscles: [],
    instructions: ["x"],
    category: "strength",
    force: "push",
    mechanic: "compound",
  },
  // loaded_carry 缺口候选
  {
    name: "Farmer's Walk",
    level: "beginner",
    equipment: "other",
    primaryMuscles: ["forearms"],
    secondaryMuscles: [],
    instructions: ["Carry."],
    category: "strongman",
    force: "static",
    mechanic: "compound",
  },
  // 精确重名 + 冲突（器材不一致）
  {
    name: "Pull-Up",
    level: "beginner",
    equipment: "cable",
    primaryMuscles: ["lats"],
    secondaryMuscles: [],
    instructions: ["x"],
    category: "strength",
    force: "pull",
    mechanic: "compound",
  },
  // 三元组近似重复（不入选）
  {
    name: "Barbell Back Squat Exercise",
    level: "beginner",
    equipment: "barbell",
    primaryMuscles: ["quadriceps", "glutes"],
    secondaryMuscles: [],
    instructions: ["x"],
    category: "strength",
    force: "push",
    mechanic: "compound",
  },
];

describe("buildImportPlan（端到端）", () => {
  it("计数：库3 全量、精确重名跳过（冲突标记）、补缺只进缺口", () => {
    const plan = buildImportPlan(lib3Fixture, lib1Fixture, {
      perCellLimit: 2,
      lib1MaxPicks: 10,
    });
    expect(plan.counts).toEqual({
      lib3_source: 2,
      lib3_internal_dup_dropped: 0,
      lib1_source: 4,
      lib1_exact_overlap_skipped: 2,
    });
    // 只有 Farmer's Walk 入选（其余被重名/三元组判重剔除）
    expect(plan.lib1Items.map((i) => i.name)).toEqual(["Farmer's Walk"]);
    // 冲突清单：Pull-Up 器材不一致
    const conflict = plan.review.find(
      (e) => e.kind === "exact_name_overlap" && e.name === "Pull-Up",
    );
    expect(conflict).toMatchObject({
      triple_conflict: true,
      lib3_equipment: "bodyweight",
      lib1_equipment: "cable",
    });
    // 补缺后 loaded_carry × other 有覆盖
    expect(plan.matrix.cells.loaded_carry.other).toBe(1);
  });

  it("产物行全部通过 ExerciseLibraryItemSchema 契约校验", () => {
    const plan = buildImportPlan(lib3Fixture, lib1Fixture);
    for (const item of [...plan.lib3Items, ...plan.lib1Items]) {
      expect(() => ExerciseLibraryItemSchema.parse(item)).not.toThrow();
    }
  });

  it("补缺总量上限生效", () => {
    // 上限 0 → 库1 无入选
    const plan = buildImportPlan(lib3Fixture, lib1Fixture, {
      perCellLimit: 2,
      lib1MaxPicks: 0,
    });
    expect(plan.lib1Items).toHaveLength(0);
    expect(plan.matrix.cells.loaded_carry.other).toBe(0);
  });
});

// ============================================================================
// 确定性 id 与器材词表完整性
// ============================================================================

describe("buildItem / 词表", () => {
  it("确定性 id：同输入同 id，长度 ∈ [12,24]", () => {
    const partial = normalizeLib3Row(lib3Fixture[0], createCollector());
    const a = buildItem("lib3", partial, NOW);
    const b = buildItem("lib3", partial, NOW);
    expect(a.id).toBe(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(12);
    expect(a.id.length).toBeLessThanOrEqual(24);
    // 源不同 → id 不同
    const c = buildItem("lib1", { ...partial }, NOW);
    expect(c.id).not.toBe(a.id);
  });

  it("覆盖矩阵列 = 15 器材词表", () => {
    const plan = buildImportPlan(lib3Fixture, lib1Fixture);
    for (const pattern of [
      "push",
      "pull",
      "squat",
      "hip_hinge",
      "loaded_carry",
      "core",
    ]) {
      expect(Object.keys(plan.matrix.cells[pattern]).sort()).toEqual(
        [...EXERCISE_EQUIPMENT].sort(),
      );
    }
  });
});
