/**
 * PlanDayDetailPage — 当日详情子页（D2 周计划卡 / C2 信息页共用二级页）。
 *
 * 交互：push 级页面右滑入 300ms easeOut（design-spec-ios §3）。
 * T10/#67 重做：
 *  - 计划说明区：rationale（安排原因/目标/注意要点）随行即显；旧计划无
 *    rationale 整区隐藏（不炸、不占位）
 *  - 三段式分组：热身动作 / 正式动作 / 收尾动作（拉伸），固定段序；
 *    旧计划（category NULL）映射层已回落 main，落「正式动作」段
 *  - 逐组参数：T9 sets 在位时每组独立行（第1组 60kg×8 / 第2组 65kg×6 形态；
 *    无配重动作以 RPE 作负荷锚）；sets 为 null 回落区间文案并折叠「第 1–N 组」
 *
 * 视觉同源（PR#17 返工）：动作卡与历史卡同一套（白底 rounded-2xl +
 * border-gray-100 + shadow-sm）；chip 用 PlanCard 同款灰徽标；
 * 排印按 iosTypeScale：Title 28 / Headline 17 semibold / Subhead 15 /
 * Footnote 13 / Caption 12，数值 font-mono + 10px 单位小字（design-spec §5）。
 * 段落标识全走排版层级，无 emoji 图标（issue #8 修正 2）。
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../lib/nativeHaptics';
import { setTabBarHidden } from '../../lib/nativeTabBar';
import { resolveExerciseDisplayName } from '../../utils/exerciseDisplay';
import { useExerciseLibraryIndex } from '../../hooks/useExerciseLibraryIndex';
import {
  groupExercisesByCategory,
  isUniformSetBlock,
  dayVolumeSummary,
  type PlanDayDetailVM,
  type PlanDaySetVM,
} from '../../utils/weeklyPlanView';

/**
 * 单组参数行。collapsed=等参数块折叠态（组号合并为「第 1–N 组」）——
 * 与负荷文案解耦判定：T9 逐组行（无 loadText 但有 rpe/配重）永不折叠，
 * 不能再借 loadText 有无推断折叠（旧实现会误合并 RPE 逐组块）。
 */
function SetRow({ set, total, collapsed }: { set: PlanDaySetVM; total: number; collapsed: boolean }): JSX.Element {
  // 配重在位 → 第 1–N 组形态只展示配重×次数；缺省时 RPE/区间文案作负荷锚
  const loadText = set.weightKg !== undefined
    ? null
    : set.rpe !== undefined
      ? `RPE ${set.rpe}`
      : set.loadText;
  return (
    <div className="grid grid-cols-[64px_1fr_1fr] items-center gap-2 border-b border-gray-100 py-2.5 last:border-b-0">
      <span className="text-[12px] text-gray-400">
        {collapsed && set.setNo === 1 ? `第 1–${total} 组` : `第 ${set.setNo} 组`}
      </span>
      <span className="font-mono text-[15px] font-semibold text-gray-900">
        {set.weightKg !== undefined && (
          <>
            {set.weightKg}
            <span className="ml-0.5 font-sans text-[10px] font-medium text-gray-400">kg</span>
          </>
        )}
        {loadText && <span className="text-[13px] font-normal text-gray-500">{loadText}</span>}
      </span>
      <span className="text-right font-mono text-[15px] font-semibold text-gray-900">
        {set.reps !== undefined && (
          <>
            {set.reps}
            <span className="ml-0.5 font-sans text-[10px] font-medium text-gray-400">次</span>
          </>
        )}
        {set.durationSec !== undefined && (
          <>
            {set.durationSec}
            <span className="ml-0.5 font-sans text-[10px] font-medium text-gray-400">秒</span>
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
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-gray-100 pb-2.5">
        <div className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight text-gray-900">{name}</div>
        <span className="shrink-0 rounded-full border border-gray-100 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          {sets.length} 组
        </span>
      </div>
      <div className="pt-0.5">
        {display.map((s) => (
          <SetRow key={s.setNo} set={s} total={sets.length} collapsed={collapsed} />
        ))}
      </div>
      {note && <div className="pb-1 pt-1.5 text-[12px] leading-relaxed text-gray-400">{note}</div>}
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
  const libraryIndex = useExerciseLibraryIndex();
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
        {/* 导航行：返回 + 居中标题同位 + meta（对齐设计规范 §1：导航栏 17 semibold） */}
        <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 pb-2">
          <button
            type="button"
            onClick={() => {
              haptic('light');
              onClose();
            }}
            aria-label="返回"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-white text-gray-600 shadow-sm active:scale-90 transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 2 4 7l5 5" />
            </svg>
          </button>
          <span className="text-[17px] font-semibold text-gray-900">本周计划</span>
          {detail.metaLine && (
            <span className="ml-auto text-[12px] text-gray-400">{detail.metaLine}</span>
          )}
        </div>

        {/* 大标题（Title 28）+ 分化 chip（PlanCard 同款灰徽标）+ 概览行 */}
        <div className="mx-auto max-w-md px-6">
          <div className="flex items-baseline gap-2.5 pt-1">
            <h2 className="text-[28px] font-bold leading-tight tracking-tight text-star-dark">
              {detail.title}
            </h2>
            {detail.splitLabel && (
              <span className="rounded-full border border-gray-100 bg-white px-2.5 py-1 text-[12px] font-medium text-gray-500">
                {detail.splitLabel}
              </span>
            )}
          </div>
          {!detail.rest && (
            <p className="pt-1 text-[13px] text-gray-500">
              {dayVolumeSummary(detail.exercises) ?? ''}
              {detail.exercises.length > 0 ? ' · 组间休息 90–120s' : ''}
            </p>
          )}
        </div>

        {/* 主体：休息日弱化 / 训练日=计划说明区 + 三段式动作分组 */}
        <div className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-4">
          {detail.rest ? (
            <div className="rounded-2xl border border-gray-100 bg-white px-5 py-8 text-center shadow-sm">
              <p className="text-[17px] font-semibold text-gray-900">休息恢复</p>
              <p className="pt-1 text-[13px] text-gray-500">安排放松与睡眠，肌肉在休息中生长</p>
            </div>
          ) : (
            <>
              {/* 计划说明区：安排原因/目标/注意要点；旧计划无 rationale 整区隐藏 */}
              {detail.rationale && (
                <section
                  aria-label="计划说明"
                  className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <div className="text-[12px] font-medium text-gray-400">计划说明</div>
                  <p className="pt-1.5 text-[13px] leading-relaxed text-gray-600">{detail.rationale}</p>
                </section>
              )}
              {/* 三段式分组（warmup→main→cooldown 固定段序，空段省略） */}
              {groupExercisesByCategory(detail.exercises).map((group) => (
                <section key={group.category} aria-label={group.label} className="flex flex-col gap-3">
                  <div className="px-1 text-[12px] font-medium text-gray-400">{group.label}</div>
                  {group.exercises.map((ex, i) => (
                    <ExerciseCard
                      key={ex.exerciseId ?? `${group.category}-${ex.name}-${i}`}
                      name={resolveExerciseDisplayName(ex.name, { library: libraryIndex })}
                      sets={ex.sets}
                      note={ex.note}
                    />
                  ))}
                </section>
              ))}
            </>
          )}
        </div>
      </motion.div>
    )}
  </AnimatePresence>,
  document.body,
  );
};
