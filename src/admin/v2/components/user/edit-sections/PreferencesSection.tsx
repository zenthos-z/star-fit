import React from 'react';
import { Settings } from 'lucide-react';
import { TagInput } from '../../ui/TagInput';

interface PreferencesSectionProps {
  preferences: any;
  setPreferences: (data: any) => void;
}

export const PreferencesSection: React.FC<PreferencesSectionProps> = ({
  preferences, setPreferences
}) => {
  const inputClass = "w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <section className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Settings className="text-orange-500" size={20} />
        偏好设置
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className={labelClass}>目标</label>
          <input
            type="text"
            value={preferences?.goal || ''}
            onChange={(e) => setPreferences({
              ...preferences,
              goal: e.target.value || undefined
            })}
            className={inputClass}
            placeholder="训练目标"
          />
        </div>

        <div>
          <label className={labelClass}>时长 (分钟)</label>
          <input
            type="number"
            value={preferences?.duration || ''}
            onChange={(e) => setPreferences({
              ...preferences,
              duration: parseInt(e.target.value) || undefined
            })}
            className={inputClass}
            placeholder="训练时长"
          />
        </div>

        <div>
          <label className={labelClass}>设备</label>
          <TagInput
            value={preferences?.equipment || []}
            onChange={(tags) => setPreferences({ ...preferences, equipment: tags })}
            placeholder="添加设备"
            className="bg-white border-gray-300 text-gray-900"
            {...{} as any}
          />
        </div>

        <div>
          <label className={labelClass}>避免动作</label>
          <TagInput
            value={preferences?.avoid_exercises || []}
            onChange={(tags) => setPreferences({ ...preferences, avoid_exercises: tags })}
            placeholder="添加避免动作"
            className="bg-white border-gray-300 text-gray-900"
            {...{} as any}
          />
        </div>
      </div>
    </section>
  );
};
