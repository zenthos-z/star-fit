import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { AdminService } from '../../services/api';
import { 
  Activity, Server, Database, AlertCircle, 
  Terminal, Play, RotateCw, FileText 
} from 'lucide-react';

function formatBytes(bytes: number) {
  const v = Number.isFinite(bytes) ? bytes : 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (v <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  const num = v / Math.pow(1024, i);
  return `${num.toFixed(num >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const Cockpit: React.FC = () => {
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [health, newLogs] = await Promise.all([
        AdminService.system.getHealth(),
        AdminService.system.getLogs(10, 'all')
      ]);
      setSystemStatus(health);
      setLogs(newLogs);
    } catch (err: any) {
      console.error('Failed to fetch system data:', err);
      setError(err.message || 'Failed to load system data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData(false);
  };

  const StatusCard = ({ icon: Icon, title, value, status, subtext }: any) => (
    <Card className="flex items-center gap-4 p-6">
      <div className={`p-3 rounded-xl ${
        status === 'ok' ? 'bg-green-50 text-green-600' : 
        status === 'warning' ? 'bg-yellow-50 text-yellow-600' : 
        'bg-red-50 text-red-600'
      }`}>
        <Icon size={24} />
      </div>
      <div>
        <div className="text-sm text-gray-500 font-medium">{title}</div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-xs text-gray-400 mt-0.5">{subtext}</div>
      </div>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RotateCw className="w-8 h-8 text-star-accent mx-auto mb-4 animate-spin" />
          <p className="text-gray-600">加载系统状态...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => fetchData(true)}
            className="px-4 py-2 bg-star-accent text-white rounded-md hover:bg-opacity-90"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* System Health Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatusCard 
          icon={Server} 
          title="API 服务" 
          value={systemStatus?.api.status === 'ok' ? '在线' : '离线'} 
          status={systemStatus?.api.status}
          subtext={`延迟: ${systemStatus?.api.latency}ms`}
        />
        <StatusCard 
          icon={Activity} 
          title="AI 引擎" 
          value={systemStatus?.ai.status === 'connected' ? '已连接' : '错误'} 
          status={systemStatus?.ai.status === 'connected' ? 'ok' : 'error'}
          subtext={`提供商: ${systemStatus?.ai.provider}`}
        />
        <StatusCard 
          icon={Database} 
          title="存储空间" 
          value={`${systemStatus?.storage.percent}%`} 
          status={systemStatus?.storage.percent > 80 ? 'warning' : 'ok'}
          subtext={`已用: ${formatBytes(systemStatus?.storage.used)} / ${formatBytes(systemStatus?.storage.total)}`}
        />
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Activity Log */}
        <div className="col-span-8 flex flex-col">
          <Card className="flex-1 flex flex-col min-h-0 p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Terminal size={18} className="text-star-accent" />
                System Activity Log
              </h3>
              <Button variant="ghost" size="sm" icon={<RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />} onClick={handleRefresh}>Refresh</Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-2 bg-gray-900 text-gray-300">
              {logs.map((log, i) => (
                <div key={i} className={`flex gap-2 ${
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-yellow-400' :
                  ''
                }`}>
                  <span className="text-gray-500">{'>'}</span>
                  <span>[{new Date(log.timestamp).toLocaleTimeString()}] {log.message}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="col-span-4 flex flex-col gap-4">
          <Card className="p-6">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Play size={18} className="text-star-accent" />
              Quick Actions
            </h3>
            <div className="space-y-3">
              <Button variant="secondary" className="w-full justify-start" icon={<FileText size={16} />} onClick={() => console.log('Navigate to logs')}>
                View Server Logs
              </Button>
              <Button variant="secondary" className="w-full justify-start" icon={<RotateCw size={16} />} onClick={async () => {
                try {
                  const result = await AdminService.system.restart();
                  alert(result.message);
                } catch (err: any) {
                  alert(`操作失败: ${err.message}`);
                }
              }}>
                Restart API Service
              </Button>
              <Button variant="secondary" className="w-full justify-start" icon={<Database size={16} />} onClick={async () => {
                try {
                  const result = await AdminService.system.backup();
                  alert(result.message);
                } catch (err: any) {
                  alert(`操作失败: ${err.message}`);
                }
              }}>
                Backup Database
              </Button>
              <Button variant="danger" className="w-full justify-start" icon={<AlertCircle size={16} />} onClick={async () => {
                if (confirm('确定要执行紧急停止吗？')) {
                  try {
                    const result = await AdminService.system.emergencyStop();
                    alert(result.message);
                  } catch (err: any) {
                    alert(`操作失败: ${err.message}`);
                  }
                }
              }}>
                Emergency Stop
              </Button>
            </div>
          </Card>

          {systemStatus?.ai?.status !== 'connected' && (
            <Card className="p-4 bg-red-50 border-red-200">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-red-900">AI 服务未连接</h4>
                  <p className="text-sm text-red-700 mt-1">请检查 AI 配置或网络连接</p>
                </div>
              </div>
            </Card>
          )}

          {systemStatus?.storage?.percent > 80 && (
            <Card className="p-4 bg-yellow-50 border-yellow-200">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-yellow-900">存储空间不足</h4>
                  <p className="text-sm text-yellow-700 mt-1">当前使用 {systemStatus.storage.percent}%，建议清理或扩展存储</p>
                </div>
              </div>
            </Card>
          )}

          <Card className="flex-1 p-6 bg-gradient-to-br from-star-accent/10 to-transparent border-star-accent/20">
            <div className="h-full flex flex-col justify-center items-center text-center">
              <h4 className="font-bold text-star-accent text-lg mb-2">Starfit Pro</h4>
              <p className="text-sm text-gray-600 mb-4">版本 2.0.0 (Build 20240115)</p>
              <Badge variant="success">最新版本</Badge>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
