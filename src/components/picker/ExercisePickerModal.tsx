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
 * 样式锚点：src/components/ExerciseLibraryModal.tsx（star-gray 底、白卡
 * rounded-[20px]、17px medium 列表标题、吸顶头、backdrop-blur）。
 * 数据：全部 mock（pickerData.ts），无 API 调用；对接后端时仅替换数据源。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { Search } from 'lucide-react';
import { haptic } from '../../lib/nativeHaptics';
import {
  MOCK_EXERCISES,
  NEWBIE_GUIDE,
  PROTOCOL_TYPE,
  RECENT_IDS,
  SOFT_LIMIT_COUNT,
  TYPE_LABELS,
  equipmentLabelOf,
  type PickerDraftSet,
  type PickerExercise,
  type PickerExerciseType,
  type PickerSelectionItem,
} from './pickerData';
import {
  EMPTY_FILTERS,
  filterAndSortExercises,
  isFiltersEmpty,
  planToDraftSets,
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

export interface ExercisePickerModalProps {
  /** 是否有训练历史；false = 新手态（热门排序 + 引导卡） */
  hasHistory?: boolean;
  onClose: () => void;
  /** 清单页「完成」回调（回传最终顺序与配置） */
  onConfirm?: (items: PickerSelectionItem[]) => void;
  /** 演示/恢复场景：初始已选动作 id 列表 */
  defaultSelectedIds?: string[];
  /** 演示/恢复场景：初始视图 */
  initialScreen?: 'browse' | 'cart';
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
      targetRpe: ex.suggestion.targetRpe,
      primaryMuscles: ex.primaryMuscles,
      equipment: ex.equipmentLabel,
      bodyCategory: ex.muscle,
    },
    name: ex.name,
    libraryId: ex.id,
    targetRpe: ex.suggestion.targetRpe,
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

/**
 * 清单卡片（v4 整页重做）：
 * - 独立白卡（rounded-[20px] shadow-sm），卡片间 space-y-3，弃单一白容器
 * - 拖拽 = framer-motion Reorder 官方方案：motion value 直接驱动被拖卡片
 *   （完全跟手），其余卡片 layout 让位；拖拽仅经行首拖动柄启动（编辑态）
 * - 浏览态：序号 + 名称/摘要 + ⓘ 教程；编辑态：拖动柄（行首）+ 红色删除（行尾）
 */
function CartCard({
  item,
  index,
  editing,
  onOpen,
  onTutorial,
  onRemove,
}: {
  item: PickerSelectionItem;
  index: number;
  editing: boolean;
  onOpen: () => void;
  onTutorial: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.03, boxShadow: '0 12px 32px rgba(0,0,0,0.16)' }}
      onDragEnd={() => haptic('light')}
      className="list-none bg-white rounded-[20px] shadow-sm px-4 py-3.5 flex items-center gap-3"
      style={{ touchAction: 'pan-y' }}
    >
      {/* 编辑态：行首拖动柄（唯一拖拽入口，物理防误触） */}
      {editing && (
        <span
          role="button"
          aria-label={`拖动排序 ${item.exercise.name}`}
          onPointerDown={e => {
            haptic('medium');
            controls.start(e);
          }}
          className="w-7 h-11 -ml-1 shrink-0 flex items-center justify-center text-gray-300 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          <svg className="w-4 h-5" viewBox="0 0 16 20" fill="currentColor">
            <circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="4" r="1.5" />
            <circle cx="5" cy="10" r="1.5" /><circle cx="11" cy="10" r="1.5" />
            <circle cx="5" cy="16" r="1.5" /><circle cx="11" cy="16" r="1.5" />
          </svg>
        </span>
      )}

      <span className="w-8 h-8 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 tabular-nums">
        {index + 1}
      </span>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left" aria-label={`配置 ${item.exercise.name}`}>
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

      {/* 浏览态：ⓘ 教程入口 */}
      {!editing && (
        <button
          onClick={e => {
            e.stopPropagation();
            onTutorial();
          }}
          aria-label={`教程 ${item.exercise.name}`}
          className="w-11 h-11 -mr-2.5 shrink-0 flex items-center justify-center text-gray-300 active:text-gray-500 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
        </button>
      )}

      {/* 编辑态：行尾红色删除 */}
      {editing && (
        <button
          onClick={onRemove}
          aria-label={`移除 ${item.exercise.name}`}
          className="w-9 h-9 shrink-0 rounded-full bg-red-50 text-red-500 flex items-center justify-center active:scale-90 transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
          </svg>
        </button>
      )}
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
  defaultSelectedIds = [],
  initialScreen = 'browse',
}) => {
  const [screen, setScreen] = useState<'browse' | 'cart'>(initialScreen);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<PickerFilters>(EMPTY_FILTERS);
  const [sheetDim, setSheetDim] = useState<PickerFilterDim | null>(null);
  const [sheetDraft, setSheetDraft] = useState<string[]>([]);
  const [configIdx, setConfigIdx] = useState<number | null>(null);
  /** 教程 Sheet 当前动作（ⓘ 入口） */
  const [tutorialEx, setTutorialEx] = useState<PickerExercise | null>(null);
  /** 清单页编辑态（拖动柄/删除钮仅编辑态出现） */
  const [cartEditing, setCartEditing] = useState(false);
  /** 浏览列表滚动折叠（Large Title 机制，同 ExerciseLibraryModal） */
  const [isScrolled, setIsScrolled] = useState(false);
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 30);
  }, []);
  const [selected, setSelected] = useState<PickerSelectionItem[]>(() => {
    if (defaultSelectedIds.length === 0) return [];
    const byId = new Map(MOCK_EXERCISES.map(ex => [ex.id, ex]));
    return defaultSelectedIds
      .map(id => byId.get(id))
      .filter((ex): ex is PickerExercise => !!ex)
      .map(ex => ({
        exercise: ex,
        sets: planToDraftSets(ex.suggestion.sets),
        targetRpe: ex.suggestion.targetRpe,
      }));
  });

  const filtered = useMemo(
    () => filterAndSortExercises(MOCK_EXERCISES, filters, searchTerm, hasHistory),
    [filters, searchTerm, hasHistory],
  );
  const recentExercises = useMemo(() => {
    const byId = new Map(MOCK_EXERCISES.map(ex => [ex.id, ex]));
    return RECENT_IDS.map(id => byId.get(id)).filter((ex): ex is PickerExercise => !!ex);
  }, []);
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
      MOCK_EXERCISES,
      { ...filters, [sheetDim]: sheetDraft },
      searchTerm,
      hasHistory,
    ).length;
  }, [sheetDim, sheetDraft, filters, searchTerm, hasHistory]);
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

  /** A9：行圈选——连续添加不关弹窗 */
  const toggleSelect = (ex: PickerExercise) => {
    haptic('light');
    setSelected(prev => {
      if (prev.some(item => item.exercise.id === ex.id)) {
        return prev.filter(item => item.exercise.id !== ex.id);
      }
      return [
        ...prev,
        {
          exercise: ex,
          sets: planToDraftSets(ex.suggestion.sets),
          targetRpe: ex.suggestion.targetRpe,
        },
      ];
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

  const updateItem = (idx: number, next: PickerSelectionItem) => {
    setSelected(prev => prev.map((item, i) => (i === idx ? next : item)));
  };

  const handleConfirm = () => {
    haptic('medium');
    onConfirm?.(selected);
  };

  const showSoftLimitHint = selected.length >= SOFT_LIMIT_COUNT;

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

  /** 底部悬浮条（A9 实时计数 + 去配置/完成） */
  const renderFloatingBar = (mode: 'browse' | 'cart') => (
    <div className="absolute bottom-0 inset-x-0 z-30 px-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
      {/* 选满 9 个的琥珀色软提示（≤8 建议，不硬拦） */}
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
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            className="bg-white/95 backdrop-blur-md rounded-full shadow-lg border border-gray-100 pl-5 pr-2 py-2 flex items-center justify-between"
          >
            <button
              onClick={() => mode === 'browse' && setScreen('cart')}
              className="text-[15px] font-semibold text-star-dark text-left"
              aria-label="查看已选清单"
            >
              已选 <span className="text-blue-500 font-bold tabular-nums">{selected.length}</span> 个动作
            </button>
            {mode === 'browse' ? (
              <button
                onClick={() => { haptic('medium'); setScreen('cart'); }}
                className="bg-blue-500 active:bg-blue-600 text-white text-[15px] font-semibold px-5 h-10 rounded-full active:scale-95 transition-all"
              >
                去配置
              </button>
            ) : (
              <button
                onClick={handleConfirm}
                className="bg-blue-500 active:bg-blue-600 text-white text-[15px] font-semibold px-5 h-10 rounded-full active:scale-95 transition-all"
              >
                开始训练
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
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
              <BackCircleButton onClick={() => { setCartEditing(false); setScreen('browse'); }} label="返回动作列表" />
              <h2 className="text-[34px] leading-[41px] font-bold text-star-dark tracking-tight">训练清单</h2>
              {/* 编辑态切换（iOS 惯例右上角文字钮）：编辑=拖动柄+删除；完成=退出编辑 */}
              <button
                onClick={() => { haptic('light'); setCartEditing(v => !v); }}
                className="w-11 text-right text-[17px] font-medium text-blue-500 active:opacity-50 transition-opacity"
              >
                {cartEditing ? '完成' : '编辑'}
              </button>
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
                <p className="px-1 pb-3 text-[13px] font-semibold text-gray-400 uppercase tracking-widest">
                  训练顺序 · {cartEditing ? '拖动柄调整顺序，红色移除' : '点按动作配置参数'}
                </p>
                {/* 独立卡片 + space-y-3 间隔；Reorder 官方拖拽排序列表（仅拖动柄可启动） */}
                <Reorder.Group axis="y" values={selected} onReorder={setSelected} className="space-y-3">
                  {selected.map((item, idx) => (
                    <CartCard
                      key={item.exercise.id}
                      item={item}
                      index={idx}
                      editing={cartEditing}
                      onOpen={() => { haptic('light'); setConfigIdx(idx); }}
                      onTutorial={() => openTutorial(item.exercise)}
                      onRemove={() => removeItem(idx)}
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
export type { PickerDraftSet, PickerSelectionItem, PickerExercise, PickerExerciseType };

export default ExercisePickerModal;
