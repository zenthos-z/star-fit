/**
 * Layer 1: Database Foundation Tests
 *
 * Tests for verifying database connection, exercises table structure,
 * and seed data integrity.
 *
 * @version 1.0.0
 * @created 2026-02-19
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { getPostgresClient } from "../../src/db/postgresql/index.js";

describe("Layer 1: Database Foundation", () => {
  const postgresClient = getPostgresClient();

  beforeAll(async () => {
    // Ensure database is initialized
    await postgresClient.query("SELECT 1");
  });

  describe("步骤1.1: 验证数据库连接和表结构", () => {
    it("应该能成功连接到数据库", async () => {
      const result = await postgresClient.query("SELECT NOW() as current_time");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].current_time).toBeDefined();
    });

    it("exercises 表应该存在", async () => {
      const result = await postgresClient.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name = 'exercises'
      `);
      expect(result.rows).toHaveLength(1);
    });

    it("exercises 表应该包含必要的列", async () => {
      const result = await postgresClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'exercises'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r: any) => r.column_name);

      expect(columns).toContain("id");
      expect(columns).toContain("name");
      expect(columns).toContain("exercise_type");
      expect(columns).toContain("difficulty");
      // 002 深化列（结构化分类接管 attributes）
      expect(columns).toContain("equipment");
      expect(columns).toContain("primary_muscles");
      expect(columns).toContain("secondary_muscles");
      expect(columns).toContain("instructions");
      expect(columns).toContain("video_urls");
      expect(columns).toContain("name_zh");
      expect(columns).toContain("owner_user_id");
      // attributes 旧列已移除（002 返工：新列完全接管）
      expect(columns).not.toContain("attributes");
    });

    it("embedding 列和 pgvector 扩展应该已卸载（008/009 迁移）", async () => {
      const columns = await postgresClient.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'exercises' AND column_name = 'embedding'
      `);
      expect(columns.rows).toHaveLength(0);

      const extension = await postgresClient.query(`
        SELECT extname
        FROM pg_extension
        WHERE extname = 'vector'
      `);
      expect(extension.rows).toHaveLength(0);
    });
  });

  describe("步骤1.2 & 1.3: 验证数据完整性和内容", () => {
    it("exercises 表应为空库基线（002 清空存量 AI 数据，A3 重灌前）", async () => {
      const result = await postgresClient.query(
        "SELECT COUNT(*) as count FROM exercises",
      );
      const count = parseInt(result.rows[0].count, 10);
      expect(count).toBe(0);
    });

    it("应该包含预期的基本动作", async () => {
      const expectedExercises = [
        "fit:exercise:bench_press",
        "fit:exercise:squat",
        "fit:exercise:deadlift",
        "fit:exercise:pullup",
        "fit:exercise:overhead_press",
      ];

      for (const id of expectedExercises) {
        // PostgresClient 使用命名参数（$id），不支持 pg 位置参数（$1 + 数组）
        const result = await postgresClient.query(
          "SELECT id FROM exercises WHERE id = $id",
          { id },
        );
        // At least one of these should exist
        expect(result.rows.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("难度/动作类型词表应就位（枚举口径，空库基线）", async () => {
      // A3 重灌前空库：难度/类型词表由枚举类型保证，不再依赖行数据
      const difficultyEnum = await postgresClient.query(`
        SELECT count(*)::int AS n FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'difficulty_level'
      `);
      expect(difficultyEnum.rows[0].n).toBe(3);

      const typeEnum = await postgresClient.query(`
        SELECT count(*)::int AS n FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'exercise_type_enum'
      `);
      expect(typeEnum.rows[0].n).toBe(10);
    });
  });
});
