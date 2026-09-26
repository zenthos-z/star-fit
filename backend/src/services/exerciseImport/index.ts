/**
 * A3 导入管线编排（issue #11）
 *
 * buildImportPlan：双源原始 JSON 行 → 完整导入计划
 * （库3基线行 + 库1补缺行 + 人工清单 + 覆盖矩阵 + 计数）。
 * 纯函数、无 IO——读源/写库/落报告由调用方（importExerciseLibrary.ts 脚本）负责。
 *
 * 管线序（数据口径拍板）：
 *  1. 库3 317 条全量为基（内部重名去重，name UNIQUE 约束前置）
 *  2. 库1 876 条归一 → 精确重名（主名键）对库3剔除，库3胜出
 *  3. 覆盖矩阵（六大模式 × 15 器材）在库3集合上找零格
 *  4. 库1 池按零格补缺（三元组判重 + 每格/总量上限）
 *  5. 人工清单：内部重名 / 精确重名冲突 / 低置信度入选 / 未映射原值 / 残余缺口
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import type { ExerciseLibraryItem } from "../../../../shared/dist/contracts/index.js";
import {
  DEFAULT_SELECTION_OPTIONS,
  buildMatrix,
  findExactOverlaps,
  selectLib1Fill,
} from "./dedupeAndSelect.js";
import {
  buildItem,
  createCollector,
  dedupeLib3ByName,
  normalizeLib1Row,
  normalizeLib3Row,
} from "./normalizeSources.js";
import type {
  ImportPlan,
  Lib1Raw,
  Lib3Raw,
  ReviewEntry,
  SelectionOptions,
} from "./types.js";

/**
 * 构建导入计划（纯函数）。
 * @param lib3Raw 库3原始行（317 条，只读）
 * @param lib1Raw 库1原始行（876 条，只读）
 * @param options 补缺参数（默认每格 2 条 / 总量 180）
 */
export function buildImportPlan(
  lib3Raw: Lib3Raw[],
  lib1Raw: Lib1Raw[],
  options: SelectionOptions = DEFAULT_SELECTION_OPTIONS,
): ImportPlan {
  const collector = createCollector();
  const review: ReviewEntry[] = [];

  // 1. 库3基线：内部重名去重 + 归一
  const { kept: lib3Kept, drops } = dedupeLib3ByName(lib3Raw);
  for (const drop of drops) {
    review.push({
      kind: "lib3_internal_dup",
      name: drop.name,
      kept_source_id: drop.keptId,
      dropped_source_id: drop.droppedId,
      note: drop.note,
    });
  }
  const nowIso = new Date().toISOString();
  const lib3Items: ExerciseLibraryItem[] = lib3Kept.map((row) =>
    buildItem("lib3", normalizeLib3Row(row, collector), nowIso),
  );

  // 2. 库1归一 + 精确重名剔除（库3胜出）
  const lib1All: ExerciseLibraryItem[] = lib1Raw.map((row) =>
    buildItem("lib1", normalizeLib1Row(row, collector), nowIso),
  );
  const { overlaps, lib1ByName } = findExactOverlaps(lib1All, lib3Items);
  for (const overlap of overlaps) review.push(overlap);

  // 3+4. 覆盖矩阵 + 补缺选择
  const { cells: lib3Cells, gaps } = buildMatrix(lib3Items);
  const selection = selectLib1Fill(
    [...lib1ByName.values()],
    lib3Items,
    lib3Cells,
    options,
  );
  for (const pick of selection.lowConfidence) review.push(pick);
  for (const gap of selection.remainingGaps) review.push(gap);

  // 5. 未映射原值（Map → 数组，按字段+值排序保证输出稳定）
  const unmapped = [...collector.unmapped.values()].sort((a, b) =>
    a.field === b.field
      ? a.value.localeCompare(b.value)
      : a.field.localeCompare(b.field),
  );
  review.push(...unmapped);

  return {
    lib3Items,
    lib1Items: selection.selected,
    review,
    matrix: {
      cells: selection.mergedCells,
      gaps_before: gaps,
      gaps_after: selection.remainingGaps.map(({ pattern, equipment }) => ({
        pattern,
        equipment,
      })),
    },
    counts: {
      lib3_source: lib3Raw.length,
      lib3_internal_dup_dropped: drops.length,
      lib1_source: lib1Raw.length,
      lib1_exact_overlap_skipped: overlaps.length,
    },
  };
}

// 子模块纯函数再导出（单测/脚本复用）
export {
  buildMatrix,
  classifyPatterns,
  DEFAULT_SELECTION_OPTIONS,
  findExactOverlaps,
  isTripleDuplicate,
  jaccard,
  nameKey,
  nameTokens,
  selectLib1Fill,
} from "./dedupeAndSelect.js";
export {
  buildItem,
  dedupeLib3ByName,
  normalizeLib1Row,
  normalizeLib3Row,
} from "./normalizeSources.js";
