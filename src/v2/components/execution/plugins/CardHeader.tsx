import React from 'react';
import { getExerciseTypeLabel } from '../../../../utils/exerciseTypeLabels';

interface CardHeaderProps {
  /** 动作名称 */
  name: string;
  /** exercise type，驱动右侧类型标签文案 */
  type: string;
  /** 标题右侧的自定义附加区（如 GPS ACTIVE 徽标），位于类型标签之后 */
  rightExtra?: React.ReactNode;
  /** 底部外边距，跟随各卡片的既有节奏（mb-6/mb-8/mb-10） */
  className?: string;
}

/**
 * ExerciseCard 系列共用头部（用户拍板 2026-09-09）：
 * - 左侧：小蓝圈标识 + 动作名（历经 竖条→SF图标→蓝点→蓝圈，最终定稿空心蓝圈，无辉光）
 * - 右侧：灰色文字 + 灰底的类型标签，可附加自定义徽标
 * 五张卡片插件（Resistance/Running/Isometric/Cardio/Outdoor）统一接入。
 */
export const CardHeader: React.FC<CardHeaderProps> = ({ name, type, rightExtra, className = 'mb-10' }) => {
  return (
    <div className={`flex justify-between items-center ${className}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-2 h-2 rounded-full border-2 border-blue-500 shrink-0" aria-hidden="true" />
        <h3 className="text-xl font-black text-gray-900 tracking-tight truncate">{name}</h3>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="flex items-center gap-1 text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded-2xl font-bold uppercase tracking-widest border border-gray-100">
          {getExerciseTypeLabel(type)}
        </span>
        {rightExtra}
      </div>
    </div>
  );
};
