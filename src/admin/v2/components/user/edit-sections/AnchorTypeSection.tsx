import React from 'react';
import { Edit2, Trash2, Plus } from 'lucide-react';
import { Button } from '../../ui/Button';

interface AnchorTypeSectionProps {
  type: 'resistance' | 'bodyweight' | 'cardio' | 'heart_rate';
  label: string;
  icon: React.ReactNode;
  anchors: [string, any][];
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
  onAdd: () => void;
}

const formatAnchorValue = (anchor: any, type: string): string => {
  if (!anchor) return '--';

  switch (type) {
    case 'resistance':
      const resistance = anchor.resistance;
      if (!resistance) return '--';
      const weight = resistance.est_1rm || resistance.best_weight || resistance['1rm'] || resistance.current;
      return weight ? `${weight} kg` : '--';

    case 'bodyweight':
      const bodyweight = anchor.bodyweight;
      if (!bodyweight) return '--';
      const reps = bodyweight.best_reps;
      return reps ? `${reps} 次` : '--';

    case 'cardio':
      const cardio = anchor.cardio;
      if (!cardio) return '--';
      if (cardio.best_pace) return `${cardio.best_pace} s/km`;
      if (cardio.best_distance) return `${(cardio.best_distance / 1000).toFixed(2)} km`;
      return '--';

    case 'heart_rate':
      const hr = anchor.heart_rate;
      if (!hr) return '--';
      if (hr.max_hr) return `${hr.max_hr} bpm (最大)`;
      if (hr.resting_hr) return `${hr.resting_hr} bpm (静息)`;
      return '--';

    default:
      return '--';
  }
};

export const AnchorTypeSection: React.FC<AnchorTypeSectionProps> = ({
  type, label, icon, anchors, onEdit, onDelete, onAdd
}) => {
  const getHeaders = () => {
    switch (type) {
      case 'resistance':
        return ['动作名称', '1RM重量', '最后更新', '操作'];
      case 'bodyweight':
        return ['动作名称', '最佳次数', '最后更新', '操作'];
      case 'cardio':
        return ['动作名称', '最佳成绩', '最后更新', '操作'];
      case 'heart_rate':
        return ['指标名称', '数值', '最后更新', '操作'];
      default:
        return ['名称', '数值', '最后更新', '操作'];
    }
  };

  return (
    <section className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          {icon}
          {label}
        </h3>
        <Button size="sm" onClick={onAdd} icon={<Plus size={14} />}>
          添加锚点
        </Button>
      </div>

      {anchors.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          暂无{label}锚点数据
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-gray-500 border-b border-gray-200">
              {getHeaders().map((header, index) => (
                <th key={index} className="pb-2 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anchors.map(([name, anchor]) => (
              <tr key={name} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                <td className="py-3 text-gray-900 font-medium">{name}</td>
                <td className="py-3 text-gray-700">{formatAnchorValue(anchor, type)}</td>
                <td className="py-3 text-sm text-gray-500">
                  {anchor.last_updated
                    ? new Date(anchor.last_updated).toLocaleDateString()
                    : '未知'
                  }
                </td>
                <td className="py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => onEdit(name)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="编辑"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => onDelete(name)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
