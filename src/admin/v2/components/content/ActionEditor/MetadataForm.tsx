import React, { useState } from 'react';
import { Badge } from '../../ui/Badge';
import { Exercise } from '../../../services/types';
import { Upload, ImageIcon, Plus, Settings2 } from 'lucide-react';
import { API_BASE } from '../../../services/geminiService';
import { MuscleSelectorDialog, MuscleTarget } from './MuscleSelectorDialog';
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_CATEGORIES,
  EXERCISE_BODY_PARTS,
  EQUIPMENT_LABELS_ZH,
  CATEGORY_LABELS_ZH,
  BODY_PART_LABELS_ZH,
} from 'shared/contracts';

interface MetadataFormProps {
  data: Partial<Exercise>;
  onChange: (data: Partial<Exercise>) => void;
  onCoverUpload: (file: File) => Promise<string>;
}

export const MetadataForm: React.FC<MetadataFormProps> = ({
  data,
  onChange,
  onCoverUpload
}) => {
  const [showPrimarySelector, setShowPrimarySelector] = useState(false);
  const [showSecondarySelector, setShowSecondarySelector] = useState(false);

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const assets = (() => {
    try {
      if (!data.assets_json) return {};
      if (typeof data.assets_json === 'string') {
        const parsed = JSON.parse(data.assets_json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return parsed;
      }
      if (typeof data.assets_json === 'object' && !Array.isArray(data.assets_json)) return data.assets_json as any;
      return {};
    } catch {
      return {};
    }
  })();

  const targets = (() => {
    const fallback = { primary: [] as MuscleTarget[], secondary: [] as MuscleTarget[] };
    try {
      if (!data.targets) return fallback;
      const parsed = typeof data.targets === 'string' ? JSON.parse(data.targets) : data.targets;
      return {
        primary: Array.isArray(parsed.primary) ? parsed.primary : [],
        secondary: Array.isArray(parsed.secondary) ? parsed.secondary : [],
      };
    } catch {
      return fallback;
    }
  })();

  const equipment = data.equipment ?? null;

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = await onCoverUpload(file);
      onChange({
        assets_json: JSON.stringify({ ...assets, cover: url })
      });
    }
  };

  const saveTargets = (primary: MuscleTarget[], secondary: MuscleTarget[]) => {
    const newTargets = {
      primary,
      ...(secondary.length > 0 && { secondary })
    };
    onChange({ targets: JSON.stringify(newTargets) });
  };

  const removeTarget = (muscle: MuscleTarget, type: 'primary' | 'secondary') => {
    const newPrimary = type === 'primary' ? targets.primary.filter(m => m !== muscle) : targets.primary;
    const newSecondary = type === 'secondary' ? targets.secondary.filter(m => m !== muscle) : targets.secondary;
    saveTargets(newPrimary, newSecondary);
  };

  return (
    <div className="space-y-6" data-testid="admin-metadata-form">
      {/* Cover Image */}
      <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden relative group border border-gray-200">
        {assets.cover ? (
          <img src={getFullUrl(String(assets.cover))} alt="Cover" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <ImageIcon size={32} />
            <span className="text-xs mt-2">暂无封面</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <label className="cursor-pointer bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded text-xs text-white backdrop-blur flex items-center gap-2">
            <Upload size={12} />
            <span>更换封面</span>
            <input
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleCoverChange}
              data-testid="admin-cover-upload"
            />
          </label>
        </div>
      </div>

      {/* Basic Info */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">动作名称</label>
          <input
            type="text"
            value={data.name || ''}
            onChange={e => onChange({ name: e.target.value })}
            data-testid="admin-exercise-name"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-star-accent/20 focus:border-star-accent outline-none"
            placeholder="例如：Barbell Bench Press（库名唯一，英文为主）"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">中文名称</label>
          <input
            type="text"
            value={data.name_zh || ''}
            onChange={e => onChange({ name_zh: e.target.value || null })}
            data-testid="admin-exercise-name-zh"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-star-accent/20 focus:border-star-accent outline-none"
            placeholder="例如：杠铃卧推"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">动作类型</label>
            <select
              value={data.exercise_type || 'resistance'}
              onChange={e => onChange({ exercise_type: e.target.value })}
              data-testid="admin-exercise-type"
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none"
            >
              <option value="resistance">常规负重</option>
              <option value="unilateral">单侧训练</option>
              <option value="bodyweight">自重训练</option>
              <option value="assisted">辅助器械</option>
              <option value="isometric">静力/等长</option>
              <option value="cardio">有氧运动</option>
              <option value="flexibility">柔韧性训练</option>
              <option value="heavy_weight">大重量/举次</option>
              <option value="rep_training">次数训练</option>
              <option value="outdoor">户外运动</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">难度等级</label>
            <div className="flex gap-2">
              {['beginner', 'intermediate', 'advanced'].map((level) => (
                <button
                  key={level}
                  onClick={() => onChange({ difficulty: level as any })}
                  data-testid={`admin-difficulty-${level}`}
                  className={`flex-1 py-1.5 text-xs rounded-md border transition-all ${data.difficulty === level
                    ? 'bg-star-accent/10 border-star-accent text-star-accent font-medium'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                >
                  {level === 'beginner' ? '初级' : level === 'intermediate' ? '中级' : '高级'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">训练类目</label>
            <select
              value={data.category || ''}
              onChange={e => onChange({ category: (e.target.value || null) as any })}
              data-testid="admin-exercise-category"
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none"
            >
              <option value="">未分类</option>
              {EXERCISE_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS_ZH[cat]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">身体区域</label>
            <select
              value={data.body_part || ''}
              onChange={e => onChange({ body_part: (e.target.value || null) as any })}
              data-testid="admin-exercise-body-part"
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none"
            >
              <option value="">未知</option>
              {EXERCISE_BODY_PARTS.map(bp => (
                <option key={bp} value={bp}>{BODY_PART_LABELS_ZH[bp]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Targets Section */}
      <div className="space-y-4 pt-4 border-t border-gray-100">
        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">训练目标 (Targets)</h3>

        {/* Primary Targets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-gray-500 uppercase">主要肌群</label>
            <button
              onClick={() => setShowPrimarySelector(true)}
              className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              <Settings2 size={10} />
              管理
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[32px]">
            {targets.primary.length > 0 ? (
              targets.primary.map(m => (
                <Badge
                  key={m}
                  variant="default"
                  className="rounded-xl px-3 py-1 bg-blue-600 text-white border-none text-[10px] font-bold"
                  onRemove={() => removeTarget(m, 'primary')}
                >
                  {m}
                </Badge>
              ))
            ) : (
              <span className="text-[10px] text-gray-400 italic">尚无主要肌群</span>
            )}
          </div>
        </div>

        {/* Secondary Targets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-gray-500 uppercase">次要肌群</label>
            <button
              onClick={() => setShowSecondarySelector(true)}
              className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              <Settings2 size={10} />
              管理
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[32px]">
            {targets.secondary.length > 0 ? (
              targets.secondary.map(m => (
                <Badge
                  key={m}
                  variant="info"
                  className="rounded-xl px-3 py-1 bg-blue-50 text-blue-600 border-blue-100 text-[10px] font-bold"
                  onRemove={() => removeTarget(m, 'secondary')}
                >
                  {m}
                </Badge>
              ))
            ) : (
              <span className="text-[10px] text-gray-400 italic">尚无次要肌群</span>
            )}
          </div>
        </div>
      </div>

      {/* Equipment — 枚举选择器（#171 P0-2）：选项 = exercise_equipment 15 英文枚举值
          （真源 shared/contracts EXERCISE_EQUIPMENT），展示中文经 EQUIPMENT_LABELS_ZH；
          中文自由标签不可写 PG 枚举列，故不再提供自由输入 */}
      <div className="space-y-4 pt-4 border-t border-gray-100">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">所需器械</label>
          <div className="flex flex-wrap gap-2" data-testid="admin-equipment">
            {EXERCISE_EQUIPMENT.map(eq => (
              <button
                key={eq}
                type="button"
                onClick={() => onChange({ equipment: equipment === eq ? null : eq })}
                data-testid={`admin-equipment-${eq}`}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${equipment === eq
                  ? 'bg-star-accent/10 border-star-accent text-star-accent font-medium'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
              >
                {EQUIPMENT_LABELS_ZH[eq]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selectors */}
      <MuscleSelectorDialog
        isOpen={showPrimarySelector}
        onClose={() => setShowPrimarySelector(false)}
        title="主要肌群选择"
        subtitle="选择该动作主要训练的肌肉部位"
        selected={targets.primary}
        disabledMuscles={targets.secondary}
        onConfirm={(muscles) => saveTargets(muscles, targets.secondary)}
      />

      <MuscleSelectorDialog
        isOpen={showSecondarySelector}
        onClose={() => setShowSecondarySelector(false)}
        title="次要肌群选择"
        subtitle="选择该动辅助训练的肌肉部位"
        selected={targets.secondary}
        disabledMuscles={targets.primary}
        onConfirm={(muscles) => saveTargets(targets.primary, muscles)}
      />
    </div>
  );
};
