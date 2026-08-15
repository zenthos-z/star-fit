/**
 * Video Controller - 视频上传和管理 API
 *
 * API 端点：
 * - POST /api/videos/upload - 上传视频（立即返回，后台处理）
 * - GET /api/videos/:exerciseName - 获取动作视频信息
 * - DELETE /api/videos/:exerciseName - 删除动作视频
 * - GET /api/videos/tasks - 获取所有视频任务
 * - GET /api/videos/tasks/:id - 获取单个任务详情
 * - POST /api/videos/tasks/:id/retry - 重试失败任务
 * - DELETE /api/videos/tasks/:id - 删除任务
 * - GET /api/videos/stats - 获取存储统计
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { pipeline } from 'stream/promises';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { VideoQueueService } from '../services/videoQueueService.js';
import { VideoProcessingService } from '../services/videoProcessingService.js';
import { WebSocketProgressBroadcaster } from '../services/websocketProgressService.js';
import { getPostgresClient as getDb } from '../db/index.js';
import { getNowISO } from '../utils/timestamp.js';

// ============================================
// 类型定义
// ============================================

interface VideoUploadBody {
  exerciseName: string;
  qualities?: ('360p' | '720p' | '1080p')[];
}

// ============================================
// Handlers
// ============================================

/**
 * 上传视频（立即返回，后台处理）
 */
