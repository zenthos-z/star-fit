import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, WifiOff, RefreshCw, Search } from 'lucide-react';
import { guessExerciseType } from '@/utils/exerciseLogic';
import { ExerciseLibraryService } from '../services/exerciseLibraryService';
import { haptic } from '../src/lib/nativeHaptics';

interface ExerciseLibraryModalProps {
  onSelect: (id: string, name: string, defaultType?: string, bodyCategory?: string, muscles?: string[], equipment?: string) => void;
  onClose: () => void;
  isCreatingMode?: boolean;
  onCancelCreate?: () => void;
}

// 后端返回的动作类型
interface Exercise {
  id: string;
  name: string;
  exercise_type: string;
  targets: {
    primary: string[];
    secondary?: string[];
  };
  equipment_required?: string[];
  // Legacy fields for compatibility
  body_category?: string;
  muscle_groups?: {
    primary?: string[];
    secondary?: string[];
    stabilizers?: string[];
  };
}

// 肌肉分区映射到中文分类名
const MUSCLE_TO_CATEGORY: Record<string, string> = {
  // 上肢
  '上胸': '胸部',
  '中下胸': '胸部',
  '前束': '肩部',
  '中束': '肩部',
  '后束': '肩部',
  '二头': '手臂',
  '三头': '手臂',
  '小臂': '手臂',
  // 躯干
  '背部': '背部',
  '下背': '背部',
  '斜方肌': '肩部',
  '腹肌': '核心',
  '侧腹': '核心',
  // 下肢
  '股四': '腿部',
  '腘绳': '腿部',
  '小腿': '腿部',
  '上臀部': '腿部',
  '下臀部': '腿部',
};

/** 同步状态文案：与真实 sync 结果严格对应（失败不伪装成刚刚同步） */
function formatLastSyncTime(timestamp: number | null): string {
  if (!timestamp) return '未同步';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / (60 * 1000));
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));

  if (days > 0) return `${days} 天前更新`;
  if (hours > 0) return `${hours} 小时前更新`;
  if (minutes > 0) return `${minutes} 分钟前更新`;
  return '刚刚更新';
}

