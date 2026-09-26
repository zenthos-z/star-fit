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

import {
  getPostgresClient,
  type PostgresClient,
} from "../db/postgresql/client/postgres-client.js";
import { getNowISO } from "../utils/timestamp.js";
import {
  EXERCISE_MUSCLES,
  EXERCISE_EQUIPMENT,
} from "../../../shared/dist/contracts/index.js";

/**
 * 写入输入：结构化列字段 + API 视图形态的 targets/equipment_required
 *（controller 提交 {primary,secondary} / 数组，Service 拆列存储）
 */
export type ExerciseWriteInput = Partial<Exercise> & {
  targets?: string | { primary?: unknown; secondary?: unknown };
  equipment_required?: string | string[];
};

// ============================================
// 类型定义
// ============================================

/**
 * 动作目标结构（API 视图形态：值域为 17 基准肌群英文词表）
 * 存储已拆列：primary_muscles / secondary_muscles（002 深化）
 */
export interface ExerciseTargets {
  primary: string[]; // 主要目标（17 基准肌群，如 ["chest"]）
  secondary?: string[]; // 次要目标（可选）
}

/**
 * exercises 行（002 深化后的结构化列子集；SELECT * 直接映射）
 */
export interface Exercise {
  id: string;
  name: string;
  name_zh?: string | null;
  exercise_type:
    | "resistance"
    | "unilateral"
    | "bodyweight"
    | "assisted"
    | "isometric"
    | "cardio"
    | "flexibility"
    | "heavy_weight"
    | "rep_training"
    | "outdoor";
  difficulty: "beginner" | "intermediate" | "advanced";
  equipment?: string | null; // 15 器材大类（单值）
  category?: string | null; // 7 训练类目
  body_part?: string | null; // 10 身体区域
  primary_muscles?: string[] | null; // 17 基准肌群
  secondary_muscles?: string[] | null;
  force_type?: string | null;
  mechanic?: string | null;
  owner_user_id?: string | null; // 自定义动作归属（NULL = 公共库）
  content_html?: string | null;
  tutorials?: string | Record<string, unknown> | null; // JSONB record
  assets_json?: string; // { cover, video }
  tags_json?: string;
  modified_by?: "admin" | "system" | "mas" | null;
  modified_at?: string | null; // ISO 8601 UTC timestamp
  created_at?: string;
  updated_at?: string; // ISO 8601 UTC timestamp
}

export interface ExerciseUpdate {
  exerciseId: string;
  data: ExerciseWriteInput;
  modifiedBy: "admin" | "system";
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
    const rows = await client.queryMany<Exercise>(
      `
      SELECT * FROM exercises
      ORDER BY name
    `,
      {},
    );

