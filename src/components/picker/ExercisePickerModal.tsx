/**
 * ExercisePickerModal — A8 筛选重构 + A9 购物车多选（mock 阶段，纯前端）
 *
 * 交互结构照搬 LiftLab 参考案例（docs/design/IMG_4065-4067.PNG 蒸馏规范）：
 *  - 顶栏三段式：左「取消」+ 居中「添加运动」（右「创建」自定义动作入口依赖
 *    后端 AI 分类，mock 阶段不提供，接入点见 handleSmartCreate 的库内实现）；
 *  - 搜索与筛选解耦：搜索只管文字匹配（中文/英文/拼音首字母兜底）；
 *  - 筛选胶囊行：「所有类型 / 所有肌肉 / 所有器械」三维正交，条件回显在胶囊上，
 *    点按弹出半模态 Sheet（PickerFilterSheet，双列卡片 + 显示 N 个结果 CTA）；
 *  - 「近期的训练」置顶分区 + 「所有运动」主列表；
 *  - 智能排序只呈现结果：rank 预置，前 3「常用」徽标 + 穿插「为你推荐」徽标；
 *  - 新手态（无历史）：降级热门排序 + 引导卡。
 *
 * A9：行圈选连续添加不关弹窗，底部悬浮条实时计数；清单页顺序即训练顺序
 *     （可调序/移除），每动作只显参数摘要一行；参数详情由 PickerConfigSheet
 *     复用 ExerciseSettingsModal 形态承载。
 *
 * A10（issue #32）：入口/出口场景区分——mode 场景参数驱动交互状态机：
 *     single-replace=单选回填（购物车流程隐藏）；batch=多选批量添加；
 *     append=多选追加队尾。确认按钮文案与行为严格对应（PICKER_MODE_CONFIRM），
 *     空选择=确认禁用态（悬浮条常驻）。
 *
 * 样式锚点：src/components/ExerciseLibraryModal.tsx（star-gray 底、白卡
 * rounded-[20px]、17px medium 列表标题、吸顶头、backdrop-blur）。
 * 数据：全部 mock（pickerData.ts），无 API 调用；对接后端时仅替换数据源。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls, useMotionValue, animate } from 'framer-motion';
import { Search } from 'lucide-react';
import { haptic } from '../../lib/nativeHaptics';
import { setTabBarHidden } from '../../lib/nativeTabBar';
import { ExerciseService } from '../../services/api/ExerciseServiceV2';
import type { SmartSortResponse } from 'shared/contracts';
import {
  MOCK_EXERCISES,
  NEWBIE_GUIDE,
  PICKER_MODE_CONFIRM,
  PROTOCOL_TYPE,
  RECENT_IDS,
  SOFT_LIMIT_COUNT,
  TYPE_LABELS,
  equipmentLabelOf,
  type PickerEntryMode,
  type PickerExercise,
  type PickerExerciseType,
  type PickerSelectionItem,
} from './pickerData';
import {
  EMPTY_FILTERS,
  computeDragTarget,
  filterAndSortExercises,
  isFiltersEmpty,
  rowSubtitle,
  showCommonBadge,
  summarizeFilterDim,
  summarizeTypeDim,
  summaryOfItem,
  type PickerFilters,
} from './pickerLogic';
import { ExerciseTutorialModal } from '../execution/ExerciseTutorialModal';
import PickerConfigSheet from './PickerConfigSheet';
import PickerFilterSheet, { type PickerFilterDim } from './PickerFilterSheet';
import { SuggestionService } from '../../services/suggestionService';
import { suggestionQueryType, valuesToDraftSets } from './pickerAdapter';

export interface ExercisePickerModalProps {
  /** 是否有训练历史；false = 新手态（热门排序 + 引导卡） */
  hasHistory?: boolean;
  onClose: () => void;
  /** 清单页「完成」回调（回传最终顺序与配置） */
  onConfirm?: (items: PickerSelectionItem[]) => void;
  /**
   * A10 入口场景（issue #32）：single-replace=单选回填（购物车流程隐藏）；
   * batch=多选批量添加（默认）；append=多选追加队尾。文案见 PICKER_MODE_CONFIRM。
   */
  mode?: PickerEntryMode;
  /** 演示/恢复场景：初始已选动作 id 列表 */
  defaultSelectedIds?: string[];
  /** 演示/恢复场景：初始视图 */
  initialScreen?: 'browse' | 'cart';
  /** 用户 UUID（智能排序后端真源按用户近期训练计算；缺省走服务端基线） */
  userId?: string;
}

// ---------------------------------------------------------------------------
// 小件
// ---------------------------------------------------------------------------

/** 选中角标（A9 选中态表达；叠在行首封面缩略图上，不使用独立 radio/checkbox 控件） */
function SelectedBadge() {
  return (
    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center shadow-sm">
      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </span>
  );
}

/**
 * 动作封面缩略图（v4）：库3 3D 解剖渲染图（R2 CDN，male 版），44-52px 圆角，
 * lazy 加载、cover 裁切居中；库内缺失/加载失败回退首字母占位。
 */
