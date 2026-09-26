/**
 * Verify Exercise Baseline (002) — 空库基线校验脚本（issue #4 返工）
 *
 * 迁移 002 最终态：16 深化列 + owner_user_id 落地，attributes JSONB 旧列
 * 与存量 25 条 AI 生成数据一并移除（A3 导入管道重灌干净数据）。本脚本
 * 校验迁移后的「空库基线」状态：
 *
 *   1. 行数 = 0（存量已清空，A3 重灌前）
 *   2. 16 深化列 + owner_user_id 全部存在
 *   3. attributes 旧列已不存在（新列完全接管）
 *   4. 词表 CHECK 生效冒烟：脏肌群写入被拒、合法写入通过后清理
 *   5. 枚举类型就位（exercise_equipment 15 值等）
 *
 * 用法：
 *   DATABASE_URL=postgresql://starfit:starfit@localhost:15432/starfit \
 *     npx tsx src/scripts/verifyExerciseBaseline.ts
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import {
  getPostgresClient,
  closePostgresClient,
} from "../db/postgresql/client/postgres-client.js";

/** 002 落地的全部新列（深化 16 + owner_user_id） */
const EXPECTED_COLUMNS = [
  "equipment",
  "category",
  "body_part",
  "primary_muscles",
  "secondary_muscles",
  "force_type",
  "mechanic",
  "instructions",
  "form_cues",
  "common_mistakes",
  "breathing",
  "aliases",
  "image_refs",
  "video_urls",
  "poster_url",
  "name_zh",
  "instructions_zh",
  "owner_user_id",
];

async function main(): Promise<void> {
  const client = getPostgresClient();
  const failures: string[] = [];

  // 1. 空库断言（A3 重灌前基线）
  const countRow = await client.queryOne<{ count: string }>(
    "SELECT count(*)::text AS count FROM exercises",
    {},
  );
  const count = Number(countRow?.count ?? "-1");
  if (count === 0) {
    console.log("✓ exercises 为空库（存量 AI 数据已清，等待 A3 重灌）");
  } else {
    failures.push(
      `exercises 应为空库，实际 ${count} 行（A3 重灌前基线被破坏？）`,
    );
  }

  // 2/3. 列存在性：新列全在 + attributes 不在
  const colRows = await client.queryMany<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'exercises'`,
    {},
  );
  const columns = new Set(colRows.map((r) => r.column_name));

  for (const col of EXPECTED_COLUMNS) {
    if (columns.has(col)) {
      console.log(`✓ 列存在: ${col}`);
    } else {
      failures.push(`缺失 002 新列: ${col}`);
    }
  }
  if (columns.has("attributes")) {
    failures.push("attributes 旧列仍存在（002 应已 DROP）");
  } else {
    console.log("✓ attributes 旧列已移除（新列完全接管）");
  }

  // 5. 枚举类型就位
  const enumRow = await client.queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'exercise_equipment'`,
    {},
  );
  if (Number(enumRow?.count ?? 0) === 15) {
    console.log("✓ exercise_equipment 枚举 15 值就位");
  } else {
    failures.push(
      `exercise_equipment 枚举值数异常: ${enumRow?.count}（期望 15）`,
    );
  }

  // 4. 词表 CHECK 冒烟：脏值被拒 / 合法值通过（仅空库时执行，探针行即清）
  if (count === 0) {
    try {
      await client.query(
        `INSERT INTO exercises (id, name, primary_muscles)
         VALUES ('baseline-check-0001', 'baseline-check', ARRAY['中下胸']::text[])`,
        {},
      );
      failures.push("词表 CHECK 未拦截脏肌群值（中下胸 不在 17 基准词表）");
      await client.query(
        "DELETE FROM exercises WHERE id = 'baseline-check-0001'",
        {},
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/exercises_primary_muscles_vocab_check/.test(msg)) {
        console.log("✓ 词表 CHECK 生效：脏肌群值被拒");
      } else {
        failures.push(`冒烟写入失败（非词表拦截原因）: ${msg}`);
      }
    }

    try {
      await client.query(
        `INSERT INTO exercises (id, name, primary_muscles, equipment)
         VALUES ('baseline-check-0002', 'baseline-check-ok', ARRAY['chest']::text[],
                 'barbell'::public.exercise_equipment)`,
        {},
      );
      console.log("✓ 合法值写入通过（chest / barbell）");
      await client.query(
        "DELETE FROM exercises WHERE id = 'baseline-check-0002'",
        {},
      );
    } catch (err) {
      failures.push(
        `合法值写入意外失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("=== 002 Baseline Verification ===");
  if (failures.length === 0) {
    console.log("RESULT: PASS");
  } else {
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log("RESULT: FAIL");
  }

  await closePostgresClient();
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[verifyExerciseBaseline] fatal:", err);
  process.exit(1);
});
