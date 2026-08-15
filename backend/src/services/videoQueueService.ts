/**
 * VideoQueueService - 视频处理后台队列服务
 *
 * 功能：
 * - 视频上传后立即返回，将处理任务加入队列
 * - 后台自动处理待处理视频
 * - 支持多任务并行处理
 * - 失败重试机制
 * - 进度实时更新
 *
 * @version 2.0.0 - PostgreSQL Migration
 */

import { getPostgresClient } from '../db/index.js';
import { VideoProcessingService, videoProgressEmitter } from './videoProcessingService.js';
import { getNowISO } from '../utils/timestamp.js';
import { broadcastVideoCompleted, broadcastVideoError } from '../controllers/videoController.js';
import fs from 'fs/promises';
import path from 'path';

// ============================================
// 类型定义
// ============================================

export type VideoTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface VideoTask {
  id: string;
  exercise_name: string;
  original_filename: string;
  original_path: string;
  status: VideoTaskStatus;
  progress: number;
  current_stage: string | null;
  error_message: string | null;
  sources_json: string | null;
  poster_url: string | null;
  metadata_json: string | null;
  file_size: number;
  created_at: string; // ISO 8601 UTC timestamp
  started_at: string | null; // ISO 8601 UTC timestamp
  completed_at: string | null; // ISO 8601 UTC timestamp
  retry_count: number;
}

export interface CreateVideoTaskInput {
  exerciseId: string;      // NanoID 格式的动作 ID
  exerciseName: string;     // 保留用于兼容，实际使用 exerciseId
  originalFilename: string;
  originalPath: string;
  fileSize: number;
}

// ============================================
// VideoQueueService
// ============================================

