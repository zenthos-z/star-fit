/**
 * LimitationsEditor - 伤病限制管理编辑器
 *
 * 功能：添加/删除用户的活跃伤病限制
 * 支持设置身体部位、严重程度、自动愈合
 * 遵循数据契约：所有类型从 shared/contracts 导入
 *
 * @module LimitationsEditor
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  AlertCircle,
  Clock,
  Activity,
  X,
  Save,
  HeartPulse,
  Armchair,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import type { ActiveLimitation } from 'shared/contracts';
import {
  createActiveLimitation,
  isLimitationExpired,
  calculateExpirationTime,
} from 'shared/contracts';

interface LimitationsEditorProps {
  limitations: ActiveLimitation[];
  onAdd: (limitation: Omit<ActiveLimitation, 'logged_at' | 'expire_at'>) => Promise<void>;
  onRemove: (part: string) => Promise<void>;
}

const bodyParts = [
  { value: 'head', label: '头部', icon: Activity },
  { value: 'neck', label: '颈部', icon: Activity },
  { value: 'left_shoulder', label: '左肩', icon: Armchair },
  { value: 'right_shoulder', label: '右肩', icon: Armchair },
  { value: 'chest', label: '胸部', icon: HeartPulse },
  { value: 'upper_back', label: '上背', icon: Activity },
  { value: 'lower_back', label: '下背', icon: Activity },
  { value: 'waist', label: '腰部', icon: Activity },
  { value: 'hips', label: '臀部', icon: Activity },
  { value: 'left_quad', label: '左大腿前侧', icon: Activity },
  { value: 'right_quad', label: '右大腿前侧', icon: Activity },
  { value: 'left_hamstring', label: '左大腿后侧', icon: Activity },
  { value: 'right_hamstring', label: '右大腿后侧', icon: Activity },
  { value: 'left_knee', label: '左膝盖', icon: Activity },
  { value: 'right_knee', label: '右膝盖', icon: Activity },
  { value: 'left_calf', label: '左小腿', icon: Activity },
  { value: 'right_calf', label: '右小腿', icon: Activity },
  { value: 'left_ankle', label: '左脚踝', icon: Activity },
  { value: 'right_ankle', label: '右脚踝', icon: Activity },
  { value: 'left_upper_arm', label: '左上臂', icon: Activity },
  { value: 'right_upper_arm', label: '右上臂', icon: Activity },
  { value: 'left_forearm', label: '左前臂', icon: Activity },
  { value: 'right_forearm', label: '右前臂', icon: Activity },
  { value: 'left_wrist', label: '左手腕', icon: Activity },
  { value: 'right_wrist', label: '右手腕', icon: Activity },
  { value: 'left_elbow', label: '左手肘', icon: Activity },
  { value: 'right_elbow', label: '右手肘', icon: Activity },
];

const getBodyPartLabel = (part: string): string => {
  const found = bodyParts.find((p) => p.value === part);
  return found?.label || part;
};

const getSeverityColor = (severity: number): string => {
  if (severity <= 3) return 'bg-green-100 text-green-700 border-green-200';
  if (severity <= 6) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-red-100 text-red-700 border-red-200';
};

const getSeverityLabel = (severity: number): string => {
  if (severity <= 3) return '轻微';
  if (severity <= 6) return '中等';
  return '严重';
};

const formatTimeRemaining = (expireAt: string): string => {
  const now = new Date();
  const expire = new Date(expireAt);
  const diffMs = expire.getTime() - now.getTime();

  if (diffMs <= 0) return '已过期';

  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return '1天后';
  return `${diffDays}天后`;
};

export const LimitationsEditor: React.FC<LimitationsEditorProps> = ({
  limitations,
  onAdd,
  onRemove,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedPart, setSelectedPart] = useState('');
  const [severity, setSeverity] = useState(5);
  const [autoHeal, setAutoHeal] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filter out expired limitations for display
  const activeLimitations = limitations.filter((l) => !isLimitationExpired(l));

  const handleAdd = async () => {
    if (!selectedPart) return;

    setSaving(true);
    try {
      await onAdd({
        part: selectedPart,
        severity,
        auto_heal: autoHeal,
      });
      setIsAdding(false);
      setSelectedPart('');
      setSeverity(5);
      setAutoHeal(true);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (part: string) => {
    if (!confirm(`确定要移除 "${getBodyPartLabel(part)}" 的伤病限制吗？`)) return;

    setSaving(true);
    try {
      await onRemove(part);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">活跃伤病限制</h3>
          {activeLimitations.length > 0 && (
            <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-medium rounded-full">
              {activeLimitations.length}
            </span>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsAdding(true)}
          icon={<Plus size={14} />}
          disabled={isAdding}
        >
          添加限制
        </Button>
      </div>

      {/* Add Form */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-4"
          >
            {/* Body Part Selection */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">身体部位</label>
              <select
                value={selectedPart}
                onChange={(e) => setSelectedPart(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-star-accent/20 focus:border-star-accent transition-all text-sm"
              >
                <option value="">选择身体部位</option>
                {bodyParts.map((part) => (
                  <option key={part.value} value={part.value}>
                    {part.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Severity Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-500">严重程度</label>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full ${getSeverityColor(
                    severity
                  )}`}
                >
                  {severity} - {getSeverityLabel(severity)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={severity}
                onChange={(e) => setSeverity(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-star-accent"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>轻微</span>
                <span>严重</span>
              </div>
            </div>

            {/* Auto Heal Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-gray-400" />
                <span className="text-sm text-gray-700">自动愈合</span>
              </div>
              <button
                onClick={() => setAutoHeal(!autoHeal)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  autoHeal ? 'bg-star-accent' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    autoHeal ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {autoHeal && (
              <p className="text-xs text-gray-500 bg-blue-50 p-2 rounded-lg">
                <AlertCircle size={12} className="inline mr-1" />
                预计 {calculateExpirationTime(severity).split('T')[0]} 自动恢复
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAdding(false);
                  setSelectedPart('');
                  setSeverity(5);
                }}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAdd}
                loading={saving}
                disabled={!selectedPart}
                icon={<Save size={14} />}
              >
                添加
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Limitations List */}
      <div className="space-y-2">
        {activeLimitations.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <HeartPulse size={32} className="mx-auto mb-2 opacity-50" />
            暂无活跃伤病限制
          </div>
        ) : (
          activeLimitations.map((limitation) => (
            <motion.div
              key={limitation.part}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${getSeverityColor(
                limitation.severity
              )}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/50 flex items-center justify-center">
                  <AlertCircle size={16} />
                </div>
                <div>
                  <p className="font-medium text-sm">{getBodyPartLabel(limitation.part)}</p>
                  <div className="flex items-center gap-2 text-xs opacity-80">
                    <span>严重程度: {limitation.severity}/10</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {formatTimeRemaining(limitation.expire_at)}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleRemove(limitation.part)}
                className="p-2 opacity-0 group-hover:opacity-100 hover:bg-white/50 rounded-lg transition-all"
                disabled={saving}
              >
                <Trash2 size={14} />
              </button>
            </motion.div>
          ))
        )}
      </div>

      {/* Info Footer */}
      {activeLimitations.length > 0 && (
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <AlertCircle size={12} />
          伤病限制会自动影响训练计划生成
        </p>
      )}
    </div>
  );
};
