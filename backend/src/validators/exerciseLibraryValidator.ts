/**
 * Exercise Library Validator
 *
 * 验证导入数据的完整性和正确性
 */

import { ExerciseLibraryService } from '../services/exerciseLibraryService.js';
import type { Exercise } from '../services/exerciseLibraryService.js';
import type { ZipFileMap, ExportManifest } from '../types/exerciseLibraryIO.js';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export const ExerciseLibraryValidator = {
  /**
   * 验证导入数据
   * @param extractedData 解压后的文件映射
   * @returns 验证错误列表（空数组表示验证通过）
   */
  async validateImportData(
    extractedData: ZipFileMap
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // 1. 检查必需文件
    if (!extractedData['manifest.json']) {
      errors.push({
        field: 'manifest.json',
        message: 'Missing required file: manifest.json',
        severity: 'error'
      });
    }

    if (!extractedData['exercises.json']) {
      errors.push({
        field: 'exercises.json',
        message: 'Missing required file: exercises.json',
        severity: 'error'
      });
      return errors; // 缺少 exercises.json 时无法继续
    }

    // 2. 验证 manifest.json
    if (extractedData['manifest.json']) {
      const manifestErrors = this.validateManifest(
        extractedData['manifest.json'] as string
      );
      errors.push(...manifestErrors);
    }

    // 3. 验证 exercises.json
    if (extractedData['exercises.json']) {
      const exerciseErrors = await this.validateExercisesJSON(
        extractedData['exercises.json'] as string
      );
      errors.push(...exerciseErrors);
    }

    // 4. 验证视频和封面文件引用
    if (extractedData['exercises.json']) {
      const assetErrors = await this.validateAssetReferences(
        extractedData
      );
      errors.push(...assetErrors);
    }

    return errors;
  },

  /**
   * 验证 manifest.json
   * @param manifestJson manifest.json 内容
   * @returns 验证错误列表
   */
  validateManifest(manifestJson: string): ValidationError[] {
    const errors: ValidationError[] = [];

    let manifest: ExportManifest;
    try {
      manifest = JSON.parse(manifestJson);
    } catch (e) {
      errors.push({
        field: 'manifest.json',
        message: `Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error'
      });
      return errors;
    }

    // 验证必需字段
    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push({
        field: 'manifest.version',
        message: 'Missing or invalid version field',
        severity: 'error'
      });
    }

    if (!manifest.exportedAt || typeof manifest.exportedAt !== 'string') {
      errors.push({
        field: 'manifest.exportedAt',
        message: 'Missing or invalid exportedAt field',
        severity: 'error'
      });
    } else {
      // 验证是否为有效的 ISO 8601 日期
      const date = new Date(manifest.exportedAt);
      if (isNaN(date.getTime())) {
        errors.push({
          field: 'manifest.exportedAt',
          message: 'Invalid ISO 8601 date format',
          severity: 'error'
        });
      }
    }

    if (!manifest.exportedBy || typeof manifest.exportedBy !== 'string') {
      errors.push({
        field: 'manifest.exportedBy',
        message: 'Missing or invalid exportedBy field',
        severity: 'error'
      });
    }

    if (typeof manifest.totalExercises !== 'number') {
      errors.push({
        field: 'manifest.totalExercises',
        message: 'Missing or invalid totalExercises field',
        severity: 'error'
      });
    }

    return errors;
  },

  /**
   * 验证 exercises.json
   * @param exercisesJson exercises.json 内容
   * @returns 验证错误列表
   */
  async validateExercisesJSON(exercisesJson: string): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    let exercises: Exercise[];
    try {
      exercises = JSON.parse(exercisesJson);
    } catch (e) {
      errors.push({
        field: 'exercises.json',
        message: `Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error'
      });
      return errors;
    }

    if (!Array.isArray(exercises)) {
      errors.push({
        field: 'exercises.json',
        message: 'Root element must be an array',
        severity: 'error'
      });
      return errors;
    }

    // 验证每个动作
    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];
      const prefix = `exercises[${i}]`;

      try {
        // 使用 ExerciseLibraryService 的验证方法
        ExerciseLibraryService.validateExercise(exercise);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        
        // 根据错误类型决定严重性级别
        // targets 格式问题可以降级为 warning，让用户决定是否继续
        if (message.includes('targets') || message.includes('equipment_required') || message.includes('exercise_type')) {
          errors.push({
            field: prefix,
            message,
            severity: 'warning'
          });
        } else {
          // 必填字段缺失（id, name）仍然是 error
          errors.push({
            field: prefix,
            message,
            severity: 'error'
          });
        }
      }
    }

    return errors;
  },

  /**
   * 验证资源文件引用
   * @param extractedData 解压后的文件映射
   * @returns 验证错误列表
   */
  async validateAssetReferences(extractedData: ZipFileMap): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    let exercises: Exercise[];
    try {
      exercises = JSON.parse(extractedData['exercises.json'] as string);
    } catch {
      return errors; // exercises.json 无效已在前面处理
    }

    // 收集所有引用的视频和封面文件
    const referencedVideos = new Set<string>();
    const referencedCovers = new Set<string>();

    for (const exercise of exercises) {
      // 解析 assets_json
      if (exercise.assets_json) {
        try {
          const assets = JSON.parse(exercise.assets_json);

          // 检查视频引用
          if (assets.video) {
            const videos = Array.isArray(assets.video) ? assets.video : [assets.video];
            for (const video of videos) {
              if (video.originalVideoUrl) {
                // 提取相对路径
                const match = video.originalVideoUrl.match(/videos\/[^/]+\/[^/]+\/.+/);
                if (match) {
                  referencedVideos.add(match[0]);
                }
              }
            }
          }

          // 检查封面引用
          if (assets.cover) {
            const match = assets.cover.match(/covers\/[^/]+\/.+/);
            if (match) {
              referencedCovers.add(match[0]);
            }
          }
        } catch (e) {
          // JSON 解析错误已在前面处理
        }
      }
    }

    // 检查引用的文件是否存在于 ZIP 中
    for (const videoPath of referencedVideos) {
      if (!extractedData[videoPath]) {
        errors.push({
          field: 'assets',
          message: `Referenced video file not found in ZIP: ${videoPath}`,
          severity: 'warning'
        });
      }
    }

    for (const coverPath of referencedCovers) {
      if (!extractedData[coverPath]) {
        errors.push({
          field: 'assets',
          message: `Referenced cover file not found in ZIP: ${coverPath}`,
          severity: 'warning'
        });
      }
    }

    return errors;
  },

  /**
   * 检查是否有致命错误（error 级别）
   * @param errors 验证错误列表
   * @returns 是否有致命错误
   */
  hasFatalErrors(errors: ValidationError[]): boolean {
    return errors.some(e => e.severity === 'error');
  },

  /**
   * 格式化验证错误为可读消息
   * @param errors 验证错误列表
   * @returns 格式化的错误消息
   */
  formatErrors(errors: ValidationError[]): string {
    const errorLines = errors
      .filter(e => e.severity === 'error')
      .map(e => `[ERROR] ${e.field}: ${e.message}`);

    const warningLines = errors
      .filter(e => e.severity === 'warning')
      .map(e => `[WARNING] ${e.field}: ${e.message}`);

    return [
      ...errorLines,
      ...warningLines
    ].join('\n');
  }
};
