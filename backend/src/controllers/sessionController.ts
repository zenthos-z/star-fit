/**
 * Session Controller - 训练 Session 持久化 API
 *
 * 提供：
 * - POST /api/sessions - 持久化训练 session 到 history_summary.sessions
 *
 * Phase 1 of workout_complete refactor: 前端先持久化，再调用 Agent 分析
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getUserId } from '../utils/requestUtils.js';
import { getPostgresClient } from '../db/postgresql/client/postgres-client.js';

// ============================================
// Schemas
// ============================================

/**
 * 单个动作记录（格式化训练条目）
 *
 * 前端 workoutSummary.ts 预处理后的形态：一行 = 一个动作的汇总
 * （组数/完成组数/重量/次数/时长/距离/心率按动作类型可选）。
 * `type` 决定哪些字段有意义：cardio/outdoor → duration/distance/avg_hr；
 * resistance 类 → weight/reps；isometric → duration。
 */
const ExerciseEntrySchema = z.object({
  name: z.string().min(1, 'Exercise name is required'),
  type: z.string().optional(),
  /** 计划组数 */
  sets: z.number().int().min(0).optional(),
  /** 实际完成组数 */
  completed_sets: z.number().int().min(0).optional(),
  reps: z.number().int().positive().optional(),
  // assisted 动作用负重量表示助力（如 -10kg），所以不设 min(0)
  weight: z.number().optional(),
  duration: z.number().positive().optional(), // For cardio/hiit/isometric (seconds)
  distance: z.number().min(0).optional(), // For cardio/outdoor (meters)
  /** 组级平均心率 bpm（来自心率带/穿戴设备，可选） */
  avg_hr: z.number().min(0).optional(),
  metadata: z.any().optional(),
});

/**
 * 训练统计数据
 * 抗阻类看 totalVolume/setsCount；有氧类看 totalCardioDurationSec/totalDistanceM/avgHr。
 */
const StatsSchema = z.object({
  totalVolume: z.number().min(0),
  setsCount: z.number().int().min(0),
  /** 有氧/户外实际时长合计（秒），可选以兼容旧客户端 */
  totalCardioDurationSec: z.number().min(0).optional(),
  /** 有氧/户外实际距离合计（米），可选以兼容旧客户端 */
  totalDistanceM: z.number().min(0).optional(),
  durationMinutes: z.number().int().min(0).optional(),
  avgHr: z.number().min(0).optional(),
}).optional();

/**
 * Session 持久化请求
 */
const SessionSchema = z.object({
  sessionId: z.string().uuid().optional(),
  startTime: z.number().positive('Start time must be a positive timestamp'),
  endTime: z.number().positive('End time must be a positive timestamp'),
  exercises: z.array(ExerciseEntrySchema).min(1, 'At least one exercise is required'),
  stats: StatsSchema,
  notes: z.string().max(2000).optional(),
});

// ============================================
// Handlers
// ============================================

/**
 * 持久化训练 session 到用户的 history_summary.sessions
 *
 * Phase 1 of workout_complete refactor:
 * - 前端在训练结束后先调用此 API 持久化数据
 * - 然后调用 Agent 进行分析（Agent 通过 load_history 读取）
 *
 * 这样确保：
 * 1. 数据不依赖 Agent（防止 Agent 超时导致数据丢失）
 * 2. Agent 始终从数据库读取真实数据（防止幻觉）
 */
export async function postSession(
  request: FastifyRequest<{ Body: z.infer<typeof SessionSchema> }>,
  reply: FastifyReply
): Promise<void> {
  const userId = getUserId(request);
  const parsed = SessionSchema.safeParse(request.body);

  if (!parsed.success) {
    reply.status(400).send({
      error: 'Invalid session data',
      details: parsed.error.flatten(),
    });
    return;
  }

  const session = parsed.data;
  const sessionId = session.sessionId || crypto.randomUUID();

  // Validate timestamps
  if (session.startTime >= session.endTime) {
    reply.status(400).send({
      error: 'Invalid timestamps',
      details: 'startTime must be before endTime',
    });
    return;
  }

  try {
    const client = getPostgresClient();

    // Build session record for history_summary.sessions
    const sessionRecord = {
      session_id: sessionId,
      start_time: new Date(session.startTime).toISOString(),
      end_time: new Date(session.endTime).toISOString(),
      exercises: session.exercises,
      stats: session.stats,
      notes: session.notes,
      recorded_at: new Date().toISOString(),
    };

    // Append session to history_summary.sessions
    // Using COALESCE to handle NULL history_summary
    const result = await client.query(
      `UPDATE users
         SET history_summary = COALESCE(history_summary, '{}'::jsonb)
           || jsonb_build_object('sessions',
             COALESCE(history_summary->'sessions', '[]'::jsonb) || $sessionRecord::jsonb)::jsonb,
           updated_at = NOW()
       WHERE id = $userId
       RETURNING history_summary->'sessions' as sessions`,
      { sessionRecord: JSON.stringify(sessionRecord), userId }
    );

    const sessions = result.rows[0]?.sessions;
    const sessionsCount = Array.isArray(sessions) ? sessions.length : 0;

    request.log.info({
      msg: 'Session persisted',
      userId,
      sessionId,
      exercisesCount: session.exercises.length,
      totalSessions: sessionsCount,
    });

    reply.status(201).send({
      ok: true,
      sessionId,
      sessionsCount,
    });
  } catch (error) {
    request.log.error({
      msg: 'Failed to persist session',
      userId,
      sessionId,
      error: (error as Error).message,
    });

    reply.status(500).send({
      error: 'Failed to persist session',
      message: (error as Error).message,
    });
  }
}

/**
 * 获取用户最近的 sessions（可选：用于验证持久化结果）
 */
export async function getRecentSessions(
  request: FastifyRequest<{ Querystring: { limit?: number } }>,
  reply: FastifyReply
): Promise<void> {
  const userId = getUserId(request);
  const limit = request.query.limit ?? 10;

  try {
    const client = getPostgresClient();

    const result = await client.queryOne<{ sessions: unknown }>(
      `SELECT history_summary->'sessions' as sessions
         FROM users
       WHERE id = $userId`,
      { userId }
    );

    if (!result?.sessions) {
      reply.status(200).send({ sessions: [], count: 0 });
      return;
    }

    const sessions = Array.isArray(result.sessions) ? result.sessions : [];
    const recent = sessions.slice(-limit);

    reply.status(200).send({
      sessions: recent,
      count: sessions.length,
    });
  } catch (error) {
    request.log.error({
      msg: 'Failed to fetch sessions',
      userId,
      error: (error as Error).message,
    });

    reply.status(500).send({
      error: 'Failed to fetch sessions',
      message: (error as Error).message,
    });
  }
}