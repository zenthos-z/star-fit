/**
 * ExercisePickerModal — A8 筛选重构 + A9 购物车多选（mock 阶段，纯前端）
 *
 * A8：三行正交筛选（种类 segmented → 区域快速带 → 肌群 chips 随区域联动）、
 *     搜索兜底（中文/英文/拼音首字母）、智能排序只呈现结果（rank 预置，
 *     前 3「常用」徽标 + 穿插「为你推荐」徽标）、新手态热门排序 + 引导卡。
 * A9：行圈选连续添加不关弹窗，底部悬浮条实时计数；清单页顺序即训练顺序
 *     （可调序/移除），每动作只显参数摘要一行；参数详情由 PickerConfigSheet
 *     复用 ExerciseSettingsModal 形态承载。
 *
 * 样式锚点：src/components/ExerciseLibraryModal.tsx（star-gray 底、白卡
 * rounded-[20px]、17px medium 列表标题、吸顶筛选头、backdrop-blur）。
 * 数据：全部 mock（pickerData.ts），无 API 调用；对接后端时仅替换数据源。
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { haptic } from '../../lib/nativeHaptics';
import {
  KIND_LABELS,
  MOCK_EXERCISES,
  NEWBIE_GUIDE,
  REGION_LABELS,
  SOFT_LIMIT_COUNT,
  type PickerDraftSet,
  type PickerExercise,
  type PickerKind,
  type PickerRegion,
  type PickerSelectionItem,
} from './pickerData';
import {
  filterAndSortExercises,
  groupByMuscle,
  planToDraftSets,
  showCommonBadge,
  summaryOfItem,
} from './pickerLogic';
import PickerConfigSheet from './PickerConfigSheet';

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

/** 种类图标占位（SF Symbols 风格线条 SVG；image_refs 就位后替换为缩略图） */
function KindThumb({
  kind,
  imageRef,
}: {
  kind: PickerKind;
  imageRef?: string;
}) {
  if (imageRef) {
    return <img src={imageRef} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 bg-gray-100" />;
  }
  return (
    <span className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 text-gray-500">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6">
        {kind === 'strength' && (
          // 杠铃
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7v10M17 7v10M3.75 9.5v5M20.25 9.5v5M7 12h10" />
        )}
        {kind === 'stretch' && (
          // 双向延展
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5M3.75 12l3-3m-3 3l3 3m13.5-3l-3-3m3 3l-3 3" />
        )}
        {kind === 'cardio' && (
          // 心率
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2.25-5.25L12.75 17l2.25-5H21" />
        )}
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

/** 返回钮 — ExerciseLibraryModal 同规格：44pt 白底正圆 + 灰图标 */
function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
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
  const [kind, setKind] = useState<PickerKind | 'all'>('all');
  const [region, setRegion] = useState<PickerRegion | 'all'>('all');
  const [muscle, setMuscle] = useState<string | 'all'>('all');
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

  // 肌群 chips 随区域联动（当前区域下实际存在的肌群）
  const muscleOptions = useMemo(() => {
    const pool = region === 'all' ? MOCK_EXERCISES : MOCK_EXERCISES.filter(ex => ex.region === region);
    return [...new Set(pool.map(ex => ex.muscle))];
  }, [region]);

  const filtered = useMemo(
    () => filterAndSortExercises(MOCK_EXERCISES, { kind, region, muscle }, searchTerm, hasHistory),
    [kind, region, muscle, searchTerm, hasHistory],
  );
  const groups = useMemo(() => groupByMuscle(filtered), [filtered]);
  const selectedIds = useMemo(() => new Set(selected.map(i => i.exercise.id)), [selected]);

  const selectKind = (k: PickerKind | 'all') => {
    haptic('light');
    setKind(k);
  };
  const selectRegion = (r: PickerRegion | 'all') => {
    haptic('light');
    setRegion(r);
    setMuscle('all'); // 区域切换后肌群带联动重置
  };
  const selectMuscle = (m: string | 'all') => {
    haptic('light');
    setMuscle(m);
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

  const clearAllFilters = () => {
    setSearchTerm('');
    setKind('all');
    setRegion('all');
    setMuscle('all');
  };

  const filterChipsActive = kind !== 'all' || region !== 'all' || muscle !== 'all';
  const showSoftLimitHint = selected.length >= SOFT_LIMIT_COUNT;

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
          {/* 吸顶筛选头：导航 + 搜索 + 三行正交筛选（backdrop-blur） */}
          <div
            className="z-20 px-4 bg-star-gray/85 backdrop-blur-md"
            style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)', paddingBottom: '10px' }}
          >
            {/* 导航行 — Large Title 34 */}
            <div className="flex items-center justify-between pb-2">
              <BackButton onClick={onClose} label="返回" />
              <h2 className="text-[34px] leading-[41px] font-bold text-star-dark tracking-tight">添加动作</h2>
              <span className="w-11" />
            </div>

            {/* 搜索兜底：中文/英文/拼音首字母 */}
            <div className="bg-black/[0.06] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 mb-3">
              <Search size={18} className="text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="搜索中文名、英文或拼音首字母"
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

            {/* 行1：种类 segmented（iOS 17 分段控件） */}
            <div className="flex bg-black/[0.06] rounded-full p-0.5 mb-2" role="tablist" aria-label="动作种类">
              {(['all', 'strength', 'stretch', 'cardio'] as const).map(k => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => selectKind(k)}
                  className={`flex-1 py-1.5 rounded-full text-[13px] font-semibold transition-all ${
                    kind === k ? 'bg-white shadow-sm text-star-dark' : 'text-gray-500'
                  }`}
                >
                  {k === 'all' ? '全部' : KIND_LABELS[k]}
                </button>
              ))}
            </div>

            {/* 行2：区域快速带 */}
            <div className="flex gap-2 mb-2 overflow-x-auto" role="tablist" aria-label="身体区域">
              {(['all', 'upper', 'lower', 'core'] as const).map(r => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={region === r}
                  onClick={() => selectRegion(r)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-all ${
                    region === r
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white border-gray-200 text-gray-600'
                  }`}
                >
                  {r === 'all' ? '全身' : REGION_LABELS[r]}
                </button>
              ))}
            </div>

            {/* 行3：肌群 chips（随区域联动） */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="肌群">
              <button
                onClick={() => selectMuscle('all')}
                aria-selected={muscle === 'all'}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                  muscle === 'all' ? 'bg-star-dark border-star-dark text-white' : 'bg-white border-gray-200 text-gray-500'
                }`}
              >
                全部肌群
              </button>
              {muscleOptions.map(m => (
                <button
                  key={m}
                  onClick={() => selectMuscle(m)}
                  aria-selected={muscle === m}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                    muscle === m ? 'bg-star-dark border-star-dark text-white' : 'bg-white border-gray-200 text-gray-500'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto px-4 pb-36 custom-scrollbar">
            {/* 新手态引导卡（无历史：热门排序降级说明） */}
            {!hasHistory && !searchTerm && filtered.length > 0 && (
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

            {filtered.length === 0 ? (
              <div className="text-center py-20 px-6">
                <p className="text-gray-400 text-lg mb-6">
                  未找到 {searchTerm ? `"${searchTerm}"` : '符合条件的动作'}
                </p>
                {(searchTerm || filterChipsActive) && (
                  <button
                    onClick={clearAllFilters}
                    className="bg-star-dark text-white rounded-full px-6 h-11 text-[15px] font-semibold active:scale-95 transition-all"
                  >
                    清除搜索与筛选
                  </button>
                )}
              </div>
            ) : (
              groups.map(group => (
                <div key={group.muscle} className="mb-6">
                  <h3 className="px-1 pb-2 text-[13px] font-semibold text-gray-400 uppercase tracking-widest">{group.muscle}</h3>
                  <div className="bg-white rounded-[20px] overflow-hidden shadow-sm">
                    {group.items.map(ex => {
                      const isSelected = selectedIds.has(ex.id);
                      return (
                        <button
                          key={ex.id}
                          onClick={() => toggleSelect(ex)}
                          aria-pressed={isSelected}
                          aria-label={`${isSelected ? '取消选择' : '选择'} ${ex.name}`}
                          className={`w-full text-left px-4 py-3 active:bg-gray-100 transition-colors flex items-center gap-3 ${
                            isSelected ? 'bg-blue-50/40' : ''
                          }`}
                        >
                          <KindThumb kind={ex.kind} imageRef={ex.imageRefs?.thumb} />
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
                            <span className="block text-[13px] text-gray-400 font-medium mt-0.5 truncate">
                              {ex.muscles.join(' · ')} · {ex.equipment}
                            </span>
                          </span>
                          <SelectCircle selected={isSelected} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
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
              <BackButton onClick={() => setScreen('browse')} label="返回动作列表" />
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
                            {KIND_LABELS[item.exercise.kind]}
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
export type { PickerDraftSet, PickerSelectionItem, PickerExercise };

export default ExercisePickerModal;
