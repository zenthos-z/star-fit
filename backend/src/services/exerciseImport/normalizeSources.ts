/**
 * A3 双源归一（issue #11）
 *
 * 库3 free-exercise-db-with-videos / 库1 free-exercise-db 原始行 →
 * ExerciseLibraryItem 契约行。全部映射经 shared/contracts/exercise-library.ts
 * 的受控词表与归一函数（唯一真源），未知原值不静默——收集进 unmapped 上报。
 *
 * 关键规则（数据口径拍板）：
 *  - name_zh / instructions_zh 一律 null（翻译管道后续）
 *  - 资产只存引用：库3 视频/海报外链直存；库1 图片路径转
 *    raw.githubusercontent.com/yuhonas/free-exercise-db/main 前缀
 *  - 库1 body_part = null（源无此维度）；库3 category 按名称规则派生
 *    （拉伸名→stretching，bodyPart=cardio→cardio，其余→strength）
 *  - 库1 equipment null → bodyweight（契约 EQUIPMENT_ALIASES 注释口径）
 *  - id 确定性生成（源前缀 + SHA-256 base64url 截断，12-24 字符内），
 *    重跑稳定，幂等
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { createHash } from "node:crypto";
import {
  BODY_PART_ALIASES,
  CATEGORY_ALIASES,
  EXERCISE_BODY_PARTS,
  EXERCISE_CATEGORIES,
  normalizeDifficulty,
  normalizeEquipment,
  normalizeMuscle,
  type ExerciseBodyPart,
  type ExerciseCategory,
  type ExerciseEquipment,
  type ExerciseLibraryItem,
  type ExerciseMuscle,
} from "../../../../shared/dist/contracts/index.js";
import type { Lib1Raw, Lib3Raw, UnmappedValue } from "./types.js";

/** 库1 图片路径 → GitHub raw 外链前缀（文件不落仓） */
const LIB1_IMAGE_BASE =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

/** 拉伸类动作名识别（库3 category 派生用；库3 无 category 字段） */
const STRETCH_NAME_RE = /stretch|pose|asana|bandhasana|mobility|foam roll/i;

/** 库3 内部重名：按 name 分组保留首行，其余丢弃（name 有 UNIQUE 约束） */
export function dedupeLib3ByName(rows: Lib3Raw[]): {
  kept: Lib3Raw[];
  drops: Array<{
    name: string;
    keptId: string;
    droppedId: string;
    note: string;
  }>;
} {
  const seen = new Set<string>();
  const kept: Lib3Raw[] = [];
  const drops: Array<{
    name: string;
    keptId: string;
    droppedId: string;
    note: string;
  }> = [];
  for (const row of rows) {
    if (seen.has(row.name)) {
      const keptRow = kept.find((k) => k.name === row.name)!;
      const targetDiffers = (keptRow.target ?? "") !== (row.target ?? "");
      drops.push({
        name: row.name,
        keptId: keptRow.id,
        droppedId: row.id,
        note: targetDiffers
          ? `同重名但 target 不同（保留 ${keptRow.target}，丢弃 ${row.target}）`
          : "完全重复行，保留首条",
      });
      continue;
    }
    seen.add(row.name);
    kept.push(row);
  }
  return { kept, drops };
}

/** 确定性 id：源标签 + 名称哈希（重跑幂等；长度 21 ∈ [12,24] 满足表约束） */
function deterministicId(source: "lib3" | "lib1", name: string): string {
  const digest = createHash("sha256")
    .update(`${source}:${name}`)
    .digest("base64url")
    .slice(0, 18);
  return `a3${source === "lib3" ? "v" : "f"}${digest}`;
}

/** 归一过程收集器（unmapped 值计数，喂人工清单） */
export interface NormalizeCollector {
  unmapped: Map<string, UnmappedValue>; // key: field|value
  noteUnmapped(field: string, value: string): void;
}

export function createCollector(): NormalizeCollector {
  const unmapped = new Map<string, UnmappedValue>();
  return {
    unmapped,
    noteUnmapped(field, value) {
      const key = `${field}|${value}`;
      const existing = unmapped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        unmapped.set(key, { kind: "unmapped_value", field, value, count: 1 });
      }
    },
  };
}

