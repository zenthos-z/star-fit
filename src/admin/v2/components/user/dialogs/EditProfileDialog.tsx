/**
 * EditProfileDialog - 用户画像编辑对话框
 *
 * 功能：编辑用户基本信息、生理状态、心理状态
 * 遵循数据契约：所有类型从 shared/contracts 导入
 *
 * @module EditProfileDialog
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Heart, Brain, Save, Loader2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import type { ProfileStatic, BasicInfo, Physiological, Psychological } from 'shared/contracts';

interface EditProfileDialogProps {
  userId: string;
  profile: {
    basic_info?: BasicInfo;
    physiological?: Physiological;
    psychological?: Psychological;
    fitness_level?: string;
  };
  onSave: (data: {
    basic_info: BasicInfo;
    physiological: Physiological;
    psychological: Psychological;
    fitness_level: string;
  }) => Promise<void>;
  onClose: () => void;
}

type TabType = 'basic' | 'physiological' | 'psychological';

const tabs = [
  { id: 'basic' as TabType, label: '基本信息', icon: User },
  { id: 'physiological' as TabType, label: '生理状态', icon: Heart },
  { id: 'psychological' as TabType, label: '心理状态', icon: Brain },
];

const fitnessLevels = [
  { value: 'beginner', label: '初学者' },
  { value: 'intermediate', label: '中级' },
  { value: 'advanced', label: '高级' },
];

const neuroTypes = [
  { value: '', label: '未知' },
  { value: 'type_1', label: 'Type 1 (耐力型)' },
  { value: 'type_2a', label: 'Type 2A (平衡型)' },
  { value: 'type_2b', label: 'Type 2B (爆发型)' },
  { value: 'type_3', label: 'Type 3 (技巧型)' },
];

const riskPreferences = [
  { value: '', label: '未知' },
  { value: 'conservative', label: '保守' },
  { value: 'moderate', label: '适中' },
  { value: 'aggressive', label: '激进' },
];

const accountabilityLevels = [
  { value: '', label: '未知' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const stressLevels = [
  { value: '', label: '未知' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const cyclePhases = [
  { value: '', label: '未知' },
  { value: 'follicular', label: '卵泡期' },
  { value: 'ovulation', label: '排卵期' },
  { value: 'luteal', label: '黄体期' },
  { value: 'menstrual', label: '月经期' },
];

export const EditProfileDialog: React.FC<EditProfileDialogProps> = ({
  userId,
  profile,
  onSave,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [saving, setSaving] = useState(false);

  // Form state
  const [basicInfo, setBasicInfo] = useState<BasicInfo>({
    age: undefined,
    weight: undefined,
    height: undefined,
    body_fat: undefined,
    training_age: undefined,
  });

  const [physiological, setPhysiological] = useState<Physiological>({
    sleep_hours: undefined,
    stress_level: undefined,
    cycle_focus: undefined,
  });

  const [psychological, setPsychological] = useState<Psychological>({
    neurotype: undefined,
    accountability: undefined,
    risk_preference: undefined,
  });

  const [fitnessLevel, setFitnessLevel] = useState('beginner');

  // Initialize form data from profile
  useEffect(() => {
    if (profile) {
      setBasicInfo({
        age: profile.basic_info?.age,
        weight: profile.basic_info?.weight,
        height: profile.basic_info?.height,
        body_fat: profile.basic_info?.body_fat,
        training_age: profile.basic_info?.training_age,
      });
      setPhysiological({
        sleep_hours: profile.physiological?.sleep_hours,
        stress_level: profile.physiological?.stress_level,
        cycle_focus: profile.physiological?.cycle_focus,
      });
      setPsychological({
        neurotype: profile.psychological?.neurotype,
        accountability: profile.psychological?.accountability,
        risk_preference: profile.psychological?.risk_preference,
      });
      setFitnessLevel(profile.fitness_level || 'beginner');
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        basic_info: basicInfo,
        physiological,
        psychological,
        fitness_level: fitnessLevel,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-star-accent/20 focus:border-star-accent transition-all placeholder-gray-400 text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1.5";
  const selectClass = "w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-star-accent/20 focus:border-star-accent transition-all text-sm appearance-none cursor-pointer";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-900">编辑用户画像</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100 px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-star-accent text-star-accent'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'basic' && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-5"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>年龄</label>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      value={basicInfo.age || ''}
                      onChange={(e) => setBasicInfo({ ...basicInfo, age: e.target.value ? parseInt(e.target.value) : undefined })}
                      className={inputClass}
                      placeholder="岁"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>训练年限</label>
                    <input
                      type="number"
                      min={0}
                      value={basicInfo.training_age || ''}
                      onChange={(e) => setBasicInfo({ ...basicInfo, training_age: e.target.value ? parseInt(e.target.value) : undefined })}
                      className={inputClass}
                      placeholder="月"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>体重 (kg)</label>
                    <input
                      type="number"
                      step="0.1"
                      min={30}
                      max={200}
                      value={basicInfo.weight || ''}
                      onChange={(e) => setBasicInfo({ ...basicInfo, weight: e.target.value ? parseFloat(e.target.value) : undefined })}
                      className={inputClass}
                      placeholder="kg"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>身高 (cm)</label>
                    <input
                      type="number"
                      min={100}
                      max={250}
                      value={basicInfo.height || ''}
                      onChange={(e) => setBasicInfo({ ...basicInfo, height: e.target.value ? parseInt(e.target.value) : undefined })}
                      className={inputClass}
                      placeholder="cm"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>体脂率 (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={3}
                    max={50}
                    value={basicInfo.body_fat || ''}
                    onChange={(e) => setBasicInfo({ ...basicInfo, body_fat: e.target.value ? parseFloat(e.target.value) : undefined })}
                    className={inputClass}
                    placeholder="%"
                  />
                </div>

                <div>
                  <label className={labelClass}>健身水平</label>
                  <div className="flex gap-3">
                    {fitnessLevels.map((level) => (
                      <button
                        key={level.value}
                        onClick={() => setFitnessLevel(level.value)}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${
                          fitnessLevel === level.value
                            ? 'bg-star-accent text-white shadow-md'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'physiological' && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-5"
              >
                <div>
                  <label className={labelClass}>平均睡眠时长 (小时)</label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={24}
                    value={physiological.sleep_hours || ''}
                    onChange={(e) => setPhysiological({ ...physiological, sleep_hours: e.target.value ? parseFloat(e.target.value) : undefined })}
                    className={inputClass}
                    placeholder="小时"
                  />
                </div>

                <div>
                  <label className={labelClass}>压力水平</label>
                  <select
                    value={physiological.stress_level || ''}
                    onChange={(e) => setPhysiological({ ...physiological, stress_level: (e.target.value || undefined) as any })}
                    className={selectClass}
                  >
                    {stressLevels.map((level) => (
                      <option key={level.value} value={level.value}>{level.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>周期专注 (女性)</label>
                  <select
                    value={physiological.cycle_focus || ''}
                    onChange={(e) => setPhysiological({ ...physiological, cycle_focus: (e.target.value || undefined) as any })}
                    className={selectClass}
                  >
                    {cyclePhases.map((phase) => (
                      <option key={phase.value} value={phase.value}>{phase.label}</option>
                    ))}
                  </select>
                </div>
              </motion.div>
            )}

            {activeTab === 'psychological' && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-5"
              >
                <div>
                  <label className={labelClass}>神经类型</label>
                  <select
                    value={psychological.neurotype || ''}
                    onChange={(e) => setPsychological({ ...psychological, neurotype: e.target.value || undefined })}
                    className={selectClass}
                  >
                    {neuroTypes.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-gray-500">
                    神经类型影响训练节奏和恢复建议
                  </p>
                </div>

                <div>
                  <label className={labelClass}>风险偏好</label>
                  <select
                    value={psychological.risk_preference || ''}
                    onChange={(e) => setPsychological({ ...psychological, risk_preference: (e.target.value || undefined) as any })}
                    className={selectClass}
                  >
                    {riskPreferences.map((pref) => (
                      <option key={pref.value} value={pref.value}>{pref.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>自律程度</label>
                  <select
                    value={psychological.accountability || ''}
                    onChange={(e) => setPsychological({ ...psychological, accountability: (e.target.value || undefined) as any })}
                    className={selectClass}
                  >
                    {accountabilityLevels.map((level) => (
                      <option key={level.value} value={level.value}>{level.label}</option>
                    ))}
                  </select>
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              icon={saving ? undefined : <Save size={16} />}
            >
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
