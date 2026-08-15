/**
 * Dashboard Component
 *
 * 主仪表盘组件
 */

import React, { useState } from 'react';
import { useDashboardData } from './hooks/useDashboardData';
import { ServerInfoCard } from './ServerInfoCard';
import { TodayTrainingCard } from './TodayTrainingCard';
import { UserStatsCard } from './UserStatsCard';
import { ContentStatsCard } from './ContentStatsCard';
import { QuickActions } from './QuickActions';
import { TrainingDetailModal } from './TrainingDetailModal';
import { AIAuditModal } from './AIAuditModal';
import { RotateCw, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';

interface DashboardProps {
  onNavigate?: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const { data, loading, error, refresh } = useDashboardData();
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <RotateCw className="w-8 h-8 text-star-accent mx-auto mb-4 animate-spin" />
          <p className="text-gray-600">加载仪表盘数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={refresh}>重试</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-6 p-8 overflow-auto">
      {/* 服务器信息 */}
      <ServerInfoCard serverInfo={data?.serverInfo} />

      {/* 今日训练动态 */}
      <TodayTrainingCard
        training={data?.latestTraining}
        onViewDetail={(session) => {
          setSelectedSession(session);
          setShowDetail(true);
        }}
        onViewAudit={(session) => {
          setSelectedSession(session);
          setShowAudit(true);
        }}
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UserStatsCard stats={data?.userStats} />
        <ContentStatsCard stats={data?.contentStats} />
      </div>

      {/* 快捷操作 */}
      <QuickActions onNavigate={onNavigate} />

      {/* 弹窗 */}
      <TrainingDetailModal
        session={selectedSession}
        isOpen={showDetail}
        onClose={() => {
          setShowDetail(false);
          setSelectedSession(null);
        }}
      />

      <AIAuditModal
        auditText={selectedSession?.auditText || ''}
        sessionTitle={selectedSession?.title || ''}
        isOpen={showAudit}
        onClose={() => {
          setShowAudit(false);
          setSelectedSession(null);
        }}
      />
    </div>
  );
};
