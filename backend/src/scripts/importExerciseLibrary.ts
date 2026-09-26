/**
 * A3 动作库导入脚本（issue #11）——可重复执行
 *
 * 双源（已评估拍板，评估区只读）：
 *   主源 库3 free-exercise-db-with-videos 317 条（教学字段最全，全量为基）
 *   补充 库1 free-exercise-db 876 条（仅按覆盖矩阵缺口补，精收口径）
 *
 * 管线：读源 JSON（parseJSONSafe）→ buildImportPlan（归一/判重/补缺，纯函数）
 *   → ExerciseRepository.replaceAllPublicItems 写库（禁裸 SQL，单事务整体替换公共库）
 *   → 人工清单落 docs/design/a3-import-review.md + 词表分布统计输出
 *
 * 用法：
 *   DATABASE_URL=postgresql://starfit:starfit@localhost:15432/starfit \
 *     npx tsx src/scripts/importExerciseLibrary.ts [--dry] [--no-report]
 *
 *   --dry       只出计划/报告，不写库（无需 DATABASE_URL）
 *   --no-report 不落 a3-import-review.md（CI 冒烟用）
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXERCISE_CATEGORIES,
  EXERCISE_EQUIPMENT,
  EXERCISE_MUSCLES,
  parseJSONSafe,
} from "../../../shared/dist/contracts/index.js";
import { buildImportPlan } from "../services/exerciseImport/index.js";
import type {
  ImportPlan,
  Lib1Raw,
  Lib3Raw,
  ReviewEntry,
} from "../services/exerciseImport/types.js";
import { MOVEMENT_PATTERNS } from "../services/exerciseImport/types.js";

/** 源数据路径（评估区副本，只读） */
const LIB3_PATH = resolve(
  process.env.HOME ?? "",
  "Documents/agent-output/projects/starfit/exercise-db-eval/videos-db/repo/data/exercises.json",
);
const LIB1_PATH = resolve(
  process.env.HOME ?? "",
  "Documents/agent-output/projects/starfit/exercise-db-eval/free-exercise-db/repo/dist/exercises.json",
);

/** 人工审核清单落点（仓库内） */
const REVIEW_DOC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/design/a3-import-review.md",
);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const skipReport = args.includes("--no-report");

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** 读源 JSON（红线：parseJSONSafe；失败即抛） */
function readSource<T>(path: string, label: string): T[] {
  const text = readFileSync(path, "utf8");
  const parsed = parseJSONSafe<unknown[]>(
    text,
    `importExerciseLibrary:${label}`,
  );
  if (!Array.isArray(parsed)) fail(`${label} 源不是 JSON 数组: ${path}`);
  return parsed as T[];
}

// ============================================================================
// 报告渲染
// ============================================================================

