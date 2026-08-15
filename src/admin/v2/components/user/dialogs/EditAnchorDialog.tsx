/**
 * Edit Anchor Dialog Component
 *
 * Dialog for adding or editing a load anchor (personal record).
 * Supports different anchor types: resistance, bodyweight, cardio, heart rate.
 *
 * @module EditAnchorDialog
 */

import React, { useState, useEffect } from 'react';
import { X, Lightbulb } from 'lucide-react';
import type { LoadAnchor } from 'shared/contracts';

interface EditAnchorDialogProps {
  anchorName: string;
  anchorData: LoadAnchor;
  existingNames: string[];
  onSave: (name: string, data: LoadAnchor) => void;
  onClose: () => void;
}

export const EditAnchorDialog: React.FC<EditAnchorDialogProps> = ({
  anchorName,
  anchorData,
  existingNames,
  onSave,
  onClose
}) => {
  const [anchorType, setAnchorType] = useState<'resistance' | 'bodyweight' | 'cardio' | 'heart_rate'>('resistance');
  const [name, setName] = useState('');
  const [est1rm, setEst1rm] = useState('');
  const [bestWeight, setBestWeight] = useState('');
  const [bestReps, setBestReps] = useState('');
  const [bestPaceMin, setBestPaceMin] = useState('');
  const [bestPaceSec, setBestPaceSec] = useState('');
  const [bestDistance, setBestDistance] = useState('');
  const [maxHr, setMaxHr] = useState('');
  const [restingHr, setRestingHr] = useState('');

  // Initialize form when editing (仅使用扁平格式 v3.0)
  useEffect(() => {
    if (anchorName) {
      setName(anchorName);

      // 检测扁平格式字段
      if (anchorData.best_weight !== undefined || anchorData.est_1rm !== undefined) {
        setAnchorType('resistance');
        setEst1rm(String(anchorData.est_1rm ?? ''));
        setBestWeight(String(anchorData.best_weight ?? ''));
        setBestReps(String(anchorData.best_reps ?? ''));
      } else if (anchorData.best_reps && !anchorData.best_weight && !anchorData.est_1rm) {
        // 有次数但无重量/1RM = 自重型
        setAnchorType('bodyweight');
        setBestReps(String(anchorData.best_reps));
      } else if (anchorData.best_pace) {
        setAnchorType('cardio');
        const pace = anchorData.best_pace;
        const mins = Math.floor(pace / 60);
        const secs = pace % 60;
        setBestPaceMin(String(mins));
        setBestPaceSec(String(secs));
        setBestDistance(String(anchorData.best_distance ?? ''));
      } else if (anchorData.max_hr || anchorData.resting_hr) {
        setAnchorType('heart_rate');
        setMaxHr(String(anchorData.max_hr ?? ''));
        setRestingHr(String(anchorData.resting_hr ?? ''));
      }
    } else {
      setEst1rm('');
      setBestWeight('');
      setBestReps('');
    }
  }, [anchorName, anchorData]);

  const handleSave = () => {
    if (!name.trim()) {
      alert('请输入动作名称');
      return;
    }

    const now = Date.now();
    let data: LoadAnchor = {
      last_updated: now  // MAS 数据契约: last_updated 必须在顶层
    };

    switch (anchorType) {
      case 'resistance':
        if (!est1rm || !bestWeight || !bestReps) {
          alert('请填写完整的力量型数据（1RM、最佳重量、最佳次数）');
          return;
        }
        // 使用扁平格式
        data.est_1rm = parseFloat(est1rm);
        data.best_weight = parseFloat(bestWeight);
        data.best_reps = parseInt(bestReps);
        break;

      case 'bodyweight':
        if (!bestReps) {
          alert('请填写自重次数');
          return;
        }
        // 使用扁平格式
        data.best_reps = parseInt(bestReps);
        data.progression_level = 1; // 默认进阶等级
        break;

      case 'cardio':
        if (!bestPaceMin || !bestPaceSec || !bestDistance) {
          alert('请填写完整的有氧数据（配速、距离）');
          return;
        }
        // 使用扁平格式
        const pace = parseInt(bestPaceMin) * 60 + parseInt(bestPaceSec);
        data.best_pace = pace;
        data.best_distance = parseInt(bestDistance);
        break;

      case 'heart_rate':
        if (!maxHr && !restingHr) {
          alert('请至少填写一项心率数据');
          return;
        }
        // 使用扁平格式
        if (maxHr) data.max_hr = parseInt(maxHr);
        if (restingHr) data.resting_hr = parseInt(restingHr);
        break;
    }

    onSave(name.trim(), data);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {anchorName ? '编辑负荷锚点' : '添加负荷锚点'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Exercise Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              动作名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：Barbell Bench Press"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
            />
          </div>

          {/* Anchor Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              锚点类型
            </label>
            <select
              value={anchorType}
              onChange={(e) => setAnchorType(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent bg-white"
            >
              <option value="resistance">力量型训练</option>
              <option value="bodyweight">自重型训练</option>
              <option value="cardio">有氧型训练</option>
              <option value="heart_rate">心率指标</option>
            </select>
          </div>

          {/* Type-specific fields */}
          {anchorType === 'resistance' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">1RM估算 (kg)</label>
                  <input
                    type="number"
                    value={est1rm}
                    onChange={(e) => setEst1rm(e.target.value)}
                    placeholder="80"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">最佳重量 (kg)</label>
                  <input
                    type="number"
                    value={bestWeight}
                    onChange={(e) => setBestWeight(e.target.value)}
                    placeholder="80"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">最佳次数</label>
                  <input
                    type="number"
                    value={bestReps}
                    onChange={(e) => setBestReps(e.target.value)}
                    placeholder="3"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Lightbulb size={12} className="text-amber-500" />
                <span>1RM 将根据最佳重量和次数自动计算</span>
              </div>
            </>
          )}

          {anchorType === 'bodyweight' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                最佳次数
              </label>
              <input
                type="number"
                value={bestReps}
                onChange={(e) => setBestReps(e.target.value)}
                placeholder="12"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
              />
            </div>
          )}

          {anchorType === 'cardio' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">配速 (分)</label>
                  <input
                    type="number"
                    value={bestPaceMin}
                    onChange={(e) => setBestPaceMin(e.target.value)}
                    placeholder="4"
                    min="0"
                    max="59"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">配速 (秒)</label>
                  <input
                    type="number"
                    value={bestPaceSec}
                    onChange={(e) => setBestPaceSec(e.target.value)}
                    placeholder="54"
                    min="0"
                    max="59"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                  />
                </div>
                <div className="flex items-end">
                  <span className="text-sm text-gray-500">/km</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  距离 (米)
                </label>
                <input
                  type="number"
                  value={bestDistance}
                  onChange={(e) => setBestDistance(e.target.value)}
                  placeholder="5000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Lightbulb size={12} className="text-amber-500" />
                <span>配速示例：4:54/km = 分:4 秒:54</span>
              </div>
            </div>
          )}

          {anchorType === 'heart_rate' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  最大心率 (bpm)
                </label>
                <input
                  type="number"
                  value={maxHr}
                  onChange={(e) => setMaxHr(e.target.value)}
                  placeholder="185"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  静息心率 (bpm)
                </label>
                <input
                  type="number"
                  value={restingHr}
                  onChange={(e) => setRestingHr(e.target.value)}
                  placeholder="58"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-star-accent hover:bg-star-accent/90 rounded-lg transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
