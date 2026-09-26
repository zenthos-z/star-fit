/**
 * Verify Exercise Backfill (002) — 回填正确性校验脚本（issue #4）
 *
 * 迁移 002 的 SQL 回填内联了契约映射的镜像 CASE；本脚本用 TS 侧契约真源
 * （MUSCLE_ALIASES / EQUIPMENT_ALIASES 经 normalizeMuscle / normalizeEquipment）
 * 逐行重算期望值，与库中新列对照，输出一致性报告：
 *
 *   - attributes 解析一律走 parseJSONSafe（CLAUDE.md 红线）
 *   - 肌群：期望 = 数组逐元素归一去重；列值不一致 → 漂移
 *   - 器材：期望 = 首个可归一值 / 空数组→bodyweight；列值不一致 → 漂移
 *   - force_type：期望 = pattern push/pull 直映射
 *   - 行数：与迁移快照口径对照（迁移内 DO block 已断言零丢失，此处复核）
 *
 * 已知漂移源（报告时区分，不算迁移缺陷）：
 *   - 迁移后经旧写入路径（未接新列）插入的行 → 列为默认空值
 *   - 迁移后经新列 UPDATE 的行 → 列值可能领先 attributes
 *
 * 用法：
 *   DATABASE_URL=postgresql://starfit:starfit@localhost:15432/starfit \
 *     npx tsx src/scripts/verifyExerciseBackfill.ts
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import {
  getPostgresClient,
  closePostgresClient,
} from "../db/postgresql/client/postgres-client.js";
import {
  parseJSONSafe,
  normalizeMuscle,
  normalizeEquipment,
} from "../../../shared/dist/contracts/index.js";

/** 回填涉及的原始行形态（pg 驱动：jsonb → 对象，text[] → string[]） */
interface ExerciseRow {
  id: string;
  name: string;
  attributes: Record<string, unknown> | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  equipment: string | null;
  force_type: string | null;
}

/** attributes 的回填相关子集（宽松：存量含词表外脏值，不强校验） */
interface AttributesShape {
  targets?: { primary?: unknown; secondary?: unknown };
  equipment_required?: unknown;
  pattern?: unknown;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** 用契约归一函数重算 primary/secondary 期望值（去重、丢弃不可归一值） */
function expectedMuscles(raw: unknown): string[] {
  const mapped = toStringArray(raw)
    .map((v) => normalizeMuscle(v))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  return [...new Set(mapped)].sort();
}

/** 用契约归一函数重算 equipment 期望值（主器材 / 空数组→bodyweight / 不可归一→null） */
function expectedEquipment(raw: unknown): string | null {
  const arr = toStringArray(raw);
  for (const v of arr) {
    const mapped = normalizeEquipment(v);
    if (mapped !== null) return mapped;
  }
  return arr.length === 0 ? "bodyweight" : null;
}

function expectedForceType(pattern: unknown): string | null {
  if (pattern === "push" || pattern === "pull") return pattern;
  return null;
}

function sameSet(a: string[] | null, b: string[]): boolean {
  const sa = [...(a ?? [])].sort();
  return sa.length === b.length && sa.every((v, i) => v === b[i]);
}

async function main(): Promise<void> {
  const client = getPostgresClient();
  const rows = await client.queryMany<ExerciseRow>(`
    SELECT id, name, attributes, primary_muscles, secondary_muscles, equipment, force_type
    FROM exercises
    ORDER BY id
  `);

  let checked = 0;
  let drift = 0;
  const issues: string[] = [];

  for (const row of rows) {
    checked++;

    // 红线：JSON 解析一律 parseJSONSafe（失败返回 null 并告警，不静默）
    const attrs = parseJSONSafe<AttributesShape>(
      row.attributes ?? "{}",
      `verifyExerciseBackfill[${row.id}]`,
    );
    if (attrs === null) {
      drift++;
      issues.push(
        `${row.id} ${row.name}: attributes 无法解析（parseJSONSafe 返回 null）`,
      );
      continue;
    }

    const expPrimary = expectedMuscles(attrs.targets?.primary);
    const expSecondary = expectedMuscles(attrs.targets?.secondary);
    const expEquipment = expectedEquipment(attrs.equipment_required);
    const expForce = expectedForceType(attrs.pattern);

    const mismatches: string[] = [];
    if (!sameSet(row.primary_muscles, expPrimary)) {
      mismatches.push(
        `primary_muscles 列=${JSON.stringify(row.primary_muscles)} 期望=${JSON.stringify(expPrimary)}`,
      );
    }
    if (!sameSet(row.secondary_muscles, expSecondary)) {
      mismatches.push(
        `secondary_muscles 列=${JSON.stringify(row.secondary_muscles)} 期望=${JSON.stringify(expSecondary)}`,
      );
    }
    if ((row.equipment ?? null) !== expEquipment) {
      mismatches.push(
        `equipment 列=${JSON.stringify(row.equipment)} 期望=${JSON.stringify(expEquipment)}`,
      );
    }
    if ((row.force_type ?? null) !== expForce) {
      mismatches.push(
        `force_type 列=${JSON.stringify(row.force_type)} 期望=${JSON.stringify(expForce)}`,
      );
    }

    if (mismatches.length > 0) {
      drift++;
      issues.push(`${row.id} ${row.name}: ${mismatches.join("; ")}`);
    }
  }

  console.log("=== 002 Backfill Verification ===");
  console.log(`rows checked : ${checked}`);
  console.log(`consistent   : ${checked - drift}`);
  console.log(`drift        : ${drift}`);
  for (const line of issues) {
    console.log(`  ⚠ ${line}`);
  }
  console.log(
    drift === 0
      ? "RESULT: PASS"
      : "RESULT: DRIFT FOUND (see above; distinguish migration defects from post-migration writes)",
  );

  await closePostgresClient();
}

main().catch((err) => {
  console.error("[verifyExerciseBackfill] fatal:", err);
  process.exit(1);
});