export const VideoQueueService = {
  /** 最大并发处理任务数 */
  MAX_CONCURRENT_TASKS: 2,

  /** 当前正在处理的任务 */
  activeTasks: new Set<string>(),

  /**
   * 创建新的视频处理任务
   */
  async createTask(input: CreateVideoTaskInput): Promise<string> {
    const client = await getPostgresClient();
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await client.query(`
      INSERT INTO video_tasks
      (id, exercise_name, original_filename, original_path, file_size, status, progress, created_at)
      VALUES ($id, $exerciseName, $originalFilename, $originalPath, $fileSize, 'pending', 0, $createdAt)
    `, {
      id: taskId,
      exerciseName: input.exerciseName,
      originalFilename: input.originalFilename,
      originalPath: input.originalPath,
      fileSize: input.fileSize,
      createdAt: getNowISO()
    });

    console.log(`[VideoQueue] Task created: ${taskId} for exercise: ${input.exerciseName}`);

    // 触发处理队列
    this.processQueue().catch(err => {
      console.error('[VideoQueue] Queue processing error:', err);
    });

    return taskId;
  },

  /**
   * 获取所有视频任务
   */
  async getAllTasks(): Promise<VideoTask[]> {
    const client = await getPostgresClient();
    const result = await client.query(`
      SELECT * FROM video_tasks
      ORDER BY created_at DESC
    `);

    return result.rows as VideoTask[];
  },

  /**
   * 获取单个任务详情
   */
  async getTask(taskId: string): Promise<VideoTask | null> {
    const client = await getPostgresClient();
    const result = await client.query(`
      SELECT * FROM video_tasks WHERE id = $taskId
    `, { taskId });

    return result.rows[0] || null;
  },

  /**
   * 获取指定动作的视频任务
   */
  async getTasksByExercise(exerciseName: string): Promise<VideoTask[]> {
    const client = await getPostgresClient();
    const result = await client.query(`
      SELECT * FROM video_tasks
      WHERE exercise_name = $exerciseName
      ORDER BY created_at DESC
    `, { exerciseName });

    return result.rows as VideoTask[];
  },

  /**
   * 更新任务状态
   */
  async updateTaskStatus(
    taskId: string,
    updates: Partial<Pick<VideoTask, 'status' | 'progress' | 'current_stage' | 'error_message'>>
  ): Promise<void> {
    const client = await getPostgresClient();

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.progress !== undefined) {
      setClauses.push(`progress = $${paramIndex++}`);
      values.push(updates.progress);
    }
    if (updates.current_stage !== undefined) {
      setClauses.push(`current_stage = $${paramIndex++}`);
      values.push(updates.current_stage);
    }
    if (updates.error_message !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      values.push(updates.error_message);
    }

    if (setClauses.length === 0) return;

    values.push(taskId);

    await client.query(`
      UPDATE video_tasks
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);
  },

  /**
   * 标记任务完成并保存结果
   */
  async markTaskComplete(
    taskId: string,
    result: {
      id: string;
      sources: any[];
      posterUrl: string;
      metadata: any;
      originalVideoUrl: string;
      baseUrl: string;
      createdAt: number;
    }
  ): Promise<void> {
    const client = await getPostgresClient();

    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    await client.query(`
      UPDATE video_tasks
      SET status = 'completed',
          progress = 100,
          current_stage = 'completed',
          sources_json = $sourcesJson,
          poster_url = $posterUrl,
          metadata_json = $metadataJson,
          completed_at = $completedAt
      WHERE id = $taskId
    `, {
      sourcesJson: JSON.stringify(result.sources),
      posterUrl: result.posterUrl,
      metadataJson: JSON.stringify(result.metadata),
      completedAt: getNowISO(),
      taskId
    });

    // 广播完成事件到前端
    broadcastVideoCompleted(taskId, task.exercise_name, result);

    // 更新 exercises 表的 assets_json（使用 ID 查询）
    console.log(`[VideoQueue] Updating exercise: ${task.exercise_name}`);
    const exerciseResult = await client.query('SELECT assets_json FROM exercises WHERE id = $exerciseId', { exerciseId: task.exercise_name });
    const exercise = exerciseResult.rows[0];

    if (!exercise) {
      console.error(`[VideoQueue] Exercise not found: ${task.exercise_name}`);
    } else {
      console.log(`[VideoQueue] Exercise found, current assets:`, exercise.assets_json);
      const assets = exercise.assets_json ? (typeof exercise.assets_json === 'string' ? JSON.parse(exercise.assets_json) : exercise.assets_json) : {};

      const newVideo = {
        id: result.id,
        exerciseId: task.exercise_name,
        type: 'local',
        originalVideoUrl: result.originalVideoUrl,
        url: result.originalVideoUrl,
        sources: result.sources,
        posterUrl: result.posterUrl,
        baseUrl: result.baseUrl,
        metadata: result.metadata,
        createdAt: result.createdAt,
      };

      if (!assets.video) {
        assets.video = newVideo;
      } else if (Array.isArray(assets.video)) {
        assets.video = [newVideo, ...assets.video];
      } else {
        assets.video = [newVideo, assets.video];
      }

      console.log(`[VideoQueue] New assets:`, JSON.stringify(assets, null, 2));

      const updateResult = await client.query(
        'UPDATE exercises SET assets_json = $assetsJson, modified_at = $modifiedAt WHERE id = $exerciseId',
        { assetsJson: JSON.stringify(assets), modifiedAt: getNowISO(), exerciseId: task.exercise_name }
      );

      console.log(`[VideoQueue] Update result: rowCount = ${updateResult.rowCount}`);
    }

    console.log(`[VideoQueue] Task completed: ${taskId}`);
  },

  /**
   * 标记任务失败
   */
  async markTaskFailed(taskId: string, error: string, stage: string = 'processing'): Promise<void> {
    const client = await getPostgresClient();

    await client.query(`
      UPDATE video_tasks
      SET status = 'failed',
          error_message = $errorMessage,
          completed_at = $completedAt
      WHERE id = $taskId
    `, { errorMessage: error, completedAt: getNowISO(), taskId });

    // 广播错误事件到前端
    broadcastVideoError(taskId, error, stage);

    console.error(`[VideoQueue] Task failed: ${taskId} - ${error}`);
  },

  /**
   * 重试失败的任务
   */
  async retryTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status !== 'failed') throw new Error(`Can only retry failed tasks, current status: ${task.status}`);

    const client = await getPostgresClient();

    await client.query(`
      UPDATE video_tasks
      SET status = 'pending',
          progress = 0,
          current_stage = NULL,
          error_message = NULL,
          retry_count = retry_count + 1
      WHERE id = $taskId
    `, { taskId });

    // 触发处理队列
    this.processQueue().catch(err => {
      console.error('[VideoQueue] Queue processing error:', err);
    });
  },

  /**
   * 删除任务（同时删除文件）
   */
  async deleteTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    // 删除原始文件
    try {
      await fs.unlink(task.original_path);
    } catch (err) {
      console.warn(`[VideoQueue] Failed to delete original file: ${task.original_path}`);
    }

    // 删除处理后的视频文件夹
    const videoDir = path.join(
      process.cwd(),
      'uploads',
      'videos',
      this.sanitizeFilename(task.exercise_name)
    );

    try {
      await fs.rm(videoDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[VideoQueue] Failed to delete video directory: ${videoDir}`);
    }

    // 从数据库删除
    const client = await getPostgresClient();
    await client.query('DELETE FROM video_tasks WHERE id = $taskId', { taskId });

    console.log(`[VideoQueue] Task deleted: ${taskId}`);
  },

  /**
   * 获取存储统计
   */
  async getStorageStats(): Promise<{
    totalSize: number;
    taskCount: number;
    byStatus: Record<VideoTaskStatus, number>;
  }> {
    const client = await getPostgresClient();

    const totalSizeResult = await client.query('SELECT SUM(file_size) as total FROM video_tasks');
    const taskCountResult = await client.query('SELECT COUNT(*) as count FROM video_tasks');

    const byStatusRows = await client.query(`
      SELECT status, COUNT(*) as count
      FROM video_tasks
      GROUP BY status
    `);

    const byStatus: Record<VideoTaskStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const row of byStatusRows.rows) {
      byStatus[row.status as VideoTaskStatus] = row.count;
    }

    return {
      totalSize: totalSizeResult.rows[0]?.total || 0,
      taskCount: taskCountResult.rows[0]?.count || 0,
      byStatus
    };
  },

  /**
   * 处理队列（后台自动执行）
   */
  async processQueue(): Promise<void> {
    // 如果正在处理的任务已达上限，则跳过
    if (this.activeTasks.size >= this.MAX_CONCURRENT_TASKS) {
      console.log('[VideoQueue] Max concurrent tasks reached, skipping queue processing');
      return;
    }

    const client = await getPostgresClient();

    // 获取待处理的任务
    const result = await client.query(`
      SELECT * FROM video_tasks
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $limit
    `, { limit: this.MAX_CONCURRENT_TASKS - this.activeTasks.size });

    const pendingTasks = result.rows as VideoTask[];

    if (pendingTasks.length === 0) {
      return;
    }

    console.log(`[VideoQueue] Processing ${pendingTasks.length} pending tasks`);

    // 并行处理任务
    await Promise.allSettled(
      pendingTasks.map(task => this.processTask(task))
    );
  },

  /**
   * 处理单个任务
   */
  async processTask(task: VideoTask): Promise<void> {
    const client = await getPostgresClient();

    // 标记为处理中
    await client.query(
      'UPDATE video_tasks SET status = $status, started_at = $startedAt WHERE id = $taskId',
      { status: 'processing', startedAt: getNowISO(), taskId: task.id }
    );

    this.activeTasks.add(task.id);

    try {
      console.log(`[VideoQueue] Processing task ${task.id} for exercise: ${task.exercise_name}`);

      // 发射进度事件
      videoProgressEmitter.emit('progress', {
        stage: 'compressing',
        progress: 0,
        message: '开始处理视频...',
        exerciseName: task.exercise_name
      });

      // 处理视频（传递 taskId 用于 WebSocket 进度广播）
      const result = await VideoProcessingService.processVideoUpload(task.original_path, {
        exerciseName: task.exercise_name,
        generatePoster: true,
        qualities: ['360p', '720p', '1080p']
      }, task.id);

      console.log(`[VideoQueue] Video processing completed for task ${task.id}, result:`, result);

      // 标记完成
      await this.markTaskComplete(task.id, result);

      console.log(`[VideoQueue] Task ${task.id} marked as complete`);

    } catch (error) {
      console.error(`[VideoQueue] Error processing task ${task.id}:`, error);
      // 标记失败（传递当前阶段）
      const stage = 'processing';
      await this.markTaskFailed(task.id, error instanceof Error ? error.message : String(error), stage);
    } finally {
      this.activeTasks.delete(task.id);

      // 继续处理队列
      this.processQueue().catch(err => {
        console.error('[VideoQueue] Queue processing error:', err);
      });
    }
  },

  /**
   * 清理文件名（移除特殊字符）
   */
  sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
};
