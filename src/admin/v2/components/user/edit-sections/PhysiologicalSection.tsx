import React from 'react';
import { Zap } from 'lucide-react';

interface PhysiologicalSectionProps {
  physiological: any;
  setPhysiological: (data: any) => void;
}

export const PhysiologicalSection: React.FC<PhysiologicalSectionProps> = ({
  physiological, setPhysiological
}) => {
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-star-accent focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <section className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Zap className="text-purple-500" size={20} />
        生理状态
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>睡眠时长 (平均)</label>
          <input
            type="number"
            step="0.1"
            value={physiological?.sleep_hours || ''}
            onChange={(e) => setPhysiological({
              ...physiological,
              sleep_hours: parseFloat(e.target.value) || undefined
            })}
            className={inputClass}
            placeholder="小时"
          />
        </div>

        <div>
          <label className={labelClass}>压力水平</label>
          <select
            value={physiological?.stress_level || ''}
            onChange={(e) => setPhysiological({
              ...physiological,
              stress_level: e.target.value || undefined
            })}
            className={inputClass}
          >
            <option value="">未知</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>周期专注</label>
          <select
            value={physiological?.cycle_focus || ''}
            onChange={(e) => setPhysiological({
              ...physiological,
              cycle_focus: e.target.value || undefined
            })}
            className={inputClass}
          >
            <option value="">未知</option>
            <option value="follicular">卵泡期</option>
            <option value="ovulation">排卵期</option>
            <option value="luteal">黄体期</option>
            <option value="menstrual">月经期</option>
          </select>
        </div>
      </div>
    </section>
  );
};
