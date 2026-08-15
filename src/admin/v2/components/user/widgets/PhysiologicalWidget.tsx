import React from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Edit2, Moon, Brain, Zap } from 'lucide-react';

interface PhysiologicalWidgetProps {
  data: any;
  onEdit: () => void;
}

export const PhysiologicalWidget: React.FC<PhysiologicalWidgetProps> = ({ data, onEdit }) => {
  const info = data?.physiological || {};

  const getStressColor = (level: string) => {
    switch (level) {
      case 'low': return 'text-green-600';
      case 'medium': return 'text-yellow-600';
      case 'high': return 'text-red-600';
      default: return 'text-gray-900';
    }
  };

  const stressMap: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高'
  };

  return (
    <Card className="h-full flex flex-col bg-white border-gray-200 text-gray-900 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Zap className="text-blue-600" size={18} />
          生理机能
        </h3>
        <Button variant="ghost" size="sm" onClick={onEdit} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100">
          <Edit2 size={14} />
        </Button>
      </div>

      <div className="space-y-4 flex-1">
        {/* Sleep */}
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-3">
            <Moon size={18} className="text-gray-400" />
            <span className="text-sm text-gray-600">睡眠时长</span>
          </div>
          <span className="font-mono font-bold text-gray-900">{info.sleep_hours || '--'} h</span>
        </div>

        {/* Stress */}
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-3">
            <Brain size={18} className="text-gray-400" />
            <span className="text-sm text-gray-600">压力水平</span>
          </div>
          <span className={`font-bold ${getStressColor(info.stress_level)}`}>
            {stressMap[info.stress_level] || info.stress_level || '--'}
          </span>
        </div>

        {/* Cycle Focus */}
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-3">
            <ActivityIcon size={18} className="text-gray-400" />
            <span className="text-sm text-gray-600">周期重点</span>
          </div>
          <span className="font-bold text-purple-600 capitalize">
            {info.cycle_focus || '--'}
          </span>
        </div>
      </div>
    </Card>
  );
};

const ActivityIcon = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