/** 肌群原值数组归一：去 null、去重、剔除与主肌群重叠；未知值计数上报 */
function normalizeMuscleArray(
  raws: string[] | undefined,
  primary: ExerciseMuscle[],
  field: string,
  collector: NormalizeCollector,
): ExerciseMuscle[] {
  if (!raws) return [];
  const out: ExerciseMuscle[] = [];
  for (const raw of raws) {
    const mapped = normalizeMuscle(raw);
    if (mapped === null) {
      collector.noteUnmapped(field, raw);
      continue;
    }
    if (!primary.includes(mapped) && !out.includes(mapped)) {
      out.push(mapped);
    }
  }
  return out;
}

/** 器材原值归一（库1 null → bodyweight；未知值计数上报并返回 null 由 schema 拒绝） */
function equipmentOrBodyweight(
  raw: string | null | undefined,
  field: string,
  collector: NormalizeCollector,
): ExerciseEquipment {
  if (raw === null || raw === undefined || raw.trim() === "")
    return "bodyweight";
  const mapped = normalizeEquipment(raw);
  if (mapped === null) {
    collector.noteUnmapped(field, raw);
    return "other";
  }
  return mapped;
}

/** 别名数组清洗：去重、剔除与主名完全相同项 */
function cleanAliases(
  aliases: string[] | undefined,
  name: string,
): string[] | null {
  if (!aliases || aliases.length === 0) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of aliases) {
    const key = alias.toLowerCase();
    if (key === name.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out.length > 0 ? out : null;
}

/** 库3 exercise_type 派生：拉伸名 → flexibility；bodyPart=cardio → cardio；单侧 → unilateral；其余 resistance */
function lib3ExerciseType(row: Lib3Raw): string {
  if (STRETCH_NAME_RE.test(row.name)) return "flexibility";
  if (row.bodyPart === "cardio") return "cardio";
  if (row.unilateral === true) return "unilateral";
  return "resistance";
}

/** 库3 category 派生（源无此维度；拉伸名优先于 bodyPart=cardio 的源噪声） */
function lib3Category(row: Lib3Raw): ExerciseCategory {
  if (STRETCH_NAME_RE.test(row.name)) return "stretching";
  if (row.bodyPart === "cardio") return "cardio";
  return "strength";
}

/** 库3 bodyPart → 10 区域（映射表 + 恒等值直通；未知值上报 null） */
function lib3BodyPart(
  raw: string | undefined,
  collector: NormalizeCollector,
): ExerciseBodyPart | null {
  if (!raw) return null;
  const mapped = BODY_PART_ALIASES[raw];
  if (mapped) return mapped;
  if ((EXERCISE_BODY_PARTS as readonly string[]).includes(raw)) {
    return raw as ExerciseBodyPart; // 恒等值（back/chest/waist 等单词原值）
  }
  collector.noteUnmapped("lib3.bodyPart", raw);
  return null;
}

/** 库3 单行 → 契约行（不设 id/时间戳，由 buildItem 统一补齐） */
export function normalizeLib3Row(
  row: Lib3Raw,
  collector: NormalizeCollector,
): Omit<
  ExerciseLibraryItem,
  "id" | "created_at" | "updated_at" | "modified_at"
> {
  const primaryRaw = row.target ?? "";
  const primaryMapped = primaryRaw ? normalizeMuscle(primaryRaw) : null;
  if (primaryRaw && primaryMapped === null) {
    collector.noteUnmapped("lib3.target", primaryRaw);
  }
  const primary = primaryMapped ? [primaryMapped] : [];
  const secondary = normalizeMuscleArray(
    row.secondaryMuscles,
    primary,
    "lib3.secondaryMuscles",
    collector,
  );

  const thumbnails = row.thumbnails ?? {};
  const imageRefs = [thumbnails.male, thumbnails.female].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  const videos = row.videos ?? {};
  const videoUrls =
    videos.male || videos.female
      ? {
          ...(videos.male ? { male: videos.male } : {}),
          ...(videos.female ? { female: videos.female } : {}),
        }
      : null;

  return {
    name: row.name,
    name_zh: null,
    exercise_type: lib3ExerciseType(
      row,
    ) as ExerciseLibraryItem["exercise_type"],
    difficulty: (row.difficulty ??
      "beginner") as ExerciseLibraryItem["difficulty"],
    equipment: equipmentOrBodyweight(
      row.equipment,
      "lib3.equipment",
      collector,
    ),
    category: lib3Category(row),
    body_part: lib3BodyPart(row.bodyPart, collector),
    primary_muscles: primary,
    secondary_muscles: secondary,
    force_type: null,
    mechanic:
      row.compound === undefined
        ? null
        : row.compound
          ? "compound"
          : "isolation",
    instructions: row.steps && row.steps.length > 0 ? row.steps : null,
    form_cues: row.formCues && row.formCues.length > 0 ? row.formCues : null,
    common_mistakes:
      row.commonMistakes && row.commonMistakes.length > 0
        ? row.commonMistakes
        : null,
    breathing: row.breathing ?? null,
    aliases: cleanAliases(row.aliases, row.name),
    instructions_zh: null,
    image_refs: imageRefs.length > 0 ? imageRefs : null,
    video_urls: videoUrls,
    poster_url: thumbnails.male ?? thumbnails.female ?? null,
    owner_user_id: null,
    content_html: row.shortDescription ?? null,
    tutorials: undefined,
    tags_json: undefined,
    assets_json: undefined,
    modified_by: "system",
  };
}

/** 库1 单行 → 契约行 */
export function normalizeLib1Row(
  row: Lib1Raw,
  collector: NormalizeCollector,
): Omit<
  ExerciseLibraryItem,
  "id" | "created_at" | "updated_at" | "modified_at"
> {
  const primary = normalizeMuscleArray(
    row.primaryMuscles,
    [],
    "lib1.primaryMuscles",
    collector,
  );
  const secondary = normalizeMuscleArray(
    row.secondaryMuscles,
    primary,
    "lib1.secondaryMuscles",
    collector,
  );

  const imageRefs = (row.images ?? [])
    .filter((p) => p.length > 0)
    .map((p) => `${LIB1_IMAGE_BASE}${p}`);

  const categoryRaw = row.category ?? "";
  let category: ExerciseCategory | null = null;
  if (categoryRaw) {
    const mapped = CATEGORY_ALIASES[categoryRaw];
    if (mapped) {
      category = mapped;
    } else if (
      (EXERCISE_CATEGORIES as readonly string[]).includes(categoryRaw)
    ) {
      category = categoryRaw as ExerciseCategory; // 恒等值
    } else {
      collector.noteUnmapped("lib1.category", categoryRaw);
    }
  }

  const force = row.force;
  const mechanic = row.mechanic;

  let exerciseType: ExerciseLibraryItem["exercise_type"];
  if (category === "cardio") exerciseType = "cardio";
  else if (category === "stretching") exerciseType = "flexibility";
  else if (category === "plyometrics") exerciseType = "bodyweight";
  else exerciseType = "resistance";

  return {
    name: row.name,
    name_zh: null,
    exercise_type: exerciseType,
    difficulty: normalizeDifficulty(
      row.level ?? "beginner",
    ) as ExerciseLibraryItem["difficulty"],
    equipment: equipmentOrBodyweight(
      row.equipment,
      "lib1.equipment",
      collector,
    ),
    category: categoryRaw ? category : null,
    body_part: null, // 库1 无此维度（契约口径）
    primary_muscles: primary,
    secondary_muscles: secondary,
    force_type:
      force === "push" || force === "pull" || force === "static" ? force : null,
    mechanic:
      mechanic === "compound" || mechanic === "isolation" ? mechanic : null,
    instructions:
      row.instructions && row.instructions.length > 0 ? row.instructions : null,
    form_cues: null,
    common_mistakes: null,
    breathing: null,
    aliases: null,
    instructions_zh: null,
    image_refs: imageRefs.length > 0 ? imageRefs : null,
    video_urls: null,
    poster_url: imageRefs[0] ?? null,
    owner_user_id: null,
    content_html: null,
    tutorials: undefined,
    tags_json: undefined,
    assets_json: undefined,
    modified_by: "system",
  };
}

/** 补齐确定性 id 与时间戳 → 完整契约行 */
export function buildItem(
  source: "lib3" | "lib1",
  partial: Omit<
    ExerciseLibraryItem,
    "id" | "created_at" | "updated_at" | "modified_at"
  >,
  nowIso: string,
): ExerciseLibraryItem {
  return {
    ...partial,
    id: deterministicId(source, partial.name),
    created_at: nowIso,
    updated_at: nowIso,
    modified_at: null,
  };
}