export async function uploadVideo(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  console.log('[VideoController] uploadVideo handler START');

  try {
    let filePart: any = null;
    let exerciseId: string | undefined;

    // 使用 parts() 遍历所有部分
    const parts = request.parts();

    for await (const part of parts) {
      console.log('[VideoController] Processing part:', {
        type: part.type,
        fieldname: part.fieldname,
        filename: (part as any).filename
      });

      if (part.type === 'file') {
        // 立即将文件流保存到缓冲区，避免阻塞解析器
        const buffer = await part.toBuffer();
        filePart = {
          file: buffer,
          filename: part.filename,
          mimetype: part.mimetype,
          fieldname: part.fieldname
        };
        console.log('[VideoController] File buffered:', part.filename);
      } else {
        // 接收 exerciseId（NanoID 格式）
        if (part.fieldname === 'exerciseId') {
          exerciseId = part.value as string;
          console.log('[VideoController] exerciseId:', exerciseId);
        }
      }
    }

    console.log('[VideoController] All parts processed');

    // 验证文件
    if (!filePart) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // 验证文件类型
    if (!filePart.mimetype?.startsWith('video/')) {
      return reply.status(400).send({ error: 'Invalid file type. Please upload a video file.' });
    }

    // 验证 exerciseId
    if (!exerciseId) {
      return reply.status(400).send({ error: 'exerciseId is required' });
    }

    console.log('[VideoController] Uploading video:', {
      filename: filePart.filename,
      exerciseId,
      mimeType: filePart.mimetype
    });

    // 使用 exerciseId 作为文件夹名称（NanoID 已经过验证，无需过滤）
    const exerciseDir = path.join(process.cwd(), 'uploads', 'videos', exerciseId);
    await fs.mkdir(exerciseDir, { recursive: true });

    const originalPath = path.join(exerciseDir, 'temp.mp4');
    await fs.writeFile(originalPath, filePart.file);

    // 获取文件大小
    const stats = await fs.stat(originalPath);

    console.log('[VideoController] File saved:', {
      path: originalPath,
      size: stats.size
    });

    // 创建处理任务（立即返回）
    const taskId = await VideoQueueService.createTask({
      exerciseId,
      exerciseName: exerciseId, // 使用 ID 作为 name 查询键
      originalFilename: filePart.filename,
      originalPath,
      fileSize: stats.size
    });

    console.log('[VideoController] Task created:', taskId);

    // 返回临时文件 URL（供前端立即显示）
    const originalVideoUrl = `/uploads/videos/${exerciseId}/temp.mp4`;

    reply.send({
      success: true,
      taskId,
      exerciseId,
      originalVideoUrl,
      message: '视频已上传，正在后台处理中'
    });

  } catch (error) {
    console.error('[VideoController] Upload failed:', error);
    reply.status(500).send({
      error: 'Video upload failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 获取动作视频信息
 */
export async function getVideoInfo(
  request: FastifyRequest<{ Params: { exerciseName: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { exerciseName } = request.params;

    const db = getDb();
    const exerciseResult = await db.query(
      'SELECT assets_json FROM exercises WHERE name = $exerciseName',
      { exerciseName }
    );
    const exercise = exerciseResult.rows[0] as any;

    if (!exercise) {
      return reply.status(404).send({ error: 'Exercise not found' });
    }

    const assets = exercise.assets_json ? JSON.parse(exercise.assets_json) : {};
    const video = assets.video || null;

    if (!video) {
      return reply.status(404).send({ error: 'No video found for this exercise' });
    }

    reply.send(video);

  } catch (error) {
    console.error('[VideoController] Get video info failed:', error);
    reply.status(500).send({
      error: 'Failed to get video info',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 删除动作视频
 */
export async function deleteVideo(
  request: FastifyRequest<{ Params: { exerciseName: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { exerciseName } = request.params;

    // 删除视频文件
    await VideoProcessingService.deleteVideo(exerciseName);

    // 更新数据库（移除视频资源）
    const db = getDb();
    const exerciseResult = await db.query(
      'SELECT assets_json FROM exercises WHERE name = $exerciseName',
      { exerciseName }
    );
    const exercise = exerciseResult.rows[0] as any;

    if (exercise) {
      const assets = exercise.assets_json ? JSON.parse(exercise.assets_json) : {};

      // 移除视频资源
      delete assets.video;

      await db.query(
        'UPDATE exercises SET assets_json = $assetsJson, modified_at = $modifiedAt WHERE name = $exerciseName',
        {
          assetsJson: JSON.stringify(assets),
          modifiedAt: getNowISO(),
          exerciseName
        }
      );
    }

    reply.send({ success: true });

  } catch (error) {
    console.error('[VideoController] Delete video failed:', error);
    reply.status(500).send({
      error: 'Failed to delete video',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 检查 FFmpeg 状态
 */
export async function checkFFmpegStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const hasFFmpeg = await VideoProcessingService.checkFFmpegInstalled();

    reply.send({
      installed: hasFFmpeg,
      suggestion: hasFFmpeg
        ? 'FFmpeg is ready'
        : 'Please install FFmpeg to enable video processing'
    });

  } catch (error) {
    reply.status(500).send({
      error: 'Failed to check FFmpeg status',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 获取所有视频任务
 */
export async function getAllVideoTasks(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const tasks = await VideoQueueService.getAllTasks();
    reply.send(tasks);
  } catch (error) {
    console.error('[VideoController] Get tasks failed:', error);
    reply.status(500).send({
      error: 'Failed to get video tasks',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 获取单个任务详情
 */
export async function getVideoTask(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const task = await VideoQueueService.getTask(id);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    reply.send(task);
  } catch (error) {
    console.error('[VideoController] Get task failed:', error);
    reply.status(500).send({
      error: 'Failed to get video task',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 重试失败任务
 */
export async function retryVideoTask(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    await VideoQueueService.retryTask(id);
    reply.send({ success: true, message: 'Task retry queued' });
  } catch (error) {
    console.error('[VideoController] Retry task failed:', error);
    reply.status(500).send({
      error: 'Failed to retry task',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 删除视频任务
 */
export async function deleteVideoTask(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    await VideoQueueService.deleteTask(id);
    reply.send({ success: true, message: 'Task deleted' });
  } catch (error) {
    console.error('[VideoController] Delete task failed:', error);
    reply.status(500).send({
      error: 'Failed to delete task',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

  /**
   * 获取存储统计
   */
  export async function getVideoStats(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
  try {
    const stats = await VideoQueueService.getStorageStats();
    reply.send(stats);
  } catch (error) {
    console.error('[VideoController] Get stats failed:', error);
    reply.status(500).send({
      error: 'Failed to get storage stats',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 广播视频处理完成事件
 */
export function broadcastVideoCompleted(taskId: string, exerciseName: string, videoAsset: any): void {
  WebSocketProgressBroadcaster.broadcast(taskId, {
    type: 'fit.video.completed',
    data: {
      taskId,
      exerciseName,
      videoAsset
    }
  });
  console.log('[VideoController] Video completed event broadcasted:', taskId);
}

/**
 * 广播视频处理错误事件
 */
export function broadcastVideoError(taskId: string, error: string, stage: string): void {
  WebSocketProgressBroadcaster.broadcast(taskId, {
    type: 'fit.video.error',
    data: {
      taskId,
      error,
      stage,
      errorMessage: error
    }
  });
  console.log('[VideoController] Video error event broadcasted:', taskId, error);
}
