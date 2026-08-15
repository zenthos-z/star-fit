import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../services/geminiService';
import { Zap, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { guessExerciseType } from '@/utils/exerciseLogic';
import { ExerciseLibraryService } from '../services/exerciseLibraryService';

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

const ExerciseLibraryModal: React.FC<ExerciseLibraryModalProps> = ({ onSelect, onClose, isCreatingMode = false, onCancelCreate }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cacheStatus, setCacheStatus] = useState<{ lastSyncTime: number | null; isExpired: boolean } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
        isExpired: status.isExpired
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
        isExpired: status.isExpired
      });
    });

    return unsubscribe;
  }, []);

  const handleRefresh = async () => {
    if (!isOnline) {
      return;
    }

    setIsRefreshing(true);
    try {
      const data = await ExerciseLibraryService.forceRefresh();
      setExercises(data);
      const status = await ExerciseLibraryService.getCacheStatus();
      setCacheStatus({
        lastSyncTime: status.lastSyncTime,
        isExpired: status.isExpired
      });
    } catch (error) {
      console.error('[ExerciseLibraryModal] Failed to refresh exercises:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatLastSyncTime = (timestamp: number | null) => {
    if (!timestamp) return '未同步';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (60 * 1000));
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));

    if (days > 0) return `${days}天前同步`;
    if (hours > 0) return `${hours}小时前同步`;
    if (minutes > 0) return `${minutes}分钟前同步`;
    return '刚刚同步';
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

  const displayLibrary = getFilteredLibrary();

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
      className="fixed inset-0 z-[70] bg-white flex flex-col animate-in fade-in slide-in-from-bottom-10"
    >
       {/* Header */}
       <div className="px-6 pt-12 pb-4 border-b border-gray-100 flex items-center gap-4 bg-white/80 backdrop-blur-md sticky top-0 z-20">
           <button onClick={() => {
             if (isCreatingMode && onCancelCreate) {
               onCancelCreate();
             } else {
               onClose();
             }
           }} className="p-3 -ml-3 text-gray-400 hover:text-black active:scale-90 transition-transform">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-8 h-8">
               <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
             </svg>
           </button>
           <div className="flex-1 flex items-center gap-2">
             <h2 className="text-2xl font-black tracking-tight">动作库</h2>
             {cacheStatus && (
               <div className="flex items-center gap-2">
                 {isOnline ? (
                   <Wifi size={16} className="text-green-500" />
                 ) : (
                   <WifiOff size={16} className="text-red-500" />
                 )}
                 <span className="text-xs text-gray-400">
                   {formatLastSyncTime(cacheStatus.lastSyncTime)}
                   {cacheStatus.isExpired && isOnline && (
                     <span className="text-orange-500 ml-1">(需更新)</span>
                   )}
                 </span>
               </div>
             )}
           </div>
           {isOnline && (
             <button
               onClick={handleRefresh}
               disabled={isRefreshing}
               className="p-3 -mr-3 text-gray-400 hover:text-black active:scale-90 transition-transform disabled:opacity-50"
             >
               <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
             </button>
           )}
       </div>

       {/* Search - Big Input */}
       <div className="px-6 py-4">
           <div className="bg-gray-100 rounded-2xl px-5 py-4 flex items-center gap-3 shadow-inner">
               <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
               <input
                 type="text"
                 placeholder="搜索动作..."
                 value={searchTerm}
                 onChange={e => setSearchTerm(e.target.value)}
                 className="bg-transparent outline-none w-full text-xl font-medium placeholder-gray-400"
               />
               {searchTerm && (
                   <button onClick={() => setSearchTerm("")} className="text-gray-400 p-1">
                       <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
                   </button>
               )}
           </div>
       </div>

       {/* Grouped List */}
       <div className="flex-1 overflow-y-auto px-6 pb-20 custom-scrollbar">
           {loading ? (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                        <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-star-dark rounded-full animate-spin mb-4"></div>
                        <p className="text-gray-400">加载动作库中...</p>
                    </div>
                </div>
           ) : Object.keys(displayLibrary).length === 0 ? (
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
                        className="w-full max-w-sm mx-auto bg-star-dark text-white p-1 rounded-2xl shadow-lg active:scale-95 transition-all group overflow-hidden relative"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-violet-600 via-purple-600 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                        <div className="relative bg-gray-900 rounded-xl px-6 py-4 flex items-center justify-between group-hover:bg-opacity-90 transition-all">
                            <div className="flex flex-col items-start">
                                <span className="text-sm text-gray-400 font-medium mb-0.5">创建新动作</span>
                                <span className="text-lg font-bold text-white flex items-center gap-2">
                                    {searchTerm}
                                    <span className="bg-violet-500/20 text-violet-300 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider border border-violet-500/30">AI</span>
                                </span>
                            </div>

                            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                                {isClassifying ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <Zap className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                                )}
                            </div>
                        </div>
                    </button>

                    <p className="text-xs text-gray-400 mt-4 max-w-xs mx-auto leading-relaxed">
                        系统将使用 AI 自动分析动作类型、目标肌群和器械需求，并为您预设合适的训练参数。
                    </p>

                    {/* Secondary Action: Quick Create (Legacy) */}
                    <button
                        onClick={() => onSelect('', searchTerm, guessType(searchTerm, ''))}
                        className="mt-6 text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        跳过 AI 分析，直接创建 &rarr;
                    </button>
                        </>
                    ) : null}
                </div>
           ) : (
               Object.entries(displayLibrary).map(([category, items]) => (
                   <div key={category} className="mb-8">
                       <div className="sticky top-0 bg-white/95 backdrop-blur py-3 z-10 border-b border-gray-100">
                           <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest">{category}</h3>
                       </div>
                       <div className="space-y-3 pt-3">
                           {items.map((item) => (
                               <button
                                 key={(item as any).id || item.name}
                                 onClick={() => onSelect((item as any).id || item.name, item.name, item.type, item.bodyCategory, item.muscles, item.equipment)}
                                 className="w-full text-left p-5 rounded-2xl bg-gray-50 border border-gray-100 active:bg-star-dark active:text-white transition-all flex justify-between items-center group shadow-sm"
                               >
                                   <span className="text-lg font-bold group-active:text-white text-gray-800">{item.name}</span>
                                   <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
                                       <svg className="w-4 h-4 text-star-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                   </div>
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
