/**
 * WeeklyPlanCard — 对话周计划卡（D2 / issue #9；B5b issue #38 提案-确认）。
 *
 * 走 uiHint 校验回路的新卡型 `weekly_plan`：AI 解释文字留在气泡正文，
 * 本卡是纯净周计划展示——7 天纵向数列 + 分化说明 + 休息日弱化，
 * 无进度/状态/执行率语义（issue #8 定稿）。
 * 点击训练日 → 当日详情子页（PlanDayDetailPage，与信息页共用）。
 *
 * [B5b] 卡携带 `data.apply` 载荷（提案）时渲染确认按钮组（与
 * ProfileUpdateConfirmCard 同构的状态机：idle → writing → done/failed，
 * 决定持久化在 ChatMessage.uiHint.decision）。用户确认 → 前端直调确定性
 * apply 端点落库（无 LLM）→ 信息栏即刻刷新。无 apply 的卡（历史卡/纯展示）
 * 不渲染按钮，行为与旧版完全一致。
 *
 * 视觉同源（PR#17 返工）：直接复用聊天卡统一外壳 ChatCardShell /
 * ChatCardHeader（star-dark 头 + 蓝点标识 + gray-50 条目块 + star-accent
 * 交互），与 PlanCard 等八张既有卡片同一色板；排印按 iosTypeScale
 * （design-tokens.ts）。
 */
import React, { useMemo, useState } from 'react';
import type { WeeklyPlanCardData } from 'shared/contracts';
import { ChatCardShell, ChatPrimaryButton, ChatSecondaryButton } from './ChatCardShell';
import { ChatCardHeader } from './ChatCardHeader';
import { haptic } from '../../../lib/nativeHaptics';
import { resolveExerciseDisplayName } from '../../../utils/exerciseDisplay';
import { useExerciseLibraryIndex } from '../../../hooks/useExerciseLibraryIndex';
import {
  weeklyCardRows,
  dowFullLabel,
  exerciseNameLine,

  type PlanDayDetailVM,
} from '../../../utils/weeklyPlanView';
import { PlanDayDetailPage } from '../../info/PlanDayDetailPage';

/** 周计划确认决定记录：固化确认/放弃状态，随 thread 持久化（与画像确认同构） */
export interface WeeklyPlanDecisionRecord {
  action: 'confirm_apply' | 'cancel_apply';
  decidedAt: number;      // epoch ms
  /** 落库结果（确认时由消费端回填）：done=成功 / failed=失败 / pending=写入中 */
  result?: 'done' | 'failed' | 'pending';
  /** failed 时的原因摘要（HTTP 状态/载荷缺失等，终端一行展示） */
  failMessage?: string;
}

export interface WeeklyPlanCardProps {
  uiHint: {
    type: string;
    data: WeeklyPlanCardData;
    /** 决定记录（持久化在 ChatMessage.uiHint 上，切话题/重启不回弹） */
    decision?: WeeklyPlanDecisionRecord;
  };
  onConfirm?: (payload: any) => void;
}

const ChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
  </svg>
);

export const WeeklyPlanCard: React.FC<WeeklyPlanCardProps> = ({ uiHint, onConfirm }) => {
  const libraryIndex = useExerciseLibraryIndex();
  const data = uiHint.data;
  const rows = React.useMemo(() => weeklyCardRows(data), [data]);
  const [detail, setDetail] = useState<PlanDayDetailVM | null>(null);

  // ── [B5b] 提案-确认状态机（与 ProfileUpdateConfirmCard 同构）─────────────
  type Phase = 'idle' | 'writing' | 'done' | 'failed' | 'cancelled';
  const [localDecision, setLocalDecision] = useState<'idle' | 'confirmed' | 'cancelled'>('idle');
  const apply = data.apply;
  const persisted = uiHint?.decision;
  const phase: Phase = useMemo(() => {
    if (persisted) {
      if (persisted.action === 'cancel_apply') return 'cancelled';
      if (persisted.result === 'done') return 'done';
      if (persisted.result === 'failed') return 'failed';
      return 'writing'; // confirm_apply + pending/未知 → 落库中
    }
    if (localDecision === 'confirmed') return 'writing';
    if (localDecision === 'cancelled') return 'cancelled';
    return 'idle';
  }, [persisted, localDecision]);

  // scope=days 只调整被点名的那几天（按钮文案点明范围，避免「整周被换」误感）
  const dayCount = apply?.scope === 'days' ? (apply.dates?.length ?? 0) : 0;
  const confirmLabel = apply?.scope === 'days'
    ? (dayCount === 1 ? '确认调整这一天' : `确认调整这 ${dayCount} 天`)
    : '确认启用本周计划';

  const canAct = phase === 'idle' || phase === 'failed';
  const handleConfirm = () => {
    if (!canAct || !onConfirm || !apply) return;
    haptic('light');
    setLocalDecision('confirmed');
    onConfirm({ action: 'confirm_apply', apply });
  };
  const handleCancel = () => {
    if (!canAct || !onConfirm) return;
    setLocalDecision('cancelled');
    onConfirm({ action: 'cancel_apply' });
  };

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
                    {row.focus ?? `${exerciseNameLine(row.exercises, (n) => resolveExerciseDisplayName(n, { library: libraryIndex }))}，${row.exercises.length} 动作`}
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

        {/* [B5b] 确认按钮组：仅提案卡（data.apply 存在）渲染。旧卡/纯展示卡无此区。
            writing：主按钮加载态；done/cancelled：终态状态行；failed：可重试。 */}
        {apply && (
          phase === 'writing' ? (
            <div className="px-4 pb-4 flex items-center gap-3">
              <ChatSecondaryButton className="flex-1 opacity-50" disabled>
                暂不启用
              </ChatSecondaryButton>
              <ChatPrimaryButton className="flex-1 opacity-70" disabled>
                <span className="inline-flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  启用中…
                </span>
              </ChatPrimaryButton>
            </div>
          ) : phase === 'done' || phase === 'cancelled' ? (
            <div className="px-4 pb-4 flex items-center justify-center gap-2 py-2.5">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                phase === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-500'
              }`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <p className="text-[15px] font-semibold text-gray-900">
                {phase === 'done' ? '已启用 · 信息栏已同步' : '已放弃，未修改计划'}
              </p>
            </div>
          ) : (
            <div className="px-4 pb-4 flex flex-col gap-2">
              {phase === 'failed' && (
                <div className="flex items-center justify-center gap-2 py-1.5">
                  <span className="w-5 h-5 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                  <p className="text-[13px] font-medium text-rose-500">
                    启用未完成{persisted?.failMessage ? `（${persisted.failMessage}）` : '，可重试'}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-3">
                <ChatSecondaryButton className="flex-1" onClick={handleCancel}>
                  暂不启用
                </ChatSecondaryButton>
                <ChatPrimaryButton className="flex-1" onClick={handleConfirm}>
                  {phase === 'failed' ? '重试启用' : confirmLabel}
                </ChatPrimaryButton>
              </div>
            </div>
          )
        )}
      </ChatCardShell>

      {/* 当日详情子页：与信息页二级页共用（push 层 z-[130]，盖聊天浮层） */}
      <PlanDayDetailPage detail={detail} onClose={() => setDetail(null)} />
    </>
  );
};
