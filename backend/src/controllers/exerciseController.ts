/**
 * Exercise Controller - 动作库 API
 *
 * 提供：
 * - GET /api/exercises - 获取所有动作
 * - GET /api/exercises/:id - 获取单个动作
 * - GET /api/exercises/target/:target - 按目标肌肉获取
 * - POST /api/exercises - 新增动作（管理员）
 * - PUT /api/exercises/:id - 更新动作（管理员）
 * - DELETE /api/exercises/:id - 删除动作（管理员）
 * - GET /api/exercises/stats - 获取统计信息
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import {
  ExerciseLibraryService,
  parseTargets,
  parseEquipmentRequired,
  type MuscleTarget
} from '../services/exerciseLibraryService.js';
import { parseJSONSafe } from '../types/validation.js';
import { getNowISO } from '../utils/timestamp.js';

// ============================================
// Handlers
// ============================================

/**
 * 获取所有动作
 */
export async function getAllExercises(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const exercises = await ExerciseLibraryService.getAllExercises();

    // 解析 JSON 字段 - 从 attributes JSONB 中提取
    const parsed = exercises.map(ex => {
      const attributes = parseJSONSafe<Record<string, any>>(ex.attributes, 'exercise attributes') || {};
      return {
        ...ex,
        targets: parseTargets(attributes.targets),
        equipment_required: parseEquipmentRequired(attributes.equipment_required)
      };
    });

    reply.send(parsed);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch exercises',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 获取单个动作
 */
export async function getExerciseById(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const exercise = await ExerciseLibraryService.getById(id);

    if (!exercise) {
      reply.status(404).send({
        error: 'Exercise not found',
        exerciseId: id
      });
      return;
    }

    // 解析 JSON 字段 - 从 attributes JSONB 中提取
    const attributes = parseJSONSafe<Record<string, any>>(exercise.attributes, 'exercise attributes') || {};
    const parsed = {
      ...exercise,
      targets: parseTargets(attributes.targets),
      equipment_required: parseEquipmentRequired(attributes.equipment_required)
    };

    reply.send(parsed);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch exercise',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 按名称获取动作（用于教学页面）
 */
export async function getExerciseByName(
  request: FastifyRequest<{ Params: { name: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { name } = request.params;
    const exercise = await ExerciseLibraryService.getByName(name);

    if (!exercise) {
      reply.status(404).send({
        error: 'Exercise not found',
        exerciseName: name
      });
      return;
    }

    // 解析 JSON 字段 - 从 attributes JSONB 中提取
    const attributes = parseJSONSafe<Record<string, any>>(exercise.attributes, 'exercise attributes') || {};
    const parsed = {
      ...exercise,
      targets: parseTargets(attributes.targets),
      equipment_required: parseEquipmentRequired(attributes.equipment_required)
    };

    reply.send(parsed);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch exercise by name',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 按目标肌肉获取动作
 */
export async function getExercisesByTarget(
  request: FastifyRequest<{ Params: { target: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { target } = request.params;
    const exercises = await ExerciseLibraryService.getByTarget(target as MuscleTarget);

    // 解析 JSON 字段 - 从 attributes JSONB 中提取
    const parsed = exercises.map(ex => {
      const attributes = parseJSONSafe<Record<string, any>>(ex.attributes, 'exercise attributes') || {};
      return {
        ...ex,
        targets: parseTargets(attributes.targets),
        equipment_required: parseEquipmentRequired(attributes.equipment_required)
      };
    });

    reply.send(parsed);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch exercises by target',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 按难度获取动作
 */
export async function getExercisesByDifficulty(
  request: FastifyRequest<{ Params: { difficulty: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { difficulty } = request.params;

    // 验证难度等级
    const validDifficulties = ['beginner', 'intermediate', 'advanced'];
    if (!validDifficulties.includes(difficulty)) {
      reply.status(400).send({
        error: 'Invalid difficulty level',
        validDifficulties
      });
      return;
    }

    const exercises = await ExerciseLibraryService.getByDifficulty(
      difficulty as 'beginner' | 'intermediate' | 'advanced'
    );

    // 解析 JSON 字段 - 从 attributes JSONB 中提取
    const parsed = exercises.map(ex => {
      const attributes = parseJSONSafe<Record<string, any>>(ex.attributes, 'exercise attributes') || {};
      return {
        ...ex,
        targets: parseTargets(attributes.targets),
        equipment_required: parseEquipmentRequired(attributes.equipment_required)
      };
    });

    reply.send(parsed);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch exercises by difficulty',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 按器械获取动作
 */
export async function getExercisesByEquipment(
  request: FastifyRequest<{ Querystring: { equipment?: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { equipment } = request.query;

    if (!equipment) {
      reply.status(400).send({
        error: 'Equipment parameter is required'
      });
      return;
    }

    const exercises = await ExerciseLibraryService.getByEquipment(equipment);

    // 解析 JSON 字段 - 从 attributes JSONB 中提取
    const parsed = exercises.map(ex => {
      const attributes = parseJSONSafe<Record<string, any>>(ex.attributes, 'exercise attributes') || {};
      return {
        ...ex,
        targets: parseTargets(attributes.targets),
        equipment_required: parseEquipmentRequired(attributes.equipment_required)
      };
    });

    reply.send(parsed);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch exercises by equipment',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 新增动作（管理员）
 */
export async function createExercise(
  request: FastifyRequest<{
    Body: {
      id: string;
      name: string;
      exercise_type: string;
      targets: any;
      equipment_required: any;
      difficulty: string;
      content_html?: string;
      assets?: any;
      assets_json?: string;
      tags?: any;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const body = request.body;

    // 验证必填字段
    if (!body.id || !body.name || !body.exercise_type || !body.targets) {
      reply.status(400).send({
        error: 'Missing required fields',
        required: ['id', 'name', 'exercise_type', 'targets']
      });
      return;
    }

    // 验证 targets 结构
    let targets: any;
    if (typeof body.targets === 'string') {
      const parsed = parseJSONSafe(body.targets, 'exerciseController.createExercise');
      if (!parsed) {
        reply.status(400).send({
          error: 'Invalid targets format',
          details: 'targets must be valid JSON'
        });
        return;
      }
      targets = parsed;
    } else {
      targets = body.targets;
    }

    if (!targets.primary || !Array.isArray(targets.primary) || targets.primary.length === 0) {
      reply.status(400).send({
        error: 'Invalid targets format',
        details: 'targets must be an object with primary array containing at least one muscle'
      });
      return;
    }

    // 序列化 JSON 字段
    const targets_json = typeof body.targets === 'string'
      ? body.targets
      : JSON.stringify(body.targets);

    const equipment_required = typeof body.equipment_required === 'string'
      ? body.equipment_required
      : JSON.stringify(body.equipment_required);

    // 处理 assets_json - 可能直接是 assets 对象或已序列化的字符串
    const assets_json = body.assets_json
      ? body.assets_json
      : (body.assets ? JSON.stringify(body.assets) : '{}');

    const tags_json = body.tags
      ? (typeof body.tags === 'string' ? body.tags : JSON.stringify(body.tags))
      : null;

    await ExerciseLibraryService.createExercise(
      {
        id: body.id,
        name: body.name,
        exercise_type: body.exercise_type as any,
        targets: targets_json,
        equipment_required,
        // createExercise rebuilds attributes from targets/equipment_required
        // internally; data.attributes is unused, so a placeholder satisfies the
        // Exercise interface without inventing a request field the schema lacks.
        attributes: '{}',
        difficulty: body.difficulty as any,
        content_html: body.content_html || '',
        assets_json,
        tags_json: tags_json || undefined,
        modified_by: 'admin',
        modified_at: getNowISO()
      },
      'admin'
    );

    reply.status(201).send({
      message: 'Exercise created successfully',
      exerciseId: body.id
    });
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to create exercise',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 更新动作（管理员）
 */
export async function updateExercise(
  request: FastifyRequest<{
    Params: { id: string };
    Body: {
      name?: string;
      exercise_type?: string;
      targets?: any;
      equipment_required?: any;
      difficulty?: string;
      content_html?: string;
      assets?: any;
      assets_json?: string;
      tags?: any;
      change_reason?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const body = request.body;

    // 构建更新数据
    const data: any = {};

    // 处理基本字段（包括 null 和空字符串的情况）
    if (body.name !== undefined) data.name = body.name;
    if (body.exercise_type !== undefined) data.exercise_type = body.exercise_type;
    if (body.difficulty !== undefined) data.difficulty = body.difficulty;
    if (body.content_html !== undefined) data.content_html = body.content_html;

    // 序列化 JSON 字段（显式检查是否提供了该字段）
    if ('targets' in body && body.targets !== undefined) {
      // 验证 targets 结构
      let targets: any;
      if (typeof body.targets === 'string') {
        const parsed = parseJSONSafe(body.targets, 'exerciseController.updateExercise');
        if (!parsed) {
          reply.status(400).send({
            error: 'Invalid targets format',
            details: 'targets must be valid JSON'
          });
          return;
        }
        targets = parsed;
      } else {
        targets = body.targets;
      }

      if (!targets.primary || !Array.isArray(targets.primary) || targets.primary.length === 0) {
        reply.status(400).send({
          error: 'Invalid targets format',
          details: 'targets must be an object with primary array containing at least one muscle'
        });
        return;
      }
      data.targets = typeof body.targets === 'string'
        ? body.targets
        : JSON.stringify(body.targets);
    }

    if ('equipment_required' in body && body.equipment_required !== undefined) {
      data.equipment_required = typeof body.equipment_required === 'string'
        ? body.equipment_required
        : JSON.stringify(body.equipment_required);
    }

    // 处理 assets_json
    if (body.assets_json !== undefined) {
      data.assets_json = body.assets_json;
    } else if (body.assets !== undefined) {
      data.assets_json = JSON.stringify(body.assets);
    }

    if (body.tags !== undefined) {
      data.tags_json = typeof body.tags === 'string'
        ? body.tags
        : JSON.stringify(body.tags);
    }

    // 添加修改元数据
    data.modified_by = 'admin';
    data.modified_at = getNowISO();

    await ExerciseLibraryService.updateExercise({
      exerciseId: id,
      data,
      modifiedBy: 'admin',
      changeReason: body.change_reason
    });

    reply.send({
      message: 'Exercise updated successfully',
      exerciseId: id
    });
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to update exercise',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 删除动作（管理员）
 */
export async function deleteExercise(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;

  try {
    await ExerciseLibraryService.deleteExercise(id);

    reply.send({
      message: 'Exercise deleted successfully',
      exerciseId: id
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      reply.status(404).send({
        error: 'Exercise not found',
        exerciseId: id
      });
      return;
    }

    reply.status(500).send({
      error: 'Failed to delete exercise',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 获取统计信息
 */
export async function getExerciseStats(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const stats = await ExerciseLibraryService.getStats();
    reply.send(stats);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch exercise statistics',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
