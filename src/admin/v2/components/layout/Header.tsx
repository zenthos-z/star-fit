import React, { useState, useEffect } from 'react';
import { Wifi, Cpu, HardDrive, RotateCw } from 'lucide-react';
import { AdminService } from '../../services/api';

interface HeaderProps {
  title?: string;
}

export const Header: React.FC<HeaderProps> = ({ title }) => {
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // 仅在组件挂载时检查一次
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    setRefreshing(true);
    try {
      const health = await AdminService.system.getHealth();
      setSystemStatus(health);
      setLoading(false);
    } catch (e) {
      console.error('Failed to fetch system health:', e);
      setLoading(false);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    fetchHealth();
  };

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-8 flex-shrink-0">
      {/* Breadcrumb / Title */}
      <h1 className="text-lg font-bold text-gray-900" data-testid="admin-header-title">
        {title || '控制台'}
      </h1>

      {/* Status Bar */}
      <div className="flex items-center gap-6">
        {loading ? (
          <RotateCw size={16} className="animate-spin text-gray-400" />
        ) : systemStatus ? (
          <>
            <div className="flex items-center gap-2 text-xs font-medium">
              <div className={`p-1.5 ${systemStatus.api.status === 'ok' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'} rounded-md`}>
                <Wifi size={14} />
              </div>
              <div className="flex flex-col">
                <span className="text-gray-500">API 状态</span>
                <span className={systemStatus.api.status === 'ok' ? 'text-green-600' : 'text-red-600'}>
                  {systemStatus.api.status === 'ok' ? '正常' : '异常'} ({systemStatus.api.latency}ms)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-medium">
              <div className={`p-1.5 ${systemStatus.ai.status === 'connected' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'} rounded-md`}>
                <Cpu size={14} />
              </div>
              <div className="flex flex-col">
                <span className="text-gray-500">AI 连接</span>
                <span className={systemStatus.ai.status === 'connected' ? 'text-blue-600' : 'text-red-600'}>
                  {systemStatus.ai.status === 'connected' ? systemStatus.ai.provider : '未连接'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-medium">
              <div className={`p-1.5 ${systemStatus.storage.percent > 80 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'} rounded-md`}>
                <HardDrive size={14} />
              </div>
              <div className="flex flex-col">
                <span className="text-gray-500">存储占用</span>
                <span className={systemStatus.storage.percent > 80 ? 'text-red-600' : 'text-gray-700'}>
                  {systemStatus.storage.percent}%
                </span>
              </div>
            </div>

            {/* 手动刷新按钮 */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="刷新系统状态"
            >
              <RotateCw size={14} className={refreshing ? 'animate-spin text-gray-600' : 'text-gray-400'} />
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-400">加载中...</span>
        )}
      </div>
    </header>
  );
};
