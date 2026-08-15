import React, { useState, useEffect } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { X } from 'lucide-react';

interface LoadAnchor {
  resistance?: {
    est_1rm?: number;
    best_weight?: number;
    best_reps?: number;
    '1rm'?: number;
    current?: number;
  };
  bodyweight?: {
    best_reps?: number;
  };
  cardio?: {
    best_pace?: number;
    best_distance?: number;
  };
  heart_rate?: {
    max_hr?: number;
    resting_hr?: number;
  };
  last_updated?: number;
}

interface AddAnchorDialogProps {
  open: boolean;
  initialData: { name: string; anchor: LoadAnchor } | null;
  onClose: () => void;
  onSave: (name: string, data: LoadAnchor) => void;
}

const ResistanceFields: React.FC<{
  data: LoadAnchor;
  onChange: (data: LoadAnchor) => void;
}> = ({ data, onChange }) => {
  const resistance = data.resistance || {};
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>1RM 估算 (kg)</label>
        <input
          type="number"
          step="0.1"
          value={resistance.est_1rm || resistance.best_weight || resistance['1rm'] || resistance.current || ''}
          onChange={(e) => onChange({
            ...data,
            resistance: {
              ...resistance,
              est_1rm: parseFloat(e.target.value) || undefined
            }
          })}
          className={inputClass}
          placeholder="如: 100"
        />
      </div>
      <div>
        <label className={labelClass}>最佳重量 (kg)</label>
        <input
          type="number"
          step="0.1"
          value={resistance.best_weight || ''}
          onChange={(e) => onChange({
            ...data,
            resistance: {
              ...resistance,
              best_weight: parseFloat(e.target.value) || undefined
            }
          })}
          className={inputClass}
          placeholder="如: 100"
        />
      </div>
      <div>
        <label className={labelClass}>最佳次数</label>
        <input
          type="number"
          value={resistance.best_reps || ''}
          onChange={(e) => onChange({
            ...data,
            resistance: {
              ...resistance,
              best_reps: parseInt(e.target.value) || undefined
            }
          })}
          className={inputClass}
          placeholder="如: 5"
        />
      </div>
    </div>
  );
};

const BodyweightFields: React.FC<{
  data: LoadAnchor;
  onChange: (data: LoadAnchor) => void;
}> = ({ data, onChange }) => {
  const bodyweight = data.bodyweight || {};
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div>
      <label className={labelClass}>最佳次数</label>
      <input
        type="number"
        value={bodyweight.best_reps || ''}
        onChange={(e) => onChange({
          ...data,
          bodyweight: {
            best_reps: parseInt(e.target.value) || undefined
          }
        })}
        className={inputClass}
        placeholder="如: 15"
      />
    </div>
  );
};

const CardioFields: React.FC<{
  data: LoadAnchor;
  onChange: (data: LoadAnchor) => void;
}> = ({ data, onChange }) => {
  const cardio = data.cardio || {};
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>最佳配速 (秒/公里)</label>
        <input
          type="number"
          step="0.1"
          value={cardio.best_pace || ''}
          onChange={(e) => onChange({
            ...data,
            cardio: {
              ...cardio,
              best_pace: parseFloat(e.target.value) || undefined
            }
          })}
          className={inputClass}
          placeholder="如: 300"
        />
      </div>
      <div>
        <label className={labelClass}>最佳距离 (米)</label>
        <input
          type="number"
          step="1"
          value={cardio.best_distance || ''}
          onChange={(e) => onChange({
            ...data,
            cardio: {
              ...cardio,
              best_distance: parseFloat(e.target.value) || undefined
            }
          })}
          className={inputClass}
          placeholder="如: 5000"
        />
      </div>
    </div>
  );
};

const HeartRateFields: React.FC<{
  data: LoadAnchor;
  onChange: (data: LoadAnchor) => void;
}> = ({ data, onChange }) => {
  const hr = data.heart_rate || {};
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>最大心率 (bpm)</label>
        <input
          type="number"
          value={hr.max_hr || ''}
          onChange={(e) => onChange({
            ...data,
            heart_rate: {
              ...hr,
              max_hr: parseInt(e.target.value) || undefined
            }
          })}
          className={inputClass}
          placeholder="如: 180"
        />
      </div>
      <div>
        <label className={labelClass}>静息心率 (bpm)</label>
        <input
          type="number"
          value={hr.resting_hr || ''}
          onChange={(e) => onChange({
            ...data,
            heart_rate: {
              ...hr,
              resting_hr: parseInt(e.target.value) || undefined
            }
          })}
          className={inputClass}
          placeholder="如: 60"
        />
      </div>
    </div>
  );
};

export const AddAnchorDialog: React.FC<AddAnchorDialogProps> = ({
  open, initialData, onClose, onSave
}) => {
  const [anchorType, setAnchorType] = useState<'resistance' | 'bodyweight' | 'cardio' | 'heart_rate'>('resistance');
  const [exerciseName, setExerciseName] = useState('');
  const [anchorData, setAnchorData] = useState<LoadAnchor>({});

  useEffect(() => {
    if (initialData) {
      setExerciseName(initialData.name);
      setAnchorData(initialData.anchor);

      // Determine type from existing data
      if (initialData.anchor.resistance) setAnchorType('resistance');
      else if (initialData.anchor.bodyweight) setAnchorType('bodyweight');
      else if (initialData.anchor.cardio) setAnchorType('cardio');
      else if (initialData.anchor.heart_rate) setAnchorType('heart_rate');
    } else {
      setExerciseName('');
      setAnchorData({});
      setAnchorType('resistance');
    }
  }, [initialData, open]);

  if (!open) return null;

  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  const handleSave = () => {
    if (!exerciseName.trim()) return;
    onSave(exerciseName.trim(), {
      ...anchorData,
      last_updated: Date.now()
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-gray-200 text-gray-900 shadow-2xl">
        <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-4">
          <h3 className="text-xl font-bold text-gray-900">
            {initialData ? '编辑' : '添加'}负荷锚点
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 px-1">
          {/* 锚点类型选择 */}
          <div>
            <label className={labelClass}>锚点类型</label>
            <select
              value={anchorType}
              onChange={(e) => {
                setAnchorType(e.target.value as any);
                setAnchorData({});
              }}
              className={inputClass}
              disabled={!!initialData}
            >
              <option value="resistance">力量型训练</option>
              <option value="bodyweight">自重型训练</option>
              <option value="cardio">有氧型训练</option>
              <option value="heart_rate">心率指标</option>
            </select>
          </div>

          {/* 动作名称 */}
          <div>
            <label className={labelClass}>
              {anchorType === 'heart_rate' ? '指标名称' : '动作名称'}
            </label>
            <input
              type="text"
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              placeholder={anchorType === 'heart_rate' ? '如: 最大心率' : '如: 深蹲、卧推'}
              className={inputClass}
            />
          </div>

          {/* 根据类型显示不同的输入字段 */}
          <div className="border-t border-gray-200 pt-4 mt-4">
            {anchorType === 'resistance' && (
              <ResistanceFields data={anchorData} onChange={setAnchorData} />
            )}
            {anchorType === 'bodyweight' && (
              <BodyweightFields data={anchorData} onChange={setAnchorData} />
            )}
            {anchorType === 'cardio' && (
              <CardioFields data={anchorData} onChange={setAnchorData} />
            )}
            {anchorType === 'heart_rate' && (
              <HeartRateFields data={anchorData} onChange={setAnchorData} />
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50">
            取消
          </Button>
          <Button onClick={handleSave} disabled={!exerciseName.trim()}>
            保存
          </Button>
        </div>
      </Card>
    </div>
  );
};
