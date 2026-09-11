import React, { useState } from 'react';
import { getExerciseTypeLabel } from '../../../../utils/exerciseTypeLabels';
import { ChatCardHeader } from './ChatCardHeader';
import { ChatCardShell, ChatPrimaryButton, ChatSecondaryButton } from './ChatCardShell';

interface PlanCardProps {
  uiHint: {
    type: 'plan_card';
    data: any[];
    context?: 'post_finish' | 'default';
    diff?: {
      added: string[];
      modified: string[];
    };
  };
  onConfirm?: (payload: { mode: 'append' | 'replace'; plan: any[] }) => void;
}

/**
 * PlanCard (PLAN_CARD) - Training Plan Proposer
 *
 * Implements "Coach Authority" principle. Displays incremental or full plans
 * with Diff highlighting. Supports Overwrite and Append modes.
 *
 * 2026-09-11 聊天卡片视觉统一：竖条装饰 → 空心小蓝圈（ChatCardHeader），
 * 圆角 40px → 24px，按钮斜体大写 → 胶囊 semibold。
 */
export const PlanCard: React.FC<PlanCardProps> = ({ uiHint, onConfirm }) => {
  // Defensive check for data
  const plan = Array.isArray(uiHint?.data) ? uiHint.data : [];
  const diff = uiHint?.diff || { added: [], modified: [] };
  const isPostFinish = uiHint?.context === 'post_finish';
  const [clickedMode, setClickedMode] = useState<'append' | 'replace' | null>(null);

  const handleClick = (mode: 'append' | 'replace') => {
    setClickedMode(mode);
    onConfirm?.({ mode, plan });
  };

  return (
    <ChatCardShell testId="plan-card">
      <ChatCardHeader
        title="建议训练计划"
        subtitle="根据您的训练数据智能生成"
      />

      <div className="p-5 space-y-3">
        {plan.map((item, idx) => {
          const isAdded = diff?.added?.includes(item?.exerciseId);
          const isModified = diff?.modified?.includes(item?.exerciseId);

          return (
            <div
              key={idx}
              className={`p-4 rounded-2xl border ${
                isAdded ? 'bg-emerald-50 border-emerald-100' :
                isModified ? 'bg-amber-50 border-amber-100' :
                'bg-gray-50 border-gray-100'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h4 className="font-semibold text-sm text-gray-900 tracking-tight truncate">
                    {item?.name || item?.exerciseId?.split('/').pop()?.replace(/_/g, ' ') || '未知动作'}
                  </h4>
                  {item?.exercise_type && (
                    <span className="text-[10px] px-2 py-0.5 bg-gray-50 text-gray-500 rounded-full font-medium border border-gray-100 shrink-0">
                      {getExerciseTypeLabel(item.exercise_type)}
                    </span>
                  )}
                </div>
                {isAdded && (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500 text-white rounded-full font-semibold shrink-0">新增</span>
                )}
                {isModified && (
                  <span className="text-[10px] px-2 py-0.5 bg-amber-500 text-white rounded-full font-semibold shrink-0">已修改</span>
                )}
              </div>
              <div className="flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="text-gray-400 text-[11px]">组</span>
                  <span className="text-gray-900 font-semibold">{item?.sets || 0}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-gray-400 text-[11px]">次</span>
                  <span className="text-gray-900 font-semibold">{item?.reps || 0}</span>
                </span>
                {item?.weight && (
                  <span className="flex items-center gap-1">
                    <span className="text-gray-400 text-[11px]">kg</span>
                    <span className="text-gray-900 font-semibold">{item.weight}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-5 pt-0 flex gap-3">
        {isPostFinish ? (
          <ChatPrimaryButton
            className="flex-1"
            onClick={() => handleClick('replace')}
            disabled={!!clickedMode}
          >
            {clickedMode ? '已添加' : '明日训练'}
          </ChatPrimaryButton>
        ) : (
          <>
            <ChatPrimaryButton
              className="flex-1"
              onClick={() => handleClick('replace')}
              disabled={!!clickedMode}
            >
              {clickedMode === 'replace' ? '已添加' : '完全覆盖'}
            </ChatPrimaryButton>
            <ChatSecondaryButton
              className="flex-1"
              onClick={() => handleClick('append')}
              disabled={!!clickedMode}
            >
              {clickedMode === 'append' ? '已添加' : '追加到末尾'}
            </ChatSecondaryButton>
          </>
        )}
      </div>
    </ChatCardShell>
  );
};
