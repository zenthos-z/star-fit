/**
 * Contract Tests: Exercises API & Video Protocol
 *
 * 批次3改造（2026-09-22）：删除本地手抄的镜像 Schema，改为直接断言真源契约。
 * 002 返工（2026-09-26）：attributes 列退役，Exercise 契约真源切换为
 *  - ExerciseLibraryItemSchema → shared/contracts/exercise-library.ts（唯一行真源）
 *  - VideoAssetSchema     → backend/src/schemas/videoSchema.ts
 *    （shared/contracts 无视频资产导出；后端视频资产真源即此文件，
 *     视频处理链路 videoProcessingService.ts 亦从这里导入）
 *
 * 断言按真 schema 形状编写：Exercise 为 NanoID + attributes 嵌套结构；
 * VideoAsset 为 uuid id + 正数元数据 + quality 枚举 + type/sources 默认值。
 */
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { VideoAssetSchema } from "../src/schemas/videoSchema.js";
import {
  CreateWeeklyPlanInputSchema,
  WeeklyPlanSchema,
  PlanEntrySchema,
  WeeklyPlanWithEntriesSchema,
  WeekIdSchema,
  canTransitionPlanEntryStatus,
  PLAN_ENTRY_STATUS_TRANSITIONS,
  EXERCISE_MUSCLES,
  EXERCISE_EQUIPMENT,
  EXERCISE_CATEGORIES,
  EXERCISE_BODY_PARTS,
  MUSCLE_ALIASES,
  EQUIPMENT_ALIASES,
  normalizeMuscle,
  normalizeEquipment,
  normalizeDifficulty,
  ExerciseLibraryItemSchema,
  ExerciseVideoUrlsSchema,
  ExerciseDetailUpdateSchema,
  TodayScheduleResponseSchema,
  TodayScheduleEntrySchema,
  ScheduleSummaryResponseSchema,
  TODAY_STATUS_TO_SUMMARY,
  getIsoWeekId,
  PlanSetPrescriptionSchema,
  PlanEntryCategorySchema,
  WeeklyPlanCardDataSchema,
  resolvePlanEntryCategory,
  PLAN_ENTRY_CATEGORY_VALUES,
  type PlanEntry,
  type WeeklyPlan,
} from "../../shared/contracts/index.js";

// ============================================================================
// 构造器：按真契约形状构造样本
// ============================================================================

/** 合法 NanoID（12-24 字符，如 nanoid 默认 21 位） */
const NANO_ID = "test-exercise-0001";

function buildExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: NANO_ID,
    name: "Test Exercise",
    name_zh: null,
    exercise_type: "resistance",
    difficulty: "beginner",
    equipment: "barbell",
    category: "strength",
    body_part: "chest",
    primary_muscles: ["chest"],
    secondary_muscles: ["triceps"],
    force_type: "push",
    mechanic: "compound",
    instructions: ["Lower the bar.", "Press up."],
    form_cues: null,
    common_mistakes: null,
    breathing: null,
    aliases: null,
    instructions_zh: null,
    image_refs: null,
    video_urls: null,
    poster_url: null,
    owner_user_id: null,
    content_html: null,
    tutorials: null,
    created_at: "2026-09-26T08:00:00.000Z",
    updated_at: "2026-09-26T08:00:00.000Z",
    ...overrides,
  };
}

function buildVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "9f8b7c6d-5e4a-4b3c-8d2e-1f0a9b8c7d6e",
    exerciseName: "bench_press",
    type: "local",
    baseUrl: "/uploads/videos/video-1",
    sources: [
      { quality: "360p", url: "/360p.mp4", size: 500000, bandwidth: 500000 },
      { quality: "720p", url: "/720p.mp4", size: 1500000, bandwidth: 1500000 },
    ],
    posterUrl: "/uploads/videos/video-1/poster.jpg",
    metadata: {
      originalFilename: "bench-press.mp4",
      duration: 45,
      width: 1920,
      height: 1080,
      codec: "h264",
      bitrate: 3000000,
      size: 1500000,
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Contract Tests: Exercises API（真源 shared/contracts ExerciseLibraryItemSchema）
// ============================================================================

describe("Contract Tests: Exercises API", () => {
  test("exercise response has valid structure", () => {
    const result = ExerciseLibraryItemSchema.safeParse(buildExercise());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.data.primary_muscles.length > 0);
      assert.ok(typeof result.data.equipment === "string");
    }
  });

  test("exercise id is NanoID-shaped (12-24 chars, no whitespace)", () => {
    // 合法：21 位默认 NanoID
    const ok = ExerciseLibraryItemSchema.safeParse(
      buildExercise({ id: "123456789012345678901" }),
    );
    assert.strictEqual(ok.success, true);

    // 非法：过短 / 含空白 —— 真契约必须拦截
    for (const bad of ["", "  ", "\t", "short"]) {
      const result = ExerciseLibraryItemSchema.safeParse(
        buildExercise({ id: bad }),
      );
      assert.strictEqual(
        result.success,
        false,
        `id "${bad}" should be rejected`,
      );
      if (!result.success) {
        assert.ok(
          result.error.issues.some((i) => i.path.includes("id")),
          `failure should point at id, got ${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });

  test("exercise name must be a string (real contract: no min-length)", () => {
    // 真契约 name: z.string()——不强制非空
    const emptyOk = ExerciseLibraryItemSchema.safeParse(
      buildExercise({ name: "" }),
    );
    assert.strictEqual(emptyOk.success, true);

    const nonString = ExerciseLibraryItemSchema.safeParse(
      buildExercise({ name: 123 }),
    );
    assert.strictEqual(nonString.success, false);
    if (!nonString.success) {
      assert.ok(nonString.error.issues.some((i) => i.path.includes("name")));
    }
  });

  test("exercise_type must be a known enum value", () => {
    const result = ExerciseLibraryItemSchema.safeParse(
      buildExercise({ exercise_type: "yoga" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error.issues.some((i) => i.path.includes("exercise_type")),
      );
    }
  });

  test("difficulty must be a known enum value", () => {
    const result = ExerciseLibraryItemSchema.safeParse(
      buildExercise({ difficulty: "extreme" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("difficulty")));
    }
  });

  test("owner_user_id accepts uuid or null (HC-2 user binding column)", () => {
    assert.strictEqual(
      ExerciseLibraryItemSchema.safeParse(
        buildExercise({
          owner_user_id: "2205fb26-33f6-4eb2-8f05-cbe372226a0e",
        }),
      ).success,
      true,
    );
    assert.strictEqual(
      ExerciseLibraryItemSchema.safeParse(
        buildExercise({ owner_user_id: "not-a-uuid" }),
      ).success,
      false,
    );
  });
});

// ============================================================================
// Contract Tests: Video Protocol（真源 backend/src/schemas/videoSchema.ts）
// ============================================================================

describe("Contract Tests: Video Protocol", () => {
  test("video asset matches VideoAssetSchema", () => {
    const result = VideoAssetSchema.safeParse(buildVideo());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.baseUrl, "/uploads/videos/video-1");
      assert.strictEqual(
        result.data.posterUrl,
        "/uploads/videos/video-1/poster.jpg",
      );
      assert.strictEqual(
        result.data.metadata.originalFilename,
        "bench-press.mp4",
      );
      assert.strictEqual(result.data.metadata.duration, 45);
      assert.strictEqual(Array.isArray(result.data.sources), true);
      assert.strictEqual(result.data.sources.length, 2);
    }
  });

  test("video id must be a UUID", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ id: "video-test-1" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("id")));
    }
  });

  test("exerciseName must be slug-shaped (no spaces / non-latin)", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ exerciseName: "卧推 bench press" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error.issues.some((i) => i.path.includes("exerciseName")),
      );
    }
  });

  test("type defaults to local when omitted", () => {
    const result = VideoAssetSchema.safeParse(buildVideo({ type: undefined }));
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.type, "local");
    }
  });

  test("sources defaults to empty array when omitted", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ sources: undefined }),
    );
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.sources.length, 0);
    }
  });

  test("sources quality must be a known enum", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({
        sources: [{ quality: "4k", url: "/4k.mp4", size: 1, bandwidth: 1 }],
      }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("quality")));
    }
  });

  test("metadata numeric fields reject non-positive values", () => {
    const result = VideoAssetSchema.safeParse(
      buildVideo({ metadata: { ...buildVideo().metadata, duration: -5 } }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("duration")));
    }
  });
});

// ============================================================================
// Contract Tests: Weekly Plan（真源 shared/contracts/weekly-plan.ts — issue #10）
// ============================================================================

const WP_USER_ID = "5f0c3e2a-1b4d-4c8e-9a7f-3d6b2e8c1a01";
const WP_PLAN_ID = "7a1e9c3b-5d2f-4b6a-8e0c-2f7d4a9b3e5c";
const WP_ENTRY_ID = "9c4a7e1d-3f8b-4d2c-b6a0-1e5f8d3c7b9a";
const WP_EXERCISE_ID = "bench-press-00001"; // NanoID 17 字符（12-24 合法区间）

function buildEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WP_ENTRY_ID,
    weekly_plan_id: WP_PLAN_ID,
    user_id: WP_USER_ID,
    entry_date: "2026-09-28",
    exercise_id: WP_EXERCISE_ID,
    target_sets: 4,
    target_load: { type: "rpe", min: 7, max: 8 },
    status: "planned",
    sort_order: 0,
    // [T9 #66] 结构化列缺省「旧行」形态（004 迁移前存量：全 NULL）
    day_focus: null,
    rationale: null,
    category: null,
    sets: null,
    created_at: "2026-09-26T08:00:00.000Z",
    updated_at: "2026-09-26T08:00:00.000Z",
    ...overrides,
  };
}

function buildPlanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WP_PLAN_ID,
    user_id: WP_USER_ID,
    week_id: "2026-W40",
    split: "upper_lower",
    status: "active",
    created_at: "2026-09-26T08:00:00.000Z",
    updated_at: "2026-09-26T08:00:00.000Z",
    ...overrides,
  };
}

function buildCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    user_id: WP_USER_ID,
    week_id: "2026-W40",
    split: "push_pull_legs",
    entries: [
      {
        entry_date: "2026-09-28",
        exercise_id: WP_EXERCISE_ID,
        target_sets: 4,
        target_load: { type: "percent_1rm", min: 70, max: 80 },
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// Contract Tests: Exercise Library（issue #4 深化 — 真源 exercise-library.ts）
// ============================================================================

describe("Contract Tests: Exercise Library", () => {
  test("controlled vocabularies match the ratified sizes (17 muscles / 15 equipment / 7 categories / 10 body parts)", () => {
    assert.strictEqual(EXERCISE_MUSCLES.length, 17);
    assert.strictEqual(EXERCISE_EQUIPMENT.length, 15);
    assert.strictEqual(EXERCISE_CATEGORIES.length, 7);
    assert.strictEqual(EXERCISE_BODY_PARTS.length, 10);
    // 词表内无重复（受控词表基本卫生）
    for (const vocab of [
      EXERCISE_MUSCLES,
      EXERCISE_EQUIPMENT,
      EXERCISE_CATEGORIES,
      EXERCISE_BODY_PARTS,
    ]) {
      assert.strictEqual(new Set(vocab).size, vocab.length);
    }
  });

  test("all 39 lib3 targets are covered by MUSCLE_ALIASES and map into the 17-muscle vocabulary or null", () => {
    // 库3 free-exercise-db-with-videos 的 39 个 target 原值（实测全集，评估区 seed=42）
    const LIB3_TARGETS = [
      "abdominals",
      "abductors",
      "abs",
      "adductors",
      "anterior deltoid",
      "biceps",
      "calves",
      "cardiovascular system",
      "deltoids",
      "delts",
      "erector spinae",
      "erectors",
      "forearm extensors",
      "forearms",
      "full body",
      "glutes",
      "gluteus medius",
      "hamstrings",
      "hip flexors",
      "lats",
      "middle back",
      "neck flexors",
      "obliques",
      "pectorals",
      "peroneals",
      "posterior deltoid",
      "quadriceps",
      "quads",
      "rear deltoids",
      "rectus abdominis",
      "rhomboids",
      "spinal erectors",
      "spine",
      "sternocleidomastoid",
      "thoracic spine",
      "traps",
      "triceps",
      "upper back",
      "upper pectorals",
    ];
    assert.strictEqual(LIB3_TARGETS.length, 39);

    for (const target of LIB3_TARGETS) {
      assert.ok(
        target in MUSCLE_ALIASES,
        `库3 target "${target}" 缺映射（MUSCLE_ALIASES 必须全覆盖 39 个）`,
      );
      const mapped = MUSCLE_ALIASES[target];
      if (mapped !== null) {
        assert.ok(
          (EXERCISE_MUSCLES as readonly string[]).includes(mapped),
          `库3 target "${target}" 映射到 "${mapped}" 不在 17 基准词表内`,
        );
      }
    }
    // 非肌群目标（有氧/全身）映射 null，不强行归并到骨骼肌
    assert.strictEqual(MUSCLE_ALIASES["cardiovascular system"], null);
    assert.strictEqual(MUSCLE_ALIASES["full body"], null);
  });

  test("every MUSCLE_ALIASES value lands inside the 17-muscle vocabulary or is null", () => {
    for (const [raw, mapped] of Object.entries(MUSCLE_ALIASES)) {
      if (mapped === null) continue;
      assert.ok(
        (EXERCISE_MUSCLES as readonly string[]).includes(mapped),
        `"${raw}" 映射到 "${mapped}" 不在词表内`,
      );
    }
  });

  test("all 76 lib3 secondaryMuscles raw values are covered by MUSCLE_ALIASES (anatomical synonyms or explicit null)", () => {
    // 库3 free-exercise-db-with-videos 317 条 secondaryMuscles 实测全集（2026-09-26）。
    // A3 数据纪律：每个源原值必须显式映射或显式 null，禁止静默丢值。
    const LIB3_SECONDARY = [
      "abdominals",
      "achilles tendon",
      "adductors",
      "anconeus",
      "ankle stabilizers",
      "ankles",
      "anterior deltoid",
      "anterior deltoids",
      "biceps",
      "biceps brachii",
      "brachialis",
      "brachioradialis",
      "calves",
      "chest",
      "core",
      "core stabilizers",
      "deltoids",
      "erector spinae",
      "flexor carpi radialis",
      "flexor carpi ulnaris",
      "forearms",
      "gastrocnemius",
      "glutes",
      "gluteus maximus",
      "gluteus medius",
      "gluteus minimus",
      "groin",
      "hamstrings",
      "hip abductors",
      "hip flexors",
      "iliopsoas",
      "infraspinatus",
      "intercostals",
      "latissimus dorsi",
      "lower abdominals",
      "lower abs",
      "lower back",
      "lower trapezius",
      "middle trapezius",
      "obliques",
      "pectoralis major",
      "pectorals",
      "peroneals",
      "piriformis",
      "posterior deltoid",
      "posterior deltoids",
      "quadratus lumborum",
      "quadriceps",
      "rear deltoids",
      "rectus abdominis",
      "rectus femoris",
      "rhoboids",
      "rhomboids",
      "rotator cuff",
      "scalenes",
      "serratus anterior",
      "shoulders",
      "soleus",
      "spinal erectors",
      "tensor fasciae latae",
      "teres major",
      "tibialis anterior",
      "tibialis posterior",
      "transverse abdominis",
      "trapezius",
      "traps",
      "triceps",
      "triceps brachii",
      "upper back",
      "upper chest",
      "upper pectorals",
      "upper trapezius",
      "varies by machine",
      "varies by machine (legs, glutes, arms)",
      "varies by movement",
      "vastus medialis",
    ];
    assert.strictEqual(LIB3_SECONDARY.length, 76);

    for (const raw of LIB3_SECONDARY) {
      assert.ok(
        raw in MUSCLE_ALIASES,
        `库3 secondaryMuscles "${raw}" 缺映射（A3 数据纪律：显式映射或显式 null）`,
      );
    }
    // 解剖学同义词抽查（桶归属的解剖依据见 MUSCLE_ALIASES 注释）
    assert.strictEqual(MUSCLE_ALIASES["trapezius"], "traps");
    assert.strictEqual(MUSCLE_ALIASES["gluteus maximus"], "glutes");
    assert.strictEqual(MUSCLE_ALIASES["latissimus dorsi"], "lats");
    assert.strictEqual(MUSCLE_ALIASES["biceps brachii"], "biceps");
    assert.strictEqual(MUSCLE_ALIASES["brachialis"], "biceps");
    assert.strictEqual(MUSCLE_ALIASES["teres major"], "lats");
    assert.strictEqual(MUSCLE_ALIASES["rotator cuff"], "shoulders");
    assert.strictEqual(MUSCLE_ALIASES["soleus"], "calves");
    assert.strictEqual(MUSCLE_ALIASES["iliopsoas"], "quadriceps");
    assert.strictEqual(MUSCLE_ALIASES["rhoboids"], "middle_back"); // 源拼写错误照录
    // 含糊/非肌值显式 null
    assert.strictEqual(MUSCLE_ALIASES["core"], null);
    assert.strictEqual(MUSCLE_ALIASES["ankles"], null);
    assert.strictEqual(MUSCLE_ALIASES["achilles tendon"], null);
    assert.strictEqual(MUSCLE_ALIASES["varies by movement"], null);
  });

  test("every EQUIPMENT_ALIASES value lands inside the 15-equipment vocabulary", () => {
    for (const [raw, mapped] of Object.entries(EQUIPMENT_ALIASES)) {
      assert.ok(
        (EXERCISE_EQUIPMENT as readonly string[]).includes(mapped),
        `"${raw}" 映射到 "${mapped}" 不在器材词表内`,
      );
    }
    // 任务口径：源 null/'body only'/'body weight'/None → bodyweight
    assert.strictEqual(EQUIPMENT_ALIASES["body only"], "bodyweight");
    assert.strictEqual(EQUIPMENT_ALIASES["body weight"], "bodyweight");
    assert.strictEqual(EQUIPMENT_ALIASES["None"], "bodyweight");
  });

  test("normalize functions: trim + case-insensitive fallback + null for unknown", () => {
    // 归一命中（库1/库3 原值；中文兼容映射已随 002 返工移除——A3 数据全走英文词表）
    assert.strictEqual(normalizeMuscle("lower back"), "lower_back");
    assert.strictEqual(normalizeMuscle("rectus abdominis"), "abdominals");
    assert.strictEqual(normalizeMuscle("cardiovascular system"), null);
    assert.strictEqual(normalizeEquipment("e-z curl bar"), "barbell");
    assert.strictEqual(normalizeEquipment("leverage machine"), "machine");
    // trim / 大小写兜底
    assert.strictEqual(normalizeMuscle(" Chest "), "chest");
    assert.strictEqual(normalizeEquipment("Barbell"), "barbell");
    // 未知原值 → null（调用方记日志，不静默映射）
    assert.strictEqual(normalizeMuscle("some-unknown-muscle"), null);
    assert.strictEqual(normalizeEquipment("flux-capacitor"), null);
    // 难度：库1 expert → advanced，其余原样
    assert.strictEqual(normalizeDifficulty("expert"), "advanced");
    assert.strictEqual(normalizeDifficulty("intermediate"), "intermediate");
  });

  test("ExerciseLibraryItemSchema accepts a fully-populated lib3-style item", () => {
    const result = ExerciseLibraryItemSchema.safeParse(buildLibraryItem());
    assert.strictEqual(result.success, true);
  });

  test("ExerciseLibraryItemSchema tolerates legacy rows: null teaching columns, empty muscle arrays", () => {
    // 回填后的存量行形态：新教学列全 null、attributes 无结构化 targets 也允许
    const legacy = ExerciseLibraryItemSchema.safeParse({
      ...buildLibraryItem(),
      equipment: null,
      category: null,
      body_part: null,
      primary_muscles: [],
      secondary_muscles: [],
      force_type: null,
      mechanic: null,
      instructions: null,
      form_cues: null,
      common_mistakes: null,
      breathing: null,
      aliases: null,
      image_refs: null,
      video_urls: null,
      poster_url: null,
      name_zh: null,
      instructions_zh: null,
      owner_user_id: null,
    });
    assert.strictEqual(legacy.success, true);
  });

  test("ExerciseLibraryItemSchema rejects out-of-vocabulary values", () => {
    for (const [field, bad] of [
      ["equipment", "flux-capacitor"],
      ["category", "yoga"],
      ["body_part", "tail"],
      ["force_type", "twist"],
      ["mechanic", "hybrid"],
      ["primary_muscles", ["中下胸"]], // 中文词表值不再进结构化列（须先归一）
      ["secondary_muscles", ["brachialis"]],
    ] as const) {
      const result = ExerciseLibraryItemSchema.safeParse({
        ...buildLibraryItem(),
        [field]: bad,
      });
      assert.strictEqual(
        result.success,
        false,
        `${field}="${JSON.stringify(bad)}" 应被词表拒绝`,
      );
    }
  });

  test("ExerciseVideoUrlsSchema requires well-formed URLs", () => {
    assert.strictEqual(
      ExerciseVideoUrlsSchema.safeParse({
        male: "https://cdn.example.com/male/squat.mp4",
        female: "https://cdn.example.com/female/squat.mp4",
      }).success,
      true,
    );
    assert.strictEqual(
      ExerciseVideoUrlsSchema.safeParse({ male: "not-a-url" }).success,
      false,
    );
    // 空对象/单版本合法（库3 部分动作只有单性别视频）
    assert.strictEqual(ExerciseVideoUrlsSchema.safeParse({}).success, true);
    assert.strictEqual(
      ExerciseVideoUrlsSchema.safeParse({ female: "https://x.example/f.mp4" })
        .success,
      true,
    );
  });

  test("ExerciseDetailUpdateSchema rejects empty patches and accepts whitelisted fields", () => {
    assert.strictEqual(
      ExerciseDetailUpdateSchema.safeParse({}).success,
      false,
      "空 patch 应被拒绝（至少一个字段）",
    );
    // 中文回写管道入口
    const zhPatch = ExerciseDetailUpdateSchema.safeParse({
      name_zh: "杠铃深蹲",
      instructions_zh: ["站立，双脚与肩同宽", "下蹲至大腿平行", "站起还原"],
    });
    assert.strictEqual(zhPatch.success, true);
    // 结构化字段可整体置空（null = 清空）
    assert.strictEqual(
      ExerciseDetailUpdateSchema.safeParse({ poster_url: null }).success,
      true,
    );
    // 词表外值拒绝
    assert.strictEqual(
      ExerciseDetailUpdateSchema.safeParse({ equipment: "magic" }).success,
      false,
    );
  });
});

/** 构造合法的库3风格深化行样本（全部新列填充） */
function buildLibraryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-exercise-0001",
    name: "Barbell Squat",
    name_zh: "杠铃深蹲",
    exercise_type: "resistance",
    difficulty: "beginner",
    equipment: "barbell",
    category: "strength",
    body_part: "upper_legs",
    primary_muscles: ["quadriceps"],
    secondary_muscles: ["glutes", "hamstrings"],
    force_type: "push",
    mechanic: "compound",
    instructions: [
      "Position the bar on your upper traps.",
      "Descend until thighs are parallel to the floor.",
      "Drive through the heels to stand.",
    ],
    form_cues: ["Keep chest up", "Knees track over toes"],
    common_mistakes: ["Knees caving in", "Lifting heels"],
    breathing: "Inhale at the top, brace, exhale on the way up.",
    aliases: ["back squat", "low-bar squat"],
    instructions_zh: null,
    image_refs: [
      "/exercises/Barbell_Squat/0.jpg",
      "/exercises/Barbell_Squat/1.jpg",
    ],
    video_urls: {
      male: "https://cdn.example.com/exercise-videos/male/barbell-squat.mp4",
      female:
        "https://cdn.example.com/exercise-videos/female/barbell-squat.mp4",
    },
    poster_url:
      "https://cdn.example.com/exercise-posters/male/barbell-squat.jpg",
    owner_user_id: null,
    modified_by: "system",
    modified_at: "2026-09-26T08:00:00.000Z",
    created_at: "2026-09-26T08:00:00.000Z",
    updated_at: "2026-09-26T08:00:00.000Z",
    ...overrides,
  };
}

describe("Contract Tests: Weekly Plan", () => {
  test("create input accepts a full plan with entries and applies defaults", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(buildCreateInput());
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.status, "active"); // 周计划状态默认 active
      assert.strictEqual(result.data.entries.length, 1);
      assert.strictEqual(result.data.entries[0].status, "planned"); // 条目默认 planned
      assert.strictEqual(result.data.entries[0].sort_order, 0); // 排序默认 0
    }
  });

  test("create input defaults entries to empty array", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse({
      user_id: WP_USER_ID,
      week_id: "2026-W40",
      split: "full_body",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.entries, []);
    }
  });

  test("week_id must be ISO week format YYYY-Www (01-53)", () => {
    for (const ok of ["2026-W01", "2026-W40", "2026-W53", "2020-W07"]) {
      assert.strictEqual(
        WeekIdSchema.safeParse(ok).success,
        true,
        `${ok} 应合法`,
      );
    }
    // 非法：周号缺零 / 越界（00、54）/ 两位年 / 非法字符
    for (const bad of [
      "2026-W1",
      "2026-W00",
      "2026-W54",
      "26-W05",
      "2026-W4x",
      "",
    ]) {
      assert.strictEqual(
        WeekIdSchema.safeParse(bad).success,
        false,
        `"${bad}" 应被拒绝`,
      );
    }
    const badInput = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ week_id: "2026-W54" }),
    );
    assert.strictEqual(badInput.success, false);
    if (!badInput.success) {
      assert.ok(badInput.error.issues.some((i) => i.path.includes("week_id")));
    }
  });

  test("user_id must be a UUID", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ user_id: "not-a-uuid" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("user_id")));
    }
  });

  test("split must be a known enum value", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ split: "bro_split" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("split")));
    }
  });

  test("entry_date must be calendar day YYYY-MM-DD", () => {
    for (const bad of ["2026-9-28", "20260928", "2026-09-28T00:00:00Z"]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ entry_date: bad }),
      );
      assert.strictEqual(result.success, false, `entry_date "${bad}" 应被拒绝`);
    }
  });

  test("exercise_id must be NanoID-shaped (12-24 chars)", () => {
    assert.strictEqual(
      PlanEntrySchema.safeParse(buildEntryRow({ exercise_id: "short-id" }))
        .success,
      false,
    );
    assert.strictEqual(
      PlanEntrySchema.safeParse(buildEntryRow({ exercise_id: "x".repeat(25) }))
        .success,
      false,
    );
  });

  test("target_sets must be a positive integer", () => {
    for (const bad of [0, -1, 1.5, "4"]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ target_sets: bad }),
      );
      assert.strictEqual(
        result.success,
        false,
        `target_sets ${JSON.stringify(bad)} 应被拒绝`,
      );
    }
  });

  test("target_load rpe bounds are [0, 10]", () => {
    assert.strictEqual(
      PlanEntrySchema.safeParse(
        buildEntryRow({ target_load: { type: "rpe", min: 0, max: 10 } }),
      ).success,
      true,
    );
    for (const bad of [
      { type: "rpe", min: -1, max: 8 },
      { type: "rpe", min: 7, max: 11 },
    ]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ target_load: bad }),
      );
      assert.strictEqual(
        result.success,
        false,
        `rpe ${JSON.stringify(bad)} 应越界拒绝`,
      );
    }
  });

  test("target_load percent_1rm bounds are (0, 100]", () => {
    assert.strictEqual(
      PlanEntrySchema.safeParse(
        buildEntryRow({
          target_load: { type: "percent_1rm", min: 40, max: 95 },
        }),
      ).success,
      true,
    );
    for (const bad of [
      { type: "percent_1rm", min: 0, max: 80 }, // 0 非法（开区间下界）
      { type: "percent_1rm", min: 70, max: 101 }, // 101 越上界
    ]) {
      const result = PlanEntrySchema.safeParse(
        buildEntryRow({ target_load: bad }),
      );
      assert.strictEqual(
        result.success,
        false,
        `percent_1rm ${JSON.stringify(bad)} 应越界拒绝`,
      );
    }
  });

  test("target_load rejects min > max and unknown type", () => {
    const reversed = PlanEntrySchema.safeParse(
      buildEntryRow({ target_load: { type: "rpe", min: 9, max: 7 } }),
    );
    assert.strictEqual(reversed.success, false);

    const badType = PlanEntrySchema.safeParse(
      buildEntryRow({ target_load: { type: "velocity", min: 1, max: 2 } }),
    );
    assert.strictEqual(badType.success, false);
  });

  test("row schemas validate persisted plan and entry shapes", () => {
    const plan: WeeklyPlan = WeeklyPlanSchema.parse(buildPlanRow());
    assert.strictEqual(plan.week_id, "2026-W40");

    const entry: PlanEntry = PlanEntrySchema.parse(buildEntryRow());
    assert.strictEqual(entry.target_load.type, "rpe");
    assert.strictEqual(entry.target_load.min, 7);

    const combined = WeeklyPlanWithEntriesSchema.safeParse({
      plan: buildPlanRow(),
      entries: [buildEntryRow()],
    });
    assert.strictEqual(combined.success, true);
  });

  test("entry status must be a known state machine value", () => {
    const result = PlanEntrySchema.safeParse(
      buildEntryRow({ status: "cancelled" }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("status")));
    }
  });

  test("create input rejects entries over the 200 cap", () => {
    const entries = Array.from({ length: 201 }, () => ({
      entry_date: "2026-09-28",
      exercise_id: WP_EXERCISE_ID,
      target_sets: 1,
      target_load: { type: "rpe", min: 1, max: 2 },
    }));
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ entries }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("entries")));
    }
  });

  test("state machine: planned→adjusted→completed/skipped, terminals sealed", () => {
    // 合法前进
    assert.strictEqual(
      canTransitionPlanEntryStatus("planned", "adjusted"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("planned", "completed"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("planned", "skipped"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("adjusted", "adjusted"),
      true,
    ); // 再调整
    assert.strictEqual(
      canTransitionPlanEntryStatus("adjusted", "completed"),
      true,
    );
    assert.strictEqual(
      canTransitionPlanEntryStatus("adjusted", "skipped"),
      true,
    );

    // 终态封闭：completed / skipped 无出边
    assert.deepStrictEqual(PLAN_ENTRY_STATUS_TRANSITIONS.completed, []);
    assert.deepStrictEqual(PLAN_ENTRY_STATUS_TRANSITIONS.skipped, []);
    for (const terminal of ["completed", "skipped"] as const) {
      for (const to of [
        "planned",
        "adjusted",
        "completed",
        "skipped",
      ] as const) {
        if (to === terminal) continue; // 同态幂等放行
        assert.strictEqual(
          canTransitionPlanEntryStatus(terminal, to),
          false,
          `${terminal} → ${to} 应非法`,
        );
      }
    }

    // 同态迁移 = 幂等重放，恒放行
    for (const s of ["planned", "adjusted", "completed", "skipped"] as const) {
      assert.strictEqual(canTransitionPlanEntryStatus(s, s), true);
    }
  });
});

// ============================================================================
// Contract Tests: Weekly Plan Structured Fields (T9 / issue #66)
// day_focus / rationale / category / sets 逐组处方——新字段 Zod 往返 + 旧数据回落
// ============================================================================

describe("Contract Tests: Weekly Plan Structured Fields (T9)", () => {
  /** T9 全字段条目输入（apply 载荷单条形态） */
  function structuredEntryInput(overrides: Record<string, unknown> = {}) {
    return {
      entry_date: "2026-09-28",
      exercise_id: WP_EXERCISE_ID,
      target_sets: 3,
      target_load: { type: "rpe", min: 6, max: 8 },
      status: "planned",
      sort_order: 1,
      day_focus: "胸肩三头",
      rationale: "复合动作打底建立基础力量，末端轻量收尾",
      category: "main",
      sets: [
        { set_no: 1, weight_kg: 60, reps: 8, rpe: 7 },
        { set_no: 2, weight_kg: 62.5, reps: 8, rpe: 7.5 },
        { set_no: 3, weight_kg: 65, reps: 6, rpe: 8 },
      ],
      ...overrides,
    };
  }

  test("input with full structured fields roundtrips (values preserved)", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({ entries: [structuredEntryInput()] }),
    );
    assert.strictEqual(result.success, true);
    if (result.success) {
      const e = result.data.entries[0];
      assert.strictEqual(e.day_focus, "胸肩三头");
      assert.strictEqual(e.category, "main");
      assert.strictEqual(e.sets?.length, 3);
      assert.strictEqual(e.sets?.[0].weight_kg, 60);
      assert.strictEqual(e.sets?.[0].rpe, 7);
      assert.strictEqual(e.sets?.[2].reps, 6);
    }
  });

  test("legacy apply payload (no structured fields) still parses — backward compat", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({
        entries: [
          {
            entry_date: "2026-09-28",
            exercise_id: WP_EXERCISE_ID,
            target_sets: 4,
            target_load: { type: "rpe", min: 7, max: 8 },
          },
        ],
      }),
    );
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.entries[0].day_focus, undefined);
      assert.strictEqual(result.data.entries[0].sets, undefined);
    }
  });

  test("legacy row (structured columns all NULL) parses — old-plan fallback", () => {
    const entry = PlanEntrySchema.parse(buildEntryRow()); // fixture 默认全 null
    assert.strictEqual(entry.day_focus, null);
    assert.strictEqual(entry.rationale, null);
    assert.strictEqual(entry.category, null);
    assert.strictEqual(entry.sets, null);
  });

  test("enriched row roundtrips through PlanEntrySchema", () => {
    const entry = PlanEntrySchema.parse(
      buildEntryRow({
        target_sets: 2,
        day_focus: "腿",
        rationale: "深蹲日：主项 5×5 建立模式，注意下背中立",
        category: "main",
        sets: [
          { set_no: 1, weight_kg: 80, reps: 5, rpe: 7 },
          { set_no: 2, reps: 12, rpe: 5 }, // 自重组：weight_kg 可省
        ],
      }),
    );
    assert.strictEqual(entry.day_focus, "腿");
    assert.strictEqual(entry.category, "main");
    assert.strictEqual(entry.sets?.[1].weight_kg, undefined);
    assert.strictEqual(entry.sets?.[1].reps, 12);
  });

  test("sets length must equal target_sets (display=storage same-source rule)", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({
        entries: [
          structuredEntryInput({
            target_sets: 4, // sets 只有 3 组
          }),
        ],
      }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("sets")));
    }
  });

  test("set_no must be contiguous 1..N", () => {
    const result = CreateWeeklyPlanInputSchema.safeParse(
      buildCreateInput({
        entries: [
          structuredEntryInput({
            sets: [
              { set_no: 1, weight_kg: 60, reps: 8, rpe: 7 },
              { set_no: 3, weight_kg: 65, reps: 6, rpe: 8 }, // 跳号
            ],
            target_sets: 2,
          }),
        ],
      }),
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((i) => i.path.includes("set_no")));
    }
  });

  test("per-set prescription field bounds: rpe 0-10, reps positive int, set_no positive", () => {
    assert.strictEqual(
      PlanSetPrescriptionSchema.safeParse({
        set_no: 1,
        reps: 8,
        rpe: 10.5,
      }).success,
      false,
    );
    assert.strictEqual(
      PlanSetPrescriptionSchema.safeParse({ set_no: 1, reps: 0, rpe: 7 })
        .success,
      false,
    );
    assert.strictEqual(
      PlanSetPrescriptionSchema.safeParse({ set_no: 0, reps: 8, rpe: 7 })
        .success,
      false,
    );
    // 合法上界：rpe 10 / 0.5 步进 / weight_kg 省略
    assert.strictEqual(
      PlanSetPrescriptionSchema.safeParse({ set_no: 1, reps: 8, rpe: 10 })
        .success,
      true,
    );
  });

  test("category enum is exactly warmup|main|cooldown", () => {
    assert.deepStrictEqual(
      [...PLAN_ENTRY_CATEGORY_VALUES],
      ["warmup", "main", "cooldown"],
    );
    assert.strictEqual(
      PlanEntryCategorySchema.safeParse("cardio").success,
      false,
    );
  });

  test("resolvePlanEntryCategory falls back to main on legacy NULL", () => {
    assert.strictEqual(resolvePlanEntryCategory(null), "main");
    assert.strictEqual(resolvePlanEntryCategory(undefined), "main");
    assert.strictEqual(resolvePlanEntryCategory("warmup"), "warmup");
    assert.strictEqual(resolvePlanEntryCategory("cooldown"), "cooldown");
  });

  test("today schedule entry: new fields optional (legacy render path) and validated when present", () => {
    const base = {
      entry_id: WP_ENTRY_ID,
      exercise_id: WP_EXERCISE_ID,
      exercise_name: "杠铃深蹲",
      target_sets: 3,
      target_load: { type: "rpe", min: 6, max: 8 },
      status: "planned",
      sort_order: 0,
    };
    // 旧数据回落渲染：缺新字段也过（后端出库恒携带，此处锁「缺省不炸」）
    assert.strictEqual(TodayScheduleEntrySchema.safeParse(base).success, true);
    // 全字段
    const full = TodayScheduleEntrySchema.safeParse({
      ...base,
      day_focus: "腿",
      rationale: "深蹲日",
      category: "warmup",
      sets: [{ set_no: 1, reps: 10, rpe: 4 }],
    });
    assert.strictEqual(full.success, true);
    // 非法段位拒绝
    assert.strictEqual(
      TodayScheduleEntrySchema.safeParse({ ...base, category: "finisher" })
        .success,
      false,
    );
  });

  test("weekly_plan card accepts day rationale + exercise category (display layer)", () => {
    const card = WeeklyPlanCardDataSchema.safeParse({
      week_label: "第 1 周",
      split_summary: "全身 · 每周 3 练",
      days: [
        {
          entry_date: "2026-09-28",
          split_label: "全身 A",
          focus: "蹲+水平推拉",
          rationale: "首个训练日以复合动作建立动作模式",
          rest: false,
          exercises: [
            {
              exercise_id: WP_EXERCISE_ID,
              name: "杠铃深蹲",
              category: "main",
              sets: [{ set: 1, weight: 40, reps: 8 }],
            },
            {
              exercise_id: "bench-press-00002",
              name: "弹力带肩外旋",
              category: "warmup",
              sets: [{ set: 1, reps: 15 }],
            },
          ],
        },
        { entry_date: "2026-09-29", rest: true, exercises: [] },
      ],
    });
    assert.strictEqual(card.success, true);
    if (card.success) {
      assert.strictEqual(card.data.days[0].rationale?.length > 0, true);
      assert.strictEqual(card.data.days[0].exercises[1].category, "warmup");
    }
  });
});

// ============================================================================
// Contract Tests: Today Schedule (E2) + ISO week derivation（真源 weekly-plan.ts）
// ============================================================================

describe("Contract Tests: Today Schedule & ISO Week", () => {
  const ENTRY = {
    entry_id: "3f2b1a00-0000-4000-8000-000000000001",
    exercise_id: "test-exercise-0001",
    exercise_name: "杠铃深蹲",
    target_sets: 4,
    target_load: { type: "percent_1rm", min: 70, max: 80 },
    status: "planned",
    sort_order: 1,
  };

  test("getIsoWeekId derives known anchors (ISO-8601, Monday start, Thursday rule)", () => {
    const anchors: Array<[string, string]> = [
      ["2026-01-01", "2026-W01"], // 元旦恰为周四
      ["2025-12-29", "2026-W01"], // 跨年向前：上年 12 月末属来年 W01
      ["2026-09-26", "2026-W39"],
      ["2026-12-31", "2026-W53"], // 2026 为 53 周长年
      ["2027-01-01", "2026-W53"], // 跨年向后：元旦周五属上年 W53
      ["2024-12-29", "2024-W52"], // 周日收尾一周
      ["2020-01-03", "2020-W01"],
      ["2021-01-01", "2020-W53"], // 闰年长周跨年
    ];
    for (const [date, week] of anchors) {
      assert.strictEqual(getIsoWeekId(date), week, `${date} → ${week}`);
    }
  });

  test("getIsoWeekId throws on malformed date", () => {
    for (const bad of ["2026-9-26", "20260926", "2026-09-26T00:00:00Z", ""]) {
      assert.throws(() => getIsoWeekId(bad), /YYYY-MM-DD/, `"${bad}" 应抛错`);
    }
  });

  test("TodayScheduleEntry rejects rows without the joined exercise_name", () => {
    const { exercise_name: _drop, ...withoutName } = ENTRY;
    assert.strictEqual(
      TodayScheduleEntrySchema.safeParse(withoutName).success,
      false,
    );
  });

  test("TodayScheduleResponse accepts all three statuses with correct shapes", () => {
    const base = { date: "2026-09-26", week_id: "2026-W39" };
    // planned：split + 非空 entries
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "planned",
        split: "upper_lower",
        entries: [ENTRY],
      }).success,
      true,
    );
    // rest_day：计划元数据仍在，entries 空
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "rest_day",
        split: "full_body",
        entries: [],
      }).success,
      true,
    );
    // no_plan：确定性兜底——split 必为 null、entries 必为空
    const noPlan = TodayScheduleResponseSchema.safeParse({
      ...base,
      status: "no_plan",
      split: null,
      entries: [],
    });
    assert.strictEqual(noPlan.success, true);
    // no_plan 带 split 或条目则拒（兜底形态不可漂移）
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "no_plan",
        split: "full_body",
        entries: [],
      }).success,
      false,
    );
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        ...base,
        status: "no_plan",
        split: null,
        entries: [ENTRY],
      }).success,
      false,
    );
  });

  test("TodayScheduleResponse rejects malformed date / unknown status", () => {
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        date: "2026-9-26",
        week_id: "2026-W39",
        status: "planned",
        split: "full_body",
        entries: [ENTRY],
      }).success,
      false,
    );
    assert.strictEqual(
      TodayScheduleResponseSchema.safeParse({
        date: "2026-09-26",
        week_id: "2026-W39",
        status: "maybe",
        split: null,
        entries: [],
      }).success,
      false,
    );
  });
});

// ============================================================================
// Contract Tests: Schedule Summary（真源 shared/contracts/schedule-summary.ts — B2 / issue #22）
// ============================================================================

describe("Contract Tests: Schedule Summary (start-workout routing)", () => {
  const SS_ENTRY = {
    entry_id: "3f2b1a00-0000-4000-8000-000000000002",
    exercise_id: "test-exercise-0001",
    exercise_name: "杠铃深蹲",
    target_sets: 4,
    target_load: { type: "percent_1rm", min: 70, max: 80 },
    status: "planned",
    sort_order: 0,
  };

  test("ScheduleSummaryResponse accepts the canonical routing shapes", () => {
    // 计划用户 + 今日有课（B1 预填数据源形态）
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: true,
        today: "scheduled",
        today_entries: [SS_ENTRY],
        user_stage: "planner",
        onboarding: "done",
      }).success,
      true,
    );
    // 计划用户 + 休息日
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: true,
        today: "rest",
        today_entries: [],
        user_stage: "planner",
        onboarding: "done",
      }).success,
      true,
    );
    // 计划用户新周未排（has_plan 与本周口径解耦的合法形态）
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: true,
        today: "none",
        today_entries: [],
        user_stage: "planner",
        onboarding: "done",
      }).success,
      true,
    );
    // 老手无计划
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: false,
        today: "none",
        today_entries: [],
        user_stage: "veteran_no_plan",
        onboarding: "done",
      }).success,
      true,
    );
    // 纯新手首次使用（onboarding=needed 的唯一合法宿主）
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: false,
        today: "none",
        today_entries: [],
        user_stage: "newcomer",
        onboarding: "needed",
      }).success,
      true,
    );
  });

  test("today 形态互锁：none/scheduled/rest 与条目数组不允许矛盾", () => {
    // none 带条目 → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: false,
        today: "none",
        today_entries: [SS_ENTRY],
        user_stage: "newcomer",
        onboarding: "needed",
      }).success,
      false,
    );
    // scheduled 空条目 → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: true,
        today: "scheduled",
        today_entries: [],
        user_stage: "planner",
        onboarding: "done",
      }).success,
      false,
    );
    // rest 带条目 → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: true,
        today: "rest",
        today_entries: [SS_ENTRY],
        user_stage: "planner",
        onboarding: "done",
      }).success,
      false,
    );
  });

  test("user_stage ⟷ has_plan 同源锁定（矛盾组合拒收）", () => {
    const base = { today: "none", today_entries: [], onboarding: "done" };
    // planner 但无计划 → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        ...base,
        has_plan: false,
        user_stage: "planner",
      }).success,
      false,
    );
    // newcomer 但有计划 → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        ...base,
        has_plan: true,
        user_stage: "newcomer",
      }).success,
      false,
    );
    // veteran_no_plan 但有计划 → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        ...base,
        has_plan: true,
        user_stage: "veteran_no_plan",
      }).success,
      false,
    );
  });

  test("onboarding=needed 仅限纯新手形态；未知枚举值拒收", () => {
    // needed 但 stage 非 newcomer → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: false,
        today: "none",
        today_entries: [],
        user_stage: "veteran_no_plan",
        onboarding: "needed",
      }).success,
      false,
    );
    // needed 但有计划 → 拒
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        has_plan: true,
        today: "none",
        today_entries: [],
        user_stage: "planner",
        onboarding: "needed",
      }).success,
      false,
    );
    // 未知 today / user_stage / onboarding 枚举 → 拒
    const ok = {
      has_plan: false,
      today_entries: [],
      user_stage: "newcomer",
      onboarding: "needed",
    };
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({ ...ok, today: "maybe" })
        .success,
      false,
    );
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        ...ok,
        today: "none",
        user_stage: "admin",
      }).success,
      false,
    );
    assert.strictEqual(
      ScheduleSummaryResponseSchema.safeParse({
        ...ok,
        today: "none",
        onboarding: "pending",
      }).success,
      false,
    );
  });

  test("TODAY_STATUS_TO_SUMMARY maps the full E2 status domain (no dead keys)", () => {
    assert.deepStrictEqual(TODAY_STATUS_TO_SUMMARY, {
      planned: "scheduled",
      rest_day: "rest",
      no_plan: "none",
    });
  });
});

// ============================================================================
// #114 契约批 B5a：问卷契约（survey.ts）+ 画像新字段（weekly_frequency_days /
// goal+body_recomp / active_limitations.note+auto_heal:false）+ 落库白名单链路
// ============================================================================
import {
  SurveyQuestionOptionSchema,
  SurveyQuestionSchema,
  SurveyCardDataSchema,
  PURPOSE_ENUM,
  PROFILE_INTAKE_QUESTIONS,
  PROFILE_INTAKE_QUESTION_IDS,
  PreferencesSchema,
  ActiveLimitationSchema,
  createActiveLimitation,
  isLimitationExpired,
  filterExpiredLimitations,
  LONG_TERM_INJURY_EXPIRE_AT,
  ExerciseEquipmentSchema,
} from "../../shared/contracts/index.js";
import { UserProfileService } from "../src/services/userProfileService.js";

describe("#114 survey contracts — SurveyQuestion/SurveyCardData 扩展", () => {
  test("旧形态问卷卡（无任何新字段）原样通过（向后兼容断言）", () => {
    // uiHintValidator.test.ts 旧 fixture 同款形状：仅 id/question/required
    const legacy = {
      title: "Feedback",
      questions: [{ id: "q1", question: "How was it?", required: false }],
    };
    assert.ok(SurveyCardDataSchema.safeParse(legacy).success);
  });

  test("children 二级菜单：选项可携带递归子选项（器材 场地→器材多选）", () => {
    const card = {
      purpose: "profile_intake",
      questions: [
        {
          id: "equipment_venue",
          question: "主要训练场地",
          required: true,
          inputType: "select",
          childKey: "equipment_items",
          options: [
            {
              label: "健身房",
              value: "gym",
              children: [
                { label: "杠铃", value: "barbell" },
                { label: "深蹲架", value: "rack" },
              ],
            },
            { label: "户外", value: "outdoor", children: [] },
          ],
        },
      ],
    };
    const parsed = SurveyCardDataSchema.safeParse(card);
    assert.ok(parsed.success);
    if (parsed.success) {
      const q = parsed.data.questions[0];
      assert.equal(q.childKey, "equipment_items");
      assert.equal(q.options?.[0].children?.length, 2);
      assert.equal(q.options?.[0].children?.[0].value, "barbell");
    }
  });

  test("children 递归两层：孙选项形状仍受校验（坏 value 被拒）", () => {
    const bad = SurveyQuestionOptionSchema.safeParse({
      label: "场地",
      value: "gym",
      children: [{ label: "杠铃", value: "" }], // 空 value 违反 min(1)
    });
    assert.ok(!bad.success);
  });

  test("inputType 枚举扩容：select / textarea 通过，旧值 text/number/checkbox 仍通过", () => {
    for (const t of ["text", "number", "checkbox", "select", "textarea"]) {
      assert.ok(
        SurveyQuestionSchema.safeParse({
          id: "q",
          question: "q",
          required: false,
          inputType: t,
        }).success,
        `inputType=${t} 应通过`,
      );
    }
    assert.ok(
      !SurveyQuestionSchema.safeParse({
        id: "q",
        question: "q",
        required: false,
        inputType: "radio",
      }).success,
    );
  });

  test("textarea 补充框全字段：maxLength/placeholder/section/hint 落位", () => {
    const parsed = SurveyQuestionSchema.safeParse({
      id: "notes",
      question: "还有什么想让教练知道的？",
      required: false,
      inputType: "textarea",
      section: "自由补充",
      maxLength: 500,
      placeholder: "夜班倒班、产后恢复……",
    });
    assert.ok(parsed.success);
    if (parsed.success) {
      assert.equal(parsed.data.maxLength, 500);
      assert.equal(parsed.data.section, "自由补充");
    }
  });

  test("condition 条件显示：equals 单值与数组均可表达", () => {
    assert.ok(
      SurveyQuestionSchema.safeParse({
        id: "age",
        question: "年龄",
        required: true,
        inputType: "number",
        min: 14,
        max: 90,
        condition: {
          questionId: "goal",
          equals: ["fat_loss", "general_fitness"],
        },
      }).success,
    );
    assert.ok(
      SurveyQuestionSchema.safeParse({
        id: "x",
        question: "x",
        required: false,
        condition: { questionId: "goal", equals: "fat_loss" },
      }).success,
    );
  });

  test("purpose 卡级枚举：三用途通过，未知值拒绝", () => {
    for (const p of PURPOSE_ENUM) {
      assert.ok(
        SurveyCardDataSchema.safeParse({
          purpose: p,
          questions: [{ id: "q", question: "q", required: false }],
        }).success,
      );
    }
    assert.ok(
      !SurveyCardDataSchema.safeParse({
        purpose: "onboarding_v9",
        questions: [{ id: "q", question: "q", required: false }],
      }).success,
    );
  });
});

describe("#114 survey contracts — PROFILE_INTAKE_QUESTIONS 题库定稿", () => {
  test("整库通过 SurveyCardDataSchema（purpose=profile_intake）", () => {
    const parsed = SurveyCardDataSchema.safeParse({
      purpose: "profile_intake",
      title: "训练画像调研",
      questions: PROFILE_INTAKE_QUESTIONS,
    });
    assert.ok(
      parsed.success,
      JSON.stringify((parsed as any).error?.issues ?? []),
    );
  });

  test("题目 id 唯一，且 id+childKey 恰好覆盖 PROFILE_INTAKE_QUESTION_IDS（防漂移）", () => {
    const ids = PROFILE_INTAKE_QUESTIONS.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, "题目 id 不得重复");
    const answerKeys = new Set([
      ...ids,
      ...PROFILE_INTAKE_QUESTIONS.flatMap((q) =>
        q.childKey ? [q.childKey] : [],
      ),
    ]);
    assert.deepEqual(
      [...answerKeys].sort(),
      [...PROFILE_INTAKE_QUESTION_IDS].sort(),
    );
  });

  test("门禁六项必答题齐备（goal/经验/体重/器材/频次/伤病）", () => {
    const byId = new Map(PROFILE_INTAKE_QUESTIONS.map((q) => [q.id, q]));
    for (const id of [
      "goal",
      "experience",
      "weight_kg",
      "equipment_venue",
      "weekly_frequency",
      "injuries",
    ]) {
      const q = byId.get(id);
      assert.ok(q, `必答题 ${id} 缺失`);
      assert.equal(q.required, true, `${id} 必须 required`);
    }
    // 器材二级菜单答案键 = equipment_items（spec §2.5 childKey 语义）
    assert.equal(byId.get("equipment_venue")?.childKey, "equipment_items");
  });

  test("器材二级子选项 value 全部 ∈ EXERCISE_EQUIPMENT（与 find_exercises 零转换）", () => {
    for (const option of PROFILE_INTAKE_QUESTIONS.flatMap(
      (q) => q.options ?? [],
    )) {
      for (const child of option.children ?? []) {
        assert.ok(
          ExerciseEquipmentSchema.safeParse(child.value).success,
          `器材子选项 ${child.value} 不在 EXERCISE_EQUIPMENT 枚举内`,
        );
      }
    }
  });

  test("频次题为单值 1-6 select（消灭区间字符串）", () => {
    const freq = PROFILE_INTAKE_QUESTIONS.find(
      (q) => q.id === "weekly_frequency",
    );
    assert.ok(freq);
    assert.equal(freq.inputType, "select");
    assert.deepEqual(
      freq.options?.map((o) => o.value),
      ["1", "2", "3", "4", "5", "6"],
    );
  });

  test("age 条件必答：goal ∈ {fat_loss, general_fitness} 才渲染（spec §2.2）", () => {
    const age = PROFILE_INTAKE_QUESTIONS.find((q) => q.id === "age");
    assert.ok(age);
    assert.equal(age.condition?.questionId, "goal");
    assert.deepEqual(age.condition?.equals, ["fat_loss", "general_fitness"]);
    assert.equal(age.min, 14);
    assert.equal(age.max, 90);
  });

  test("weight_kg 硬性要求：min 30 / max 250 / unit kg / hint 在位", () => {
    const w = PROFILE_INTAKE_QUESTIONS.find((q) => q.id === "weight_kg");
    assert.ok(w);
    assert.equal(w.min, 30);
    assert.equal(w.max, 250);
    assert.equal(w.unit, "kg");
    assert.ok(w.hint);
  });
});

describe("#114 PreferencesSchema — weekly_frequency_days + goal body_recomp", () => {
  test("weekly_frequency_days：数字直过、表单字符串 coerce、越界拒绝", () => {
    assert.equal(
      PreferencesSchema.parse({ weekly_frequency_days: 3 })
        .weekly_frequency_days,
      3,
    );
    assert.equal(
      PreferencesSchema.parse({ weekly_frequency_days: "4" })
        .weekly_frequency_days,
      4,
    );
    assert.ok(
      !PreferencesSchema.safeParse({ weekly_frequency_days: 0 }).success,
    );
    assert.ok(
      !PreferencesSchema.safeParse({ weekly_frequency_days: 8 }).success,
    );
    assert.ok(
      !PreferencesSchema.safeParse({ weekly_frequency_days: 2.5 }).success,
    );
  });

  test("频次区间字符串 '3-4' 显式失败（不再 parseInt 静默取下界）", () => {
    // 旧断裂：前端 parseInt('3-4')=3 静默取区间下界（useAICoach.ts:549-553）。
    // 拍板 OQ7=A：题库改单值，契约层对区间字符串 loud failure（红线：Zod
    // 校验失败必须抛错，不静默入库）。
    const res = PreferencesSchema.safeParse({ weekly_frequency_days: "3-4" });
    assert.ok(!res.success);
  });

  test("旧 payload 无新字段仍解析通过（兼容断言：存量画像不受影响）", () => {
    const legacy = PreferencesSchema.safeParse({
      goal: "muscle_gain",
      equipment: ["barbell"],
      time_constraint: 60,
    });
    assert.ok(legacy.success);
    if (legacy.success) {
      assert.equal(legacy.data.weekly_frequency_days, undefined);
    }
  });

  test("goal 枚举：body_recomp 新档通过，health 存量档保留，未知值拒绝", () => {
    assert.equal(
      PreferencesSchema.parse({ goal: "body_recomp" }).goal,
      "body_recomp",
    );
    assert.equal(PreferencesSchema.parse({ goal: "health" }).goal, "health");
    assert.ok(!PreferencesSchema.safeParse({ goal: "增肌塑形" }).success);
  });
});

describe("#114 ActiveLimitationSchema — note 原文 + auto_heal:false 长期旧伤", () => {
  test("note optional：带原文通过，不带原文的旧数据仍通过（兼容断言）", () => {
    const withNote = ActiveLimitationSchema.safeParse({
      part: "left_knee",
      severity: 4,
      expire_at: "2026-10-10T00:00:00.000Z",
      logged_at: "2026-10-03T00:00:00.000Z",
      note: "2024 年半月板术后，深蹲超过 60kg 不适",
    });
    assert.ok(withNote.success);
    const legacy = ActiveLimitationSchema.safeParse({
      part: "left_knee",
      severity: 4,
      expire_at: "2026-10-10T00:00:00.000Z",
      logged_at: "2026-10-03T00:00:00.000Z",
    });
    assert.ok(legacy.success);
  });

  test("auto_heal:false 显式通道通过 schema", () => {
    assert.ok(
      ActiveLimitationSchema.safeParse({
        part: "lower_back",
        severity: 3,
        expire_at: LONG_TERM_INJURY_EXPIRE_AT,
        logged_at: "2026-10-03T00:00:00.000Z",
        auto_heal: false,
        note: "长期旧伤，不会自愈",
      }).success,
    );
  });

  test("createActiveLimitation 默认行为回归：auto_heal true + severity 过期", () => {
    const acute = createActiveLimitation(
      "left_shoulder",
      5,
      "Rotator cuff strain",
    );
    assert.equal(acute.auto_heal, true);
    assert.equal(acute.note, "Rotator cuff strain");
    assert.ok(!isLimitationExpired(acute));
  });

  test("createActiveLimitation({autoHeal:false}) → 永不过期（长期旧伤）", () => {
    const chronic = createActiveLimitation("left_knee", 4, "半月板旧伤", {
      autoHeal: false,
    });
    assert.equal(chronic.auto_heal, false);
    assert.equal(chronic.expire_at, LONG_TERM_INJURY_EXPIRE_AT);
    assert.ok(!isLimitationExpired(chronic));
    // 即便存量数据 auto_heal:false 且 expire_at 已过，读取侧也不过期
    const stale = {
      ...chronic,
      expire_at: "2020-01-01T00:00:00.000Z",
    };
    assert.ok(!isLimitationExpired(stale));
    assert.deepEqual(
      filterExpiredLimitations([stale, ...[createActiveLimitation("wrist", 1)]])
        .length,
      2,
    );
  });
});

describe("#114 落库链路 — UserProfileService.validateProfile 白名单", () => {
  test("weekly_frequency_days 落库用例：嵌套 preferences 键通过白名单清洗并保留", () => {
    // PUT /profile/static 嵌套分支只转发 basic_info/preferences/... 四键；
    // 字段定义进 PreferencesSchema 后自动过清洗白名单（spec 修法 1 第 3 步）。
    const validated = UserProfileService.validateProfile({
      userId: "15ba86ca-574c-42c1-b14a-eb4217d702c9",
      modifiedBy: "user",
      preferences: {
        goal: "body_recomp",
        equipment: ["barbell", "dumbbell"],
        weekly_frequency_days: 3,
      },
    });
    assert.equal(validated.preferences?.weekly_frequency_days, 3);
    assert.equal(validated.preferences?.goal, "body_recomp");
  });

  test("weekly_frequency_days 区间字符串在清洗层抛错（不静默取下界入库）", () => {
    assert.throws(
      () =>
        UserProfileService.validateProfile({
          userId: "15ba86ca-574c-42c1-b14a-eb4217d702c9",
          modifiedBy: "user",
          preferences: { weekly_frequency_days: "3-4" },
        }),
      /preferences validation failed/,
    );
  });

  test("伤病原文白名单用例：active_limitations.note 过清洗并保留（替代顶层 raw_injuries）", () => {
    // OQ4 拍板 A：伤病原文经 active_limitations[].note 结构化落库
    // （Agent update_profile / 提案确认 / PUT 清洗共用同一白名单），
    // 不再在静态画像顶层私造 raw_injuries 键（spec 修法 2）。
    const validated = UserProfileService.validateProfile({
      userId: "15ba86ca-574c-42c1-b14a-eb4217d702c9",
      modifiedBy: "mas",
      active_limitations: [
        {
          part: "left_knee",
          severity: 4,
          expire_at: "2999-12-31T00:00:00.000Z",
          logged_at: "2026-10-03T00:00:00.000Z",
          auto_heal: false,
          note: "半月板旧伤，下蹲深处有弹响",
        },
      ],
    });
    assert.equal(
      validated.active_limitations?.[0]?.note,
      "半月板旧伤，下蹲深处有弹响",
    );
    assert.equal(validated.active_limitations?.[0]?.auto_heal, false);
  });

  test("旧 payload 无新字段仍解析通过（兼容断言：v1 问卷时代画像不受影响）", () => {
    const validated = UserProfileService.validateProfile({
      userId: "15ba86ca-574c-42c1-b14a-eb4217d702c9",
      modifiedBy: "user",
      basic_info: { age: 30, weight: 76 },
      preferences: { goal: "health", equipment: ["machine"] },
    });
    assert.deepEqual(validated.basic_info, { age: 30, weight: 76 });
    assert.equal(validated.preferences?.goal, "health");
    assert.equal(validated.preferences?.weekly_frequency_days, undefined);
  });
});
