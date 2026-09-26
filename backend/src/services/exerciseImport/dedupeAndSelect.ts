/**
 * A3 判重与补缺选择（issue #11）
 *
 * 数据口径（任务书）：
 *  - 库3 全量为基；库1 只按覆盖矩阵补缺（六大模式 × 器材），缺口才补
 *  - 判重三元组：主名 + 器材 + 肌群（主名 token 集合 Jaccard 近似匹配）
 *  - 冲突（重名但三元组不一致）与低置信度入选 → 人工清单
 *
 * 模式分类为启发式（名称关键词 + force_type + 主肌群），仅服务于补缺
 * 选择与缺口报告，不落库。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import {
  EXERCISE_EQUIPMENT,
  type ExerciseLibraryItem,
} from "../../../../shared/dist/contracts/index.js";
import {
  MOVEMENT_PATTERNS,
  type CoverageMatrix,
  type ExactOverlap,
  type LowConfidencePick,
  type MovementPattern,
  type PatternSet,
  type RemainingGap,
  type SelectionOptions,
} from "./types.js";

export const DEFAULT_SELECTION_OPTIONS: SelectionOptions = {
  perCellLimit: 3,
  lib1MaxPicks: 180, // 库3 去重后 314 + 180 ≤ 500 精收上限
};

// ============================================================================
// 名称 token 化与相似度
// ============================================================================

/** 主名 token 化：小写、去括号内容、去标点（"EZ-Bar Curl" → {ez, bar, curl}） */
export function nameTokens(name: string): Set<string> {
  const stripped = name.toLowerCase().replace(/\(.*?\)/g, " ");
  return new Set(
    stripped
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
}

/** token 集合 Jaccard 相似度 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** 归一主名键（token 保序拼接，精确重名判定用） */
export function nameKey(name: string): string {
  return [...nameTokens(name)].join(" ");
}

// ============================================================================
// 六大模式分类（启发式，可多模式）
// ============================================================================

const SQUAT_RE = /squat|lunge|leg press|step[- ]?up|pistol|bulgarian/i;
const HINGE_RE =
  /deadlift|romanian|\brdl\b|good morning|hip thrust|glute bridge|back extension|hyperextension|\bswing\b|pull[- ]?through|\bclean\b|snatch|high pull/i;
const CARRY_RE = /\bcarry\b|\bcarries\b|farmer|suitcase|sled drag|yoke/i;
const CORE_NAME_RE =
  /plank|crunch|sit[- ]?up|leg raise|hip raise|russian twist|ab wheel|hollow|side bend|dead bug|bird dog/i;

/** 主肌群 → push/pull 力向兜底（源无 force 时；蹲/铰链类目标肌不在两侧集合） */
const PUSH_MUSCLES = new Set(["triceps", "chest", "shoulders"]);
const PULL_MUSCLES = new Set([
  "lats",
  "biceps",
  "middle_back",
  "traps",
  "forearms",
]);

/** 单条动作 → 模式集合（蹲/铰链/负重行走按名称；推拉按 force 或主肌群兜底；核心按区域/名称） */
export function classifyPatterns(
  item: Pick<
    ExerciseLibraryItem,
    "name" | "force_type" | "primary_muscles" | "body_part"
  >,
): Set<MovementPattern> {
  const patterns = new Set<MovementPattern>();
  if (SQUAT_RE.test(item.name)) patterns.add("squat");
  if (HINGE_RE.test(item.name)) patterns.add("hip_hinge");
  if (CARRY_RE.test(item.name)) patterns.add("loaded_carry");
  if (
    item.body_part === "waist" ||
    item.primary_muscles.includes("abdominals") ||
    CORE_NAME_RE.test(item.name)
  ) {
    patterns.add("core");
  }
  if (
    item.force_type === "push" ||
    (item.force_type === null &&
      item.primary_muscles.some((m) => PUSH_MUSCLES.has(m)))
  ) {
    patterns.add("push");
  }
  if (
    item.force_type === "pull" ||
    (item.force_type === null &&
      item.primary_muscles.some((m) => PULL_MUSCLES.has(m)))
  ) {
    patterns.add("pull");
  }
  return patterns;
}

// ============================================================================
// 覆盖矩阵（模式 × 器材）
// ============================================================================

/** 构建计数矩阵并识别零格 */
export function buildMatrix(
  items: Array<
    Pick<
      ExerciseLibraryItem,
      "name" | "force_type" | "primary_muscles" | "body_part" | "equipment"
    >
  >,
): {
  cells: Record<string, Record<string, number>>;
  gaps: Array<{ pattern: MovementPattern; equipment: string }>;
} {
  const cells: Record<string, Record<string, number>> = {};
  for (const pattern of MOVEMENT_PATTERNS) {
    cells[pattern] = {};
    for (const equipment of EXERCISE_EQUIPMENT) cells[pattern][equipment] = 0;
  }
  for (const item of items) {
    if (item.equipment === null) continue;
    for (const pattern of classifyPatterns(item)) {
      cells[pattern][item.equipment] += 1;
    }
  }
  const gaps: Array<{ pattern: MovementPattern; equipment: string }> = [];
  for (const pattern of MOVEMENT_PATTERNS) {
    for (const equipment of EXERCISE_EQUIPMENT) {
      if (cells[pattern][equipment] === 0) gaps.push({ pattern, equipment });
    }
  }
  return { cells, gaps };
}

// ============================================================================
// 判重（三元组近似匹配）
// ============================================================================

/** 三元组重复判定：主名相似 ≥ 0.75 且器材相同且主肌群有交集（或均空） */
export function isTripleDuplicate(
  candidate: Pick<
    ExerciseLibraryItem,
    "name" | "equipment" | "primary_muscles"
  >,
  existing: Pick<ExerciseLibraryItem, "name" | "equipment" | "primary_muscles">,
): boolean {
  if (candidate.equipment !== existing.equipment) return false;
  const similarity = jaccard(
    nameTokens(candidate.name),
    nameTokens(existing.name),
  );
  if (similarity < 0.75) return false;
  const sharesMuscle =
    candidate.primary_muscles.some((m) =>
      existing.primary_muscles.includes(m),
    ) ||
    (candidate.primary_muscles.length === 0 &&
      existing.primary_muscles.length === 0);
  return sharesMuscle;
}

/** 库1 vs 库3 精确重名清单（库3 胜出；三元组不一致标记冲突） */
export function findExactOverlaps(
  lib1Items: ExerciseLibraryItem[],
  lib3Items: ExerciseLibraryItem[],
): { overlaps: ExactOverlap[]; lib1ByName: Map<string, ExerciseLibraryItem> } {
  const lib3ByKey = new Map<string, ExerciseLibraryItem>();
  for (const item of lib3Items) lib3ByKey.set(nameKey(item.name), item);

  const overlaps: ExactOverlap[] = [];
  const lib1ByName = new Map<string, ExerciseLibraryItem>();
  for (const item of lib1Items) {
    const key = nameKey(item.name);
    const lib3Hit = lib3ByKey.get(key);
    if (lib3Hit) {
      const equipmentSame = lib3Hit.equipment === item.equipment;
      const muscleShare =
        lib3Hit.primary_muscles.some((m) => item.primary_muscles.includes(m)) ||
        (lib3Hit.primary_muscles.length === 0 &&
          item.primary_muscles.length === 0);
      overlaps.push({
        kind: "exact_name_overlap",
        name: item.name,
        lib3_equipment: lib3Hit.equipment,
        lib1_equipment: item.equipment,
        lib3_primary_muscles: lib3Hit.primary_muscles,
        lib1_primary_muscles: item.primary_muscles,
        triple_conflict: !(equipmentSame && muscleShare),
      });
      continue; // 库3 胜出，库1 行不进入备选池
    }
    lib1ByName.set(key, item);
  }
  return { overlaps, lib1ByName };
}

// ============================================================================
// 补缺选择
// ============================================================================

/** 名称常用度排序键：实义词数少者优先（更规范；撇号碎屑如 farmer's 的 "s" 不计），同数按字母序（确定性） */
function canonicalRank(name: string): [number, string] {
  const wordCount = [...nameTokens(name)].filter((t) => t.length > 1).length;
  return [wordCount, name.toLowerCase()];
}

export interface SelectionResult {
  selected: ExerciseLibraryItem[];
  lowConfidence: LowConfidencePick[];
  remainingGaps: RemainingGap[];
  /** 补缺后（库3 + 入选库1）合并矩阵 */
  mergedCells: Record<string, Record<string, number>>;
}

/**
 * 库1 按覆盖矩阵补缺：
 *  1. 精确重名（vs 库3）已在 findExactOverlaps 剔除
 *  2. 遍历库3零格（模式×器材，固定顺序保证确定性），从库1池选同类候选
 *  3. 候选再过三元组判重（vs 库3 全量 + 已入选），低置信度近似记录人工清单
 *  4. 每格上限 perCellLimit，总量上限 lib1MaxPicks
 */
export function selectLib1Fill(
  lib1Pool: ExerciseLibraryItem[],
  lib3Items: ExerciseLibraryItem[],
  lib3Cells: Record<string, Record<string, number>>,
  options: SelectionOptions = DEFAULT_SELECTION_OPTIONS,
): SelectionResult {
  // 预计算库3名称 token（判重与低置信度复用）
  const lib3Tokens = lib3Items.map((item) => ({
    item,
    tokens: nameTokens(item.name),
  }));

  // 按格聚合候选（模式×器材 → 池），同一候选可属多格
  const poolByCell = new Map<string, ExerciseLibraryItem[]>();
  const cellKey = (p: string, e: string) => `${p}|${e}`;
  for (const candidate of lib1Pool) {
    if (candidate.equipment === null) continue;
    // 三元组判重 vs 库3：重复者不入选（无冲突记录——精确重名已在上一环输出）
    if (lib3Items.some((existing) => isTripleDuplicate(candidate, existing)))
      continue;
    for (const pattern of classifyPatterns(candidate)) {
      const key = cellKey(pattern, candidate.equipment);
      const bucket = poolByCell.get(key) ?? [];
      bucket.push(candidate);
      bucket.sort((a, b) => {
        const [wa, na] = canonicalRank(a.name);
        const [wb, nb] = canonicalRank(b.name);
        return wa - wb || (na < nb ? -1 : na > nb ? 1 : 0);
      });
      poolByCell.set(key, bucket);
    }
  }

  const selected: ExerciseLibraryItem[] = [];
  const selectedNames = new Set<string>();
  const lowConfidence: LowConfidencePick[] = [];

  const lib3GapCells: Array<{ pattern: MovementPattern; equipment: string }> =
    [];
  for (const pattern of MOVEMENT_PATTERNS) {
    for (const equipment of EXERCISE_EQUIPMENT) {
      if ((lib3Cells[pattern]?.[equipment] ?? 0) === 0) {
        lib3GapCells.push({ pattern, equipment });
      }
    }
  }

  for (const { pattern, equipment } of lib3GapCells) {
    const bucket = poolByCell.get(cellKey(pattern, equipment)) ?? [];
    let taken = 0;
    for (const candidate of bucket) {
      if (taken >= options.perCellLimit) break;
      if (selected.length >= options.lib1MaxPicks) break;
      if (selectedNames.has(candidate.name)) {
        taken += 1; // 已由其他格入选，计入本格配额避免同格堆叠
        continue;
      }
      // 三元组判重 vs 已入选（库1内部近似变体）
      if (selected.some((existing) => isTripleDuplicate(candidate, existing)))
        continue;

      // 低置信度检查：与库3某行 0.6 ≤ jaccard < 0.75 且同器材 → 记录仍入选
      const candTokens = nameTokens(candidate.name);
      for (const { item, tokens } of lib3Tokens) {
        if (item.equipment !== candidate.equipment) continue;
        const similarity = jaccard(candTokens, tokens);
        if (similarity >= 0.6 && similarity < 0.75) {
          lowConfidence.push({
            kind: "low_confidence_pick",
            selected_name: candidate.name,
            similar_lib3_name: item.name,
            jaccard: Number(similarity.toFixed(3)),
          });
          break; // 记录首个命中即止（遍历序确定）
        }
      }

      selected.push(candidate);
      selectedNames.add(candidate.name);
      taken += 1;
    }
  }

  // 合并矩阵 + 残余缺口
  const mergedCells = JSON.parse(JSON.stringify(lib3Cells)) as Record<
    string,
    Record<string, number>
  >;
  for (const item of selected) {
    if (item.equipment === null) continue;
    for (const pattern of classifyPatterns(item)) {
      mergedCells[pattern][item.equipment] += 1;
    }
  }
  const remainingGaps: RemainingGap[] = [];
  const capReached = selected.length >= options.lib1MaxPicks;
  for (const pattern of MOVEMENT_PATTERNS) {
    for (const equipment of EXERCISE_EQUIPMENT) {
      if (mergedCells[pattern][equipment] === 0) {
        remainingGaps.push({
          kind: "remaining_gap",
          pattern,
          equipment,
          reason:
            (poolByCell.get(cellKey(pattern, equipment)) ?? []).length === 0
              ? "no_candidates"
              : capReached
                ? "cap_reached"
                : "no_candidates",
        });
      }
    }
  }

  return { selected, lowConfidence, remainingGaps, mergedCells };
}
