/**
 * LoadAnchorsEditor - 负荷锚点编辑器
 *
 * 功能：添加/编辑/删除用户的负荷锚点
 * 支持多种运动类型：力量训练、自重训练、有氧训练、等长训练
 * 遵循数据契约：所有类型从 shared/contracts 导入
 *
 * @module LoadAnchorsEditor
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Dumbbell,
  Timer,
  Heart,
  Activity,
  X,
  Save,
  GripVertical,
  TrendingUp,
  Weight,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import type { LoadAnchor, LoadAnchors } from 'shared/contracts';
import {
  validateAnchorForExerciseType,
  EXERCISE_TYPE_FIELDS,
} from 'shared/contracts';

interface LoadAnchorsEditorProps {
  loadAnchors: LoadAnchors;
  onSave: (anchors: LoadAnchors) => Promise<void>;
}

type ExerciseType =
  | 'resistance'
  | 'bodyweight'
  | 'cardio'
  | 'isometric'
  | 'assisted'
  | 'flexibility';

const exerciseTypes: { value: ExerciseType; label: string; icon: typeof Dumbbell }[] = [
  { value: 'resistance', label: '力量训练', icon: Dumbbell },
  { value: 'bodyweight', label: '自重训练', icon: Activity },
  { value: 'cardio', label: '有氧训练', icon: Heart },
  { value: 'isometric', label: '等长训练', icon: Timer },
  { value: 'assisted', label: '辅助训练', icon: GripVertical },
];

const getExerciseType = (exerciseId: string): ExerciseType => {
  const id = exerciseId.toLowerCase();
  if (id.includes('跑') || id.includes('走') || id.includes('有氧') || id.includes('cardio')) {
    return 'cardio';
  }
  if (id.includes('静蹲') || id.includes('平板') || id.includes('支撑')) {
    return 'isometric';
  }
  if (id.includes('辅助') || id.includes('assisted')) {
    return 'assisted';
  }
  if (id.includes('俯卧撑') || id.includes('引体') || id.includes('自重')) {
    return 'bodyweight';
  }
  return 'resistance';
};

const getExerciseIcon = (exerciseId: string) => {
  const type = getExerciseType(exerciseId);
  const typeConfig = exerciseTypes.find((t) => t.value === type);
  return typeConfig?.icon || Dumbbell;
};

interface AnchorFormData {
  exerciseId: string;
  exerciseType: ExerciseType;
  best_weight?: number;
  best_reps?: number;
  est_1rm?: number;
  progression_level?: number;
  best_duration?: number;
  best_distance?: number;
  best_pace?: number;
  max_hr?: number;
  resting_hr?: number;
  zone_2_threshold?: number;
}

const emptyFormData: AnchorFormData = {
  exerciseId: '',
  exerciseType: 'resistance',
  best_weight: undefined,
  best_reps: undefined,
  est_1rm: undefined,
  progression_level: undefined,
  best_duration: undefined,
  best_distance: undefined,
  best_pace: undefined,
  max_hr: undefined,
  resting_hr: undefined,
  zone_2_threshold: undefined,
};

export const LoadAnchorsEditor: React.FC<LoadAnchorsEditorProps> = ({
  loadAnchors,
  onSave,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<AnchorFormData>(emptyFormData);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const handleAddNew = () => {
    setFormData(emptyFormData);
    setEditingId(null);
    setIsAdding(true);
    setErrors([]);
  };

  const handleEdit = (exerciseId: string, anchor: LoadAnchor) => {
    setFormData({
      exerciseId,
      exerciseType: getExerciseType(exerciseId),
      best_weight: anchor.best_weight,
      best_reps: anchor.best_reps,
      est_1rm: anchor.est_1rm,
      progression_level: anchor.progression_level,
      best_duration: anchor.best_duration,
      best_distance: anchor.best_distance,
      best_pace: anchor.best_pace,
      max_hr: anchor.max_hr,
      resting_hr: anchor.resting_hr,
      zone_2_threshold: anchor.zone_2_threshold,
    });
    setEditingId(exerciseId);
    setIsAdding(true);
    setErrors([]);
  };

  const handleDelete = async (exerciseId: string) => {
    if (!confirm(`确定要删除 "${exerciseId}" 的负荷锚点吗？`)) return;

    const newAnchors = { ...loadAnchors };
    delete newAnchors[exerciseId];

    setSaving(true);
    try {
      await onSave(newAnchors);
    } finally {
      setSaving(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = [];

    if (!formData.exerciseId.trim()) {
      newErrors.push('请输入动作名称');
    }

    // 根据运动类型验证必填字段
    const anchor: LoadAnchor = {
      best_weight: formData.best_weight,
      best_reps: formData.best_reps,
      est_1rm: formData.est_1rm,
      progression_level: formData.progression_level,
      best_duration: formData.best_duration,
      best_distance: formData.best_distance,
      best_pace: formData.best_pace,
      max_hr: formData.max_hr,
      resting_hr: formData.resting_hr,
      zone_2_threshold: formData.zone_2_threshold,
      last_updated: Date.now(),
    };

    const validation = validateAnchorForExerciseType(anchor, formData.exerciseType);
    if (!validation.valid) {
      newErrors.push(...validation.errors);
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    const anchor: LoadAnchor = {
      best_weight: formData.best_weight,
      best_reps: formData.best_reps,
      est_1rm: formData.est_1rm,
      progression_level: formData.progression_level,
      best_duration: formData.best_duration,
      best_distance: formData.best_distance,
      best_pace: formData.best_pace,
      max_hr: formData.max_hr,
      resting_hr: formData.resting_hr,
      zone_2_threshold: formData.zone_2_threshold,
      last_updated: Date.now(),
    };

    const newAnchors = { ...loadAnchors };

    // 如果编辑的是已有项目且修改了名称，删除旧的
    if (editingId && editingId !== formData.exerciseId) {
      delete newAnchors[editingId];
    }

    newAnchors[formData.exerciseId] = anchor;

    setSaving(true);
    try {
      await onSave(newAnchors);
      setIsAdding(false);
      setEditingId(null);
      setFormData(emptyFormData);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-star-accent/20 focus:border-star-accent transition-all placeholder-gray-400 text-sm';
  const labelClass = 'block text-xs font-medium text-gray-500 mb-1';

  const renderFormFields = () => {
    const { exerciseType } = formData;

    return (
      <div className="space-y-4">
        {/* Exercise Name */}
        <div>
          <label className={labelClass}>动作名称</label>
          <input
            type="text"
            value={formData.exerciseId}
            onChange={(e) => setFormData({ ...formData, exerciseId: e.target.value })}
            className={inputClass}
            placeholder="例如：深蹲、卧推、跑步"
            disabled={!!editingId}
          />
        </div>

        {/* Exercise Type */}
        <div>
          <label className={labelClass}>运动类型</label>
          <div className="flex flex-wrap gap-2">
            {exerciseTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => setFormData({ ...formData, exerciseType: type.value })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  exerciseType === type.value
                    ? 'bg-star-accent text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <type.icon size={12} />
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Fields based on exercise type */}
        <div className="grid grid-cols-2 gap-3">
          {(exerciseType === 'resistance' || exerciseType === 'assisted') && (
            <>
              <div>
                <label className={labelClass}>最佳重量 (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.best_weight || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_weight: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="kg"
                />
              </div>
              <div>
                <label className={labelClass}>最佳次数</label>
                <input
                  type="number"
                  value={formData.best_reps || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_reps: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="次"
                />
              </div>
              <div>
                <label className={labelClass}>估算 1RM (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.est_1rm || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      est_1rm: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="kg"
                />
              </div>
            </>
          )}

          {exerciseType === 'bodyweight' && (
            <>
              <div>
                <label className={labelClass}>最佳次数</label>
                <input
                  type="number"
                  value={formData.best_reps || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_reps: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="次"
                />
              </div>
              <div>
                <label className={labelClass}>进阶等级 (1-10)</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={formData.progression_level || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      progression_level: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="1-10"
                />
              </div>
            </>
          )}

          {exerciseType === 'isometric' && (
            <>
              <div>
                <label className={labelClass}>最佳时长 (秒)</label>
                <input
                  type="number"
                  value={formData.best_duration || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_duration: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="秒"
                />
              </div>
              <div>
                <label className={labelClass}>负重 (kg, 可选)</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.best_weight || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_weight: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="kg"
                />
              </div>
            </>
          )}

          {exerciseType === 'cardio' && (
            <>
              <div>
                <label className={labelClass}>最佳配速 (min/km)</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.best_pace || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_pace: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="min/km"
                />
              </div>
              <div>
                <label className={labelClass}>最佳距离 (km)</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.best_distance || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_distance: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="km"
                />
              </div>
              <div>
                <label className={labelClass}>最佳时长 (分钟)</label>
                <input
                  type="number"
                  value={formData.best_duration || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      best_duration: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className={inputClass}
                  placeholder="分钟"
                />
              </div>
            </>
          )}
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            {errors.map((error, index) => (
              <p key={index} className="text-xs text-red-600 flex items-center gap-1">
                <X size={12} />
                {error}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">负荷锚点</h3>
        <Button variant="secondary" size="sm" onClick={handleAddNew} icon={<Plus size={14} />}>
          添加锚点
        </Button>
      </div>

      {/* Add/Edit Form */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-gray-50 rounded-xl p-4 border border-gray-200"
          >
            {renderFormFields()}
            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAdding(false);
                  setEditingId(null);
                  setErrors([]);
                }}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                loading={saving}
                icon={<Save size={14} />}
              >
                {editingId ? '更新' : '保存'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Anchors List */}
      <div className="space-y-2">
        {Object.entries(loadAnchors).length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <Dumbbell size={32} className="mx-auto mb-2 opacity-50" />
            暂无负荷锚点
          </div>
        ) : (
          Object.entries(loadAnchors).map(([exerciseId, anchor]) => {
            const Icon = getExerciseIcon(exerciseId);
            const type = getExerciseType(exerciseId);

            return (
              <motion.div
                key={exerciseId}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="group flex items-center justify-between p-3 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Icon size={18} className="text-gray-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{exerciseId}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {anchor.best_weight !== undefined && (
                        <span className="flex items-center gap-0.5">
                          <Weight size={10} />
                          {anchor.best_weight}kg
                        </span>
                      )}
                      {anchor.best_reps !== undefined && (
                        <span>×{anchor.best_reps}次</span>
                      )}
                      {anchor.est_1rm !== undefined && (
                        <span className="text-star-accent">1RM: {anchor.est_1rm}kg</span>
                      )}
                      {anchor.best_duration !== undefined && (
                        <span>{anchor.best_duration}秒</span>
                      )}
                      {anchor.best_pace !== undefined && (
                        <span>{anchor.best_pace}min/km</span>
                      )}
                      {anchor.progression_level !== undefined && (
                        <span>Lv.{anchor.progression_level}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(exerciseId, anchor)}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <TrendingUp size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(exerciseId)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
};
