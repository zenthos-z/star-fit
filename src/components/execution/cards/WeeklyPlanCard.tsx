/**
 * WeeklyPlanCard — 对话周计划卡（D2 / issue #9）。
 *
 * 走 uiHint 校验回路的新卡型 `weekly_plan`：AI 解释文字留在气泡正文，
 * 本卡是纯净周计划展示——7 天纵向数列 + 分化说明 + 休息日弱化，
 * 无进度/状态/执行率语义（issue #8 定稿）。
 * 点击训练日 → 当日详情子页（PlanDayDetailPage，与信息页共用）。
 *
 * 视觉同源（PR#17 返工）：直接复用聊天卡统一外壳 ChatCardShell /
 * ChatCardHeader（star-dark 头 + 蓝点标识 + gray-50 条目块 + star-accent
 * 交互），与 PlanCard 等八张既有卡片同一色板；排印按 iosTypeScale
 * （design-tokens.ts）。
 */
import React, { useState } from 'react';
import type { WeeklyPlanCardData } from 'shared/contracts';
import { ChatCardShell } from './ChatCardShell';
import { ChatCardHeader } from './ChatCardHeader';
import { haptic } from '../../../lib/nativeHaptics';
import {
  weeklyCardRows,
  dowFullLabel,
  exerciseNameLine,
  type PlanDayDetailVM,
} from '../../../utils/weeklyPlanView';
import { PlanDayDetailPage } from '../../info/PlanDayDetailPage';

export interface WeeklyPlanCardProps {
  uiHint: { type: string; data: WeeklyPlanCardData };
  onConfirm?: (payload: any) => void;
}

const ChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
  </svg>
);

export const WeeklyPlanCard: React.FC<WeeklyPlanCardProps> = ({ uiHint }) => {
  const data = uiHint.data;
  const rows = React.useMemo(() => weeklyCardRows(data), [data]);
  const [detail, setDetail] = useState<PlanDayDetailVM | null>(null);

  return (
    <>
      <ChatCardShell testId="weekly-plan-card">
        <ChatCardHeader
          title={`本周计划 · ${data.week_label}${data.phase_label ? ` · ${data.phase_label}` : ''}`}
          subtitle={data.split_summary}
        />

        {/* 7 天纵向数列：训练日可点进当日详情，休息日弱化灰行 */}
        <div className="flex flex-col gap-2 p-4">
          {rows.map((row) => {
            const dow = dowFullLabel(row.entryDate);
            if (row.rest) {
              return (
                <div key={row.entryDate} className="flex items-center gap-2.5 px-1 py-1.5">
                  <span className="w-9 shrink-0 text-[15px] font-normal text-gray-400">{dow}</span>
                  <span className="text-[13px] text-gray-400">休息恢复</span>
                </div>
              );
            }
            return (
              <button
                key={row.entryDate}
                type="button"
                role="button"
                aria-label={`查看${dow}详情`}
                onClick={() => {
                  haptic('light');
                  setDetail(row);
                }}
                className="flex w-full items-center gap-2.5 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-left transition-colors active:bg-gray-100"
              >
                <span className="w-9 shrink-0 text-[15px] font-semibold text-gray-900">{dow}</span>
                {row.splitTag && (
                  <span className="shrink-0 rounded-full border border-gray-100 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    {row.splitTag}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-gray-900">
                    {row.focus ?? `${exerciseNameLine(row.exercises)}，${row.exercises.length} 动作`}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-gray-500">
                    {exerciseNameLine(row.exercises)}
                  </span>
                </span>
                <span className="shrink-0 text-gray-300">
                  <ChevronRight />
                </span>
              </button>
            );
          })}
        </div>
      </ChatCardShell>

      {/* 当日详情子页：与信息页二级页共用（push 层 z-[130]，盖聊天浮层） */}
      <PlanDayDetailPage detail={detail} onClose={() => setDetail(null)} />
    </>
  );
};