function CoverThumb({ exercise, selected }: { exercise: PickerExercise; selected: boolean }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = exercise.thumbnail && !imgFailed;
  return (
    <span className="relative w-12 h-12 shrink-0">
      {showImg ? (
        <img
          src={exercise.thumbnail}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="w-12 h-12 rounded-xl object-cover object-center shrink-0 bg-gray-100"
        />
      ) : (
        <span className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 text-gray-400 text-base font-bold">
          {exercise.name.slice(0, 1)}
        </span>
      )}
      {selected && <SelectedBadge />}
    </span>
  );
}

/** 清单项 → 教程 Sheet 入参（ExerciseTutorialModal 真组件所需字段口径） */
function toTutorialAction(ex: PickerExercise) {
  return {
    protocol_version: '2.0.0' as const,
    id: ex.id,
    exerciseId: `fit://library/exercise/${ex.id}`,
    type: PROTOCOL_TYPE[ex.exerciseType],
    sets: [],
    metadata: {
      name: ex.name,
      nameEn: ex.nameEn,
      libraryId: ex.id,
      primaryMuscles: ex.primaryMuscles,
      equipment: ex.equipmentLabel,
      bodyCategory: ex.muscle,
    },
    name: ex.name,
    libraryId: ex.id,
  };
}

/** 分区标题（近期的训练 / 所有运动，参考案例灰色大字口径） */
function SectionHeader({ text }: { text: string }) {
  return <p className="px-1 pb-2 text-[20px] font-normal text-gray-400">{text}</p>;
}

/** 返回圆钮 — ExerciseLibraryModal 341-352 同款：44pt 白底正圆 + 灰 chevron-left */
function BackCircleButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-11 h-11 shrink-0 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-600 active:scale-90 transition-all"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
    </button>
  );
}

/** 长按进入拖拽的阈值（ms）——与 SwipeableRow 口径一致 */
const LONG_PRESS_MS = 300;

/**
 * 清单卡片（v5：拖拽全范围 + 去智能填充徽标）：
 * - 独立白卡（rounded-[20px] shadow-sm），卡片间 space-y-3
 * - 手势分离（iOS 惯例，无编辑钮）：短按主区域=进参数配置；长按 300ms=整卡
 *   进入 Reorder 拖拽（motion value 跟手，其余卡片 layout 让位），位移>10px
 *   判定为滚动即取消长按
 * - 拖拽范围修复（v5）：不再覆写 touch-action（原 pan-y 覆写令触摸拖拽被浏览器
 *   滚动接管 pointercancel，表现为拖动范围受限）；交由 Reorder 自身的
 *   touch-action:none 承载，列表滚动由卡片间隙与页面其余区域承担
 * - 智能填充：无逐卡徽标（v5 去噪），告知语义收敛到清单顶部一次性提示
 */
