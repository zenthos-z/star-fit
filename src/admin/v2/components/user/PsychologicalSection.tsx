/**
 * Psychological Profile Section Component (Enhanced)
 *
 * Displays user's psychological characteristics with enhanced visual design:
 * - Neurotype with detailed descriptions
 * - Accountability and risk preference with visual indicators
 * - Training goals and equipment with better presentation
 * - Avoid exercises with tags
 *
 * @module PsychologicalSection
 */

import React from 'react';
import { Brain, Flame, Scale, Shield, Dumbbell, Footprints, Zap, Activity, AlertTriangle, HelpCircle, Stethoscope } from 'lucide-react';

interface PsychologicalSectionProps {
  psychological: {
    neurotype?: string;
    accountability?: string;
    risk_preference?: string;
  };
  preferences: {
    goal?: string;
    equipment?: string[];
    frequency?: string;
    avoid_exercises?: string[];
  };
}

export const PsychologicalSection: React.FC<PsychologicalSectionProps> = ({
  psychological,
  preferences
}) => {
  const getNeurotypeInfo = (neurotype?: string) => {
    const info: Record<string, { label: string; desc: string; color: string }> = {
      '1A': { label: '1A - 精确型', desc: '追求完美，注重技术细节', color: 'bg-blue-100 text-blue-700 border-blue-200' },
      '1B': { label: '1B - 敏感型', desc: '情感丰富，需要鼓励', color: 'bg-purple-100 text-purple-700 border-purple-200' },
      '2A': { label: '2A - 激进型', desc: '竞争性强，追求突破', color: 'bg-red-100 text-red-700 border-red-200' },
      '2B': { label: '2B - 稳健型', desc: '稳健踏实，循序渐进', color: 'bg-green-100 text-green-700 border-green-200' },
      '3A': { label: '3A - 社交型', desc: '喜欢团队训练', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
      '3B': { label: '3B - 独立型', desc: '偏好独自训练', color: 'bg-gray-100 text-gray-700 border-gray-200' }
    };
    return info[neurotype || ''] || { label: '未设置', desc: '请设置神经类型', color: 'bg-gray-100 text-gray-500 border-gray-200' };
  };

  const getAccountabilityConfig = (level?: string) => {
    const config: Record<string, { label: string; color: string; bars: number }> = {
      'high': { label: '高', color: 'bg-green-500', bars: 3 },
      'medium': { label: '中', color: 'bg-yellow-500', bars: 2 },
      'low': { label: '低', color: 'bg-gray-400', bars: 1 }
    };
    return config[level || ''] || config['medium'];
  };

  const getRiskConfig = (risk?: string) => {
    const config: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
      'aggressive': { label: '激进', color: 'bg-red-100 text-red-700', Icon: Flame },
      'moderate': { label: '中等', color: 'bg-yellow-100 text-yellow-700', Icon: Scale },
      'conservative': { label: '保守', color: 'bg-blue-100 text-blue-700', Icon: Shield }
    };
    return config[risk || ''] || { ...config['moderate'], Icon: Scale };
  };

  const getGoalInfo = (goal?: string) => {
    const info: Record<string, { label: string; Icon: React.ElementType; color: string }> = {
      'muscle_gain': { label: '增肌', Icon: Dumbbell, color: 'bg-red-50 text-red-700' },
      'fat_loss': { label: '减脂', Icon: Flame, color: 'bg-orange-50 text-orange-700' },
      'strength': { label: '力量', Icon: Dumbbell, color: 'bg-blue-50 text-blue-700' },
      'endurance': { label: '耐力', Icon: Footprints, color: 'bg-green-50 text-green-700' },
      'general_fitness': { label: '健身', Icon: Activity, color: 'bg-purple-50 text-purple-700' },
      'rehabilitation': { label: '康复', Icon: Stethoscope, color: 'bg-teal-50 text-teal-700' }
    };
    return info[goal || ''] || { label: '未设置', Icon: HelpCircle, color: 'bg-gray-50 text-gray-600' };
  };

  const getEquipmentInfo = (equipment?: string[]) => {
    if (!equipment || equipment.length === 0) {
      return { label: '无设备', count: 0, color: 'bg-gray-100 text-gray-600' };
    }

    if (equipment.length >= 8) {
      return { label: '完整健身房', count: equipment.length, color: 'bg-green-100 text-green-700' };
    }
    if (equipment.length >= 5) {
      return { label: '丰富器械', count: equipment.length, color: 'bg-blue-100 text-blue-700' };
    }
    if (equipment.length >= 3) {
      return { label: '基础器械', count: equipment.length, color: 'bg-yellow-100 text-yellow-700' };
    }
    return { label: '少量器械', count: equipment.length, color: 'bg-gray-100 text-gray-700' };
  };

  const neurotypeInfo = getNeurotypeInfo(psychological.neurotype);
  const accountabilityConfig = getAccountabilityConfig(psychological.accountability);
  const riskConfig = getRiskConfig(psychological.risk_preference);
  const goalInfo = getGoalInfo(preferences.goal);
  const equipmentInfo = getEquipmentInfo(preferences.equipment);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="psychological-section">
      {/* Section Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Brain size={16} />
          <span>心理画像</span>
        </h3>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Neurotype Card */}
        {psychological.neurotype && (
          <div className={`p-3 rounded-lg border ${neurotypeInfo.color}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium opacity-75">神经类型</span>
              <span className="text-xs">MBTI</span>
            </div>
            <div className="font-semibold mb-1">{neurotypeInfo.label}</div>
            <div className="text-xs opacity-75">{neurotypeInfo.desc}</div>
          </div>
        )}

        {/* Traits Row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Accountability */}
          {psychological.accountability && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-2">责任感</div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${accountabilityConfig.color} text-white`}>
                  {accountabilityConfig.label}
                </span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${
                      i <= accountabilityConfig.bars ? accountabilityConfig.color : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Risk Preference */}
          {psychological.risk_preference && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-2">风险偏好</div>
              <div className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${riskConfig.color}`}>
                <riskConfig.Icon size={14} />
                <span>{riskConfig.label}</span>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100" />

        {/* Goals & Equipment */}
        <div className="space-y-3">
          {/* Training Goal */}
          {preferences.goal && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">训练目标</span>
              <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${goalInfo.color}`}>
                <goalInfo.Icon size={14} />
                <span>{goalInfo.label}</span>
              </span>
            </div>
          )}

          {/* Equipment */}
          {preferences.equipment && preferences.equipment.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">可用设备</span>
              <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${equipmentInfo.color}`}>
                <span>{equipmentInfo.label}</span>
                <span className="opacity-75">({equipmentInfo.count})</span>
              </span>
            </div>
          )}

          {/* Training Frequency */}
          {preferences.frequency && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">训练频率</span>
              <span className="text-sm font-medium text-gray-900 bg-gray-100 px-3 py-1.5 rounded-lg">
                {preferences.frequency}
              </span>
            </div>
          )}
        </div>

        {/* Avoid Exercises */}
        {preferences.avoid_exercises && preferences.avoid_exercises.length > 0 && (
          <>
            <div className="border-t border-gray-100" />
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                <AlertTriangle size={14} />
                <span>避免动作 ({preferences.avoid_exercises.length})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {preferences.avoid_exercises.map((exercise, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs border border-orange-200"
                  >
                    {exercise}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
