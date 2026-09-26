/**
 * Exercise Repository integration tests (issue #4).
 *
 * Validates against a REAL PostgreSQL (migration 002 applied): deepened-column
 * reads via contract-validated mapping, multi-axis search (muscle hits primary
 * OR secondary), Chinese-column writeback (name_zh / instructions_zh), and the
 * DB-level vocabulary CHECK constraint (bypass-Repository defense).
 * Skipped automatically when DATABASE_URL is unset (CI/PG-less machines).
 *
 * Run for real with:
 *   DATABASE_URL=postgresql://starfit:starfit@localhost:15432/starfit \
 *     npx jest tests/integration/exerciseRepository.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import pg from "pg";

import {
  getPostgresClient,
  closePostgresClient,
} from "../../src/db/postgresql/client/postgres-client.js";
import { createExerciseRepository } from "../../src/db/postgresql/repository/exercise.repository.js";
import { ServiceError } from "../../src/services/errors/ServiceError.js";
import { ValidationError } from "../../../shared/contracts/index.js";

const connectionString = process.env.DATABASE_URL;
const describeOrSkip = connectionString ? describe : describe.skip;

/** 测试动作 NanoID（12-24 字符） */
const TEST_ID = `exrepo-test-${Date.now()}`.slice(0, 24);
const TEST_NAME = `exrepo-深蹲-${Date.now()}`;

interface TestRow {
  id: string;
  name: string;
  name_zh: string | null;
  equipment: string | null;
  primary_muscles: string[];
  instructions_zh: string[] | null;
  video_urls: Record<string, string> | null;
}

describeOrSkip("ExerciseRepository (real PG, migration 002)", () => {
  let adminPool!: pg.Pool;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString });
    // 测试行：直接落新列（迁移 002 后的完整形态），attributes 兜底位留空对象
    await adminPool.query(
      `INSERT INTO exercises (id, name, exercise_type, difficulty, tutorials,
         equipment, category, body_part, primary_muscles, secondary_muscles,
         force_type, mechanic, instructions, video_urls)
       VALUES ($1, $2, 'resistance', 'intermediate', '{}'::jsonb,
         'barbell'::public.exercise_equipment,
         'strength'::public.exercise_category,
         'upper_legs'::public.exercise_body_part,
         ARRAY['quadriceps']::text[], ARRAY['glutes', 'hamstrings']::text[],
         'push'::public.exercise_force_type, 'compound'::public.exercise_mechanic,
         ARRAY['Descend to parallel.', 'Drive up.']::text[],
         '{"male": "https://cdn.example.com/exercise-videos/male/test.mp4"}'::jsonb)`,
      [TEST_ID, TEST_NAME],
    );
  });

  afterAll(async () => {
    if (adminPool) {
      await adminPool.query("DELETE FROM exercises WHERE id = $1", [TEST_ID]);
      await adminPool.end();
    }
    await closePostgresClient();
  });

  it("getItemById returns a contract-validated item with deepened columns", async () => {
    const repo = createExerciseRepository(getPostgresClient());
    const item = await repo.getItemById(TEST_ID);

    expect(item).not.toBeNull();
    expect(item?.id).toBe(TEST_ID);
    expect(item?.equipment).toBe("barbell");
    expect(item?.category).toBe("strength");
    expect(item?.body_part).toBe("upper_legs");
    expect(item?.primary_muscles).toEqual(["quadriceps"]);
    expect(item?.secondary_muscles).toEqual(["glutes", "hamstrings"]);
    expect(item?.force_type).toBe("push");
    expect(item?.mechanic).toBe("compound");
    expect(item?.instructions).toEqual(["Descend to parallel.", "Drive up."]);
    expect(item?.video_urls).toEqual({
      male: "https://cdn.example.com/exercise-videos/male/test.mp4",
    });
    expect(item?.name_zh).toBeNull(); // 中文列未填 → null
    // ISO 8601 时间戳（timestamptz → 字符串映射）
    expect(item?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("getItemById returns null for unknown id and throws on malformed id", async () => {
    const repo = createExerciseRepository(getPostgresClient());
    expect(await repo.getItemById("nonexistent-id-0001")).toBeNull();
    await expect(repo.getItemById("short")).rejects.toBeInstanceOf(
      ServiceError,
    );
  });

  it("getItemByName finds the test row", async () => {
    const repo = createExerciseRepository(getPostgresClient());
    const item = await repo.getItemByName(TEST_NAME);
    expect(item?.id).toBe(TEST_ID);
  });

  it("searchItems: muscle filter hits primary OR secondary; filters compose", async () => {
    const repo = createExerciseRepository(getPostgresClient());

    // 主肌群命中
    const byPrimary = await repo.searchItems({ muscle: "quadriceps" });
    expect(byPrimary.some((i) => i.id === TEST_ID)).toBe(true);

    // 次肌群命中（glutes 只在 secondary）
    const bySecondary = await repo.searchItems({ muscle: "glutes" });
    expect(bySecondary.some((i) => i.id === TEST_ID)).toBe(true);

    // 组合筛选：muscle + equipment + difficulty
    const combined = await repo.searchItems({
      muscle: "hamstrings",
      equipment: "barbell",
      difficulty: "intermediate",
    });
    expect(combined.some((i) => i.id === TEST_ID)).toBe(true);

    // 交集为空：muscle 命中但 equipment 不匹配 → 不返回
    const excluded = await repo.searchItems({
      muscle: "quadriceps",
      equipment: "cable",
    });
    expect(excluded.some((i) => i.id === TEST_ID)).toBe(false);

    // 词表外筛选值 → Zod 拒绝（validateOrThrow → ValidationError）
    await expect(
      repo.searchItems({ muscle: "中下胸" as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updateDetail writes Chinese columns and refreshes modified_by/modified_at", async () => {
    const repo = createExerciseRepository(getPostgresClient());

    const updated = await repo.updateDetail(
      TEST_ID,
      {
        name_zh: "杠铃深蹲",
        instructions_zh: [
          "站稳，杠铃置于斜方肌上",
          "下蹲至大腿平行",
          "蹬地站起",
        ],
      },
      "mas",
    );

    expect(updated?.name_zh).toBe("杠铃深蹲");
    expect(updated?.instructions_zh).toEqual([
      "站稳，杠铃置于斜方肌上",
      "下蹲至大腿平行",
      "蹬地站起",
    ]);
    expect(updated?.modified_by).toBe("mas");
    expect(updated?.modified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // 读回持久化（新连接路径 getItemById）
    const reread = await repo.getItemById(TEST_ID);
    expect(reread?.name_zh).toBe("杠铃深蹲");

    // 白名单外字段（name）被 schema strip：更新后原名不变
    expect(reread?.name).toBe(TEST_NAME);
  });

  it("updateDetail rejects empty patch and unknown id yields null", async () => {
    const repo = createExerciseRepository(getPostgresClient());
    await expect(repo.updateDetail(TEST_ID, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(
      await repo.updateDetail("nonexistent-id-0001", { name_zh: "x" }),
    ).toBeNull();
  });

  it("DB vocabulary CHECK rejects out-of-vocabulary muscle values (bypass-Repository defense)", async () => {
    // 绕过 Repository 直写脏值 → exercises_primary_muscles_vocab_check 拦截
    await expect(
      adminPool.query(
        `UPDATE exercises SET primary_muscles = ARRAY['中下胸']::text[] WHERE id = $1`,
        [TEST_ID],
      ),
    ).rejects.toThrow(/exercises_primary_muscles_vocab_check/);
  });
});