function renderReviewDoc(plan: ImportPlan, runIso: string): string {
  const { counts } = plan;
  const byKind = <K extends ReviewEntry["kind"]>(kind: K) =>
    plan.review.filter((e) => e.kind === kind) as Extract<
      ReviewEntry,
      { kind: K }
    >[];

  const lines: string[] = [];
  lines.push("# A3 动作库导入人工审核清单（issue #11）");
  lines.push("");
  lines.push(`> 生成时间：${runIso}`);
  lines.push(
    `> 源：库3 free-exercise-db-with-videos ${counts.lib3_source} 条（基线，内部重名丢弃 ${counts.lib3_internal_dup_dropped}）｜库1 free-exercise-db ${counts.lib1_source} 条（补充池）`,
  );
  lines.push(
    `> 导入口径：库3 ${plan.lib3Items.length} 条 + 库1 补缺 ${plan.lib1Items.length} 条 = **${plan.lib3Items.length + plan.lib1Items.length} 条**（精收 300-500）`,
  );
  lines.push(
    `> 判重口径：主名 token（去括号/标点）Jaccard ≥ 0.75 且器材相同且主肌群有交集；精确重名一律库3 胜出`,
  );
  lines.push("");

  // 1. 库3 内部重名
  const dups = byKind("lib3_internal_dup");
  lines.push(`## 1. 库3 内部重名丢弃（${dups.length}）`);
  lines.push("");
  lines.push("| 动作名 | 保留源 id | 丢弃源 id | 说明 |");
  lines.push("| --- | --- | --- | --- |");
  for (const d of dups) {
    lines.push(
      `| ${d.name} | ${d.kept_source_id} | ${d.dropped_source_id} | ${d.note} |`,
    );
  }
  lines.push("");

  // 2. 精确重名
  const overlaps = byKind("exact_name_overlap");
  const conflicts = overlaps.filter((o) => o.triple_conflict);
  const plainDups = overlaps.filter((o) => !o.triple_conflict);
  lines.push(
    `## 2. 库1∩库3 精确重名（${overlaps.length}，库3 胜出、库1 跳过）`,
  );
  lines.push("");
  lines.push(
    `### 2.1 冲突——重名但器材/主肌群不一致（${conflicts.length}，需人工裁决）`,
  );
  lines.push("");
  lines.push("| 动作名 | 库3 器材 | 库1 器材 | 库3 主肌群 | 库1 主肌群 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const o of conflicts) {
    lines.push(
      `| ${o.name} | ${o.lib3_equipment ?? "—"} | ${o.lib1_equipment ?? "—"} | ${o.lib3_primary_muscles.join(", ") || "—"} | ${o.lib1_primary_muscles.join(", ") || "—"} |`,
    );
  }
  lines.push("");
  lines.push(`### 2.2 单纯重复——三元组一致（${plainDups.length}，跳过无争议）`);
  lines.push("");
  for (const o of plainDups) lines.push(`- ${o.name}`);
  lines.push("");

  // 3. 低置信度入选
  const lowConf = byKind("low_confidence_pick");
  lines.push(`## 3. 低置信度入选（${lowConf.length}）`);
  lines.push("");
  lines.push(
    "入选库1 补缺行与库3某行近似（Jaccard 0.6-0.75 且同器材）——大概率是合理变体，建议抽查：",
  );
  lines.push("");
  lines.push("| 入选（库1） | 相似库3 行 | Jaccard |");
  lines.push("| --- | --- | --- |");
  for (const p of lowConf) {
    lines.push(
      `| ${p.selected_name} | ${p.similar_lib3_name} | ${p.jaccard} |`,
    );
  }
  lines.push("");

  // 4. 未映射源值
  const unmapped = byKind("unmapped_value");
  lines.push(
    `## 4. 源值未映射（${unmapped.length} 项 → 按契约规则落 null，已计数上报）`,
  );
  lines.push("");
  lines.push("| 字段 | 原值 | 出现次数 |");
  lines.push("| --- | --- | --- |");
  for (const u of unmapped) {
    lines.push(`| ${u.field} | ${u.value} | ${u.count} |`);
  }
  lines.push("");

  // 5. 残余缺口
  const gaps = byKind("remaining_gap");
  lines.push(`## 5. 覆盖矩阵残余缺口（${gaps.length} 格，补缺后仍为 0）`);
  lines.push("");
  lines.push("| 模式 | 器材 | 原因 |");
  lines.push("| --- | --- | --- |");
  for (const g of gaps) {
    lines.push(
      `| ${g.pattern} | ${g.equipment} | ${g.reason === "no_candidates" ? "库1 无候选" : "总量上限截断"} |`,
    );
  }
  lines.push("");

  // 附：矩阵
  lines.push("## 附：导入后覆盖矩阵（六大模式 × 15 器材）");
  lines.push("");
  lines.push(`| 模式 | ${EXERCISE_EQUIPMENT.join(" | ")} |`);
  lines.push(`| --- | ${EXERCISE_EQUIPMENT.map(() => "---").join(" | ")} |`);
  for (const pattern of MOVEMENT_PATTERNS) {
    const row = EXERCISE_EQUIPMENT.map((eq) =>
      String(plan.matrix.cells[pattern]?.[eq] ?? 0),
    );
    lines.push(`| ${pattern} | ${row.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ============================================================================
// 统计
// ============================================================================

function distribution(
  values: string[],
  vocabulary: readonly string[],
): Array<[string, number]> {
  const counts = new Map<string, number>(vocabulary.map((v) => [v, 0]));
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()];
}

function printStats(plan: ImportPlan): void {
  const all = [...plan.lib3Items, ...plan.lib1Items];
  console.log("\n=== 词表分布统计 ===");

  console.log(`\n器材（${EXERCISE_EQUIPMENT.length} 大类）：`);
  for (const [eq, n] of distribution(
    all.map((i) => i.equipment ?? "（null）"),
    EXERCISE_EQUIPMENT,
  )) {
    console.log(`  ${eq.padEnd(16)} ${n}`);
  }

  console.log(`\n主肌群（${EXERCISE_MUSCLES.length} 基准，含次肌群命中）：`);
  const muscleCounts = new Map<string, number>(
    EXERCISE_MUSCLES.map((m) => [m, 0]),
  );
  for (const item of all) {
    for (const m of item.primary_muscles)
      muscleCounts.set(m, (muscleCounts.get(m) ?? 0) + 1);
    for (const m of item.secondary_muscles)
      muscleCounts.set(m, (muscleCounts.get(m) ?? 0) + 1);
  }
  for (const [m, n] of muscleCounts) console.log(`  ${m.padEnd(16)} ${n}`);

  console.log(`\n类目（${EXERCISE_CATEGORIES.length} 类）：`);
  for (const [c, n] of distribution(
    all.map((i) => i.category ?? "（null）"),
    EXERCISE_CATEGORIES,
  )) {
    console.log(`  ${c.padEnd(22)} ${n}`);
  }

  console.log(`\n难度：`);
  for (const [d, n] of distribution(
    all.map((i) => i.difficulty),
    ["beginner", "intermediate", "advanced"],
  )) {
    console.log(`  ${d.padEnd(14)} ${n}`);
  }
}

// ============================================================================
// 主流程
// ============================================================================

async function main(): Promise<void> {
  console.log(`A3 动作库导入${dryRun ? "（DRY RUN）" : ""}`);
  const runIso = new Date().toISOString();

  const lib3Raw = readSource<Lib3Raw>(LIB3_PATH, "lib3");
  const lib1Raw = readSource<Lib1Raw>(LIB1_PATH, "lib1");
  console.log(
    `✓ 源读取：库3 ${lib3Raw.length} 条 / 库1 ${lib1Raw.length} 条（只读）`,
  );

  const plan = buildImportPlan(lib3Raw, lib1Raw);
  const total = plan.lib3Items.length + plan.lib1Items.length;
  console.log(
    `✓ 管线计划：库3 ${plan.lib3Items.length}（内部重名丢弃 ${plan.counts.lib3_internal_dup_dropped}）` +
      ` + 库1补缺 ${plan.lib1Items.length}（精确重名跳过 ${plan.counts.lib1_exact_overlap_skipped}）` +
      ` = ${total} 条 [精收上限 500]`,
  );
  if (total < 300 || total > 500)
    fail(`总量 ${total} 超出精收口径 300-500，中止`);

  // 人工清单（dry 与实跑均落盘，便于先审后导）
  if (!skipReport) {
    mkdirSync(dirname(REVIEW_DOC_PATH), { recursive: true });
    writeFileSync(REVIEW_DOC_PATH, renderReviewDoc(plan, runIso), "utf8");
    console.log(`✓ 人工清单：${REVIEW_DOC_PATH}`);
  }

  if (dryRun) {
    console.log("（dry run：不写库）");
    printStats(plan);
    return;
  }

  if (!process.env.DATABASE_URL) fail("缺少 DATABASE_URL（实跑需指向目标库）");

  const { getPostgresClient, closePostgresClient } =
    await import("../db/postgresql/client/postgres-client.js");
  const { createExerciseRepository } =
    await import("../db/postgresql/repository/exercise.repository.js");

  const client = getPostgresClient();
  try {
    const repo = createExerciseRepository(client);
    const before = await repo.countPublicLibrary();
    const items = [...plan.lib3Items, ...plan.lib1Items];
    const { written } = await repo.replaceAllPublicItems(items);
    const after = await repo.countPublicLibrary();
    console.log(
      `✓ 写库：替换前公共库 ${before} 行 → 写入 ${written} 行 → 现有 ${after} 行`,
    );
    if (after !== total) fail(`导入后计数 ${after} ≠ 计划 ${total}`);
  } finally {
    await closePostgresClient();
  }

  printStats(plan);
  console.log("\n=== 完成 ===");
}

main().catch((error) => {
  console.error("✗ 导入失败：", error);
  process.exit(1);
});
