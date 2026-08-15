/**
 * Dashboard Controller
 *
 * 提供仪表盘数据 API，符合 MAS 数据契约规范：
 * - 时间使用 ISO 8601 UTC 格式
 * - JSON 解析使用 try-catch
 * - 错误统一返回 { error: string }
 * - 只读操作，不涉及数据写入
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { SessionRepo } from '../services/sessionRepo.js';
import { KnowledgeRepo } from '../services/knowledgeRepo.js';
import { MediaRepo } from '../services/mediaRepo.js';
import { getPostgresClient as getDb } from '../db/index.js';
import { getNowISO } from '../utils/timestamp.js';
import { formatTimestamps } from '../utils/responseFormat.js';

/**
 * GET /api/admin/dashboard/latest-training
 * 获取今日最近的训练记录
 */
export const getLatestTraining = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const db = getDb();

    // 使用 ISO 8601 UTC 字符串计算今日范围
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
    const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();

    console.log('[Dashboard] Querying sessions from', todayStart, 'to', todayEnd);

    // 查询今日训练记录（PostgreSQL 版本）
    // start_time 是 TIMESTAMPTZ 类型，直接使用 ISO 8601 字符串比较
    const sessionsResult = await db.query(`
      SELECT * FROM sessions
      WHERE start_time >= $todayStart
        AND start_time <= $todayEnd
      ORDER BY start_time DESC
    `, { todayStart, todayEnd });
    const sessions = sessionsResult.rows;

    console.log('[Dashboard] Found', sessions?.length || 0, 'sessions');

    if (!sessions || sessions.length === 0) {
      return reply.send({
        hasTraining: false,
        todayStats: {
          inProgress: 0,
          completed: 0,
          totalVolume: 0
        }
      });
    }

    // 获取最近的一条训练
    const latestSession = sessions[0];

    // 格式化时间戳字段（PostgreSQL 返回的是 Date 对象，需要转为 ISO 字符串）
    const formattedSession = formatTimestamps(latestSession, ['start_time', 'end_time', 'created_at', 'updated_at']);

    // 安全解析 JSON（符合数据契约）
    let sessionData: any = {};
    try {
      sessionData = formattedSession.raw_json ? JSON.parse(formattedSession.raw_json) : {};
    } catch (e) {
      console.error('[Dashboard] Failed to parse session raw_json:', e);
      sessionData = {};
    }

    // 计算总容量
    const totalVolume = calculateVolume(sessionData.exercises);

    // 统计今日数据
    const stats = calculateTodayStats(sessions);

    return reply.send({
      hasTraining: true,
      session: {
        id: formattedSession.id,
        userId: formattedSession.user_id,
        userName: formattedSession.user_id,
        title: sessionData.title || '训练记录',
        startTime: formattedSession.start_time,
        duration: formattedSession.duration || 0,
        exercises: formatExercises(sessionData.exercises),
        totalVolume,
        hasAudit: !!formattedSession.ai_audit_text,
        auditText: formattedSession.ai_audit_text,
      },
      todayStats: stats
    });
  } catch (e: any) {
    console.error('[Dashboard] getLatestTraining error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * GET /api/admin/server-info
 * 获取服务器信息
 *
 * 返回 API 服务器地址（端口 43111），供前端 App 连接使用
 */
export const getServerInfo = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    // 优先使用 X-Forwarded-Host（代理场景），其次使用 host header，最后使用本地地址
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = typeof forwardedHost === 'string' ? forwardedHost : (req.headers.host || 'localhost:43111');

    // 检测协议
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string'
      ? forwardedProto
      : (process.env.NODE_ENV === 'production' ? 'https' : 'http');

    // 确保使用 API 端口 43111
    // 检查是否已包含端口（排除 IPv6 地址的情况）
    const hasPort = /:\d+$/.test(host);
    const hostWithPort = hasPort ? host.replace(/:\d+$/, ':43111') : `${host}:43111`;
    const serverUrl = `${protocol}://${hostWithPort}`;

    return reply.send({
      serverUrl,
      apiUrl: serverUrl,
    });
  } catch (e: any) {
    console.error('[Dashboard] getServerInfo error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * GET /api/admin/exercises/stats
 * 获取动作库统计
 */
export const getExerciseStats = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const db = getDb();

    // 获取所有动作（PostgreSQL 版本）
    const exercisesResult = await db.query('SELECT * FROM exercises');
    const exercises = exercisesResult.rows;

    // 获取视频任务（PostgreSQL 版本）
    const videosResult = await db.query('SELECT * FROM media WHERE mime LIKE $mimePattern', { mimePattern: 'video/%' });
    const videos = videosResult.rows;

    // 安全处理数据
    const stats = {
      total: exercises?.length || 0,
      withVideo: exercises?.filter((e: any) => e.video_url || e.videoUrl).length || 0,
      withImage: exercises?.filter((e: any) => e.cover_image || e.coverImage).length || 0,
      pendingTranscode: 0, // 简化处理，实际可从视频任务表查询
    };

    return reply.send(stats);
  } catch (e: any) {
    console.error('[Dashboard] getExerciseStats error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

// 辅助函数：计算训练容量
function calculateVolume(exercises: any[]): number {
  if (!Array.isArray(exercises)) return 0;

  return exercises.reduce((acc: number, ex: any) => {
    const sets = ex.sets || [];
    return acc + sets.reduce((sAcc: number, s: any) => {
      return sAcc + ((s.weight || 0) * (s.reps || 0));
    }, 0);
  }, 0);
}

// 辅助函数：计算今日统计
function calculateTodayStats(sessions: any[]): any {
  return {
    inProgress: sessions.filter((s: any) => !s.end_time).length,
    completed: sessions.filter((s: any) => s.end_time).length,
    totalVolume: sessions.reduce((acc: number, s: any) => {
      let data: any = {};
      try {
        data = s.raw_json ? JSON.parse(s.raw_json) : {};
      } catch (e) {
        data = {};
      }
      return acc + calculateVolume(data.exercises);
    }, 0),
  };
}

// 辅助函数：格式化动作数据
function formatExercises(exercises: any[]): any[] {
  if (!Array.isArray(exercises)) return [];

  return exercises.map((ex: any) => ({
    name: ex.name || '未知动作',
    type: ex.type || 'unknown',
    sets: (ex.sets || []).map((s: any, idx: number) => ({
      index: idx,
      weight: s.weight,
      reps: s.reps,
      rpe: s.rpe,
      duration: s.duration,
      distance: s.distance,
    })),
  }));
}
