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
 *  - 教程缩略图入口（#81，返工定稿）：卡头缩略图位**恒在**——卡头固定 48px 行
 *    （44×44 radius-10 + 名称 + 组数徽标，点按热区 56×56，右上 ▸ 播放角标），
 *    无论有无封面素材/有无 exerciseId 入口不消失（用户随时可点进教程了解动作）；
 *    点开 ExerciseTutorialModal 独立实例（详情页自有 state，不入主页
 *    tutorialExerciseId 返回链）；图源 poster_url 走教程数据链
 *    （tutorialPoster.ts），三态：无封面灰底哑铃 / 拉取中静态骨架 /
 *    无 exerciseId 占位同款哑铃灰标（点击轻提示「暂无关联动作库条目」不打开）
 *
 * 视觉同源（PR#17 返工）：动作卡与历史卡同一套（白底 rounded-2xl +
 * border-gray-100 + shadow-sm）；chip 用 PlanCard 同款灰徽标；
 * 排印按 iosTypeScale：Title 28 / Headline 17 semibold / Subhead 15 /
 * Footnote 13 / Caption 12，数值 font-mono + 10px 单位小字（design-spec §5）。
 * 段落标识全走排版层级，无 emoji 图标（issue #8 修正 2）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../lib/nativeHaptics';
import { setTabBarHidden } from '../../lib/nativeTabBar';
import { resolveExerciseDisplayName } from '../../utils/exerciseDisplay';
import { useExerciseLibraryIndex } from '../../hooks/useExerciseLibraryIndex';
import { ExerciseTutorialModal } from '../execution/ExerciseTutorialModal';
import type { ExerciseAction } from '../../types/protocol';
import { useTutorialPoster } from './tutorialPoster';
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

/** 哑铃占位图标路径（PickerFilterSheet.dumbbell 同款线性体系，禁 emoji） */
const DUMBBELL_PATHS = ['M6 6.75v10.5', 'M18 6.75v10.5', 'M3.25 9v6', 'M20.75 9v6', 'M6 12h12'];

/** 播放角标（同训练页播放语义：实心三角，教程封面放大镜徽标同款黑透底） */
function PlayBadge(): JSX.Element {
  return (
    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/45 text-white shadow-sm" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-2 w-2">
        <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
      </svg>
    </span>
  );
}

/**
 * 卡头教程缩略图（#81 返工）：44×44 radius-10，尺寸恒定不随组数变化，
 * **入口恒在**——exerciseId 缺省时 useTutorialPoster 直接返回无封面态，
 * 占位（gray-50+哑铃灰标）照常渲染、照常可点（点击语义由调用方定）。
 * 点按热区 56×56（after 四周外扩 6px，纯视觉盒保持 44，不吞名称区）。
 * 三态：封面渐显（lazy+onLoad 透明度过渡）/ 无封面 gray-50+哑铃灰标 /
 * 拉取中静态骨架灰底（无 pulse，不闪跳）。
 */