function CartCard({
  item,
  index,
  total,
  onOpen,
  onTutorial,
  onRemove,
  onMoveTo,
}: {
  item: PickerSelectionItem;
  index: number;
  total: number;
  onOpen: () => void;
  onTutorial: () => void;
  onRemove: () => void;
  /** 松手兜底落位：把 from 位确定性移动到 to 位 */
  onMoveTo: (from: number, to: number) => void;
}) {
  const controls = useDragControls();
  const rowRef = useRef<HTMLLIElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /** 长按已触发：随后的 click（pointerup 后派发）不再当作「点按配置」 */
  const longPressFired = useRef(false);
  /** 拖拽起点下标（offset 从起点累计，落位计算用） */
  const dragStartIdx = useRef(index);
  /** framer 拖拽在飞（onDragStart 置位，settleDrag 复位）——pointercancel 兜底判据 */
  const dragInFlight = useRef(false);
  const cancelFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * iOS 触摸修复（v6）：framer-motion v12 在 dragListener={false} 时不注入
   * touch-action:none（render/html/use-props.mjs 只在 dragListener !== false
   * 时设），WKWebView 长按后手指一动即被原生滚动抢占 → pointercancel。
   * 修法=动态切换（优先方案）：长按 fire 时置 none + touchmove preventDefault
   * （non-passive，防原生滚动/长按菜单），onDragEnd 复原 pan-y。
   */
  const [iosDragActive, setIosDragActive] = useState(false);
  const touchMoveGuard = useRef<((ev: TouchEvent) => void) | null>(null);
  /**
   * 浮动卡视觉（v7）：不再用 whileDrag —— 实测 v12 在 Reorder.Item +
   * dragListener={false} 组合下，无论正常松手还是 pointercancel，
   * whileDrag 的退出动画都可能不创建（scale 永久冻在 1.03，即用户看到的
   * 「卡死在中间态」）。改为自有 motion value 驱动 scale，settleDrag 在
   * 全部终局路径显式 animate 回 1；阴影走 class + CSS transition。
   */
  const floatScale = useMotionValue(1);
  const [dragRaised, setDragRaised] = useState(false);

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  /** iOS：接管触摸手势（禁原生滚动/长按菜单），拖拽结束/卸载时解除 */
  const engageTouchGuard = (el: HTMLLIElement) => {
    setIosDragActive(true);
    if (touchMoveGuard.current) return;
    const guard = (ev: TouchEvent) => ev.preventDefault();
    el.addEventListener('touchmove', guard, { passive: false });
    touchMoveGuard.current = guard;
  };
  const releaseTouchGuard = (el: HTMLLIElement | null) => {
    setIosDragActive(false);
    if (el && touchMoveGuard.current) {
      el.removeEventListener('touchmove', touchMoveGuard.current);
    }
    touchMoveGuard.current = null;
  };

  /** 拖拽终局统一复位（v7）：onDragEnd 与 pointercancel/touchcancel 兜底共用同一条路径 */
  const settleDrag = () => {
    dragInFlight.current = false;
    longPressFired.current = false;
    clearPress();
    releaseTouchGuard(rowRef.current);
    // 浮动卡确定性归位（scale 由自有 motion value 驱动，不依赖 framer 退出时序）
    setDragRaised(false);
    animate(floatScale, 1, { type: 'spring', stiffness: 500, damping: 35 });
  };

  /**
   * 终局兜底（v7 卡死修复）：framer v12 PanSession 在「无位移松手/取消」时
   * handlePointerUp 提前 return（PanSession.mjs:87），stop()/onDragEnd 均不
   * 发生；系统接管（touchcancel）时 framer 更是完全无感。元素级监听先于
   * framer 的 document 级触发；且过早 cancel() 会先杀 panSession，让 framer
   * 随后自身的 stop 变 no-op（isDragging 已翻 false）→ settle 动画不发、
   * y 冻结 —— 实测复现过。因此兜底推迟到 rAF×2（覆盖 frame.postRender 的
   * onDragEnd 派发），framer 已正常终局（onDragEnd → settleDrag → 旗标翻转）
   * 则不干预；未终局才自行复位 + cancel() 强停。
   */
  const queueDragConclude = () => {
    if (cancelFallbackTimer.current) clearTimeout(cancelFallbackTimer.current);
    cancelFallbackTimer.current = setTimeout(() => {
      cancelFallbackTimer.current = null;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!dragInFlight.current) return;
        settleDrag();
        controls.cancel();
      }));
    }, 0);
  };
  const onDragPointerCancel = () => {
    clearPress();
    if (dragInFlight.current) queueDragConclude();
  };

  useEffect(() => () => {
    if (rowRef.current && touchMoveGuard.current) {
      rowRef.current.removeEventListener('touchmove', touchMoveGuard.current);
    }
    touchMoveGuard.current = null;
    if (cancelFallbackTimer.current) {
      clearTimeout(cancelFallbackTimer.current);
      cancelFallbackTimer.current = null;
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // 仅行尾动作钮（教程/移除）不参与长按；主区域遵循移动端惯例：长按=拖拽，短按=配置
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    longPressFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    clearPress();
    pressTimer.current = setTimeout(() => {
      haptic('medium');
      longPressFired.current = true;
      dragInFlight.current = true;
      // 浮动卡浮起（scale 自有 motion value + 阴影 class，退出在 settleDrag）
      setDragRaised(true);
      animate(floatScale, 1.03, { type: 'spring', stiffness: 500, damping: 35 });
      // iOS 触摸：长按生效瞬间接管手势（动态 touch-action + touchmove 拦截）
      if (e.pointerType === 'touch' && rowRef.current) {
        engageTouchGuard(rowRef.current);
      }
      controls.start(e);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    // 位移超阈值：判定为滚动，取消长按
    if (pressTimer.current && pressStart.current) {
      if (Math.abs(e.clientX - pressStart.current.x) + Math.abs(e.clientY - pressStart.current.y) > 10) {
        clearPress();
      }
    }
  };
  /** 松手：有位移走 framer onDragEnd；无位移 framer 不发终局事件，走兜底复位浮起态 */
  const onPointerUp = () => {
    clearPress();
    if (dragInFlight.current) queueDragConclude();
  };

  return (
    <Reorder.Item
      ref={rowRef}
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => {
        dragStartIdx.current = index;
        dragInFlight.current = true;
      }}
      onDragEnd={(_, info) => {
        haptic('light');
        settleDrag();
        // 松手兜底（v5）：实时换位存在滞后，按最终偏移确定性落位
        // （绝对目标语义：moveItemTo 先删后插，与 Reorder 已落位的 index 现值自洽）
        const rowH = rowRef.current?.getBoundingClientRect().height || 76;
        const target = computeDragTarget(dragStartIdx.current, info.offset.y, rowH, total);
        if (target !== index) onMoveTo(index, target);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onDragPointerCancel}
      onTouchCancel={onDragPointerCancel}
      className={`list-none bg-white rounded-[20px] px-4 py-3.5 flex items-center gap-3 transition-shadow duration-150 ${
        dragRaised ? 'shadow-[0_12px_32px_rgba(0,0,0,0.16)]' : 'shadow-sm'
      }`}
      style={{
        // 浮起 scale 由自有 motion value 驱动（退出复位在 settleDrag，v7）
        scale: floatScale,
        // 浮起阴影内联且两态显式（framer 不回滚「键消失」的样式；arbitrary class
        // 也会输给 shadow-sm 的 --tw-shadow 层叠序）；静默值 = shadow-sm 同款
        boxShadow: dragRaised ? '0 12px 32px rgba(0, 0, 0, 0.16)' : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        // v6 iOS 触摸修复：拖拽进行中禁用一切原生手势（framer v12 在
        // dragListener={false} 下不代为注入）；其余时段 pan-y 保列表可滚
        touchAction: iosDragActive ? 'none' : 'pan-y',
        userSelect: iosDragActive ? 'none' : undefined,
        WebkitUserSelect: iosDragActive ? 'none' : undefined,
        WebkitTouchCallout: iosDragActive ? 'none' : undefined,
      }}
    >
      <span className="w-8 h-8 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 tabular-nums">
        {index + 1}
      </span>

      {/* 短按=参数配置；长按拖拽后的 click 在此吞掉 */}
      <button
        onClick={() => {
          if (longPressFired.current) {
            longPressFired.current = false;
            return;
          }
          onOpen();
        }}
        className="flex-1 min-w-0 text-left"
        aria-label={`配置 ${item.exercise.name}`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[17px] font-medium text-star-dark truncate">{item.exercise.name}</span>
          <span className="shrink-0 bg-gray-100 text-gray-400 text-[10px] font-bold px-1.5 py-0.5 rounded-md">
            {TYPE_LABELS[item.exercise.exerciseType]}
          </span>
        </span>
        <span className="block text-[13px] text-gray-400 font-medium mt-0.5 truncate tabular-nums">
          {summaryOfItem(item)}
        </span>
      </button>

      {/* ⓘ 教程入口 */}
      <button
        data-no-drag
        onClick={e => {
          e.stopPropagation();
          onTutorial();
        }}
        aria-label={`教程 ${item.exercise.name}`}
        className="w-11 h-11 -mr-1 shrink-0 flex items-center justify-center text-gray-300 active:text-gray-500 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
      </button>

      {/* 红色「—」移除 */}
      <button
        data-no-drag
        onClick={onRemove}
        aria-label={`移除 ${item.exercise.name}`}
        className="w-9 h-9 -mr-1 shrink-0 rounded-full bg-red-50 text-red-500 flex items-center justify-center active:scale-90 transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
        </svg>
      </button>
    </Reorder.Item>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

const ExercisePickerModal: React.FC<ExercisePickerModalProps> = ({
  hasHistory = true,
  onClose,
  onConfirm,
  mode = 'batch',
  defaultSelectedIds = [],
  initialScreen = 'browse',
  userId,
}) => {
  /** A10：single-replace 为单选模式且无清单页（购物车流程按场景隐藏） */
  const singleOnly = mode === 'single-replace';
  const [screen, setScreen] = useState<'browse' | 'cart'>(singleOnly ? 'browse' : initialScreen);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<PickerFilters>(EMPTY_FILTERS);
  const [sheetDim, setSheetDim] = useState<PickerFilterDim | null>(null);
  const [sheetDraft, setSheetDraft] = useState<string[]>([]);
  const [configIdx, setConfigIdx] = useState<number | null>(null);
  /** 教程 Sheet 当前动作（ⓘ 入口） */
  const [tutorialEx, setTutorialEx] = useState<PickerExercise | null>(null);
  /** 进行中的 resolve 去重（按动作 id） */
  const resolvingRef = useRef<Set<string>>(new Set());
  /** 浏览列表滚动折叠（Large Title 机制，同 ExerciseLibraryModal） */
  const [isScrolled, setIsScrolled] = useState(false);
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 30);
  }, []);
  const [selected, setSelected] = useState<PickerSelectionItem[]>(() => {
    if (defaultSelectedIds.length === 0) return [];
    const byId = new Map(MOCK_EXERCISES.map(ex => [ex.id, ex]));
    return (singleOnly ? defaultSelectedIds.slice(0, 1) : defaultSelectedIds)
      .map(id => byId.get(id))
      .filter((ex): ex is PickerExercise => !!ex)
      .map(ex => ({ exercise: ex, sets: [], targetRpe: 7 }));
  });

  // iOS sheet 规范：动作库全屏呈现时盖住原生 tab bar，关闭恢复（引用计数）。
  // #57 回归修复：A10 把库从 ExerciseSettingsModal（自带隐藏）内嵌改为本组件
  // 直连挂载后，隐藏逻辑未随迁 → tab bar 复现，遮挡底部购物车悬浮条。
  useEffect(() => {
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, []);

  /** 智能排序（A31 后端真源，issue #31）：近期训练过的动作按分区去重后置顶。
   *  加载失败（离线等）静默回落 mock 预置序——排序属呈现增强，不阻断选动作。 */
  const [sortData, setSortData] = useState<SmartSortResponse | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>(RECENT_IDS);
  useEffect(() => {
    if (!hasHistory) return;
    let cancelled = false;
    ExerciseService.getSmartSort(userId || undefined)
      .then(res => {
        if (cancelled) return;
        setSortData(res);
        if (res.recent_exercise_ids.length > 0) setRecentIds(res.recent_exercise_ids);
      })
      .catch(() => {
        /* 离线兜底：保持 mock 序（RECENT_IDS） */
      });
    return () => {
      cancelled = true;
    };
  }, [hasHistory, userId]);

  /** 后端排序应用到全库：ranked_ids 位置覆盖 rank（库外 id 保留 mock 序兜底） */
  const exercises = useMemo(() => {
    if (!sortData) return MOCK_EXERCISES;
    const pos = new Map(sortData.ranked_ids.map((id, i) => [id, i + 1]));
    return MOCK_EXERCISES
      .map(ex => {
        const p = pos.get(ex.id);
        return p === undefined ? ex : { ...ex, rank: p };
      })
      .sort((a, b) => a.rank - b.rank);
  }, [sortData]);

  const filtered = useMemo(
    () => filterAndSortExercises(exercises, filters, searchTerm, hasHistory),
    [exercises, filters, searchTerm, hasHistory],
  );
  const recentExercises = useMemo(() => {
    const byId = new Map(exercises.map(ex => [ex.id, ex]));
    return recentIds.map(id => byId.get(id)).filter((ex): ex is PickerExercise => !!ex);
  }, [exercises, recentIds]);
  const selectedIds = useMemo(() => new Set(selected.map(i => i.exercise.id)), [selected]);

  const filtersEmpty = isFiltersEmpty(filters);
  /** 近期分区仅在无搜索、无筛选、有历史时展示（参考案例口径） */
  const showRecent = hasHistory && !searchTerm.trim() && filtersEmpty && recentExercises.length > 0;
  /** 近期已置顶的动作不重复出现在「所有运动」（单屏内不重复；近期分区隐藏时恢复全量） */
  const mainList = useMemo(() => {
    if (!showRecent) return filtered;
    const recentIds = new Set(recentExercises.map(ex => ex.id));
    const rest = filtered.filter(ex => !recentIds.has(ex.id));
    return rest.length > 0 ? rest : filtered;
  }, [filtered, showRecent, recentExercises]);

  // ---- 筛选 Sheet ----
  const openSheet = (dim: PickerFilterDim) => {
    haptic('light');
    setSheetDraft([...filters[dim]]);
    setSheetDim(dim);
  };
  /** Sheet 内草稿下的结果数（CTA 实时计数） */
  const sheetResultCount = useMemo(() => {
    if (!sheetDim) return 0;
    return filterAndSortExercises(
      exercises,
      { ...filters, [sheetDim]: sheetDraft },
      searchTerm,
      hasHistory,
    ).length;
  }, [sheetDim, sheetDraft, filters, searchTerm, hasHistory, exercises]);
  const toggleDraft = (value: string) => {
    haptic('light');
    setSheetDraft(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));
  };
  const applySheet = () => {
    haptic('medium');
    if (sheetDim) setFilters(prev => ({ ...prev, [sheetDim]: sheetDraft }));
    setSheetDim(null);
  };
  const clearSheetDim = () => {
    haptic('light');
    setSheetDraft([]);
    if (sheetDim) setFilters(prev => ({ ...prev, [sheetDim]: [] }));
  };

  /** A9：行圈选——连续添加不关弹窗。参数建议统一挂 SuggestionService（链路 A）：
      先占位（空组），resolve 回来后由统一 effect 填入（见下方 effect）。
      A10：single-replace 收敛为单选——新选中替换既有选择（替换语义，见 issue #32）。 */
  const toggleSelect = (ex: PickerExercise) => {
    haptic('light');
    setSelected(prev => {
      if (prev.some(item => item.exercise.id === ex.id)) {
        return prev.filter(item => item.exercise.id !== ex.id);
      }
      if (singleOnly) return [{ exercise: ex, sets: [], targetRpe: 7 }];
      return [...prev, { exercise: ex, sets: [], targetRpe: 7 }];
    });
  };

  const removeItem = (idx: number) => {
    haptic('light');
    setSelected(prev => prev.filter((_, i) => i !== idx));
    if (configIdx !== null) {
      if (idx === configIdx) setConfigIdx(null);
      else if (idx < configIdx) setConfigIdx(configIdx - 1);
    }
  };

  /** 参数建议统一挂 SuggestionService（链路 A，issue #31；B6 秒回 issue #39）：
      清单中出现空组占位条目时先 resolveSync 从本地缓存镜像同步读出（零等待），
      miss 再按 name/type 走 resolve（缓存→后端→本地启发式，miss 时服务层自动
      异步对账补齐整批），回来后填入 sets/targetRpe；defaultSelectedIds 恢复
      场景同样覆盖。两读点（此处与动作设置「应用建议」）同源同一份对账缓存。 */
  useEffect(() => {
    for (const item of selected) {
      const ex = item.exercise;
      if (item.sets.length > 0) continue;
      // B6 秒回：镜像命中即同步填入（与 resolve 同条目同导出链，零网络）
      const synced = SuggestionService.resolveSync(ex.name, suggestionQueryType(ex.exerciseType), 7);
      if (synced) {
        setSelected(prev => prev.map(it =>
          it.exercise.id === ex.id && it.sets.length === 0
            ? { ...it, sets: valuesToDraftSets(synced.values), targetRpe: synced.values.target_rpe ?? it.targetRpe }
            : it,
        ));
        continue;
      }
      if (resolvingRef.current.has(ex.id)) continue;
      resolvingRef.current.add(ex.id);
      SuggestionService.resolve(ex.name, suggestionQueryType(ex.exerciseType), 7)
        .then(res => {
          setSelected(prev => prev.map(it =>
            it.exercise.id === ex.id && it.sets.length === 0
              ? { ...it, sets: valuesToDraftSets(res.values), targetRpe: res.values.target_rpe ?? it.targetRpe }
              : it,
          ));
        })
        .catch(() => {
          // resolve 三级链内部已兜底；此分支仅防御意外拒绝
          setSelected(prev => prev.map(it =>
            it.exercise.id === ex.id && it.sets.length === 0
              ? { ...it, sets: valuesToDraftSets({ reps: 10, set_count: 3, target_rpe: 7 }) }
              : it,
          ));
        })
        .finally(() => resolvingRef.current.delete(ex.id));
    }
  }, [selected]);

  /** 拖拽落位兜底：把 from 位确定性移动到 to 位（顺序即训练顺序） */
  const moveItemTo = (from: number, to: number) => {
    if (from === to) return;
    haptic('light');
    setSelected(prev => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const updateItem = (idx: number, next: PickerSelectionItem) => {
    setSelected(prev => prev.map((item, i) => (i === idx ? next : item)));
  };

  /** A10：确认按钮=空选择禁用（禁用态不触发回调），文案严格对应场景模式 */
  const confirmCopy = PICKER_MODE_CONFIRM[mode];
  const confirmDisabled = selected.length === 0;
  const confirmLabel = confirmDisabled
    ? confirmCopy.emptyLabel
    : mode === 'single-replace'
      ? confirmCopy.label(1, selected[0].exercise.name)
      : confirmCopy.label(selected.length);

  const handleConfirm = () => {
    if (confirmDisabled) return;
    haptic('medium');
    onConfirm?.(selected);
  };

  const showSoftLimitHint = !singleOnly && selected.length >= SOFT_LIMIT_COUNT;

  /** 筛选胶囊回显文案 */
  const pillLabels: Record<PickerFilterDim, string> = {
    types: summarizeTypeDim(filters.types),
    muscles: summarizeFilterDim(filters.muscles, '所有肌肉', v => v),
    equipment: summarizeFilterDim(filters.equipment, '所有器械', equipmentLabelOf),
  };
  const pillActive: Record<PickerFilterDim, boolean> = {
    types: filters.types.length > 0,
    muscles: filters.muscles.length > 0,
    equipment: filters.equipment.length > 0,
  };

  /** 教程入口（ⓘ）：打开 ExerciseTutorialModal 真组件 Sheet */
  const openTutorial = (ex: PickerExercise) => {
    if (!ex.id && !ex.name) {
      haptic('warning'); // 缺教程必需字段（库 id/名称）：轻提示不打开
      return;
    }
    haptic('light');
    setTutorialEx(ex);
  };

  /** 列表行（圈选 + 徽标 + 副标题 + 教程入口） */
  const renderRow = (ex: PickerExercise, className = '') => {
    const isSelected = selectedIds.has(ex.id);
    return (
      <div
        key={ex.id}
        role="button"
        tabIndex={0}
        onClick={() => toggleSelect(ex)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSelect(ex);
          }
        }}
        aria-pressed={isSelected}
        aria-label={`${isSelected ? '取消选择' : '选择'} ${ex.name}`}
        className={`w-full text-left px-4 py-3.5 active:bg-gray-100 transition-colors flex items-center gap-3 cursor-pointer ${className} ${
          isSelected ? 'bg-blue-50/40' : ''
        }`}
      >
        {/* 行首：动作封面（库3 3D 解剖渲染图）+ 选中角标 */}
        <CoverThumb exercise={ex} selected={isSelected} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[17px] font-medium text-star-dark truncate">{ex.name}</span>
            {showCommonBadge(ex, hasHistory) && (
              <span className="shrink-0 bg-blue-50 text-blue-500 text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                常用
              </span>
            )}
            {ex.isRecommended && (
              <span className="shrink-0 bg-[#BCEF08] text-star-dark text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                为你推荐
              </span>
            )}
          </span>
          <span className="block text-[14px] text-gray-400 font-medium mt-0.5 truncate">
            {rowSubtitle(ex)}
          </span>
        </span>
        {/* 行尾：教程入口 ⓘ（stopPropagation，不触发行圈选） */}
        <button
          onClick={e => {
            e.stopPropagation();
            openTutorial(ex);
          }}
          aria-label={`教程 ${ex.name}`}
          className="w-11 h-11 -mr-2.5 shrink-0 flex items-center justify-center text-gray-300 active:text-gray-500 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
        </button>
      </div>
    );
  };

  /**
   * 底部悬浮条（A9 实时计数；A10 起常驻——空选择=确认禁用态，issue #32）。
   * 右钮按场景分流：多选模式浏览页=去配置（清单页承载参数配置），清单页/单选模式
   * =模式确认钮（文案见 PICKER_MODE_CONFIRM，行为与文案严格一致）。
   */
  const renderFloatingBar = (screenKey: 'browse' | 'cart') => (
    <div className="absolute bottom-0 inset-x-0 z-30 px-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
      {/* 选满 9 个的琥珀色软提示（≤8 建议，不硬拦；单选模式不适用） */}
      <AnimatePresence>
        {showSoftLimitHint && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="bg-amber-50 text-amber-600 text-xs font-medium rounded-xl px-3.5 py-2.5 mb-2"
          >
            已选 {selected.length} 个动作，单次训练建议不超过 8 个
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
        className="bg-white/95 backdrop-blur-md rounded-full shadow-lg border border-gray-100 pl-5 pr-2 py-2 flex items-center justify-between"
      >
        {singleOnly ? (
          <span className="text-[15px] font-semibold text-star-dark text-left">
            已选 <span className="text-blue-500 font-bold tabular-nums">{selected.length}</span> 个动作
          </span>
        ) : (
          <button
            onClick={() => screenKey === 'browse' && setScreen('cart')}
            className="text-[15px] font-semibold text-star-dark text-left"
            aria-label="查看已选清单"
          >
            已选 <span className="text-blue-500 font-bold tabular-nums">{selected.length}</span> 个动作
          </button>
        )}
        {screenKey === 'browse' && !singleOnly ? (
          <button
            onClick={() => { haptic('medium'); setScreen('cart'); }}
            disabled={confirmDisabled}
            className="bg-blue-500 active:bg-blue-600 text-white text-[15px] font-semibold px-5 h-10 rounded-full active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100"
          >
            去配置
          </button>
        ) : (
          <button
            onClick={handleConfirm}
            disabled={confirmDisabled}
            aria-label={confirmLabel}
            className="bg-blue-500 active:bg-blue-600 text-white text-[15px] font-semibold px-5 h-10 rounded-full active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100"
          >
            {confirmLabel}
          </button>
        )}
      </motion.div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[70] bg-star-gray flex flex-col overflow-hidden"
    >
      {/* ---------------- 浏览视图 ---------------- */}
      {screen === 'browse' && (
        <>
          {/* 吸顶头：返回圆钮 + Large Title（滚动折叠）+ 搜索 + 筛选胶囊行（backdrop-blur） */}
          <div
            className="z-20 px-4 bg-star-gray/85 backdrop-blur-md"
            style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)', paddingBottom: '10px' }}
          >
            {/* 导航行 — ExerciseLibraryModal 同规格：未滚动大标题与按钮同行，滚动折叠、居中小标题淡入 */}
            <div className="flex items-center justify-between" style={{ marginBottom: isScrolled ? 0 : 16 }}>
              <BackCircleButton onClick={onClose} label="返回" />
              <h2
                className="ml-3 text-[34px] leading-[41px] font-bold text-star-dark tracking-tight transition-all duration-200 overflow-hidden flex-1"
                style={{ opacity: isScrolled ? 0 : 1, maxHeight: isScrolled ? 0 : 41 }}
                aria-hidden={isScrolled}
              >
                添加运动
              </h2>
              <span
                className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold text-star-dark transition-opacity duration-200 pointer-events-none"
                style={{ opacity: isScrolled ? 1 : 0 }}
                aria-hidden={!isScrolled}
              >
                添加运动
              </span>
              <span className="w-11 shrink-0" aria-hidden="true" />
            </div>

            {/* 搜索兜底：中文/英文/拼音首字母（与筛选解耦） */}
            <div className="bg-black/[0.06] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 mb-3">
              <Search size={18} className="text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="搜索运动"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="bg-transparent outline-none w-full text-[17px] font-medium placeholder-gray-400"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} aria-label="清除搜索" className="text-gray-400 p-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              )}
            </div>

            {/* 筛选胶囊行：所有类型 / 所有肌肉 / 所有器械（条件回显 + 选中态深底白字） */}
            <div className="grid grid-cols-3 gap-2.5">
              {(['types', 'muscles', 'equipment'] as PickerFilterDim[]).map(dim => (
                <button
                  key={dim}
                  onClick={() => openSheet(dim)}
                  aria-haspopup="dialog"
                  className={`h-11 rounded-xl flex items-center justify-center gap-1 text-[15px] font-semibold transition-colors ${
                    pillActive[dim] ? 'bg-star-dark text-white' : 'bg-black/[0.06] text-star-dark'
                  }`}
                >
                  <span className="truncate max-w-[86px]">{pillLabels[dim]}</span>
                  <svg className="w-3.5 h-3.5 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto px-4 pb-36 custom-scrollbar" onScroll={handleListScroll}>
            {filtered.length === 0 ? (
              <div className="text-center py-20 px-6">
                <p className="text-gray-400 text-lg mb-6">
                  未找到 {searchTerm ? `"${searchTerm}"` : '符合条件的动作'}
                </p>
                {(searchTerm || !filtersEmpty) && (
                  <button
                    onClick={() => { setSearchTerm(''); setFilters(EMPTY_FILTERS); }}
                    className="bg-star-dark text-white rounded-full px-6 h-11 text-[15px] font-semibold active:scale-95 transition-all"
                  >
                    清除搜索与筛选
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* 近期的训练（上次用过置顶；无搜索无筛选且有历史时） */}
                {showRecent && (
                  <div className="mb-6">
                    <SectionHeader text="近期的训练" />
                    <div className="bg-white rounded-[20px] overflow-hidden shadow-sm">
                      {recentExercises.map((ex, i) => renderRow(ex, i > 0 ? 'border-t border-gray-100' : ''))}
                    </div>
                  </div>
                )}

                {/* 新手态引导卡（无历史：热门排序降级说明） */}
                {!hasHistory && (
                  <div className="bg-white rounded-[20px] shadow-sm p-4 mb-4 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0 text-blue-500">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-star-dark">{NEWBIE_GUIDE.title}</p>
                      <p className="text-[13px] text-gray-400 font-medium leading-relaxed mt-0.5">{NEWBIE_GUIDE.desc}</p>
                    </div>
                  </div>
                )}

                {/* 所有运动 */}
                <SectionHeader text="所有运动" />
                <div className="bg-white rounded-[20px] overflow-hidden shadow-sm">
                  {mainList.map((ex, i) => renderRow(ex, i > 0 ? 'border-t border-gray-100' : ''))}
                </div>
              </>
            )}
          </div>

          {renderFloatingBar('browse')}
        </>
      )}

      {/* ---------------- 清单视图（A9：顺序即训练顺序） ---------------- */}
      {screen === 'cart' && (
        <>
          <div
            className="z-20 px-4 bg-star-gray/85 backdrop-blur-md"
            style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)', paddingBottom: '10px' }}
          >
            <div className="flex items-center justify-between pb-2">
              <BackCircleButton onClick={() => setScreen('browse')} label="返回动作列表" />
              <h2 className="text-[34px] leading-[41px] font-bold text-star-dark tracking-tight">训练清单</h2>
              <span className="w-11" aria-hidden="true" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-36 custom-scrollbar">
            {selected.length === 0 ? (
              <div className="text-center py-20 px-6">
                <p className="text-gray-400 text-lg mb-6">还没有选择动作</p>
                <button
                  onClick={() => setScreen('browse')}
                  className="bg-star-dark text-white rounded-full px-6 h-11 text-[15px] font-semibold active:scale-95 transition-all"
                >
                  去挑选动作
                </button>
              </div>
            ) : (
              <>
                {/* 操作提示 + 智能填充一次性告知（v5：全局一条，传达已填充/非固定/可改） */}
                <div className="px-1 pb-3">
                  <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-widest">
                    训练顺序 · 短按改参数 · 长按拖动排序
                  </p>
                  <p className="text-xs text-gray-400 font-medium mt-1 flex items-center gap-1">
                    <svg className="w-3 h-3 shrink-0 text-blue-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
                    </svg>
                    训练参数已按你的训练画像智能填充，点按卡片即可调整
                  </p>
                </div>
                {/* 独立卡片 + space-y-3 间隔；Reorder 官方拖拽排序列表（长按整卡启动） */}
                <Reorder.Group axis="y" values={selected} onReorder={setSelected} className="space-y-3">
                  {selected.map((item, idx) => (
                    <CartCard
                      key={item.exercise.id}
                      item={item}
                      index={idx}
                      total={selected.length}
                      onOpen={() => { haptic('light'); setConfigIdx(idx); }}
                      onTutorial={() => openTutorial(item.exercise)}
                      onRemove={() => removeItem(idx)}
                      onMoveTo={moveItemTo}
                    />
                  ))}
                </Reorder.Group>
              </>
            )}
          </div>

          {renderFloatingBar('cart')}
        </>
      )}

      {/* ---------------- 筛选 Sheet（A8，草稿态 + 结果计数 CTA） ---------------- */}
      <AnimatePresence>
        {sheetDim && (
          <PickerFilterSheet
            dim={sheetDim}
            draft={sheetDraft}
            resultCount={sheetResultCount}
            onToggle={toggleDraft}
            onClear={clearSheetDim}
            onApply={applySheet}
            onClose={() => setSheetDim(null)}
          />
        )}
      </AnimatePresence>

      {/* ---------------- 参数配置面板（A9，复用 ExerciseSettingsModal 形态） ---------------- */}
      <AnimatePresence>
        {configIdx !== null && selected[configIdx] && (
          <PickerConfigSheet
            key={selected[configIdx].exercise.id}
            item={selected[configIdx]}
            onChange={next => updateItem(configIdx, next)}
            onClose={() => setConfigIdx(null)}
          />
        )}
      </AnimatePresence>

      {/* ---------------- 动作教程 Sheet（ⓘ 入口；ExerciseTutorialModal 真组件） ---------------- */}
      {tutorialEx && (
        <div className="fixed inset-0 z-[85]">
          <ExerciseTutorialModal
            exercise={toTutorialAction(tutorialEx)}
            onClose={() => setTutorialEx(null)}
            onAskAi={() => {}}
          />
        </div>
      )}
    </motion.div>
  );
};

// 供演示页复用的类型/常量出口（业务接入不需要）
export { MOCK_EXERCISES as pickerDemoExercises };
export type { PickerEntryMode, PickerSelectionItem, PickerExercise, PickerExerciseType };

export default ExercisePickerModal;
