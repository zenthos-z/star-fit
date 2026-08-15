import React from 'react';
import { Activity } from 'lucide-react';
import { TagInput } from '../../ui/TagInput';

interface PhysioSectionProps {
  basicInfo: any;
  setBasicInfo: (data: any) => void;
  fitnessLevel: string;
  setFitnessLevel: (level: string) => void;
  redFlags: string[];
  setRedFlags: (flags: string[]) => void;
}

export const PhysioSection: React.FC<PhysioSectionProps> = ({
  basicInfo, setBasicInfo, fitnessLevel, setFitnessLevel, redFlags, setRedFlags
}) => {
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <section className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Activity className="text-blue-600" size={20} />
        体能状态
      </h3>

      {/* 基础指标 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: '年龄', key: 'age', type: 'number' },
          { label: '身高 (cm)', key: 'height', type: 'number' },
          { label: '体重 (kg)', key: 'weight', type: 'number' },
          { label: '体脂率 (%)', key: 'body_fat', type: 'number' },
          { label: '训练龄 (月)', key: 'training_age', type: 'number' },
        ].map(field => (
          <div key={field.key}>
            <label className={labelClass}>{field.label}</label>
            <input
              type={field.type}
              value={basicInfo?.[field.key] || ''}
              onChange={(e) => setBasicInfo({
                ...basicInfo,
                [field.key]: e.target.value ? parseFloat(e.target.value) : undefined
              })}
              className={inputClass}
            />
          </div>
        ))}
      </div>

      {/* 健康状态和伤病记录 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className={labelClass}>健康状态</label>
          <select
            value={fitnessLevel}
            onChange={(e) => setFitnessLevel(e.target.value)}
            className={inputClass}
          >
            <option value="beginner">初级</option>
            <option value="intermediate">中级</option>
            <option value="advanced">高级</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>伤病记录</label>
          <TagInput
            value={redFlags}
            onChange={setRedFlags as any}
            placeholder="添加伤病记录"
            // TS2322: className is not a declared prop on TagInput; cast through any
          /> as any
        </div>
      </div>
    </section>
  );
};