const ExerciseLibraryModal: React.FC<ExerciseLibraryModalProps> = ({ onSelect, onClose, isCreatingMode = false, onCancelCreate }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cacheStatus, setCacheStatus] = useState<{
    lastSyncTime: number | null;
    isExpired: boolean;
    isSyncing: boolean;
    lastError?: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const loadExercises = async () => {
      try {
        const data = await ExerciseLibraryService.getExercises();
        setExercises(data);
        setLoading(false);
      } catch (error) {
        console.error('[ExerciseLibraryModal] Failed to load exercises:', error);
        setLoading(false);
      }
    };

    const loadCacheStatus = async () => {
      const status = await ExerciseLibraryService.getCacheStatus();
      setCacheStatus({
        lastSyncTime: status.lastSyncTime,
        isExpired: status.isExpired,
        isSyncing: status.isSyncing,
        ...(status.lastError ? { lastError: status.lastError } : {})
      });
    };

    loadExercises();
    loadCacheStatus();
  }, []);

  useEffect(() => {
    const unsubscribe = ExerciseLibraryService.subscribe(async () => {
      const data = await ExerciseLibraryService.getExercises();
      setExercises(data);
      const status = await ExerciseLibraryService.getCacheStatus();
      setCacheStatus({
        lastSyncTime: status.lastSyncTime,
        isExpired: status.isExpired,
        isSyncing: status.isSyncing,
        ...(status.lastError ? { lastError: status.lastError } : {})
      });
    });

    return unsubscribe;
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 8);
  }, []);

  /**
   * 更新动作库：真实同步——结果只有三种，全部如实反映
   * ① 成功 → 状态更新为「刚刚更新」
   * ② 失败但旧缓存仍在 → 状态回到旧缓存时间 + 「上次同步失败」琥珀色提示
   * ③ 失败且无缓存 → 「未同步」
   * 绝不在失败时把时间刷成「刚刚」。
   */
  const handleRefresh = async () => {
    if (!isOnline || isRefreshing) {
      return;
    }

    haptic('light');
    setIsRefreshing(true);
    try {
      const data = await ExerciseLibraryService.forceRefresh();
      setExercises(data);
      const status = await ExerciseLibraryService.getCacheStatus();
      setCacheStatus({
        lastSyncTime: status.lastSyncTime,
        isExpired: status.isExpired,
        isSyncing: status.isSyncing,
        ...(status.lastError ? { lastError: status.lastError } : {})
      });
    } catch (error) {
      console.error('[ExerciseLibraryModal] Failed to refresh exercises:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const guessType = (name: string, cat: string) => {
      return guessExerciseType(name, cat);
  };

  // 将后端数据转换为按分类分组的结构，并保留完整的动作信息
  const getLibrary = () => {
    const grouped: Record<string, Array<{ name: string; type: string; bodyCategory?: string; muscles?: string[]; equipment?: string }>> = {};

    exercises.forEach(ex => {
      // Get primary targets from the new targets structure
      const primaryTargets = ex.targets?.primary || [];

      if (primaryTargets.length > 0) {
        // Use the first primary target to determine category
        const firstTarget = primaryTargets[0];
        const categoryName = MUSCLE_TO_CATEGORY[firstTarget] || firstTarget;

        if (!grouped[categoryName]) {
          grouped[categoryName] = [];
        }

        const equipment = Array.isArray(ex.equipment_required) ? ex.equipment_required[0] : '';

        grouped[categoryName].push({
          name: ex.name,
          type: ex.exercise_type || 'resistance',
          bodyCategory: categoryName, // For compatibility with handleLibrarySelect
          muscles: primaryTargets,
          equipment
        });
      } else {
        // Fallback for exercises without targets (use '其他' category)
        const categoryName = '其他';
        if (!grouped[categoryName]) {
          grouped[categoryName] = [];
        }

        const equipment = Array.isArray(ex.equipment_required) ? ex.equipment_required[0] : '';

        grouped[categoryName].push({
          name: ex.name,
          type: ex.exercise_type || 'resistance',
          bodyCategory: categoryName,
          muscles: [],
          equipment
        });
      }
    });

    return grouped;
  };

  // Filter logic preserves the category structure
  const getFilteredLibrary = () => {
    const library = getLibrary();

    if (!searchTerm) return library;

    const filtered: Record<string, Array<{ name: string; type: string; bodyCategory?: string; muscles?: string[]; equipment?: string }>> = {};
    Object.entries(library).forEach(([cat, items]) => {
        const matchingItems = items.filter(item =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (matchingItems.length > 0) {
            filtered[cat] = matchingItems;
        }
    });
    return filtered;
  };

  const handleSmartCreate = async () => {
      if (!searchTerm) return;
      haptic('medium');
      setIsClassifying(true);
      try {
          const response = await fetch('/api/agent/classify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: searchTerm })
          });

          if (response.ok) {
              const data = await response.json();
              onSelect(
                  '', // New exercise has no id
                  searchTerm,
                  data.type,
                  data.bodyCategory,
                  data.primaryMuscles,
                  data.equipment
              );
          } else {
              // Fallback to basic guess if API fails
              onSelect('', searchTerm, guessType(searchTerm, ''));
          }
      } catch (error) {
          console.error("Smart Fill failed:", error);
          onSelect('', searchTerm, guessType(searchTerm, ''));
      } finally {
          setIsClassifying(false);
      }
  };

  const handleBack = () => {
    haptic('light');
    if (isCreatingMode && onCancelCreate) {
      onCancelCreate();
    } else {
      onClose();
    }
  };

  const displayLibrary = getFilteredLibrary();
  const isEmptyLibrary = Object.keys(displayLibrary).length === 0;
  /** 同步失败过（本次会话内）且当前不在线上刷新成功 → 琥珀提示 */
  const showSyncError = !!cacheStatus?.lastError && isOnline;
  /** 离线但已有缓存 */
  const showOfflineCache = !isOnline && !!cacheStatus?.lastSyncTime;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      transition={{
        type: 'tween',
        duration: 0.25,
        ease: 'easeOut'
      }}
      className="fixed inset-0 z-[70] bg-star-gray flex flex-col overflow-hidden"
    >
      {/* iOS Large Title 导航栏 — 与 History 页同规格：滚动折叠居中小标题 */}
      <div
        className="sticky top-0 z-20 bg-star-gray/85 backdrop-blur-md"
        style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)' }}
      >
        <div className="relative flex items-center h-11 px-4">
            {/* HIG：返回钮左上角，44pt 命中区 */}
            <button
              onClick={handleBack}
              aria-label="返回"
              className="flex items-center -ml-2 pr-3 text-star-accent active:opacity-50 transition-opacity"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-7 h-7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            {/* 折叠居中小标题（滚动后淡入） */}
            <span
              className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold text-star-dark transition-opacity duration-200 pointer-events-none"
              style={{ opacity: isScrolled ? 1 : 0 }}
              aria-hidden={!isScrolled}
            >
              动作库
            </span>

            {/* HIG：动作与状态贴近——「最近更新 + 更新钮」一体放在导航栏右侧 */}
            <div className="ml-auto flex items-center gap-2">
                <span
                  className={`text-xs whitespace-nowrap ${
                    showSyncError
                      ? 'text-amber-500'
                      : showOfflineCache
                        ? 'text-gray-400'
                        : cacheStatus?.isExpired && isOnline
                          ? 'text-amber-500'
                          : 'text-gray-400'
                  }`}
                >
                  {formatLastSyncTime(cacheStatus?.lastSyncTime ?? null)}
                </span>
                {isOnline && (
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    aria-label="更新动作库"
                    className="w-9 h-9 rounded-full bg-white shadow-sm text-gray-500 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50"
                  >
                    <RefreshCw size={17} className={isRefreshing ? 'animate-spin' : ''} />
                  </button>
                )}
            </div>
        </div>

        {/* Large Title — 滚动时折叠（History 页同规格） */}
        <h2
          className="px-4 text-[34px] leading-[41px] font-black text-star-dark tracking-tight transition-all duration-200 overflow-hidden"
          style={{ opacity: isScrolled ? 0 : 1, maxHeight: isScrolled ? 0 : 60, marginBottom: isScrolled ? 0 : 8 }}
        >
          动作库
        </h2>
      </div>

      {/* Search — iOS 风格圆角灰底搜索框 */}
      <div className="px-4 pt-1 pb-3">
          <div className="bg-black/[0.06] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
              <Search size={18} className="text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="搜索动作..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="bg-transparent outline-none w-full text-[17px] font-medium placeholder-gray-400"
              />
              {searchTerm && (
                  <button onClick={() => setSearchTerm("")} aria-label="清除搜索" className="text-gray-400 p-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
                  </button>
              )}
          </div>
      </div>

      {/* 同步失败提示条 — 真实反馈，只在失败时出现 */}
      <AnimatePresence>
        {showSyncError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 overflow-hidden"
          >
            <div className="bg-amber-50 text-amber-600 text-xs font-medium rounded-xl px-3.5 py-2.5 mb-1">
              上次更新失败，当前显示的是缓存数据
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grouped List */}
      <div
        className="flex-1 overflow-y-auto px-4 pb-20 custom-scrollbar"
        onScroll={handleScroll}
      >
          {loading ? (
               <div className="flex items-center justify-center h-full">
                   <div className="text-center">
                       <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-star-dark rounded-full animate-spin mb-4"></div>
                       <p className="text-gray-400">加载动作库中...</p>
                   </div>
               </div>
          ) : isEmptyLibrary ? (
               <div className="text-center py-20 px-6">
                   {!isOnline && cacheStatus && cacheStatus.lastSyncTime === null ? (
                       <>
                           <WifiOff size={48} className="mx-auto text-gray-400 mb-4" />
                           <p className="text-gray-400 text-lg mb-6">网络离线，暂无动作库缓存</p>
                           <p className="text-sm text-gray-400 mb-6">连接网络后将自动同步动作库数据</p>
                       </>
                   ) : searchTerm ? (
                       <>
                           <p className="text-gray-400 text-lg mb-6">未找到 "{searchTerm}"</p>

                   {/* Primary Action: AI Smart Create */}
                   <button
                       onClick={handleSmartCreate}
                       disabled={isClassifying || !isOnline}
                       className="w-full max-w-sm mx-auto bg-star-dark text-white rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-between px-5 py-4 disabled:opacity-50"
                   >
                       <div className="flex flex-col items-start">
                           <span className="text-sm text-gray-400 font-medium mb-0.5">创建新动作</span>
                           <span className="text-lg font-bold text-white flex items-center gap-2">
                               {searchTerm}
                               <span className="bg-star-accent/15 text-star-accent text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider border border-star-accent/30">AI</span>
                           </span>
                       </div>

                       <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                           {isClassifying ? (
                               <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                           ) : (
                               <Zap className="w-5 h-5 text-star-accent fill-star-accent/20" />
                           )}
                       </div>
                   </button>

                   <p className="text-xs text-gray-400 mt-4 max-w-xs mx-auto leading-relaxed">
                       系统将使用 AI 自动分析动作类型、目标肌群和器械需求，并为您预设合适的训练参数。
                   </p>

                   {/* Secondary Action: Quick Create (Legacy) */}
                   <button
                       onClick={() => onSelect('', searchTerm, guessType(searchTerm, ''))}
                       className="mt-6 text-sm font-bold text-star-accent active:opacity-50 transition-opacity"
                   >
                       跳过 AI 分析，直接创建 &rarr;
                   </button>
                       </>
                   ) : null}
               </div>
          ) : (
               Object.entries(displayLibrary).map(([category, items]) => (
                   <div key={category} className="mb-8">
                       <div className="sticky top-0 bg-star-gray/95 backdrop-blur py-3 z-10">
                           <h3 className="px-1 text-[13px] font-semibold text-gray-400 uppercase tracking-widest">{category}</h3>
                       </div>
                       <div className="bg-white rounded-[20px] overflow-hidden shadow-sm">
                           {items.map((item, idx) => (
                               <button
                                 key={(item as any).id || item.name}
                                 onClick={() => { haptic('light'); onSelect((item as any).id || item.name, item.name, item.type, item.bodyCategory, item.muscles, item.equipment); }}
                                 className={`w-full text-left px-5 py-3.5 active:bg-gray-100 transition-colors flex justify-between items-center group ${
                                   idx > 0 ? 'border-t border-gray-100' : ''
                                 }`}
                               >
                                   <span className="text-[17px] font-medium text-star-dark">{item.name}</span>
                                   <svg className="w-4 h-4 text-star-accent opacity-0 group-active:opacity-100 transition-opacity shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                               </button>
                           ))}
                       </div>
                   </div>
               ))
          )}
      </div>
    </motion.div>
  );
};

export default ExerciseLibraryModal;
