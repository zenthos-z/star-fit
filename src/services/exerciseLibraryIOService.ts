import { API_BASE, getHeaders } from './geminiService';

export interface ExportOptions {
  includeVideos: boolean;
  videoQuality: '360p' | '720p' | '1080p';
}

export interface PrecheckResponse {
  manifest: {
    version: string;
    exportedAt: string;
    exportedBy: string;
    totalExercises: number;
    totalVideos: number;
    totalCovers: number;
  };
  conflicts: Array<{
    exerciseName: string;
    existing: any;
    suggestedRename: string;
  }>;
}

export type ConflictStrategy = 'overwrite' | 'rename' | 'skip';

export interface ImportResult {
  success: number;
  skipped: number;
  failed: number;
  errors: Array<{
    exerciseName: string;
    error: string;
  }>;
  videoTasks: string[];
  renamedExercises: Array<{
    originalName: string;
    newName: string;
  }>;
  batchId: string;
}

export interface ImportStatus {
  batchId: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  totalExercises: number;
  processedExercises: number;
  videoTasks: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  startedAt: string;
  completedAt?: string;
  errors: Array<{
    exerciseName: string;
    error: string;
  }>;
}

export const ExerciseLibraryIOService = {
  async exportExercises(options: ExportOptions): Promise<void> {
    const params = new URLSearchParams({
      includeVideos: String(options.includeVideos),
      videoQuality: options.videoQuality
    });

    const response = await fetch(`${API_BASE}/exercises/export?${params}`, {
      headers: getHeaders()
    });

    if (!response.ok) {
      throw new Error('导出请求失败');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exercises_${new Date().getTime()}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  async precheckImport(file: File): Promise<PrecheckResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/exercises/import/precheck`, {
      method: 'POST',
      headers: getHeaders({}, false),
      body: formData
    });

    if (!response.ok) {
      throw new Error('预检请求失败');
    }

    return await response.json();
  },

  async importExercises(file: File, strategy: ConflictStrategy): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/exercises/import?strategy=${strategy}`, {
      method: 'POST',
      headers: getHeaders({}, false),
      body: formData
    });

    if (!response.ok) {
      throw new Error('导入请求失败');
    }

    return await response.json();
  },

  async getImportStatus(batchId: string): Promise<ImportStatus> {
    const response = await fetch(`${API_BASE}/exercises/import/status/${batchId}`, {
      headers: getHeaders()
    });

    if (!response.ok) {
      throw new Error('获取进度失败');
    }

    return await response.json();
  },

  async cancelImport(batchId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/exercises/import/cancel/${batchId}`, {
      method: 'POST',
      headers: getHeaders()
    });

    if (!response.ok) {
      throw new Error('取消失败');
    }
  }
};
