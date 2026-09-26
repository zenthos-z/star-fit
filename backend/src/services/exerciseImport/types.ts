/**
 * A3 导入管线类型（issue #11）
 *
 * 双源数据形态与管线中间产物：
 *  - Lib3Raw / Lib1Raw：源 JSON 行形态（只读，不做断言的宽松边界）
 *  - Pattern：六大动作模式（覆盖矩阵行轴）
 *  - ImportPlan：管线产物（待写库行 + 人工清单 + 覆盖矩阵 + 计数）
 *
 * 真源与红线：
 *  - 词表/映射：shared/contracts/exercise-library.ts（唯一真源，禁私建映射）
 *  - 写库：ExerciseRepository.replaceAllPublicItems（禁裸 SQL）
 *  - 评估区源数据只读
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import type { ExerciseLibraryItem } from "../../../../shared/dist/contracts/index.js";

// ============================================================================
// 源数据形态（宽松边界：未知字段容忍，消费字段显式判空）
// ============================================================================

/** 库3 free-exercise-db-with-videos 行形态（317 条） */
export interface Lib3Raw {
  id: string;
  name: string;
  aliases?: string[];
  bodyPart?: string;
  target?: string;
  secondaryMuscles?: string[];
  equipment?: string | null;
  muscleGroup?: string;
  difficulty?: string;
  compound?: boolean;
  unilateral?: boolean;
  shortDescription?: string;
  instructions?: string;
  steps?: string[];
  formCues?: string[];
  commonMistakes?: string[];
  breathing?: string;
  videos?: { male?: string; female?: string };
  thumbnails?: { male?: string; female?: string };
}

/** 库1 free-exercise-db 行形态（876 条） */
export interface Lib1Raw {
  id?: string;
  name: string;
  force?: string | null;
  level?: string;
  mechanic?: string | null;
  equipment?: string | null;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  category?: string;
  images?: string[];
}

// ============================================================================
// 覆盖矩阵（六大模式 × 器材/身体区域）
// ============================================================================

/** 六大动作模式（任务书口径：推/拉/蹲/髋铰链/负重行走/核心） */
export const MOVEMENT_PATTERNS = [
  "push",
  "pull",
  "squat",
  "hip_hinge",
  "loaded_carry",
  "core",
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

/** 单条动作的模式集合（可多模式，如 deadlift = hip_hinge + pull） */
export type PatternSet = ReadonlySet<MovementPattern>;

// ============================================================================
// 人工清单（docs/design/a3-import-review.md 素材）
// ============================================================================

/** 库3 内部重名丢弃 */
export interface InternalDupDrop {
  kind: "lib3_internal_dup";
  name: string;
  kept_source_id: string;
  dropped_source_id: string;
  note: string;
}

/** 库1∩库3 精确重名：库3 胜出，库1 行跳过 */
export interface ExactOverlap {
  kind: "exact_name_overlap";
  name: string;
  lib3_equipment: string | null;
  lib1_equipment: string | null;
  lib3_primary_muscles: string[];
  lib1_primary_muscles: string[];
  /** 三元组（主名+器材+肌群）一致 → 单纯重复；不一致 → 冲突需人工裁决 */
  triple_conflict: boolean;
}

/** 低置信度入选：与库3某行近似（0.6 ≤ jaccard < 0.75 且同器材）但仍被选入库1补充 */
export interface LowConfidencePick {
  kind: "low_confidence_pick";
  selected_name: string;
  similar_lib3_name: string;
  jaccard: number;
}

/** 归一时落入 null 的源原值（不静默，全部上报） */
export interface UnmappedValue {
  kind: "unmapped_value";
  field: string;
  value: string;
  count: number;
}

/** 覆盖矩阵残余缺口（补缺后仍为 0 的格） */
export interface RemainingGap {
  kind: "remaining_gap";
  pattern: MovementPattern;
  equipment: string;
  reason: "no_candidates" | "cap_reached";
}

export type ReviewEntry =
  | InternalDupDrop
  | ExactOverlap
  | LowConfidencePick
  | UnmappedValue
  | RemainingGap;

// ============================================================================
// 导入计划（管线产物）
// ============================================================================

/** 模式 × 器材 计数矩阵（行=模式，列=15 器材） */
export interface CoverageMatrix {
  /** 每格动作数（pattern → equipment → count） */
  cells: Record<string, Record<string, number>>;
  /** 补缺前（仅库3）为 0 的格 */
  gaps_before: Array<{ pattern: MovementPattern; equipment: string }>;
  /** 补缺后仍为 0 的格 */
  gaps_after: Array<{ pattern: MovementPattern; equipment: string }>;
}

export interface ImportPlan {
  /** 库3 待写库行（含内部重名去重） */
  lib3Items: ExerciseLibraryItem[];
  /** 库1 补缺待写库行 */
  lib1Items: ExerciseLibraryItem[];
  /** 人工清单 */
  review: ReviewEntry[];
  /** 覆盖矩阵（写库集合口径 = lib3Items + lib1Items） */
  matrix: CoverageMatrix;
  /** 源头计数：库3 原始 / 库3 内部重名丢弃 / 库1 原始 / 精确重名跳过 */
  counts: {
    lib3_source: number;
    lib3_internal_dup_dropped: number;
    lib1_source: number;
    lib1_exact_overlap_skipped: number;
  };
}

/** 选择参数（默认值见 dedupeAndSelect.ts） */
export interface SelectionOptions {
  /** 每个缺口格最多补几条 */
  perCellLimit: number;
  /** 库1 补缺总量上限（与库3 合计 ≤ 500 精收上限） */
  lib1MaxPicks: number;
}
