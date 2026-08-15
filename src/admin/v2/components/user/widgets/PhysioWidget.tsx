import React from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Edit2, Ruler, Weight, Activity, Heart, Calendar, Clock } from 'lucide-react';

interface PhysioWidgetProps {
  data: any;
  onEdit: () => void;
}

export const PhysioWidget: React.FC<PhysioWidgetProps> = ({ data, onEdit }) => {
  const info = data?.basic_info || {};

  return (
    <Card className="h-full flex flex-col bg-white border-gray-200 text-gray-900 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Activity className="text-blue-600" size={18} />
          生理指标
        </h3>
        <Button variant="ghost" size="sm" onClick={onEdit} className="text-gray-400 hover:text-gray-900 hover:bg-gray-100">
          <Edit2 size={14} />
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 flex-1">
        {/* Height */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-col items-center justify-center">
          <Ruler size={20} className="text-gray-400 mb-1" />
          <span className="text-lg font-bold text-gray-900">{info.height || '--'} <span className="text-xs text-gray-500 font-normal">cm</span></span>
          <span className="text-xs text-gray-500">身高</span>
        </div>
        
        {/* Weight */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-col items-center justify-center">
          <Weight size={20} className="text-gray-400 mb-1" />
          <span className="text-lg font-bold text-gray-900">{info.weight || '--'} <span className="text-xs text-gray-500 font-normal">kg</span></span>
          <span className="text-xs text-gray-500">体重</span>
        </div>

        {/* Body Fat */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-col items-center justify-center">
          <Activity size={20} className="text-gray-400 mb-1" />
          <span className="text-lg font-bold text-gray-900">{info.body_fat || '--'} <span className="text-xs text-gray-500 font-normal">%</span></span>
          <span className="text-xs text-gray-500">体脂率</span>
        </div>

        {/* Age (New) */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-col items-center justify-center">
          <Calendar size={20} className="text-gray-400 mb-1" />
          <span className="text-lg font-bold text-gray-900">{info.age || '--'}</span>
          <span className="text-xs text-gray-500">年龄</span>
        </div>

        {/* Training Age (New) */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-col items-center justify-center">
          <Clock size={20} className="text-gray-400 mb-1" />
          <span className="text-lg font-bold text-gray-900">{info.training_age || '--'} <span className="text-xs text-gray-500 font-normal">月</span></span>
          <span className="text-xs text-gray-500">训练年限</span>
        </div>

        {/* Injuries */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-col items-center justify-center">
          <Heart size={20} className="text-gray-400 mb-1" />
          <span className={`text-lg font-bold ${info.injuries?.length ? 'text-orange-500' : 'text-green-600'}`}>
            {info.injuries?.length ? '受伤' : '健康'}
          </span>
          <span className="text-xs text-gray-500">状态</span>
        </div>
      </div>
    </Card>
  );
};
