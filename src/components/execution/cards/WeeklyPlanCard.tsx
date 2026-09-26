/**
 * WeeklyPlanCard — 对话周计划卡（D2 / issue #9）。
 *
 * 走 uiHint 校验回路的新卡型 `weekly_plan`：AI 解释文字留在气泡正文，
 * 本卡是纯净周计划展示——7 天纵向数列 + 分化说明 + 休息日弱化，
 * 无进度/状态/执行率语义（issue #8 定稿）。
 * 点击训练日 → 当日详情子页（PlanDayDetailPage，与信息页共用）。
 *
 * 视觉依据 docs/design/mockups/d1-weekly-plan-ui.html；配色统一 tailwind
 * 项目色板（orange-600 主分化 / star-accent 交互蓝）。
 */
import React, { useState } from 'react';
import type { WeeklyPlanCardData } from 'shared/contracts';
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
      <div className="w-full overflow-hidden rounded-[20px] bg-white shadow-[0_8px_26px_rgba(24,24,27,0.06)]">
        {/* 卡头：本周上下文（周次/阶段 + 一行分化概要） */}
        <div className="border-b border-gray-100 px-4 pb-3 pt-3.5">
          <div className="text-[15px] font-bold text-gray-900">
            本周计划 ·{' '}
            <span className="text-orange-600">{data.week_label}</span>
            {data.phase_label ? ` · ${data.phase_label}` : ''}
          </div>
          <div className="mt-0.5 text-[11.5px] text-gray-400">{data.split_summary}</div>
        </div>

        {/* 7 天纵向数列：训练日可点进当日详情，休息日弱化灰行 */}
        <div className="flex flex-col gap-0.5 px-2 pb-2 pt-1">
          {rows.map((row) => {
            const dow = dowFullLabel(row.entryDate);
            if (row.rest) {
              return (
                <div key={row.entryDate} className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
                  <span className="w-9 shrink-0 text-[13.5px] font-medium text-gray-300">{dow}</span>
                  <span className="text-xs text-gray-300">休息恢复</span>
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
                className="flex w-full items-center gap-2.5 rounded-2xl bg-gray-50 px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_rgba(24,24,27,0.045)] transition-colors active:bg-gray-100"
              >
                <span className="w-9 shrink-0 text-[13.5px] font-bold text-gray-900">{dow}</span>
                {row.splitTag && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-orange-600 text-[11.5px] font-bold text-white">
                    {row.splitTag.slice(0, 1)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-gray-700">
                    {row.focus ?? `${exerciseNameLine(row.exercises)}，${row.exercises.length} 动作`}
                  </span>
                  <span className="block truncate text-[11px] text-gray-400">
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
      </div>

      {/* 当日详情子页：与信息页二级页共用（push 层 z-[130]，盖聊天浮层） */}
      <PlanDayDetailPage detail={detail} onClose={() => setDetail(null)} />
    </>
  );
};
