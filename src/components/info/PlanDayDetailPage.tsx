/**
 * PlanDayDetailPage — 当日详情子页（D2 周计划卡 / C2 信息页共用二级页）。
 *
 * 视觉依据 docs/design/mockups/d1-weekly-plan-ui.html 定稿：
 *   push 级页面右滑入 300ms easeOut（design-spec-ios §3）；
 *   动作条目按组展开，每组参数独立（第1组 60kg×8 / 第2组 65kg×6）；
 *   组间无逐组差异时折叠为单行「第 1–N 组」（排版工整，issue #8 修正 3）。
 *
 * 段落标识全部走排版层级（字号/颜色/分隔线），无 emoji 图标（issue #8 修正 2）。
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../lib/nativeHaptics';
import { setTabBarHidden } from '../../lib/nativeTabBar';
import {
  isUniformSetBlock,
  dayVolumeSummary,
  type PlanDayDetailVM,
  type PlanDaySetVM,
} from '../../utils/weeklyPlanView';

/** 单组参数行：等参数块折叠为「第 1–N 组」单行，其余逐组独立 */
function SetRow({ set, total }: { set: PlanDaySetVM; total: number }): JSX.Element {
  const loadText = set.weightKg !== undefined ? null : set.loadText;
  return (
    <div className="grid grid-cols-[64px_1fr_1fr] items-center gap-2 border-b border-gray-100 py-2.5 text-[13px] last:border-b-0">
      <span className="text-xs text-gray-400">
        {total > 1 && set.setNo === 1 && loadText ? `第 1–${total} 组` : `第 ${set.setNo} 组`}
      </span>
      <span className="font-mono font-semibold text-gray-900">
        {set.weightKg !== undefined && (
          <>
            {set.weightKg}
            <span className="ml-0.5 text-[10.5px] font-medium text-gray-400">kg</span>
          </>
        )}
        {loadText && <span className="text-xs font-medium text-gray-500">{loadText}</span>}
      </span>
      <span className="text-right font-mono font-semibold text-gray-900">
        {set.reps !== undefined && (
          <>
            {set.reps}
            <span className="ml-0.5 text-[10.5px] font-medium text-gray-400">次</span>
          </>
        )}
        {set.durationSec !== undefined && (
          <>
            {set.durationSec}
            <span className="ml-0.5 text-[10.5px] font-medium text-gray-400">秒</span>
          </>
        )}
      </span>
    </div>
  );
}

function ExerciseCard({ name, sets, note }: { name: string; sets: PlanDayDetailVM['exercises'][number]['sets']; note?: string }): JSX.Element {
  const collapsed = isUniformSetBlock(sets);
  const display = collapsed ? [sets[0]] : sets;
  return (
    <div className="rounded-[20px] bg-white px-4 pb-1 pt-3.5 shadow-[0_4px_14px_rgba(24,24,27,0.05)]">
      <div className="flex items-center gap-2.5 border-b border-gray-100 pb-2.5">
        <div className="min-w-0 flex-1 text-[14.5px] font-bold text-gray-900">{name}</div>
        <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-500">
          {sets.length} 组
        </span>
      </div>
      <div className="pt-0.5">
        {display.map((s) => (
          <SetRow key={s.setNo} set={s} total={sets.length} />
        ))}
      </div>
      {note && <div className="pb-2 pt-1 text-[11px] leading-relaxed text-gray-400">{note}</div>}
    </div>
  );
}

export interface PlanDayDetailPageProps {
  /** null = 子页关闭（由 AnimatePresence 驱动退场） */
  detail: PlanDayDetailVM | null;
  onClose: () => void;
}

/**
 * 当日详情子页。经 portal 挂 document.body（聊天容器/页面容器常驻 transform，
 * fixed 会相对祖先定位而被困在滚动容器内——portal 逃逸）；z-[130]：盖 AI 浮层
 * z-[110] 与信息页 z-[100]。打开时盖住原生 tab bar（引用计数），关闭恢复。
 */
export const PlanDayDetailPage: React.FC<PlanDayDetailPageProps> = ({ detail, onClose }) => {
  useEffect(() => {
    if (!detail) return;
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, [detail]);

  return createPortal(
  <AnimatePresence>
    {detail && (
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
        className="fixed inset-0 z-[130] overflow-y-auto bg-star-gray"
        style={{ paddingTop: 'calc(var(--safe-top, 0px) + 8px)', paddingBottom: 'calc(var(--safe-bottom, 0px) + 24px)' }}
        role="dialog"
        aria-label={`${detail.title} 当日详情`}
      >
        {/* 导航行：返回 + 标题 + meta */}
        <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 pb-2">
          <button
            type="button"
            onClick={() => {
              haptic('light');
              onClose();
            }}
            aria-label="返回"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 shadow-[0_2px_8px_rgba(24,24,27,0.06)] active:scale-90 transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 2 4 7l5 5" />
            </svg>
          </button>
          <span className="text-[15px] font-semibold text-gray-900">本周计划</span>
          {detail.metaLine && (
            <span className="ml-auto text-[11px] text-gray-400">{detail.metaLine}</span>
          )}
        </div>

        {/* 大标题 + 分化 chip + 概览行（排版层级，无 emoji） */}
        <div className="mx-auto max-w-md px-6">
          <div className="flex items-baseline gap-2.5 pt-1">
            <h2 className="text-[30px] font-black leading-tight tracking-tight text-gray-900">
              {detail.title}
            </h2>
            {detail.splitLabel && (
              <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-600">
                {detail.splitLabel}
              </span>
            )}
          </div>
          {!detail.rest && (
            <p className="pt-1 text-xs text-gray-400">
              {dayVolumeSummary(detail.exercises) ?? ''}
              {detail.exercises.length > 0 ? ' · 组间休息 90–120s' : ''}
            </p>
          )}
        </div>

        {/* 主体：休息日弱化 / 训练日动作列表 */}
        <div className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-4">
          {detail.rest ? (
            <div className="rounded-[20px] bg-white px-5 py-8 text-center shadow-[0_4px_14px_rgba(24,24,27,0.05)]">
              <p className="text-[15px] font-semibold text-gray-500">休息恢复</p>
              <p className="pt-1 text-xs text-gray-400">安排放松与睡眠，肌肉在休息中生长</p>
            </div>
          ) : (
            detail.exercises.map((ex, i) => (
              <ExerciseCard key={ex.exerciseId ?? `${ex.name}-${i}`} name={ex.name} sets={ex.sets} note={ex.note} />
            ))
          )}
        </div>
      </motion.div>
    )}
  </AnimatePresence>,
  document.body,
  );
};
