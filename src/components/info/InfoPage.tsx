/**
 * InfoPage — 信息页（C1+C2 / issue #6 + #7，tab 0 新落点）。
 *
 * 结构（docs/design/mockups/d1-weekly-plan-ui.html 区块 2 定稿；配色/排印按
 * PR#17 返工与 App 现有卡片同源——白卡 gray-100 边 + star-accent 交互，
 * 禁 mockup 橙色；字阶 iosTypeScale）：
 *   上 = 本周计划：横向 7 天条（训练日深墨+块底加深 / 休息日灰）+ 选中日概览 +
 *        查看当日详情入口（进 PlanDayDetailPage 二级页，与 D2 周计划卡共用）
 *   下 = 训练历史：现有历史卡样式原样迁移（SessionCardItem），无进度条
 *
 * 数据：本周计划读确定性课表 API（useWeeklyPlan，纯 DB 读无 LLM）；
 * 无计划周给引导入口（AI Agent 排计划）。页骨架沿用 History 的
 * iOS Large Title 形态（design-spec §1）。
 */
import React, { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Session } from '@/src/types/legacy';
import { haptic } from '../../lib/nativeHaptics';
import { setTabBarHidden } from '../../lib/nativeTabBar';
import { SessionCardItem } from '../history/SessionCardItem';
import { DiagnosticsSheet } from '../settings/DiagnosticsSheet';
import { PageActionsMenu } from './PageActionsMenu';
import { WeekStrip, type WeekStripDay } from './WeekStrip';
import { PlanDayDetailPage } from './PlanDayDetailPage';
import { useWeeklyPlan } from '../../hooks/useWeeklyPlan';
import type { GlassMenuItem } from '../../lib/nativeGlassMenu';
import {
  todayDateKey,
  dowFullLabel,
  splitLabelZh,
  dayVolumeSummary,
  exerciseNameLine,
  todayScheduleDayToVM,
  type PlanDayDetailVM,
} from '../../utils/weeklyPlanView';

export interface InfoPageProps {
  sessions: Session[];
  onSelect: (s: Session) => void;
  onDelete: (sessionId: string) => void;
  onOpenSettings?: () => void;
  /** 无计划周引导入口：打开 AI 教练浮层 */
  onOpenAiCoach?: () => void;
  /** 注销登录（App 层 useLoginStatus.logout，菜单确认后调用） */
  onLogout?: () => void;
}

// 菜单项（与旧历史页同款：设置/诊断/注销；index 对应分发分支）
const MENU_ITEMS: GlassMenuItem[] = [
  { title: '设置', sfSymbol: 'gearshape' },
  { title: '诊断', sfSymbol: 'stethoscope' },
  { separator: true },
  { title: '注销登录', sfSymbol: 'rectangle.portrait.and.arrow.right', danger: true },
];

