/**
 * VideoManager - 视频任务管理页面
 *
 * 功能：
 * - 显示所有视频处理任务
 * - 实时显示处理进度
 * - 重试失败任务
 * - 删除任务
 * - 存储统计
 */

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, RotateCcw, HardDrive, Clock, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';

const API_BASE = 'http://localhost:43111/api';

// ============================================
// 类型定义
// ============================================

type VideoTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface VideoTask {
  id: string;
  exercise_name: string;
  original_filename: string;
  status: VideoTaskStatus;
  progress: number;
  current_stage: string | null;
  error_message: string | null;
  file_size: number;
  created_at: number;
  completed_at: number | null;
  retry_count: number;
}

interface StorageStats {
  totalSize: number;
  taskCount: number;
  byStatus: Record<VideoTaskStatus, number>;
}

// ============================================
// 辅助函数
// ============================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function formatDuration(start: number, end?: number | null): string {
  const endTime = end || Date.now();
  const seconds = Math.floor((endTime - start) / 1000);

  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds}秒`;
}

// ============================================
// 组件
// ============================================

export const VideoManager: React.FC = () => {
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 获取所有任务
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/videos/tasks`);
      const data = await res.json();
      setTasks(data);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  }, []);

  // 获取统计数据
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/videos/stats`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    Promise.all([fetchTasks(), fetchStats()]).finally(() => {
      setLoading(false);
    });
  }, [fetchTasks, fetchStats]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchTasks();
      fetchStats();
    }, 3000); // 每3秒刷新

    return () => clearInterval(interval);
  }, [autoRefresh, fetchTasks, fetchStats]);

  // 重试任务
  const handleRetry = async (taskId: string) => {
    if (!confirm('确定要重试此任务吗？')) return;

    try {
      const res = await fetch(`${API_BASE}/videos/tasks/${taskId}/retry`, { method: 'POST' });
      if (res.ok) {
        fetchTasks();
      } else {
        alert('重试失败');
      }
    } catch (err) {
      console.error('Retry failed:', err);
      alert('重试失败');
    }
  };

  // 删除任务
  const handleDelete = async (taskId: string) => {
    if (!confirm('确定要删除此任务吗？此操作不可恢复！')) return;

    try {
      const res = await fetch(`${API_BASE}/videos/tasks/${taskId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchTasks();
        fetchStats();
      } else {
        alert('删除失败');
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('删除失败');
    }
  };

  // 状态图标
  const getStatusIcon = (status: VideoTaskStatus) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
    }
  };

  // 状态文本
  const getStatusText = (status: VideoTaskStatus) => {
    switch (status) {
      case 'pending':
        return '待处理';
      case 'processing':
        return '处理中';
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-star-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-star-primary">视频任务管理</h2>
          <p className="text-sm text-gray-500 mt-1">管理所有视频处理任务</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              autoRefresh
                ? 'bg-star-accent text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? '自动刷新中' : '已暂停刷新'}
          </button>
          <button
            onClick={() => {
              fetchTasks();
              fetchStats();
            }}
            className="px-4 py-2 rounded-lg bg-star-primary text-white hover:bg-star-primary/90 transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            立即刷新
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">总任务数</p>
                <p className="text-2xl font-bold text-star-primary mt-1">{stats.taskCount}</p>
              </div>
              <HardDrive className="w-8 h-8 text-gray-400" />
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">总存储</p>
                <p className="text-2xl font-bold text-star-primary mt-1">{formatFileSize(stats.totalSize)}</p>
              </div>
              <HardDrive className="w-8 h-8 text-star-accent" />
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">处理中</p>
                <p className="text-2xl font-bold text-blue-500 mt-1">{stats.byStatus.processing}</p>
              </div>
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">失败</p>
                <p className="text-2xl font-bold text-red-500 mt-1">{stats.byStatus.failed}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
          </div>
        </div>
      )}

      {/* 任务列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">动作名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">文件名</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">大小</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">进度</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">耗时</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <p>暂无视频任务</p>
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        <span className="text-sm font-medium">{getStatusText(task.status)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-star-primary">{task.exercise_name}</div>
                      {task.current_stage && (
                            <div className="text-xs text-gray-500 mt-1">{task.current_stage}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {task.original_filename}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatFileSize(task.file_size)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-star-accent h-2 rounded-full transition-all duration-300"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{task.progress}%</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatTimestamp(task.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDuration(task.created_at, task.completed_at)}
                      {task.retry_count > 0 && (
                        <span className="ml-2 text-xs text-orange-500">(重试 {task.retry_count} 次)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        {task.status === 'failed' && (
                          <button
                            onClick={() => handleRetry(task.id)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="重试"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 错误信息 */}
      {tasks.some(t => t.status === 'failed' && t.error_message) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-medium text-red-800 mb-2">失败任务错误信息：</h3>
          <ul className="space-y-2">
            {tasks
              .filter(t => t.status === 'failed' && t.error_message)
              .map(t => (
                <li key={t.id} className="text-sm text-red-700">
                  <strong>{t.exercise_name}:</strong> {t.error_message}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default VideoManager;
