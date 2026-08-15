/**
 * Dashboard Data Hook
 *
 * 数据获取逻辑，符合 MAS 规范：
 * - HTTP 轮询获取数据
 * - WebSocket 监听实时更新
 * - 错误处理和加载状态
 */

import { useState, useEffect, useCallback } from 'react';
import { AdminService } from '../../../services/api';
import { wsService } from '../../../services/websocketService';

interface DashboardData {
  serverUrl: string;
  apiUrl: string;
  serverInfo: {
    serverUrl: string;
    apiUrl: string;
  } | null;
  latestTraining: {
    hasTraining: boolean;
    session?: {
      id: string;
      userId: string;
      userName: string;
      title: string;
      startTime: string;
      duration: number;
      exercises: any[];
      totalVolume: number;
      hasAudit: boolean;
      auditText?: string;
    };
    todayStats: {
      inProgress: number;
      completed: number;
      totalVolume: number;
    };
  } | null;
  userStats: {
    total: number;
    todayActive: number;
    newToday: number;
  } | null;
  contentStats: {
    totalExercises: number;
    withVideo: number;
    pendingVideos: number;
  } | null;
}

export const useDashboardData = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      // 并行获取所有数据
      const [serverInfo, latestTraining, users, exercises, videos] = await Promise.all([
        AdminService.dashboard.getServerInfo(),
        AdminService.dashboard.getLatestTraining(),
        AdminService.users.list(),
        AdminService.exercises.list(),
        AdminService.videos.listTasks(),
      ]);

      // 过滤系统用户
      const SYSTEM_USER_IDS = ['system', 'global', 'admin'];
      const filteredUsers = users.filter((u: any) => !SYSTEM_USER_IDS.includes(u.id));

      // 计算今日新增用户（使用 ISO 8601 时间比较）
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const newToday = filteredUsers.filter((u: any) => {
        try {
          const createdAt = new Date(u.created_at);
          return createdAt >= todayStart;
        } catch (e) {
          return false;
        }
      }).length;

      setData({
        serverUrl: serverInfo?.serverUrl || "",
        apiUrl: serverInfo?.apiUrl || "",
        serverInfo,
        latestTraining,
        userStats: {
          total: filteredUsers.length,
          todayActive: latestTraining?.todayStats?.completed || 0,
          newToday,
        },
        contentStats: {
          totalExercises: exercises.length,
          withVideo: exercises.filter((e: any) => e.videoUrl).length,
          pendingVideos: videos.filter((v: any) => v.status === 'pending').length,
        },
      } as any);
    } catch (err: any) {
      console.error('[useDashboardData] Error:', err);
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载 + 定时轮询
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30秒刷新
    return () => clearInterval(interval);
  }, [fetchData]);

  // WebSocket 实时更新
  useEffect(() => {
    wsService.connect('admin', 'admin-console');

    wsService.on('session_created', () => {
      console.log('[Dashboard] Session created, refreshing...');
      fetchData();
    });

    wsService.on('session_updated', () => {
      console.log('[Dashboard] Session updated, refreshing...');
      fetchData();
    });

    wsService.on('video_task_updated', () => {
      console.log('[Dashboard] Video task updated, refreshing...');
      fetchData();
    });

    return () => wsService.disconnect();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
};
