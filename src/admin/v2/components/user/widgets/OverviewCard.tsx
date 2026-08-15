import React from 'react';
import { Card } from '../../ui/Card';
import { Activity, AlertTriangle, Calendar, Dumbbell } from 'lucide-react';

interface OverviewCardProps {
  profile: any;
  stats: any;
  onEdit: () => void;
}

export const OverviewCard: React.FC<OverviewCardProps> = ({ profile, stats, onEdit }) => {
  const fitnessLevel = profile?.fitness_level || 'beginner';
  const redFlags = profile?.red_flags || [];
  const lastActive = stats?.last_active ? new Date(stats.last_active).toLocaleDateString() : '从未';
  const totalSessions = stats?.total_sessions || 0;

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'advanced': return 'text-purple-700 bg-purple-50';
      case 'intermediate': return 'text-blue-700 bg-blue-50';
      default: return 'text-green-700 bg-green-50';
    }
  };

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
        {/* Fitness Level */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${getLevelColor(fitnessLevel)}`}>
              <Activity size={18} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900 capitalize">{fitnessLevel}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">体能水平</div>
            </div>
          </div>
        </div>

        {/* Red Flags */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className={redFlags.length > 0 ? "text-orange-500" : "text-gray-400"} />
            <span className="text-xs text-gray-400 uppercase tracking-wider">红色警报</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {redFlags.length > 0 ? (
              redFlags.map((flag: string, idx: number) => (
                <span key={idx} className="px-2 py-1 rounded bg-orange-50 text-orange-700 text-xs border border-orange-200">
                  {flag}
                </span>
              ))
            ) : (
              <span className="text-xs text-gray-500 italic">无红色警报</span>
            )}
          </div>
        </div>

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
