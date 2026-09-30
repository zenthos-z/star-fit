/**
 * StandardCard —— 通用数据展示卡（占位渲染面）
 *
 * 原为 ExerciseRenderer 内联组件（#88 分册3 迁出为注册组件）。注册于：
 *   - stretch_standard（柔韧拉伸占位卡——规范卡未定义，走默认模板，
 *     docs/card-spec/fine/flexibility.md「未定义≠不能跑」）
 *   - skeleton / unknown（协议 UIHint 枚举内的占位哨兵键）
 *
 * 注意：它**不是**未注册 cardType 的兜底——分册3 起未注册 = 显式错误卡
 * （ExerciseRenderer，红线2 不兜底）。本卡只渲染显式注册到它名下的键。
 */
import React from 'react';
import { ExerciseAction } from '../../../types/protocol';
import { Attachment } from '../FloatingAttachment';

export interface StandardCardProps {
  exercise: ExerciseAction;
  uiHint?: any;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
  onConfirm?: (payload: any) => void;
  addAttachment?: (attachment: Omit<Attachment, 'id' | 'timestamp'>) => void;
}

/**
 * Generic/Standard Card
 * [FIX] 去掉冗余的兜底展示，直接渲染实际内容或错误信息
 */
export const StandardCard: React.FC<StandardCardProps> = ({ exercise, uiHint }) => {
  // 优先展示 uiHint 中的原始数据，而不是兜底信息
  const displayData = uiHint?.data || exercise;

  return (
    <div className="p-4 border rounded-2xl shadow-sm bg-gray-50 border-gray-200">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-lg text-gray-700">{exercise.exerciseId}</h3>
        <span className="text-xs text-gray-400 uppercase font-bold tracking-widest">{exercise.type}</span>
      </div>
      <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-100 p-3 rounded-lg overflow-auto max-h-60">
        {JSON.stringify(displayData, null, 2)}
      </pre>
    </div>
  );
};
