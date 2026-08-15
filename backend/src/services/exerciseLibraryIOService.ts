/**
 * ExerciseLibraryIOService - 动作库导入/导出服务
 *
 * 功能：
 * - 导出动作库为 ZIP 文件（包含动作数据、视频、封面）
 * - 从 ZIP 文件导入动作库（支持冲突处理）
 * - 导入进度跟踪
 * - 视频异步处理（复用 VideoQueueService）
 */

import { getPostgresClient } from '../db/index.js';
import { ExerciseLibraryService } from './exerciseLibraryService.js';
import { VideoQueueService } from './videoQueueService.js';
import { ZipHandler } from '../utils/zipHandler.js';
import { ConflictResolver } from '../utils/conflictResolver.js';
import { ExerciseLibraryValidator } from '../validators/exerciseLibraryValidator.js';
import type { Exercise } from './exerciseLibraryService.js';
import type {
  ExportOptions,
  ExportManifest,
  ImportOptions,
  ImportResult,
  ImportStatus,
  PrecheckResult,
  ZipFileMap
} from '../types/exerciseLibraryIO.js';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

// ============================================
// ExerciseLibraryIOService
// ============================================

export const ExerciseLibraryIOService = {
  // ============================================
  // 导出功能
  // ============================================

  /**
   * 导出动作库为 ZIP
   * @param options 导出选项
   * @param exportedBy 导出者用户 ID
   * @returns ZIP 文件的 Buffer
   */
  async exportExercises(
    options: ExportOptions = {},
    exportedBy: string
  ): Promise<Buffer> {
    // 默认选项
    const exportOptions: Required<ExportOptions> = {
      includeVideos: options.includeVideos ?? true,
      includeCovers: options.includeCovers ?? true,
      videoQuality: options.videoQuality ?? '1080p',
      filterByDifficulty: options.filterByDifficulty ?? [],
      filterByTarget: options.filterByTarget ?? []
    };

    // 获取所有动作
    let exercises = await ExerciseLibraryService.getAllExercises();

    // 应用筛选
    if (exportOptions.filterByDifficulty.length > 0) {
      exercises = exercises.filter(ex =>
        exportOptions.filterByDifficulty.includes(ex.difficulty)
      );
    }

    if (exportOptions.filterByTarget.length > 0) {
      exercises = exercises.filter(ex => {
        try {
          const targets = JSON.parse(ex.targets);
          return exportOptions.filterByTarget.some(target =>
            targets.primary?.includes(target) || targets.secondary?.includes(target)
          );
        } catch {
          return false;
        }
      });
    }

    // 构建 manifest
    const manifest: ExportManifest = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      exportedBy,
      totalExercises: exercises.length,
      totalVideos: 0,
      totalCovers: 0,
      options: exportOptions
    };

    // 构建 ZIP 文件结构
    const zipStructure: Record<string, string | Buffer> = {
      'manifest.json': JSON.stringify(manifest, null, 2),
      'exercises.json': JSON.stringify(exercises, null, 2)
    };

    // 收集视频文件
    if (exportOptions.includeVideos) {
      let videoCount = 0;
      for (const exercise of exercises) {
        if (exercise.assets_json) {
          try {
            const assets = JSON.parse(exercise.assets_json);
            if (assets.video) {
              const videos = Array.isArray(assets.video) ? assets.video : [assets.video];
              for (const video of videos) {
                // 收集原始视频
                if (video.originalVideoUrl) {
                  const videoPath = this._extractUploadPath(video.originalVideoUrl);
                  if (videoPath) {
                    try {
                      const buffer = await fs.readFile(videoPath);
                      zipStructure[`videos/${exercise.id}/${video.id}/original.mp4`] = buffer;
                      videoCount++;

                      // 收集指定清晰度的视频
                      if (video.sources) {
                        const qualityFile = exportOptions.videoQuality + '.mp4';
                        for (const source of video.sources) {
                          if (source.url && source.quality === exportOptions.videoQuality) {
                            const qualityPath = this._extractUploadPath(source.url);
                            if (qualityPath) {
                              try {
                                const qualityBuffer = await fs.readFile(qualityPath);
                                zipStructure[`videos/${exercise.id}/${video.id}/${qualityFile}`] = qualityBuffer;
                              } catch (err) {
                                console.warn(`[Export] Failed to read quality file: ${qualityPath}`);
                              }
                            }
                          }
                        }
                      }

                      // 收集封面图
                      if (video.posterUrl) {
                        const posterPath = this._extractUploadPath(video.posterUrl);
                        if (posterPath) {
                          try {
                            const posterBuffer = await fs.readFile(posterPath);
                            zipStructure[`videos/${exercise.id}/${video.id}/poster.jpg`] = posterBuffer;
                          } catch (err) {
                            console.warn(`[Export] Failed to read poster: ${posterPath}`);
                          }
                        }
                      }
                    } catch (err) {
                      console.warn(`[Export] Failed to read video: ${videoPath}`);
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`[Export] Failed to parse assets for exercise: ${exercise.id}`);
          }
        }
      }
      manifest.totalVideos = videoCount;
    }

    // 收集封面图片
    if (exportOptions.includeCovers) {
      let coverCount = 0;
      for (const exercise of exercises) {
        if (exercise.assets_json) {
          try {
            const assets = JSON.parse(exercise.assets_json);
            if (assets.cover) {
              const coverPath = this._extractUploadPath(assets.cover);
              if (coverPath) {
                try {
                  const coverBuffer = await fs.readFile(coverPath);
                  const ext = path.extname(coverPath) || '.jpg';
                  zipStructure[`covers/${exercise.id}/cover${ext}`] = coverBuffer;
                  coverCount++;
                } catch (err) {
                  console.warn(`[Export] Failed to read cover: ${coverPath}`);
                }
              }
            }
          } catch (e) {
            console.warn(`[Export] Failed to parse assets for exercise: ${exercise.id}`);
          }
        }
      }
      manifest.totalCovers = coverCount;
    }

    // 更新 manifest
    zipStructure['manifest.json'] = JSON.stringify(manifest, null, 2);

    // 创建 ZIP
    return await ZipHandler.createArchive(zipStructure);
  },

  // ============================================
  // 导入功能
  // ============================================

  /**
   * 从 ZIP 导入动作库
   * @param zipBuffer ZIP 文件的 Buffer
   * @param options 导入选项
   * @returns 导入结果
   */
  async importExercises(
    zipBuffer: Buffer,
    options: ImportOptions
  ): Promise<ImportResult> {
    console.log('[Import] Starting import...');
    // 1. 解压 ZIP
    const extractedData = await ZipHandler.extractArchive(zipBuffer);
    console.log('[Import] Extracted files:', Object.keys(extractedData).length);

    // 2. 验证数据
    console.log('[Import] Validating import data...');
    const validationErrors = await ExerciseLibraryValidator.validateImportData(extractedData);
    
    // 区分 error 和 warning
    const fatalErrors = validationErrors.filter(e => e.severity === 'error');
    const warnings = validationErrors.filter(e => e.severity === 'warning');
    
    console.log('[Import] Validation errors:', validationErrors.length, '(fatal:', fatalErrors.length, 'warnings:', warnings.length, ')');
    
    if (fatalErrors.length > 0) {
      console.error('[Import] Fatal validation errors:', fatalErrors);
      throw new Error(`Import validation failed:\n${ExerciseLibraryValidator.formatErrors(validationErrors)}`);
    }
    
    if (warnings.length > 0) {
      console.warn(`[Import] Found ${warnings.length} validation warnings`);
    }

    // 3. 解析数据
    console.log('[Import] Parsing exercises and manifest...');
    const exercises = JSON.parse(extractedData['exercises.json'] as string) as Exercise[];
    const manifest = JSON.parse(extractedData['manifest.json'] as string) as ExportManifest;
    console.log('[Import] Parsed', exercises.length, 'exercises');

    // 4. 创建导入批次
    console.log('[Import] Creating import batch...');
    const batchId = randomUUID();
    await this._createImportBatch(batchId, exercises.length);

    try {
      // 5. 解决冲突
      console.log('[Import] Resolving conflicts with strategy:', options.conflictStrategy);
      const resolution = await ConflictResolver.resolveConflicts(
        exercises,
        options.conflictStrategy
      );
      console.log('[Import] Conflict resolution:', {
        toDelete: resolution.toDelete.length,
        toImport: resolution.exercisesToImport.length,
        skipped: resolution.skipped.length,
        renamed: resolution.renamed.length
      });

      // 6. 删除需要覆盖的动作
      console.log('[Import] Deleting', resolution.toDelete.length, 'exercises for overwrite...');
      for (const exercise of resolution.toDelete) {
        try {
          await ExerciseLibraryService.deleteExercise(exercise.id);
          console.log('[Import] Deleted exercise:', exercise.name, '(', exercise.id, ')');
        } catch (e) {
          console.error('[Import] Failed to delete exercise:', exercise.name, e);
          throw e;
        }
      }

      // 7. 导入动作
      console.log('[Import] Importing', resolution.exercisesToImport.length, 'exercises...');
      const errors: Array<{ exerciseName: string; error: string }> = [];
      let successCount = 0;

      for (const { exercise, originalName } of resolution.exercisesToImport) {
        try {
          await ExerciseLibraryService.createExercise(exercise, 'import');
          successCount++;
          console.log('[Import] Imported', successCount, '/', resolution.exercisesToImport.length, ':', exercise.name);

          // 更新进度
          await this._updateImportProgress(batchId, successCount);
        } catch (error) {
          console.error('[Import] Failed to import exercise:', exercise.name, error);
          errors.push({
            exerciseName: originalName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      console.log('[Import] Import completed:', successCount, 'success,', errors.length, 'errors');

      // 8. 处理视频任务
      console.log('[Import] Processing video tasks...');
      const videoTasks: string[] = [];
      if (options.processVideos) {
        for (const { exercise } of resolution.exercisesToImport) {
          if (exercise.assets_json) {
            try {
              const assets = JSON.parse(exercise.assets_json);
              if (assets.video) {
                const videos = Array.isArray(assets.video) ? assets.video : [assets.video];
                for (const video of videos) {
                  // 检查 ZIP 中是否有对应的视频文件
                  const videoKey = `videos/${exercise.id}/${video.id}/original.mp4`;
                  if (extractedData[videoKey]) {
                    // 保存视频文件到临时位置
                    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
                    await fs.mkdir(tempDir, { recursive: true });

                    const tempPath = path.join(tempDir, `${video.id}_original.mp4`);
                    await fs.writeFile(tempPath, extractedData[videoKey] as Buffer);

                    // 创建视频处理任务
                    const taskId = await VideoQueueService.createTask({
                      exerciseId: exercise.id,
                      exerciseName: exercise.name,
                      originalFilename: `${video.id}_original.mp4`,
                      originalPath: tempPath,
                      fileSize: (extractedData[videoKey] as Buffer).length
                    });

                    videoTasks.push(taskId);
                  }
                }
              }
            } catch (e) {
              console.warn(`[Import] Failed to process video for exercise: ${exercise.name}`, e);
            }
          }
        }
      }
      console.log('[Import] Created', videoTasks.length, 'video tasks');

      // 9. 完成导入批次
      console.log('[Import] Completing import batch...');
      await this._completeImportBatch(
        batchId,
        successCount,
        errors,
        videoTasks
      );

      console.log('[Import] Import finished successfully');
      return {
        success: successCount,
        skipped: resolution.skipped.length,
        failed: errors.length,
        errors,
        videoTasks,
        renamedExercises: resolution.renamed,
        batchId
      };
    } catch (error) {
      console.error('[Import] Import failed with error:', error);
      // 标记批次失败
      await this._failImportBatch(batchId, error);
      throw error;
    }
  },

  /**
   * 预检导入（不执行，仅返回冲突信息）
   * @param zipBuffer ZIP 文件的 Buffer
   * @returns 预检结果
   */
  async precheckImport(zipBuffer: Buffer): Promise<PrecheckResult> {
    console.log('[PrecheckImport] Extracting ZIP archive...');
    // 解压 ZIP
    const extractedData = await ZipHandler.extractArchive(zipBuffer);
    console.log('[PrecheckImport] Extracted files:', Object.keys(extractedData).length);

    console.log('[PrecheckImport] Validating import data...');
    // 验证数据
    const validationErrors = await ExerciseLibraryValidator.validateImportData(extractedData);
    console.log('[PrecheckImport] Validation errors:', validationErrors.length);
    
    // 区分 error 和 warning
    const fatalErrors = validationErrors.filter(e => e.severity === 'error');
    const warnings = validationErrors.filter(e => e.severity === 'warning');
    
    if (fatalErrors.length > 0) {
      throw new Error(`Precheck validation failed:\n${ExerciseLibraryValidator.formatErrors(validationErrors)}`);
    }
    
    // 打印 warning 信息但不中断流程
    if (warnings.length > 0) {
      console.warn(`[PrecheckImport] Found ${warnings.length} validation warnings:`);
      warnings.forEach(w => {
        console.warn(`  [WARNING] ${w.field}: ${w.message}`);
      });
    }

    console.log('[PrecheckImport] Parsing exercises and manifest...');
    // 解析数据
    const exercises = JSON.parse(extractedData['exercises.json'] as string) as Exercise[];
    const manifest = JSON.parse(extractedData['manifest.json'] as string) as ExportManifest;
    console.log('[PrecheckImport] Parsed', exercises.length, 'exercises');

    console.log('[PrecheckImport] Checking for conflicts...');
    // 检测冲突
    const conflicts = await ConflictResolver.precheckConflicts(exercises);
    console.log('[PrecheckImport] Found', conflicts.length, 'conflicts');

    return {
      manifest,
      exercises,
      conflicts
    };
  },

  // ============================================
  // 进度查询
  // ============================================

  /**
   * 获取导入进度
   * @param batchId 批次 ID
   * @returns 导入状态
   */
  async getImportStatus(batchId: string): Promise<ImportStatus> {
    const client = await getPostgresClient();

    const result = await client.query(`
      SELECT * FROM import_batches WHERE id = $1
    `, [batchId]);

    const batch = result.rows[0];

    if (!batch) {
      throw new Error(`Import batch not found: ${batchId}`);
    }

    // 查询视频任务状态
    const videoTaskIds = JSON.parse(batch.video_task_ids || '[]');
    const videoTasks = {
      total: videoTaskIds.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const taskId of videoTaskIds) {
      const task = await VideoQueueService.getTask(taskId);
      if (task) {
        videoTasks[task.status]++;
      }
    }

    // 解析错误
    const errors = batch.errors_json ? JSON.parse(batch.errors_json) : [];

    return {
      batchId: batch.id,
      status: batch.status,
      totalExercises: batch.total_exercises,
      processedExercises: batch.processed_exercises,
      videoTasks,
      startedAt: batch.started_at,
      completedAt: batch.completed_at || undefined,
      errors
    };
  },

  /**
   * 取消导入
   * @param batchId 批次 ID
   */
  async cancelImport(batchId: string): Promise<void> {
    const client = await getPostgresClient();

    // 获取批次信息
    const result = await client.query(`
      SELECT * FROM import_batches WHERE id = $1
    `, [batchId]);

    const batch = result.rows[0];

    if (!batch) {
      throw new Error(`Import batch not found: ${batchId}`);
    }

    if (batch.status !== 'processing') {
      throw new Error(`Cannot cancel import with status: ${batch.status}`);
    }

    // 取消视频任务
    const videoTaskIds = JSON.parse(batch.video_task_ids || '[]');
    for (const taskId of videoTaskIds) {
      try {
        await VideoQueueService.deleteTask(taskId);
      } catch (err) {
        console.warn(`[Import] Failed to cancel video task: ${taskId}`);
      }
    }

    // 更新批次状态
    await client.query(`
      UPDATE import_batches
      SET status = 'cancelled', cancelled_at = $1
      WHERE id = $2
    `, [new Date().toISOString(), batchId]);
  },

  /**
   * 获取用户的所有导入批次
   * @param userId 用户 ID
   * @returns 导入批次列表
   */
  async getUserImports(userId: string): Promise<Array<{
    batchId: string;
    status: string;
    totalExercises: number;
    processedExercises: number;
    startedAt: string;
    completedAt?: string;
  }>> {
    const client = await getPostgresClient();

    const result = await client.query(`
      SELECT id, status, total_exercises, processed_exercises, started_at, completed_at
      FROM import_batches
      WHERE user_id = $1
      ORDER BY started_at DESC
    `, [userId]);

    return result.rows.map(batch => ({
      batchId: batch.id,
      status: batch.status,
      totalExercises: batch.total_exercises,
      processedExercises: batch.processed_exercises,
      startedAt: batch.started_at,
      completedAt: batch.completed_at || undefined
    }));
  },

  // ============================================
  // 私有辅助方法
  // ============================================

  /**
   * 从 URL 中提取上传目录的文件路径
   * @param url 文件 URL
   * @returns 本地文件路径
   */
  _extractUploadPath(url: string): string | null {
    // 匹配 /uploads/ 路径
    const match = url.match(/\/uploads\/(.+)/);
    if (match) {
      return path.join(process.cwd(), 'uploads', match[1]);
    }
    return null;
  },

  /**
   * 创建导入批次
   */
  async _createImportBatch(batchId: string, totalExercises: number): Promise<void> {
    const client = await getPostgresClient();

    // 确保 system 用户存在
    let systemUserId = 'system';
    const userResult = await client.query('SELECT id FROM users WHERE id = $1', [systemUserId]);
    const systemUser = userResult.rows[0];

    if (!systemUser) {
      // 创建 system 用户（仅使用必需字段）
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO users (id, device_id, created_at)
        VALUES ($1, 'system-import', $2)
      `, [systemUserId, now]);
    }

    await client.query(`
      INSERT INTO import_batches
      (id, user_id, status, total_exercises, processed_exercises, video_task_ids, errors_json, started_at)
      VALUES ($1, 'system', 'processing', $2, 0, '[]', '[]', $3)
    `, [batchId, totalExercises, new Date().toISOString()]);
  },

  /**
   * 更新导入进度
   */
  async _updateImportProgress(batchId: string, processed: number): Promise<void> {
    const client = await getPostgresClient();

    await client.query(`
      UPDATE import_batches
      SET processed_exercises = $1
      WHERE id = $2
    `, [processed, batchId]);
  },

  /**
   * 完成导入批次
   */
  async _completeImportBatch(
    batchId: string,
    processed: number,
    errors: Array<{ exerciseName: string; error: string }>,
    videoTasks: string[]
  ): Promise<void> {
    const client = await getPostgresClient();

    await client.query(`
      UPDATE import_batches
      SET status = 'completed',
          processed_exercises = $1,
          video_task_ids = $2,
          errors_json = $3,
          completed_at = $4
      WHERE id = $5
    `, [
      processed,
      JSON.stringify(videoTasks),
      JSON.stringify(errors),
      new Date().toISOString(),
      batchId
    ]);
  },

  /**
   * 标记导入批次失败
   */
  async _failImportBatch(batchId: string, error: unknown): Promise<void> {
    const client = await getPostgresClient();

    const errors = [{
      exerciseName: 'system',
      error: error instanceof Error ? error.message : String(error)
    }];

    await client.query(`
      UPDATE import_batches
      SET status = 'failed',
          errors_json = $1,
          completed_at = $2
      WHERE id = $3
    `, [
      JSON.stringify(errors),
      new Date().toISOString(),
      batchId
    ]);
  }
};
