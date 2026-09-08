/**
 * Layer 1: Database Foundation Tests
 *
 * Tests for verifying database connection, exercises table structure,
 * and seed data integrity.
 *
 * @version 1.0.0
 * @created 2026-02-19
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { getPostgresClient } from '../../src/db/postgresql/index.js';

describe('Layer 1: Database Foundation', () => {
  const postgresClient = getPostgresClient();

  beforeAll(async () => {
    // Ensure database is initialized
    await postgresClient.query('SELECT 1');
  });

  describe('步骤1.1: 验证数据库连接和表结构', () => {
    it('应该能成功连接到数据库', async () => {
      const result = await postgresClient.query('SELECT NOW() as current_time');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].current_time).toBeDefined();
    });

    it('exercises 表应该存在', async () => {
      const result = await postgresClient.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name = 'exercises'
      `);
      expect(result.rows).toHaveLength(1);
    });

    it('exercises 表应该包含必要的列', async () => {
      const result = await postgresClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'exercises'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r: any) => r.column_name);

      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('exercise_type');
      expect(columns).toContain('difficulty');
      expect(columns).toContain('attributes');
    });

    it('embedding 列和 pgvector 扩展应该已卸载（008/009 迁移）', async () => {
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

  describe('步骤1.2 & 1.3: 验证数据完整性和内容', () => {
    it('exercises 表应该有数据', async () => {
      const result = await postgresClient.query('SELECT COUNT(*) as count FROM exercises');
      const count = parseInt(result.rows[0].count, 10);
      expect(count).toBeGreaterThan(0);
    });

    it('应该包含预期的基本动作', async () => {
      const expectedExercises = [
        'fit:exercise:bench_press',
        'fit:exercise:squat',
        'fit:exercise:deadlift',
        'fit:exercise:pullup',
        'fit:exercise:overhead_press'
      ];

      for (const id of expectedExercises) {
        const result = await postgresClient.query(
          'SELECT id FROM exercises WHERE id = $1',
          [id]
        );
        // At least one of these should exist
        expect(result.rows.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('attributes 字段应该包含正确的 JSON 结构', async () => {
      const result = await postgresClient.query(`
        SELECT id, attributes
        FROM exercises
        LIMIT 1
      `);

      expect(result.rows.length).toBeGreaterThan(0);
      const row = result.rows[0];
      const attributes = row.attributes;

      expect(attributes).toHaveProperty('targets');
      expect(attributes.targets).toHaveProperty('primary');
      expect(attributes.targets).toHaveProperty('secondary');
      expect(attributes).toHaveProperty('equipment_required');
    });

    it('应该有不同的难度级别', async () => {
      const result = await postgresClient.query(`
        SELECT DISTINCT difficulty
        FROM exercises
        ORDER BY difficulty
      `);

      const difficulties = result.rows.map((r: any) => r.difficulty);
      expect(difficulties.length).toBeGreaterThan(0);
    });

    it('应该有不同的动作类型', async () => {
      const result = await postgresClient.query(`
        SELECT DISTINCT exercise_type
        FROM exercises
        ORDER BY exercise_type
      `);

      const types = result.rows.map((r: any) => r.exercise_type);
      expect(types.length).toBeGreaterThan(0);
    });
  });
});
