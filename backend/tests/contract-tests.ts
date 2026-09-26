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
