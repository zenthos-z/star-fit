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

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { haptic } from '../../lib/nativeHaptics';
import {
  MOCK_EXERCISES,
  NEWBIE_GUIDE,
  RECENT_IDS,
  SOFT_LIMIT_COUNT,
  TYPE_LABELS,
  type PickerDraftSet,
  type PickerExercise,
  type PickerExerciseType,
  type PickerSelectionItem,
  type PickerVisual,
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

/** 列表缩略示意（44-52px 类型图标占位；image_refs 就位后替换为缩略图） */
function KindThumb({ visual, imageRef }: { visual: PickerVisual; imageRef?: string }) {
  if (imageRef) {
    return <img src={imageRef} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 bg-gray-100" />;
  }
  const paths: Record<PickerVisual, string[]> = {
    dumbbell: ['M7 7v10', 'M17 7v10', 'M3.75 9.5v5', 'M20.25 9.5v5', 'M7 12h10'],
    bodyweight: [
      'M12 6.75a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z',
      'M12 9v6', 'M12 11l-3.25 1.75', 'M12 11l3.25 1.75', 'M12 15l-2.5 5.5', 'M12 15l2.5 5.5',
    ],
    pulse: ['M3 12h4l2.25-5.25L12.75 17l2.25-5H21'],
    stretch: ['M3.75 12h16.5', 'M3.75 12l3-3', 'M3.75 12l3 3', 'M20.25 12l-3-3', 'M20.25 12l-3 3'],
  };
  return (
    <span className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 text-gray-500">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6">
        {paths[visual].map((d, i) => (
          <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />
        ))}
      </svg>
    </span>
  );
}

/** 圈选圆点（A9 多选标记） */
function SelectCircle({ selected }: { selected: boolean }) {
  return (
    <span
      className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'bg-blue-500 border-blue-500' : 'border-gray-200 bg-white'
      }`}
    >
      {selected && (
        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
    </span>
  );
}

/** 分区标题（近期的训练 / 所有运动，参考案例灰色大字口径） */
function SectionHeader({ text }: { text: string }) {
  return <p className="px-1 pb-2 text-[20px] font-normal text-gray-400">{text}</p>;
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

  const moveItem = (idx: number, dir: -1 | 1) => {
    haptic('light');
    setSelected(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
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
    equipment: summarizeFilterDim(filters.equipment, '所有器械', v => v),
  };
  const pillActive: Record<PickerFilterDim, boolean> = {
    types: filters.types.length > 0,
    muscles: filters.muscles.length > 0,
    equipment: filters.equipment.length > 0,
  };

  /** 列表行（圈选 + 徽标 + 副标题） */
  const renderRow = (ex: PickerExercise, className = '') => {
    const isSelected = selectedIds.has(ex.id);
    return (
      <button
        key={ex.id}
        onClick={() => toggleSelect(ex)}
        aria-pressed={isSelected}
        aria-label={`${isSelected ? '取消选择' : '选择'} ${ex.name}`}
        className={`w-full text-left px-4 py-3.5 active:bg-gray-100 transition-colors flex items-center gap-3 ${className} ${
          isSelected ? 'bg-blue-50/40' : ''
        }`}
      >
        <KindThumb visual={ex.visual} imageRef={ex.imageRefs?.thumb} />
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
        <SelectCircle selected={isSelected} />
      </button>
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
                完成
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
          {/* 吸顶头：顶栏三段式 + 搜索 + 筛选胶囊行（backdrop-blur） */}
          <div
            className="z-20 px-4 bg-star-gray/85 backdrop-blur-md"
            style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)', paddingBottom: '10px' }}
          >
            {/* 顶栏三段式：取消 / 添加运动 / 创建（创建依赖后端 AI 分类，mock 不提供） */}
            <div className="flex items-center justify-between pb-3">
              <button
                onClick={onClose}
                aria-label="取消"
                className="h-11 px-5 rounded-full bg-white shadow-sm text-blue-500 text-[17px] font-medium active:scale-95 transition-transform"
              >
                取消
              </button>
              <h2 className="text-[17px] font-semibold text-star-dark">添加运动</h2>
              <span className="w-[76px]" aria-hidden="true" />
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
          <div className="flex-1 overflow-y-auto px-4 pb-36 custom-scrollbar">
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
              <button
                onClick={() => setScreen('browse')}
                aria-label="返回动作列表"
                className="w-11 h-11 shrink-0 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-600 active:scale-90 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <h2 className="text-[34px] leading-[41px] font-bold text-star-dark tracking-tight">训练清单</h2>
              <span className="w-11" />
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
                <p className="px-1 pb-2 text-[13px] font-semibold text-gray-400 uppercase tracking-widest">
                  训练顺序 · 点按动作配置参数
                </p>
                <div className="bg-white rounded-[20px] overflow-hidden shadow-sm">
                  {selected.map((item, idx) => (
                    <div
                      key={item.exercise.id}
                      className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <span className="w-8 h-8 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 tabular-nums">
                        {idx + 1}
                      </span>
                      <button
                        onClick={() => { haptic('light'); setConfigIdx(idx); }}
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
                      {/* 调序 */}
                      <span className="flex flex-col gap-0.5 shrink-0">
                        <button
                          onClick={() => moveItem(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`上移 ${item.exercise.name}`}
                          className="w-7 h-5 flex items-center justify-center text-gray-400 disabled:opacity-25 active:text-star-dark"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                          </svg>
                        </button>
                        <button
                          onClick={() => moveItem(idx, 1)}
                          disabled={idx === selected.length - 1}
                          aria-label={`下移 ${item.exercise.name}`}
                          className="w-7 h-5 flex items-center justify-center text-gray-400 disabled:opacity-25 active:text-star-dark"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                      </span>
                      {/* 移除 */}
                      <button
                        onClick={() => removeItem(idx)}
                        aria-label={`移除 ${item.exercise.name}`}
                        className="w-8 h-8 shrink-0 flex items-center justify-center text-gray-300 hover:text-red-500 active:text-red-500 rounded-full transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
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
    </motion.div>
  );
};

// 供演示页复用的类型/常量出口（业务接入不需要）
export { MOCK_EXERCISES as pickerDemoExercises };
export type { PickerDraftSet, PickerSelectionItem, PickerExercise, PickerExerciseType };

export default ExercisePickerModal;
