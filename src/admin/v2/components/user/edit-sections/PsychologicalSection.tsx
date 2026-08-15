import React from 'react';
import { Brain } from 'lucide-react';

interface PsychologicalSectionProps {
  psychological: any;
  setPsychological: (data: any) => void;
}

export const PsychologicalSection: React.FC<PsychologicalSectionProps> = ({
  psychological, setPsychological
}) => {
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-star-accent focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <section className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Brain className="text-green-500" size={20} />
        心理画像
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>神经类型</label>
          <input
            type="text"
            value={psychological?.neurotype || ''}
            onChange={(e) => setPsychological({
              ...psychological,
              neurotype: e.target.value || undefined
            })}
            className={inputClass}
            placeholder="如: Type 1A"
          />
        </div>

        <div>
          <label className={labelClass}>责任感</label>
          <select
            value={psychological?.accountability || ''}
            onChange={(e) => setPsychological({
              ...psychological,
              accountability: e.target.value || undefined
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
          <label className={labelClass}>风险偏好</label>
          <select
            value={psychological?.risk_preference || ''}
            onChange={(e) => setPsychological({
              ...psychological,
              risk_preference: e.target.value || undefined
            })}
            className={inputClass}
          >
            <option value="">未知</option>
            <option value="conservative">保守</option>
            <option value="moderate">适中</option>
            <option value="aggressive">激进</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>训练目标</label>
          <input
            type="text"
            value={psychological?.training_goal || ''}
            onChange={(e) => setPsychological({
              ...psychological,
              training_goal: e.target.value || undefined
            })}
            className={inputClass}
            placeholder="如: 增肌、减脂、提升力量"
          />
        </div>

        <div>
          <label className={labelClass}>训练设备</label>
          <input
            type="text"
            value={psychological?.equipment || ''}
            onChange={(e) => setPsychological({
              ...psychological,
              equipment: e.target.value || undefined
            })}
            className={inputClass}
            placeholder="如: 哑铃、杠铃"
          />
        </div>

        <div>
          <label className={labelClass}>训练频率</label>
          <input
            type="text"
            value={psychological?.training_frequency || ''}
            onChange={(e) => setPsychological({
              ...psychological,
              training_frequency: e.target.value || undefined
            })}
            className={inputClass}
            placeholder="如: 每周3-4次"
          />
        </div>
      </div>
    </section>
  );
};
