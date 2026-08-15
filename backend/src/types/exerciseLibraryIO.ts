/**
 * Exercise Library Import/Export Type Definitions
 *
 * 定义动作库导入/导出功能的所有类型
 */

import { Exercise } from '../services/exerciseLibraryService.js';

// ============================================
// 导出相关类型
// ============================================

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 是否包含视频文件 */
  includeVideos?: boolean;
  /** 是否包含封面图片 */
  includeCovers?: boolean;
  /** 视频清晰度（默认 1080p） */
  videoQuality?: '360p' | '720p' | '1080p';
  /** 按难度筛选 */
  filterByDifficulty?: ('beginner' | 'intermediate' | 'advanced')[];
  /** 按目标肌肉筛选 */
  filterByTarget?: string[];
}

/**
 * 导出清单（manifest.json 内容）
 */
export interface ExportManifest {
  /** 导出格式版本 */
  version: string;
  /** 导出时间（ISO 8601 UTC） */
  exportedAt: string;
  /** 导出者用户 ID */
  exportedBy: string;
  /** 动作总数 */
  totalExercises: number;
  /** 视频文件总数 */
  totalVideos: number;
  /** 封面图片总数 */
  totalCovers: number;
  /** 导出选项 */
  options: ExportOptions;
}

// ============================================
// 导入相关类型
// ============================================

/**
 * 冲突处理策略
 */
export type ConflictStrategy = 'overwrite' | 'rename' | 'skip';

/**
 * 导入选项
 */
export interface ImportOptions {
  /** 冲突处理策略 */
  conflictStrategy: ConflictStrategy;
  /** 是否处理视频（创建视频任务） */
  processVideos?: boolean;
}

/**
 * 导入结果
 */
export interface ImportResult {
  /** 成功导入数量 */
  success: number;
  /** 跳过数量 */
  skipped: number;
  /** 失败数量 */
  failed: number;
  /** 错误详情 */
  errors: Array<{ exerciseName: string; error: string }>;
  /** 创建的视频任务 ID 列表 */
  videoTasks: string[];
  /** 重命名的动作列表 */
  renamedExercises: Array<{ originalName: string; newName: string }>;
  /** 导入批次 ID（用于进度查询） */
  batchId: string;
}

/**
 * 导入状态
 */
export interface ImportStatus {
  /** 批次 ID */
  batchId: string;
  /** 导入状态 */
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  /** 动作总数 */
  totalExercises: number;
  /** 已处理动作数 */
  processedExercises: number;
  /** 视频任务统计 */
  videoTasks: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  /** 开始时间（ISO 8601 UTC） */
  startedAt: string;
  /** 完成时间（ISO 8601 UTC） */
  completedAt?: string;
  /** 错误列表 */
  errors: Array<{ exerciseName: string; error: string }>;
}

/**
 * 冲突信息
 */
export interface ConflictInfo {
  /** 动作名称 */
  exerciseName: string;
  /** 已存在的动作（null 表示无冲突） */
  existingExercise: Exercise | null;
  /** 导入的动作 */
  importedExercise: Exercise;
}

/**
 * 冲突解决结果
 */
export interface ConflictResolution {
  /** 处理策略 */
  action: ConflictStrategy;
  /** 新名称（仅当 action 为 rename 时） */
  newName?: string;
}

/**
 * 预检结果
 */
export interface PrecheckResult {
  /** 清单信息 */
  manifest: ExportManifest;
  /** 导入的动作列表 */
  exercises: Exercise[];
  /** 冲突列表 */
  conflicts: Array<{
    exerciseName: string;
    existing: Exercise | null;
    suggestedRename: string;
  }>;
}

/**
 * ZIP 文件内容映射
 */
export type ZipFileMap = Record<string, Buffer | string>;

/**
 * 导出的 ZIP 结构
 */
export interface ExportZipStructure {
  /** 清单文件 */
  'manifest.json': string;
  /** 动作数据文件 */
  'exercises.json': string;
  /** 视频文件目录 */
  'videos/'?: Record<string, Record<string, {
    'original.mp4'?: Buffer;
    '1080p.mp4'?: Buffer;
    '720p.mp4'?: Buffer;
    '360p.mp4'?: Buffer;
    'poster.jpg'?: Buffer;
  }>>;
  /** 封面图片目录 */
  'covers/'?: Record<string, {
    'cover.jpg'?: Buffer;
    'cover.png'?: Buffer;
  }>;
}
