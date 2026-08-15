/**
 * ExerciseLibraryService - PostgreSQL Migration
 *
 * 动作库统一服务层，提供 MAS 和 Admin Console 的统一访问接口
 *
 * Changes from SQLite version:
 * - Replaced getDb() with getPostgresClient()
 * - Converted all SQL queries from SQLite to PostgreSQL syntax
 * - Used named parameters ($paramName) for query parameters
 * - Used TIMESTAMPTZ for timestamps
 * - Used JSONB for JSON columns
 *
 * @version 3.0.0 - PostgreSQL Migration
 */

import { getPostgresClient, type PostgresClient } from '../db/postgresql/client/postgres-client.js';
import { getNowISO } from '../utils/timestamp.js';

// ============================================
// 类型定义
// ============================================

/**
 * 肌肉目标选项 - 完整的肌肉分区列表
 */
export type MuscleTarget =
  | '上胸' | '中下胸'
  | '前束' | '中束' | '后束'
  | '二头' | '三头' | '小臂'
  | '背部' | '下背' | '斜方肌'
  | '腹肌' | '侧腹'
  | '股四' | '腘绳' | '小腿'
  | '上臀部' | '下臀部';

/**
 * 动作目标结构
 */
export interface ExerciseTargets {
  primary: MuscleTarget[];      // 主要目标（至少1个）
  secondary?: MuscleTarget[];   // 次要目标（可选）
}

export interface Exercise {
  id: string;
  name: string;
  exercise_type: 'resistance' | 'unilateral' | 'bodyweight' | 'assisted' | 'isometric' | 'cardio' | 'flexibility' | 'heavy_weight' | 'rep_training' | 'outdoor';
  targets: string; // JSON stringified ExerciseTargets
  equipment_required: string; // JSON stringified string[]
  attributes: string; // JSON stringified ExerciseAttributes (DB JSONB column)
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  content_html?: string;
  tutorials?: string; // JSON stringified record (optional, DB JSONB column)
  assets_json?: string; // { cover, video }
  tags_json?: string;
  modified_by: 'admin' | 'system' | 'mas';
  modified_at: string; // ISO 8601 UTC timestamp
  updated_at?: string; // ISO 8601 UTC timestamp
  protocol_version?: string;
  version?: number;
  metadata_json?: string;
}

export interface ExerciseUpdate {
  exerciseId: string;
  data: Partial<Omit<Exercise, 'id' | 'updated_at'>>;
  modifiedBy: 'admin' | 'system';
  changeReason?: string;
}

// ============================================
// ExerciseLibraryService - PostgreSQL Implementation
// ============================================

