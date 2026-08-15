/**
 * Conflict Resolver Utility
 *
 * 处理动作导入时的名称冲突
 * 支持多种冲突解决策略
 */

import { ExerciseLibraryService } from '../services/exerciseLibraryService.js';
import type { Exercise } from '../services/exerciseLibraryService.js';
import type { ConflictStrategy, ConflictResolution } from '../types/exerciseLibraryIO.js';

export const ConflictResolver = {
  /**
   * 检测名称冲突
   * @param exercises 待导入的动作列表
   * @returns 冲突信息列表
   */
  async detectConflicts(exercises: Exercise[]): Promise<Array<{
    exerciseName: string;
    existingExercise: Exercise | null;
    importedExercise: Exercise;
  }>> {
    const conflicts: Array<{
      exerciseName: string;
      existingExercise: Exercise | null;
      importedExercise: Exercise;
    }> = [];

    for (const importedExercise of exercises) {
      const existing = await ExerciseLibraryService.getByName(importedExercise.name);

      if (existing) {
        conflicts.push({
          exerciseName: importedExercise.name,
          existingExercise: existing,
          importedExercise
        });
      }
    }

    return conflicts;
  },

  /**
   * 生成唯一名称（自动添加后缀）
   * @param baseName 基础名称
   * @returns 唯一名称
   */
  async generateUniqueName(baseName: string): Promise<string> {
    let suffix = 2;
    let newName = baseName;

    while (true) {
      const existing = await ExerciseLibraryService.getByName(newName);
      if (!existing) {
        return newName;
      }

      newName = `${baseName} (${suffix})`;
      suffix++;
    }
  },

  /**
   * 应用冲突策略
   * @param conflicts 冲突列表
   * @param strategy 冲突策略
   * @returns 冲突解决映射（动作名称 -> 解决方案）
   */
  async applyStrategy(
    conflicts: Array<{
      exerciseName: string;
      existingExercise: Exercise | null;
      importedExercise: Exercise;
    }>,
    strategy: ConflictStrategy
  ): Promise<Map<string, ConflictResolution>> {
    const resolutionMap = new Map<string, ConflictResolution>();

    for (const conflict of conflicts) {
      switch (strategy) {
        case 'overwrite':
          // 覆盖：删除旧动作，使用新动作
          resolutionMap.set(conflict.exerciseName, {
            action: 'overwrite'
          });
          break;

        case 'rename':
          // 重命名：生成新名称
          const newName = await this.generateUniqueName(conflict.exerciseName);
          resolutionMap.set(conflict.exerciseName, {
            action: 'rename',
            newName
          });
          break;

        case 'skip':
          // 跳过：不导入此动作
          resolutionMap.set(conflict.exerciseName, {
            action: 'skip'
          });
          break;
      }
    }

    return resolutionMap;
  },

  /**
   * 批量解决冲突
   * @param exercises 待导入的动作列表
   * @param strategy 冲突策略
   * @returns 解决结果，包含过滤后的动作列表和重命名映射
   */
  async resolveConflicts(
    exercises: Exercise[],
    strategy: ConflictStrategy
  ): Promise<{
    exercisesToImport: Array<{ exercise: Exercise; originalName: string }>;
    skipped: string[];
    renamed: Array<{ originalName: string; newName: string }>;
    toDelete: Exercise[];
  }> {
    // 检测冲突
    const conflicts = await this.detectConflicts(exercises);

    // 应用策略
    const resolutionMap = await this.applyStrategy(conflicts, strategy);

    const exercisesToImport: Array<{ exercise: Exercise; originalName: string }> = [];
    const skipped: string[] = [];
    const renamed: Array<{ originalName: string; newName: string }> = [];
    const toDelete: Exercise[] = [];

    // 构建动作名称映射（用于快速查找）
    const exerciseMap = new Map(exercises.map(ex => [ex.name, ex]));

    // 处理每个冲突
    for (const conflict of conflicts) {
      const resolution = resolutionMap.get(conflict.exerciseName);

      if (!resolution) {
        // 无冲突，直接导入
        exercisesToImport.push({
          exercise: conflict.importedExercise,
          originalName: conflict.importedExercise.name
        });
        continue;
      }

      switch (resolution.action) {
        case 'overwrite':
          // 标记删除旧动作，导入新动作
          if (conflict.existingExercise) {
            toDelete.push(conflict.existingExercise);
          }
          exercisesToImport.push({
            exercise: conflict.importedExercise,
            originalName: conflict.importedExercise.name
          });
          break;

        case 'rename':
          // 使用新名称导入
          renamed.push({
            originalName: conflict.exerciseName,
            newName: resolution.newName!
          });
          const renamedExercise = {
            ...conflict.importedExercise,
            name: resolution.newName!
          };
          exercisesToImport.push({
            exercise: renamedExercise,
            originalName: conflict.exerciseName
          });
          break;

        case 'skip':
          // 跳过此动作
          skipped.push(conflict.exerciseName);
          break;
      }
    }

    // 添加无冲突的动作
    for (const exercise of exercises) {
      const hasConflict = conflicts.some(c => c.exerciseName === exercise.name);
      if (!hasConflict) {
        exercisesToImport.push({
          exercise,
          originalName: exercise.name
        });
      }
    }

    return {
      exercisesToImport,
      skipped,
      renamed,
      toDelete
    };
  },

  /**
   * 预检冲突（不执行任何操作）
   * @param exercises 待导入的动作列表
   * @returns 冲突预检结果
   */
  async precheckConflicts(exercises: Exercise[]): Promise<Array<{
    exerciseName: string;
    existing: Exercise | null;
    suggestedRename: string;
  }>> {
    const conflicts = await this.detectConflicts(exercises);

    const results = await Promise.all(
      conflicts.map(async conflict => ({
        exerciseName: conflict.exerciseName,
        existing: conflict.existingExercise,
        suggestedRename: await this.generateUniqueName(conflict.exerciseName)
      }))
    );

    return results;
  }
};
