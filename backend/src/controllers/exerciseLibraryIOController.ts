/**
 * Exercise Library IO Controller
 *
 * 动作库导入/导出 API 控制器
 *
 * 端点：
 * - GET /api/exercises/export - 导出动作库为 ZIP
 * - POST /api/exercises/import - 导入动作库 ZIP
 * - POST /api/exercises/import/precheck - 预检导入
 * - GET /api/exercises/import/status/:batchId - 获取导入进度
 * - POST /api/exercises/import/cancel/:batchId - 取消导入
 * - GET /api/exercises/import/list - 获取导入历史
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { ExerciseLibraryIOService } from '../services/exerciseLibraryIOService.js';
import type { ExportOptions, ConflictStrategy } from '../types/exerciseLibraryIO.js';
import { ZipHandler } from '../utils/zipHandler.js';

// ============================================
// 类型定义
// ============================================

interface ExportQuery {
  includeVideos?: string;
  includeCovers?: string;
  videoQuality?: '360p' | '720p' | '1080p';
  difficulty?: string;
  target?: string;
}

interface ImportQuery {
  strategy?: ConflictStrategy;
  processVideos?: string;
}

interface PrecheckBody {
  file: {
    data: Buffer;
    filename: string;
    mimetype: string;
  };
}

interface ImportBody {
  file: {
    data: Buffer;
    filename: string;
    mimetype: string;
  };
}

// ============================================
// Handlers
// ============================================

/**
 * GET /api/exercises/export
 * 导出动作库为 ZIP
 */
export async function exportExercises(
  request: FastifyRequest<{ Querystring: ExportQuery }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const query = request.query;

    // 解析选项
    const options: ExportOptions = {
      includeVideos: query.includeVideos !== 'false',
      includeCovers: query.includeCovers !== 'false',
      videoQuality: query.videoQuality || '1080p'
    };

    // 解析筛选条件
    if (query.difficulty) {
      options.filterByDifficulty = query.difficulty.split(',') as ('beginner' | 'intermediate' | 'advanced')[];
    }

    if (query.target) {
      options.filterByTarget = query.target.split(',');
    }

    // 获取用户 ID（从请求头或使用默认值）
    const exportedBy = (request.headers['x-user-id'] as string) || 'admin';

    // 导出
    const zipBuffer = await ExerciseLibraryIOService.exportExercises(options, exportedBy);

    // 设置响应头
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="exercises_${Date.now()}.zip"`);
    reply.send(zipBuffer);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to export exercises',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * POST /api/exercises/import
 * 导入动作库 ZIP
 */
export async function importExercises(
  request: FastifyRequest<{ Querystring: ImportQuery }>,
  reply: FastifyReply
): Promise<void> {
  try {
    // 获取上传的文件
    const data = await request.file();
    if (!data) {
      reply.status(400).send({
        error: 'No file uploaded'
      });
      return;
    }

    // 验证文件类型
    if (data.mimetype !== 'application/zip' && !data.filename.endsWith('.zip')) {
      reply.status(400).send({
        error: 'Invalid file type. Please upload a ZIP file.'
      });
      return;
    }

    // 读取文件内容
    const buffer = await data.toBuffer();

    // 验证 ZIP 文件
    if (!ZipHandler.isValidZip(buffer)) {
      reply.status(400).send({
        error: 'Invalid ZIP file format'
      });
      return;
    }

    // 解析选项
    const strategy = request.query.strategy || 'skip';
    const processVideos = request.query.processVideos !== 'false';

    // 导入
    const result = await ExerciseLibraryIOService.importExercises(buffer, {
      conflictStrategy: strategy,
      processVideos
    });

    reply.send(result);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to import exercises',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * POST /api/exercises/import/precheck
 * 预检导入
 */
export async function precheckImport(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    console.log('[PrecheckImport] Starting precheck...');
    // 获取上传的文件
    const data = await request.file();
    if (!data) {
      reply.status(400).send({
        error: 'No file uploaded'
      });
      return;
    }

    console.log('[PrecheckImport] File received:', data.filename, 'size:', data.file?.bytesRead);
    // 验证文件类型
    if (data.mimetype !== 'application/zip' && !data.filename.endsWith('.zip')) {
      reply.status(400).send({
        error: 'Invalid file type. Please upload a ZIP file.'
      });
      return;
    }

    // 读取文件内容
    const buffer = await data.toBuffer();
    console.log('[PrecheckImport] Buffer size:', buffer.length);

    // 验证 ZIP 文件
    if (!ZipHandler.isValidZip(buffer)) {
      reply.status(400).send({
        error: 'Invalid ZIP file format'
      });
      return;
    }

    console.log('[PrecheckImport] ZIP validated, starting precheck...');
    // 预检
    const result = await ExerciseLibraryIOService.precheckImport(buffer);

    console.log('[PrecheckImport] Precheck completed successfully');
    reply.send(result);
  } catch (error) {
    console.error('[PrecheckImport] Error:', error);
    if (error instanceof Error) {
      console.error('[PrecheckImport] Stack:', error.stack);
    }
    reply.status(500).send({
      error: 'Failed to precheck import',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * GET /api/exercises/import/status/:batchId
 * 获取导入进度
 */
export async function getImportStatus(
  request: FastifyRequest<{ Params: { batchId: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { batchId } = request.params;

    const status = await ExerciseLibraryIOService.getImportStatus(batchId);

    reply.send(status);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      reply.status(404).send({
        error: 'Import batch not found',
        batchId: request.params.batchId
      });
      return;
    }

    reply.status(500).send({
      error: 'Failed to get import status',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * POST /api/exercises/import/cancel/:batchId
 * 取消导入
 */
export async function cancelImport(
  request: FastifyRequest<{ Params: { batchId: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { batchId } = request.params;

    await ExerciseLibraryIOService.cancelImport(batchId);

    reply.send({
      message: 'Import cancelled successfully',
      batchId
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      reply.status(404).send({
        error: 'Import batch not found',
        batchId: request.params.batchId
      });
      return;
    }

    if (error instanceof Error && error.message.includes('Cannot cancel')) {
      reply.status(400).send({
        error: error.message
      });
      return;
    }

    reply.status(500).send({
      error: 'Failed to cancel import',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * GET /api/exercises/import/list
 * 获取导入历史
 */
export async function getImportList(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const userId = (request.headers['x-user-id'] as string) || 'admin';

    const imports = await ExerciseLibraryIOService.getUserImports(userId);

    reply.send(imports);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to get import list',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
