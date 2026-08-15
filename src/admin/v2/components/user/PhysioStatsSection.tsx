/**
 * Physiological Stats Section Component (Enhanced)
 *
 * Displays user's basic physical information with enhanced visual design:
 * - Height, weight, body fat percentage, BMI calculation
 * - Age, training age with visual progress
 * - Health status indicator with color coding
 * - Injury records with management
 *
 * @module PhysioStatsSection
 */

import React from 'react';
import { Activity, Award, Stethoscope } from 'lucide-react';

interface PhysioStatsSectionProps {
  basicInfo: {
    height?: number;
    weight?: number;
    body_fat?: number;
    age?: number;
    training_age?: number;
    injuries?: string[];
    health_status?: '良好' | '有伤' | '需注意';
  };
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced';
}

export const PhysioStatsSection: React.FC<PhysioStatsSectionProps> = ({
  basicInfo,
  fitnessLevel
}) => {
  // Calculate BMI if height and weight are available
  const calculateBMI = () => {
    if (!basicInfo.height || !basicInfo.weight) return null;
    const heightInMeters = basicInfo.height / 100;
    const bmi = basicInfo.weight / (heightInMeters * heightInMeters);
    return bmi.toFixed(1);
  };

  const getBMICategory = (bmi: number) => {
    if (bmi < 18.5) return { label: '偏瘦', color: 'text-blue-600' };
    if (bmi < 24) return { label: '正常', color: 'text-green-600' };
    if (bmi < 28) return { label: '超重', color: 'text-yellow-600' };
    return { label: '肥胖', color: 'text-red-600' };
  };

  const getHealthStatusStyle = (status?: string) => {
    switch (status) {
      case '良好': return 'bg-green-100 text-green-700 border-green-200';
      case '有伤': return 'bg-red-100 text-red-700 border-red-200';
      case '需注意': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getHealthStatusDotColor = (status?: string) => {
    switch (status) {
      case '良好': return 'bg-green-500';
      case '有伤': return 'bg-red-500';
      case '需注意': return 'bg-yellow-500';
      default: return 'bg-gray-400';
    }
  };

  const getFitnessLevelLabel = (level: string) => {
    switch (level) {
      case 'beginner': return '初级';
      case 'intermediate': return '中级';
      case 'advanced': return '高级';
      default: return '未知';
    }
  };

  const getFitnessLevelStyle = (level: string) => {
    switch (level) {
      case 'beginner': return 'bg-gradient-to-r from-blue-500 to-blue-600 text-white';
      case 'intermediate': return 'bg-gradient-to-r from-green-500 to-green-600 text-white';
      case 'advanced': return 'bg-gradient-to-r from-purple-500 to-purple-600 text-white';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const bmi = calculateBMI();
  const bmiCategory = bmi ? getBMICategory(parseFloat(bmi)) : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="physio-stats-section">
      {/* Section Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Activity size={16} />
          <span>体能状态</span>
        </h3>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Height */}
          {basicInfo.height && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">身高</div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-gray-900">{basicInfo.height}</span>
                <span className="text-sm text-gray-500">cm</span>
              </div>
            </div>
          )}

          {/* Weight */}
          {basicInfo.weight && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">体重</div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-gray-900">{basicInfo.weight}</span>
                <span className="text-sm text-gray-500">kg</span>
              </div>
            </div>
          )}

          {/* Body Fat */}
          {basicInfo.body_fat && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">体脂率</div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-gray-900">{basicInfo.body_fat}</span>
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
          )}

          {/* BMI */}
          {bmi && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">BMI</div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-gray-900">{bmi}</span>
                {bmiCategory && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${bmiCategory.color} bg-opacity-20`}>
                    {bmiCategory.label}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Secondary Stats */}
        <div className="space-y-3 mb-4">
          {/* Age */}
          {basicInfo.age && (
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">年龄</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{basicInfo.age}</span>
                <span className="text-xs text-gray-400">岁</span>
              </div>
            </div>
          )}

          {/* Training Age */}
          {basicInfo.training_age && (
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">训练龄</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{basicInfo.training_age}</span>
                <span className="text-xs text-gray-400">个月</span>
              </div>
            </div>
          )}

          {/* Health Status */}
          {basicInfo.health_status && (
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-600">健康状态</span>
              <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getHealthStatusStyle(basicInfo.health_status)} flex items-center gap-1.5`}>
                <div className={`w-2 h-2 rounded-full ${getHealthStatusDotColor(basicInfo.health_status)}`} />
                {basicInfo.health_status}
              </span>
            </div>
          )}
        </div>

        {/* Fitness Level Badge */}
        <div className="pt-3 border-t border-gray-100">
          <div className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium gap-2 ${getFitnessLevelStyle(fitnessLevel)}`}>
            <Award size={16} />
            {getFitnessLevelLabel(fitnessLevel)}
          </div>
        </div>

        {/* Injuries Section */}
        {basicInfo.injuries && basicInfo.injuries.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <Stethoscope size={14} />
              <span>伤病记录 ({basicInfo.injuries.length})</span>
            </div>
            <div className="space-y-2">
              {basicInfo.injuries.map((injury, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-100"
                >
                  <span className="text-red-600 mt-0.5">•</span>
                  <span className="text-xs text-red-700 flex-1">{injury}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
