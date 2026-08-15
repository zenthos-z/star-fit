import React from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Edit2, BrainCircuit, Scale, Target } from 'lucide-react';

interface PsychologicalWidgetProps {
  data: any;
  onEdit: () => void;
}

export const PsychologicalWidget: React.FC<PsychologicalWidgetProps> = ({ data, onEdit }) => {
  const info = data?.psychological || {};

  return (
    <Card className="h-full flex flex-col bg-white border-gray-200 text-gray-900 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <BrainCircuit className="text-blue-600" size={18} />
          心理状态
        </h3>
        <Button variant="ghost" size="sm" onClick={onEdit} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100">
          <Edit2 size={14} />
        </Button>
      </div>

      <div className="space-y-4 flex-1">
        {/* Neurotype */}
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-2 mb-1 text-gray-400">
            <BrainCircuit size={14} />
            <span className="text-xs uppercase tracking-wider">神经类型</span>
          </div>
          <div className="font-bold text-lg text-gray-900">{info.neurotype || '--'}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Accountability */}
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
            <div className="flex items-center gap-2 mb-1 text-gray-400">
              <Target size={14} />
              <span className="text-xs uppercase tracking-wider">问责方式</span>
            </div>
            <div className="font-medium text-gray-900 capitalize">{info.accountability || '--'}</div>
          </div>

          {/* Risk Preference */}
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
            <div className="flex items-center gap-2 mb-1 text-gray-400">
              <Scale size={14} />
              <span className="text-xs uppercase tracking-wider">风险偏好</span>
            </div>
            <div className="font-medium text-gray-900 capitalize">{info.risk_preference || '--'}</div>
          </div>
        </div>
      </div>
    </Card>
  );
};