const InfoPage: React.FC<InfoPageProps> = ({ sessions, onSelect, onDelete, onOpenSettings, onOpenAiCoach, onLogout }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [detail, setDetail] = useState<PlanDayDetailVM | null>(null);
  const today = useMemo(() => todayDateKey(), []);
  const {
    loading,
    error,
    weekDates,
    dayMap,
    weekId,
    split,
    hasNoPlan,
    refresh,
  } = useWeeklyPlan();

  // 默认选中今天（本周必含今天）；用户点选后跟随
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const selectedResp = dayMap[selectedDate];
  const selectedIsTrain = selectedResp?.status === 'planned';

  const metaLine = [weekId, split ? splitLabelZh(split) : ''].filter(Boolean).join(' · ');

  // iOS sheet 规范：诊断 sheet 呈现时盖住原生 tab bar，关闭恢复（引用计数）
  React.useEffect(() => {
    if (!showDebug) return;
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, [showDebug]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 30);
  }, []);

  const runMenuAction = (index: number) => {
    switch (index) {
      case 0: onOpenSettings?.(); break;
      case 1: setShowDebug(true); break;
      case 3:
        if (window.confirm('确定要注销登录吗？')) onLogout?.();
        break;
    }
  };

  // 横条 7 天模型：训练日=当日有条目；标注用动作组数（库数据无逐日分化标签）
  const stripDays: WeekStripDay[] = weekDates.map((date) => {
    const r = dayMap[date];
    const isTrainDay = r?.status === 'planned';
    const setCount = isTrainDay
      ? r!.entries.reduce((acc, e) => acc + e.target_sets, 0)
      : 0;
    return {
      date,
      isTrainDay,
      mark: isTrainDay ? `${setCount}组` : '休',
    };
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="fixed inset-0 z-[100] overflow-y-auto bg-star-gray"
      onScroll={handleScroll}
    >
      <div className="flex h-full flex-col px-4 pb-20 max-w-md mx-auto">

        {/* Navbar — iOS Large Title（滚动折叠 + 居中小标题淡入，沿用 History 形态） */}
        <div
          className="sticky top-0 z-20 -mx-4 px-4 bg-star-gray/85 backdrop-blur-md transition-all duration-200 flex items-center justify-between"
          style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)', paddingBottom: '10px', marginBottom: isScrolled ? 0 : 16 }}
        >
          <h2
            className="text-[34px] leading-[41px] font-bold text-star-dark tracking-tight transition-all duration-200 overflow-hidden"
            style={{ opacity: isScrolled ? 0 : 1, maxHeight: isScrolled ? 0 : 41 }}
            aria-hidden={isScrolled}
          >
            信息
          </h2>
          <span
            className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold text-star-dark transition-opacity duration-200 pointer-events-none"
            style={{ opacity: isScrolled ? 1 : 0 }}
            aria-hidden={!isScrolled}
          >
            信息
          </span>
          <PageActionsMenu items={MENU_ITEMS} onSelect={runMenuAction} />
        </div>

        {/* ── 上半：本周计划（卡壳同 ChatCardShell：白底 24px 圆角 gray-100 边） ── */}
        <div className="rounded-[24px] border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-baseline gap-2 pb-3">
            <span className="text-[17px] font-semibold tracking-tight text-gray-900">本周计划</span>
            <span className="ml-auto text-[12px] text-gray-400">
              {loading ? '' : metaLine || '暂无计划'}
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1.5" aria-label="本周计划加载中" role="status">
              {weekDates.map((d) => (
                <div key={d} className="h-[64px] animate-pulse rounded-[14px] bg-gray-100" />
              ))}
            </div>
          ) : error && Object.keys(dayMap).length === 0 ? (
            <div className="py-6 text-center" role="status">
              <p className="text-sm text-gray-500">{error}</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-3 h-11 rounded-full bg-star-accent/10 px-5 text-[15px] font-semibold text-star-accent active:scale-95 transition-all"
              >
                重新加载
              </button>
            </div>
          ) : hasNoPlan ? (
            <div className="py-6 text-center">
              <p className="text-[15px] font-semibold text-gray-900">本周还没有训练计划</p>
              <p className="pt-1 text-[13px] text-gray-500">让 AI 教练根据你的状态排一份周计划</p>
              {onOpenAiCoach && (
                <button
                  type="button"
                  onClick={() => {
                    haptic('medium');
                    onOpenAiCoach();
                  }}
                  className="mt-3 h-11 rounded-full bg-star-accent px-5 text-[15px] font-semibold text-white transition-all active:scale-95"
                >
                  去找 AI 教练
                </button>
              )}
            </div>
          ) : (
            <>
              <WeekStrip
                days={stripDays}
                selectedDate={selectedDate}
                todayDate={today}
                onSelect={setSelectedDate}
              />

              {/* 选中日概览 + 详情入口（块样式同 PlanCard 条目：gray-50 + gray-100 边） */}
              {selectedResp && (
                <div className="mt-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                  {selectedIsTrain ? (
                    <>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-gray-900">{dowFullLabel(selectedDate)}</span>
                        {split && (
                          <span className="rounded-full border border-gray-100 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-500">
                            {splitLabelZh(split)}
                          </span>
                        )}
                        <span className="ml-auto text-[12px] text-gray-400">
                          {dayVolumeSummary(todayScheduleDayToVM(selectedResp).exercises)}
                        </span>
                      </div>
                      <p className="text-[13px] leading-relaxed text-gray-500">
                        {exerciseNameLine(todayScheduleDayToVM(selectedResp).exercises)}
                      </p>
                      <button
                        type="button"
                        role="button"
                        aria-label={`查看${dowFullLabel(selectedDate)}当日详情`}
                        onClick={() => {
                          haptic('light');
                          setDetail(todayScheduleDayToVM(selectedResp, metaLine));
                        }}
                        className="mt-2.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-star-accent text-[15px] font-semibold text-white transition-all active:scale-95"
                      >
                        查看当日详情
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-gray-400">{dowFullLabel(selectedDate)}</span>
                      <span className="text-[13px] text-gray-400">
                        {selectedResp?.status === 'rest_day' ? '休息恢复' : '暂无安排'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── 下半：训练历史（现有历史卡样式原样迁移，无进度条） ── */}
        <div className="pt-5 text-[17px] font-semibold text-star-dark">训练历史</div>
        {sessions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 text-center opacity-50" role="status">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-200 text-gray-400" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="font-medium text-gray-500">暂无历史记录</p>
            <p className="mt-1 text-xs text-gray-400">完成一次训练后在此查看</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-3">
            {sessions.map((s) => (
              <SessionCardItem key={s.id} session={s} onSelect={onSelect} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>

      {/* 诊断 sheet（与旧历史页共用，行为零改动） */}
      <DiagnosticsSheet open={showDebug} onClose={() => setShowDebug(false)} />

      {/* 当日详情二级页（与 D2 周计划卡共用，push 层） */}
      <PlanDayDetailPage detail={detail} onClose={() => setDetail(null)} />
    </motion.div>
  );
};

export default InfoPage;