    return rows;
  },

  /**
   * 按目标肌肉筛选动作
   */
  async getByTarget(target: string): Promise<Exercise[]> {
    const client = this.getClient();
    // 结构化列查询：命中 primary 或 secondary（17 基准肌群词表值）
    const rows = await client.queryMany<Exercise>(
      `
      SELECT * FROM exercises
      WHERE $target::text = ANY(primary_muscles)
         OR $target::text = ANY(secondary_muscles)
      ORDER BY name
    `,
      { target },
    );

    return rows;
  },

  /**
   * 获取单个动作
   */
  async getById(id: string): Promise<Exercise | null> {
    const client = this.getClient();
    const row = await client.queryOne<Exercise>(
      `
      SELECT * FROM exercises WHERE id = $id
    `,
      { id },
    );

    return row || null;
  },

  /**
   * 按名称获取动作（用于教学页面查询）
   */
  async getByName(name: string): Promise<Exercise | null> {
    const client = this.getClient();
    const row = await client.queryOne<Exercise>(
      `
      SELECT * FROM exercises WHERE name = $name
    `,
      { name },
    );

    return row || null;
  },

  /**
   * 按难度获取动作
   */
  async getByDifficulty(
    difficulty: "beginner" | "intermediate" | "advanced",
  ): Promise<Exercise[]> {
    const client = this.getClient();
    const rows = await client.queryMany<Exercise>(
      `
      SELECT * FROM exercises
      WHERE difficulty = $difficulty
      ORDER BY name
    `,
      { difficulty },
    );

    return rows;
  },

  /**
   * 按器械筛选动作
   */
  async getByEquipment(equipment: string): Promise<Exercise[]> {
    const client = this.getClient();
    // 结构化列查询：equipment 单值枚举（15 大类词表值）
    const rows = await client.queryMany<Exercise>(
      `
      SELECT * FROM exercises
      WHERE equipment = $equipment::public.exercise_equipment
      ORDER BY name
    `,
      { equipment },
    );

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

    // 顶级字段直写；targets/equipment_required（API 视图形态）拆列存储
    const topLevelFields = [
      "id",
      "name",
      "exercise_type",
      "difficulty",
      "content_html",
      "tutorials",
      "assets_json",
    ];
    const regularUpdates: string[] = [];
    const params: Record<string, any> = {};

    Object.entries(validated).forEach(([key, value]) => {
      if (value === undefined) return;

      if (topLevelFields.includes(key)) {
        regularUpdates.push(`${key} = $${key}`);
        params[key] = value;
      } else if (key === "targets") {
        // targets {primary, secondary} → primary_muscles / secondary_muscles 两列
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        regularUpdates.push(`primary_muscles = $primaryMuscles::text[]`);
        regularUpdates.push(`secondary_muscles = $secondaryMuscles::text[]`);
        params.primaryMuscles = Array.isArray(parsed.primary)
          ? parsed.primary
          : [];
        params.secondaryMuscles = Array.isArray(parsed.secondary)
          ? parsed.secondary
          : [];
      } else if (key === "equipment_required") {
        // equipment_required 数组（API 兼容形态）→ equipment 单值枚举（取首个）
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        const first =
          Array.isArray(parsed) && parsed.length > 0 ? String(parsed[0]) : null;
        regularUpdates.push(
          `equipment = $equipment::public.exercise_equipment`,
        );
        params.equipment = first ?? "bodyweight";
      }
    });

    if (regularUpdates.length === 0) {
      return; // 没有需要更新的字段
    }

    const timestamp = getNowISO();
    params.modifiedBy = update.modifiedBy;
    params.modifiedAt = timestamp;
    params.updatedAt = timestamp;
    params.exerciseId = update.exerciseId;

    const updateParts = [
      ...regularUpdates,
      "modified_by = $modifiedBy",
      "modified_at = $modifiedAt",
      "updated_at = $updatedAt",
    ];

    await client.query(
      `
      UPDATE exercises
      SET ${updateParts.join(", ")}
      WHERE id = $exerciseId
    `,
      params,
    );
  },

  /**
   * 新增动作（管理员使用）
   */
  async createExercise(
    data: ExerciseWriteInput,
    createdBy: string,
  ): Promise<void> {
    const client = this.getClient();

    // 验证数据
    const validated = this.validateExercise(data);

    // targets {primary, secondary} / equipment_required 数组（API 视图形态）拆列存储
    let primaryMuscles: string[] = [];
    let secondaryMuscles: string[] = [];
    if (validated.targets) {
      try {
        const parsed =
          typeof validated.targets === "string"
            ? JSON.parse(validated.targets)
            : validated.targets;
        primaryMuscles = Array.isArray(parsed.primary) ? parsed.primary : [];
        secondaryMuscles = Array.isArray(parsed.secondary)
          ? parsed.secondary
          : [];
      } catch {
        primaryMuscles = [];
        secondaryMuscles = [];
      }
    }

    let equipment: string = "bodyweight";
    if (validated.equipment_required) {
      try {
        const parsed =
          typeof validated.equipment_required === "string"
            ? JSON.parse(validated.equipment_required)
            : validated.equipment_required;
        equipment =
          Array.isArray(parsed) && parsed.length > 0
            ? String(parsed[0])
            : "bodyweight";
      } catch {
        equipment = "bodyweight";
      }
    }

    await client.query(
      `
      INSERT INTO exercises
      (id, name, exercise_type, difficulty, primary_muscles, secondary_muscles, equipment, content_html, tutorials, assets_json, modified_by, modified_at, updated_at)
      VALUES ($id, $name, $exerciseType, $difficulty, $primaryMuscles::text[], $secondaryMuscles::text[], $equipment::public.exercise_equipment, $contentHtml, $tutorials, $assetsJson, $modifiedBy, $modifiedAt, $updatedAt)
    `,
      {
        id: validated.id,
        name: validated.name,
        exerciseType: validated.exercise_type || "resistance",
        difficulty: validated.difficulty || "beginner",
        primaryMuscles,
        secondaryMuscles,
        equipment,
        contentHtml: validated.content_html || "",
        tutorials: validated.tutorials || "{}",
        assetsJson: validated.assets_json || "{}",
        modifiedBy: createdBy,
        modifiedAt: getNowISO(),
        updatedAt: getNowISO(),
      },
    );
  },

  /**
   * 删除动作（管理员使用）
   */
  async deleteExercise(id: string): Promise<void> {
    const client = this.getClient();

    const result = await client.query(
      `
      DELETE FROM exercises WHERE id = $id
    `,
      { id },
    );

    if (result.rowCount === 0) {
      throw new Error(`Exercise not found: ${id}`);
    }
  },

  /**
   * 数据验证
   */
  validateExercise(data: ExerciseWriteInput): ExerciseWriteInput {
    const validated: ExerciseWriteInput = {};

    if (data.id !== undefined) {
      if (typeof data.id !== "string") {
        throw new Error("Exercise id must be a string");
      }
      const trimmed = data.id.trim();
      if (!trimmed || trimmed === "null" || trimmed === "undefined") {
        throw new Error(
          "Exercise id is required and must be a non-empty string",
        );
      }
      validated.id = trimmed;
    }

    // 必填字段验证
    if (data.name !== undefined) {
      if (typeof data.name !== "string" || data.name.trim().length === 0) {
        throw new Error(
          "Exercise name is required and must be a non-empty string",
        );
      }
      validated.name = data.name.trim();
    }

    // 枚举字段验证
    if (data.exercise_type !== undefined) {
      const validTypes = [
        "resistance",
        "unilateral",
        "bodyweight",
        "assisted",
        "isometric",
        "cardio",
        "flexibility",
        "heavy_weight",
        "rep_training",
        "outdoor",
      ];
      if (!validTypes.includes(data.exercise_type)) {
        throw new Error(`Invalid exercise_type: ${data.exercise_type}`);
      }
      validated.exercise_type = data.exercise_type;
    }

    if (data.difficulty !== undefined) {
      const validDifficulties = ["beginner", "intermediate", "advanced"];
      if (!validDifficulties.includes(data.difficulty)) {
        throw new Error(`Invalid difficulty: ${data.difficulty}`);
      }
      validated.difficulty = data.difficulty;
    }

    // JSON 字段验证
    // targets: 提供时验证结构；未提供不强制（部分更新如仅回写 tutorials 时无 targets，
    // 新建路径由 controller 层保证 targets 必填）
    if (data.targets !== undefined) {
      try {
        // 处理两种情况：targets 可能是字符串或对象
        let parsed;
        if (typeof data.targets === "string") {
          parsed = JSON.parse(data.targets);
        } else if (typeof data.targets === "object" && data.targets !== null) {
          parsed = data.targets;
        } else {
          throw new Error("targets must be a valid JSON object");
        }

        // 验证结构：必须有 primary 数组
        if (!parsed.primary || !Array.isArray(parsed.primary)) {
          throw new Error("targets must contain primary array");
        }

        // 值域校验：17 基准肌群英文词表（DB CHECK 兜底，应用层前置拦截给出友好错误）
        const vocab = EXERCISE_MUSCLES as readonly string[];
        for (const m of [
          ...parsed.primary,
          ...(Array.isArray(parsed.secondary) ? parsed.secondary : []),
        ]) {
          if (typeof m !== "string" || !vocab.includes(m)) {
            throw new Error(
              `Invalid muscle value: ${String(m)}. Must be one of: ${vocab.join(", ")}`,
            );
          }
        }

        validated.targets =
          typeof data.targets === "string"
            ? data.targets
            : JSON.stringify(data.targets);
      } catch (e) {
        throw new Error("Invalid targets JSON format");
      }
    }

    if (data.equipment_required !== undefined) {
      try {
        // 处理两种情况：equipment_required 可能是字符串或数组
        let parsed;
        if (typeof data.equipment_required === "string") {
          parsed = JSON.parse(data.equipment_required);
        } else if (Array.isArray(data.equipment_required)) {
          parsed = data.equipment_required;
        } else {
          throw new Error("equipment_required must be a valid JSON array");
        }

        if (!Array.isArray(parsed)) {
          throw new Error("equipment_required must be an array");
        }

        // 值域校验：15 器材大类（取首个落 equipment 单值列）
        const eqVocab = EXERCISE_EQUIPMENT as readonly string[];
        for (const e of parsed) {
          if (typeof e !== "string" || !eqVocab.includes(e)) {
            throw new Error(
              `Invalid equipment value: ${String(e)}. Must be one of: ${eqVocab.join(", ")}`,
            );
          }
        }
        validated.equipment_required =
          typeof data.equipment_required === "string"
            ? data.equipment_required
            : JSON.stringify(data.equipment_required);
      } catch (e) {
        throw new Error("Invalid equipment_required JSON format");
      }
    }

    // 其他可选字段
    if (data.tags_json !== undefined) validated.tags_json = data.tags_json;
    if (data.content_html !== undefined)
      validated.content_html = data.content_html;
    if (data.assets_json !== undefined)
      validated.assets_json = data.assets_json;
    if (data.tutorials !== undefined) {
      // tutorials 为 JSONB 列：接受对象（序列化）或已序列化字符串，结构非法则拒
      if (typeof data.tutorials === "string") {
        try {
          JSON.parse(data.tutorials);
          validated.tutorials = data.tutorials;
        } catch {
          throw new Error("Invalid tutorials JSON format");
        }
      } else if (
        typeof data.tutorials === "object" &&
        data.tutorials !== null
      ) {
        validated.tutorials = JSON.stringify(data.tutorials);
      }
    }

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

    const totalRow = await client.queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM exercises",
      {},
    );

    const byDifficultyRows = await client.queryMany<{
      difficulty: string;
      count: string;
    }>(
      `
      SELECT difficulty, COUNT(*) as count
      FROM exercises
      GROUP BY difficulty
    `,
      {},
    );

    const byDifficulty: Record<string, number> = {};
    byDifficultyRows.forEach((row) => {
      byDifficulty[row.difficulty] = parseInt(row.count);
    });

    return {
      total: parseInt(totalRow?.count || "0"),
      byDifficulty,
    };
  },
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
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const primary = Array.isArray((json as any).primary)
      ? (json as any).primary
      : [];
    const secondary = Array.isArray((json as any).secondary)
      ? (json as any).secondary
      : undefined;
    return { primary, secondary };
  }

  // 如果是字符串，解析 JSON
  if (typeof json !== "string" || json.trim() === "") {
    return { primary: [] };
  }
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return { primary: [] };
    const primary = Array.isArray((parsed as any).primary)
      ? (parsed as any).primary
      : [];
    const secondary = Array.isArray((parsed as any).secondary)
      ? (parsed as any).secondary
      : undefined;
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
  if (typeof json !== "string" || json.trim() === "") return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