function CardHeaderThumb({ exerciseId, name, onOpen }: { exerciseId?: string; name: string; onOpen: () => void }): JSX.Element {
  const { posterUrl, loading } = useTutorialPoster(exerciseId);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imgFailed = posterUrl !== null && failedUrl === posterUrl;
  const imgVisible = posterUrl !== null && failedUrl !== posterUrl && loadedUrl === posterUrl;
  const showFallback = posterUrl === null ? !loading : imgFailed;
  return (
    <button
      type="button"
      onClick={() => {
        haptic('light');
        onOpen();
      }}
      aria-label={`查看「${name}」教程`}
      className="relative h-11 w-11 shrink-0 after:absolute after:-inset-1.5 after:content-[''] active:scale-95 transition-transform"
    >
      <span
        data-testid="thumb-box"
        className={`block h-11 w-11 overflow-hidden rounded-[10px] ${showFallback ? 'bg-gray-50' : 'bg-gray-100'}`}
      >
        {posterUrl !== null && !imgFailed && (
          <img
            src={posterUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoadedUrl(posterUrl)}
            onError={() => setFailedUrl(posterUrl)}
            className={`h-11 w-11 object-cover object-center transition-opacity duration-300 ${imgVisible ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {showFallback && (
          <span className="flex h-11 w-11 items-center justify-center text-gray-300" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {DUMBBELL_PATHS.map((d) => <path key={d} d={d} />)}
            </svg>
          </span>
        )}
      </span>
      <PlayBadge />
    </button>
  );
}

function ExerciseCard({
  exerciseId,
  name,
  sets,
  note,
  onOpenTutorial,
}: {
  exerciseId?: string;
  name: string;
  sets: PlanDayDetailVM['exercises'][number]['sets'];
  note?: string;
  /** exerciseId 可缺省（旧计划）：调用方负责缺省时的轻引导（占位恒在可点） */
  onOpenTutorial?: (exerciseId: string | undefined, name: string) => void;
}): JSX.Element {
  const collapsed = isUniformSetBlock(sets);
  const display = collapsed ? [sets[0]] : sets;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      {/* 卡头恒为固定 48px 行（#81 返工）：44×44 缩略图位**恒在**——无 exerciseId
          时为同款哑铃灰标占位，点击轻提示（入口不消失，用户随时可了解动作） */}
      <div className={`flex items-center gap-2.5 border-b border-gray-100 ${onOpenTutorial ? 'h-12' : 'pb-2.5'}`}>
        {onOpenTutorial && (
          <CardHeaderThumb
            exerciseId={exerciseId}
            name={name}
            onOpen={() => onOpenTutorial(exerciseId, name)}
          />
        )}
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
  /** 详情页自有教程 Sheet 状态：与主页 tutorialExerciseId 返回链完全隔离（#81） */
  const [tutorial, setTutorial] = useState<{ exerciseId: string; name: string } | null>(null);
  /** 轻提示（#81 返工）：无 exerciseId 占位点击的轻引导，禁弹错误（App.tsx showToast 同口径） */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };
  useEffect(() => {
    if (!detail) return;
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, [detail]);
  // 卸载清尾：挂起的 toast 定时器不触达已卸载组件
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  return (
    <>
      {createPortal(
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
                      exerciseId={ex.exerciseId}
                      name={resolveExerciseDisplayName(ex.name, { library: libraryIndex })}
                      sets={ex.sets}
                      note={ex.note}
                      onOpenTutorial={(id, displayName) => {
                        // 旧计划无关联库条目：占位可点但无教程可开——轻提示引导，禁弹错误
                        if (!id) {
                          haptic('warning');
                          showToast('该条目暂无关联动作库条目');
                          return;
                        }
                        setTutorial({ exerciseId: id, name: displayName });
                      }}
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
  )}
      {/* 教程 Sheet：独立 portal 实例（wrapper 提升层叠上下文盖过详情页 z-[130]；
          详情页关闭即随之卸载，不触碰主页 tutorialExerciseId 返回链）。
          onAskAi 空实现与 ExercisePickerModal 教程入口同口径。 */}
      {detail && tutorial && createPortal(
        <div className="fixed inset-0 z-[135]">
          <ExerciseTutorialModal
            exercise={{
              protocol_version: '2.0.0',
              id: tutorial.exerciseId,
              exerciseId: tutorial.exerciseId,
              type: 'resistance',
              sets: [],
              name: tutorial.name,
              libraryId: tutorial.exerciseId,
              metadata: { name: tutorial.name, libraryId: tutorial.exerciseId },
            } as unknown as ExerciseAction}
            onClose={() => setTutorial(null)}
            onAskAi={() => {}}
          />
        </div>,
        document.body,
      )}
      {/* 轻提示 toast（#81 返工）：App.tsx showToast 同款形态（深色胶囊、底部
          safe-area+96px、淡入上浮）；z-[140] 盖详情页/教程 Sheet，让位全局 toast z-[200] */}
      {detail && toast && createPortal(
        <AnimatePresence>
          <motion.div
            key={toast}
            initial={{ opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            role="status"
            className="fixed left-1/2 z-[140] max-w-[85vw] rounded-2xl bg-gray-900/90 px-6 py-3 text-center text-sm font-bold text-white shadow-lg"
            style={{ bottom: 'calc(var(--safe-bottom, 0px) + 96px)' }}
          >
            {toast}
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
};