export const ExerciseLibraryService = {
  /**
   * Get PostgreSQL client instance
   */
  getClient(): PostgresClient {
    return getPostgresClient();
  },

  /**
   * 获取所有动作（供 MAS 和 Admin 使用）
   */
  async getAllExercises(): Promise<Exercise[]> {
    const client = this.getClient();
    const rows = await client.queryMany<Exercise>(`
      SELECT * FROM exercises
      ORDER BY name
    `, {});

    return rows;
  },

  /**
   * 按目标肌肉筛选动作
   */
  async getByTarget(target: MuscleTarget): Promise<Exercise[]> {
    const client = this.getClient();
    // PostgreSQL JSONB query for targets
    const rows = await client.queryMany<Exercise>(`
      SELECT * FROM exercises
      WHERE attributes::jsonb->'targets'::jsonb->'primary'::text LIKE $targetPattern
      ORDER BY name
    `, { targetPattern: `%"${target}"%` });

    return rows;
  },

  /**
   * 获取单个动作
   */
  async getById(id: string): Promise<Exercise | null> {
    const client = this.getClient();
    const row = await client.queryOne<Exercise>(`
      SELECT * FROM exercises WHERE id = $id
    `, { id });

    return row || null;
  },

  /**
   * 按名称获取动作（用于教学页面查询）
   */
  async getByName(name: string): Promise<Exercise | null> {
    const client = this.getClient();
    const row = await client.queryOne<Exercise>(`
      SELECT * FROM exercises WHERE name = $name
    `, { name });

    return row || null;
  },

  /**
   * 按难度获取动作
   */
  async getByDifficulty(difficulty: 'beginner' | 'intermediate' | 'advanced'): Promise<Exercise[]> {
    const client = this.getClient();
    const rows = await client.queryMany<Exercise>(`
      SELECT * FROM exercises
      WHERE difficulty = $difficulty
      ORDER BY name
    `, { difficulty });

    return rows;
  },

  /**
   * 按器械筛选动作
   */
  async getByEquipment(equipment: string): Promise<Exercise[]> {
    const client = this.getClient();
    const rows = await client.queryMany<Exercise>(`
      SELECT * FROM exercises
      WHERE attributes->'equipment_required'::text LIKE $equipmentPattern
      ORDER BY name
    `, { equipmentPattern: `%"${equipment}"%` });

    return rows;
  },

  /**
   * 更新动作（管理员使用）
   */
  async updateExercise(update: ExerciseUpdate): Promise<void> {
    const client = this.getClient();

    // 验证数据
    const validated = this.validateExercise(update.data);

    // 获取旧数据用于审计
    const oldExercise = await this.getById(update.exerciseId);
    if (!oldExercise) {
      throw new Error(`Exercise not found: ${update.exerciseId}`);
    }

    // 分离顶级字段和 attributes 字段
    const topLevelFields = ['id', 'name', 'exercise_type', 'difficulty', 'content_html', 'tutorials', 'assets_json'];
    const attributesFields: Record<string, any> = {};
    const regularUpdates: string[] = [];
    const params: Record<string, any> = {};

    Object.entries(validated).forEach(([key, value]) => {
      if (value === undefined) return;

      if (topLevelFields.includes(key)) {
        regularUpdates.push(`${key} = $${key}`);
        params[key] = value;
      } else {
        // 这些字段存储在 attributes JSONB 中
        attributesFields[key] = value;
      }
    });

    // 构建 attributes 更新（使用 jsonb_set）
    let attributesUpdate = '';
    const attrParams: Record<string, any> = {};
    let attrIndex = 1;

    if (Object.keys(attributesFields).length > 0) {
      let currentAttributes = 'attributes';

      for (const [key, value] of Object.entries(attributesFields)) {
        const paramName = `attrValue${attrIndex}`;
        attrParams[paramName] = value;
        // 构建嵌套的 jsonb_set 调用
        currentAttributes = `jsonb_set(${currentAttributes}, '{${key}}', $${paramName}::jsonb)`;
        attrIndex++;
      }

      attributesUpdate = `, attributes = ${currentAttributes}`;
    }

    // 合并所有参数
    Object.assign(params, attrParams);

    if (regularUpdates.length === 0 && Object.keys(attributesFields).length === 0) {
      return; // 没有需要更新的字段
    }

    const timestamp = getNowISO();
    params.modifiedBy = update.modifiedBy;
    params.modifiedAt = timestamp;
    params.updatedAt = timestamp;
    params.exerciseId = update.exerciseId;

    const updateParts = [...regularUpdates, 'modified_by = $modifiedBy', 'modified_at = $modifiedAt', 'updated_at = $updatedAt'];

    await client.query(`
      UPDATE exercises
      SET ${updateParts.join(', ')}${attributesUpdate}
      WHERE id = $exerciseId
    `, params);
  },

  /**
   * 新增动作（管理员使用）
   */
  async createExercise(data: Exercise, createdBy: string): Promise<void> {
    const client = this.getClient();

    // 验证数据
    const validated = this.validateExercise(data);

    // 构建完整的 attributes 对象（包含 targets 和 equipment_required）
    const attributes: Record<string, any> = {};

    if (validated.targets) {
      try {
        attributes.targets = typeof validated.targets === 'string'
          ? JSON.parse(validated.targets)
          : validated.targets;
      } catch {
        attributes.targets = { primary: [], secondary: [] };
      }
    }

    if (validated.equipment_required) {
      try {
        attributes.equipment_required = typeof validated.equipment_required === 'string'
          ? JSON.parse(validated.equipment_required)
          : validated.equipment_required;
      } catch {
        attributes.equipment_required = [];
      }
    }

    await client.query(`
      INSERT INTO exercises
      (id, name, exercise_type, difficulty, attributes, content_html, tutorials, assets_json, modified_by, modified_at, updated_at)
      VALUES ($id, $name, $exerciseType, $difficulty, $attributes, $contentHtml, $tutorials, $assetsJson, $modifiedBy, $modifiedAt, $updatedAt)
    `, {
      id: validated.id,
      name: validated.name,
      exerciseType: validated.exercise_type || 'resistance',
      difficulty: validated.difficulty || 'beginner',
      attributes: JSON.stringify(attributes),
      contentHtml: validated.content_html || '',
      tutorials: validated.tutorials || '{}',
      assetsJson: validated.assets_json || '{}',
      modifiedBy: createdBy,
      modifiedAt: getNowISO(),
      updatedAt: getNowISO()
    });
  },

  /**
   * 删除动作（管理员使用）
   */
  async deleteExercise(id: string): Promise<void> {
    const client = this.getClient();

    const result = await client.query(`
      DELETE FROM exercises WHERE id = $id
    `, { id });

    if (result.rowCount === 0) {
      throw new Error(`Exercise not found: ${id}`);
    }
  },

  /**
   * 数据验证
   */
  validateExercise(data: Partial<Exercise>): Partial<Exercise> {
    const validated: Partial<Exercise> = {};

    if (data.id !== undefined) {
      if (typeof data.id !== 'string') {
        throw new Error('Exercise id must be a string');
      }
      const trimmed = data.id.trim();
      if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
        throw new Error('Exercise id is required and must be a non-empty string');
      }
      validated.id = trimmed;
    }

    // 必填字段验证
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim().length === 0) {
        throw new Error('Exercise name is required and must be a non-empty string');
      }
      validated.name = data.name.trim();
    }

    // 枚举字段验证
    if (data.exercise_type !== undefined) {
      const validTypes = ['resistance', 'unilateral', 'bodyweight', 'assisted', 'isometric', 'cardio', 'flexibility', 'heavy_weight', 'rep_training', 'outdoor'];
      if (!validTypes.includes(data.exercise_type)) {
        throw new Error(`Invalid exercise_type: ${data.exercise_type}`);
      }
      validated.exercise_type = data.exercise_type;
    }

    if (data.difficulty !== undefined) {
      const validDifficulties = ['beginner', 'intermediate', 'advanced'];
      if (!validDifficulties.includes(data.difficulty)) {
        throw new Error(`Invalid difficulty: ${data.difficulty}`);
      }
      validated.difficulty = data.difficulty;
    }

    // JSON 字段验证
    if (data.targets !== undefined) {
      try {
        // 处理两种情况：targets 可能是字符串或对象
        let parsed;
        if (typeof data.targets === 'string') {
          parsed = JSON.parse(data.targets);
        } else if (typeof data.targets === 'object' && data.targets !== null) {
          parsed = data.targets;
        } else {
          throw new Error('targets must be a valid JSON object');
        }

        // 验证结构：必须有 primary 数组
        if (!parsed.primary || !Array.isArray(parsed.primary)) {
          throw new Error('targets must contain primary array');
        }

        validated.targets = typeof data.targets === 'string' ? data.targets : JSON.stringify(data.targets);
      } catch (e) {
        throw new Error('Invalid targets JSON format');
      }
    } else {
      // targets 是必填字段，如果没有提供则抛出错误
      throw new Error('targets is required');
    }

    if (data.equipment_required !== undefined) {
      try {
        // 处理两种情况：equipment_required 可能是字符串或数组
        let parsed;
        if (typeof data.equipment_required === 'string') {
          parsed = JSON.parse(data.equipment_required);
        } else if (Array.isArray(data.equipment_required)) {
          parsed = data.equipment_required;
        } else {
          throw new Error('equipment_required must be a valid JSON array');
        }

        if (!Array.isArray(parsed)) {
          throw new Error('equipment_required must be an array');
        }
        validated.equipment_required = typeof data.equipment_required === 'string' ? data.equipment_required : JSON.stringify(data.equipment_required);
      } catch (e) {
        throw new Error('Invalid equipment_required JSON format');
      }
    }

    // 其他可选字段
    if (data.tags_json !== undefined) validated.tags_json = data.tags_json;
    if (data.content_html !== undefined) validated.content_html = data.content_html;
    if (data.assets_json !== undefined) validated.assets_json = data.assets_json;

    return validated;
  },


  /**
   * 获取动作库统计信息
   */
  async getStats(): Promise<{
    total: number;
    byDifficulty: Record<string, number>;
  }> {
    const client = this.getClient();

    const totalRow = await client.queryOne<{ count: string }>('SELECT COUNT(*) as count FROM exercises', {});

    const byDifficultyRows = await client.queryMany<{ difficulty: string; count: string }>(`
      SELECT difficulty, COUNT(*) as count
      FROM exercises
      GROUP BY difficulty
    `, {});

    const byDifficulty: Record<string, number> = {};
    byDifficultyRows.forEach(row => {
      byDifficulty[row.difficulty] = parseInt(row.count);
    });

    return {
      total: parseInt(totalRow?.count || '0'),
      byDifficulty
    };
  }
};

// ============================================
// 辅助函数
// ============================================

/**
 * 解析 targets JSON
 * 支持字符串或对象作为输入
 */
export function parseTargets(json: unknown): ExerciseTargets {
  // 如果是对象，直接使用
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const primary = Array.isArray((json as any).primary) ? (json as any).primary : [];
    const secondary = Array.isArray((json as any).secondary) ? (json as any).secondary : undefined;
    return { primary, secondary };
  }

  // 如果是字符串，解析 JSON
  if (typeof json !== 'string' || json.trim() === '') {
    return { primary: [] };
  }
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return { primary: [] };
    const primary = Array.isArray((parsed as any).primary) ? (parsed as any).primary : [];
    const secondary = Array.isArray((parsed as any).secondary) ? (parsed as any).secondary : undefined;
    return { primary, secondary };
  } catch (e) {
    return { primary: [] };
  }
}

/**
 * 解析 equipment_required JSON
 * 支持字符串或数组作为输入
 */
export function parseEquipmentRequired(json: unknown): string[] {
  // 如果是数组，直接返回
  if (Array.isArray(json)) {
    return json;
  }

  // 如果是字符串，解析 JSON
  if (typeof json !== 'string' || json.trim() === '') return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
