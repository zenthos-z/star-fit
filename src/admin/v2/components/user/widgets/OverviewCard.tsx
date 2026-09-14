import React from 'react';
import { Card } from '../../ui/Card';
import { Calendar, Dumbbell } from 'lucide-react';

interface OverviewCardProps {
  stats: any;
  onEdit: () => void;
}

export const OverviewCard: React.FC<OverviewCardProps> = ({ stats, onEdit }) => {
  const lastActive = stats?.last_active ? new Date(stats.last_active).toLocaleDateString() : '从未';
  const totalSessions = stats?.total_sessions || 0;

  return (
    <Card className="bg-white border-gray-200 text-gray-900 h-full shadow-sm">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">概览</h3>
          <p className="text-xs text-gray-500">关键指标与状态</p>
        </div>
        <button onClick={onEdit} className="text-xs text-blue-600 hover:text-blue-800">编辑</button>
      </div>

      <div className="space-y-6">
        <div className="h-px bg-gray-100" />

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <Calendar size={12} />
              上次活跃
            </div>
            <div className="text-sm font-bold text-gray-900">{lastActive}</div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
              <Dumbbell size={12} />
              总训练次数
            </div>
            <div className="text-sm font-bold text-gray-900">{totalSessions}</div>
          </div>
        </div>
      </div>
    </Card>
  );
};
