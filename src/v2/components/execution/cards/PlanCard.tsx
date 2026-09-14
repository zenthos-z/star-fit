import React from 'react';
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
    /** 消费状态（持久化在 ChatMessage.uiHint 上，重开对话不丢失） */
    consumed?: PlanConsumeRecord;
  };
  onConfirm?: (payload: { mode: 'append' | 'replace'; plan: any[] }) => void;
}

/**
 * 一次性消费记录：挂在消息的 uiHint 上随 thread 持久化。
 * targetDate = 锁定的目标日期（点击时刻的下一天，而非重开时的"明天"）。
 */
export interface PlanConsumeRecord {
  /** tomorrow = 存为未来某天的计划；session = 已加入当前训练会话 */
  kind: 'tomorrow' | 'session';
  mode: 'append' | 'replace';
  targetDate: string;   // yyyy-mm-dd（kind=tomorrow 时为锁定目标日；kind=session 为当天）
  consumedAt: number;   // epoch ms
  count: number;        // 导入动作数
}

/** yyyy-mm-dd（本地时区） */
export const planTargetDateLabel = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
};

/**
 * PlanCard (PLAN_CARD) - Training Plan Proposer
 *
 * 一次性消费语义（2026-09-14 拍板）：
 * - pending：按钮可点；消费后整卡折叠为摘要条，显示导入结果（目标日期 + 动作数）
 * - 训练结束后（post_finish）：「设为明日计划」+「追加到明日计划」双按钮
 *   （旧版只有硬编码 replace 的单按钮，append 无入口 → 用户报"无法追加到第二天"）
 * - 消费记录存 ChatMessage.uiHint.consumed，随 saveChatMessages 持久化，
 *   重开对话/切换会话不会重置回可点状态，杜绝重复消费导致的动作翻倍
 */
export const PlanCard: React.FC<PlanCardProps> = ({ uiHint, onConfirm }) => {
  // Defensive check for data
  const plan = Array.isArray(uiHint?.data) ? uiHint.data : [];
  const diff = uiHint?.diff || { added: [], modified: [] };
  const isPostFinish = uiHint?.context === 'post_finish';
  const consumed = uiHint?.consumed;

  if (consumed) {
    // 已消费：折叠为摘要条（用户拍板：自动折叠，不保留完整动作列表）
    const summaryLine = consumed.kind === 'tomorrow'
      ? `已保存为 ${planTargetDateLabel(consumed.targetDate)} 的训练计划`
      : '已加入当前训练';
    return (
      <ChatCardShell testId="plan-card-consumed">
        <div className="px-4 py-3.5 flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-gray-900 leading-snug">{summaryLine}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {consumed.mode === 'append' ? '追加' : '覆盖'} · {consumed.count} 个动作
            </p>
          </div>
        </div>
      </ChatCardShell>
    );
  }

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
                {item?.weight != null && item.weight !== 0 && (
                  <span className="flex items-center gap-1">
                    {item.exercise_type === 'assisted' ? (
                      // assisted 负值辅助重量：展示「辅助 20kg」，不露负号
                      <>
                        <span className="text-gray-400 text-[11px]">辅助</span>
                        <span className="text-gray-900 font-semibold">{Math.abs(item.weight)}kg</span>
                      </>
                    ) : (
                      <>
                        <span className="text-gray-400 text-[11px]">kg</span>
                        <span className="text-gray-900 font-semibold">{item.weight}</span>
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-5 pt-0 flex gap-3">
        {isPostFinish ? (
          <>
            <ChatPrimaryButton
              className="flex-1"
              onClick={() => onConfirm?.({ mode: 'replace', plan })}
            >
              设为明日计划
            </ChatPrimaryButton>
            <ChatSecondaryButton
              className="flex-1"
              onClick={() => onConfirm?.({ mode: 'append', plan })}
            >
              追加到明日
            </ChatSecondaryButton>
          </>
        ) : (
          <>
            <ChatPrimaryButton
              className="flex-1"
              onClick={() => onConfirm?.({ mode: 'replace', plan })}
            >
              完全覆盖
            </ChatPrimaryButton>
            <ChatSecondaryButton
              className="flex-1"
              onClick={() => onConfirm?.({ mode: 'append', plan })}
            >
              追加到末尾
            </ChatSecondaryButton>
          </>
        )}
      </div>
    </ChatCardShell>
  );
};
