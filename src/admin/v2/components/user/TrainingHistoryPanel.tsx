/**
 * Training History Panel Component (High-Density Redesign)
 *
 * A compact, high-density visualization of user training history.
 * 
 * Features:
 * - Timeline layout for better continuity
 * - High-density "Capsule" view for sets (no expanding needed)
 * - Strict alignment with App exercise types (resistance, cardio, etc.)
 * - robust error handling for raw_json parsing
 *
 * @module TrainingHistoryPanel
 */

import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, AlertTriangle, ArrowRight, Play, CheckCircle2, XCircle, Search, Filter, Dumbbell, Activity, Footprints, Calendar, Clock, BarChart3, ChevronLeft, ChevronRight, User, HelpCircle, Minimize, Heart, MapPin, Zap, Check, X, ChevronsLeft, ChevronsRight, ClipboardList } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { formatDistanceToNow, format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addYears, subYears } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { AppExerciseType, getExerciseType } from '../../services/types';
import { TrainingStatsSidebar } from './stats/TrainingStatsSidebar';
import { MarkdownRenderer } from '../../../../components/MarkdownRenderer';
import { parseJSONSafe } from '../../../../types/validation';

interface Set {
  id?: string;
  weight?: number;
  reps?: number;
  rpe?: number;
  rest?: number;
  distance?: number;
  duration?: number;
  completed?: boolean;
}

interface Exercise {
  name: string;
  type?: string;
  sets: Set[];
  body_category?: string;
  equipment_required?: string; // JSON string
  muscle_groups?: string; // JSON string
  metadata?: {
    cardioMode?: 'TIME_COUNTDOWN' | 'DISTANCE_TARGET' | 'FREE_RUN';
    [key: string]: any;
  };
}

interface Session {
  id: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  duration?: number;
  title?: string;
  raw_json?: string;
  ai_audit_text?: string;
}

interface TrainingHistoryPanelProps {
  userId: string;
  loading: boolean;
  onSessionDeleted: () => void;
  onSessionDelete?: (sessionId: string) => Promise<void>;
  onLoadMoreSessions?: (limit: number, offset: number) => Promise<Session[]>;
}

// --- Types ---

// --- Icons & Helpers ---

const getTypeIcon = (type: AppExerciseType) => {
  switch (type) {
    case 'resistance': return <Dumbbell size={14} className="text-purple-500" />;
    case 'bodyweight': return <User size={14} className="text-blue-500" />;
    case 'assisted': return <HelpCircle size={14} className="text-indigo-500" />;
    case 'isometric': return <Minimize size={14} className="text-slate-500" />;
    case 'cardio': return <Heart size={14} className="text-rose-500" />;
    case 'outdoor': return <MapPin size={14} className="text-emerald-500" />;
    default: return <Activity size={14} className="text-gray-400" />;
  }
};



const formatDurationShort = (seconds: number) => {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hrs}h ${remainingMins}m`;
};

// --- Sub-Components ---

// 1. Set Capsule: The core high-density unit
// Shows "100x8 RPE8 60s" depending on data
const SetCapsule: React.FC<{ set: Set; type: AppExerciseType; index: number }> = ({ set, type, index }) => {
  const isResistance = ['resistance', 'bodyweight', 'assisted'].includes(type);
  const isCardio = ['cardio', 'outdoor'].includes(type);
  const isIsometric = type === 'isometric';

  // High intensity highlight (RPE >= 8)
  const isHard = set.rpe !== undefined && set.rpe >= 8;
  const isRpe9_10 = set.rpe !== undefined && set.rpe >= 9;

  let mainContent = '—';
  let subContent = '';

  if (isResistance) {
    if (set.weight !== undefined && set.weight > 0) {
      mainContent = `${set.weight}kg × ${set.reps || 0}`;
    } else if (set.reps) {
      mainContent = `${set.reps} reps`;
    }
  } else if (isCardio) {
    if (set.distance) {
      mainContent = `${(set.distance / 1000).toFixed(2)}km`;
    } else if (set.duration) {
      mainContent = formatDurationShort(set.duration);
    }
  } else if (isIsometric) {
    mainContent = set.duration ? `${set.duration}s` : 'Hold';
  }

  // Add RPE and Rest info
  const details = [];
  if (set.rpe !== undefined) details.push(`RPE${set.rpe}`);
  if (set.rest !== undefined && set.rest > 0) details.push(`${set.rest}s`);
  if (details.length > 0) subContent = details.join(' · ');

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded border transition-colors hover:shadow-sm
        ${isRpe9_10
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : isHard
            ? 'bg-orange-50 text-orange-700 border-orange-200'
            : 'bg-white text-gray-700 border-gray-200'}
      `}
      title={`组 ${index + 1}`}
    >
      <span className="text-[10px] opacity-40 font-mono w-3">{index + 1}</span>
      <span className="font-semibold">{mainContent}</span>
      {subContent && (
        <span className={`text-[10px] ${isHard ? 'opacity-80' : 'text-gray-400'}`}>
          {subContent}
        </span>
      )}
    </div>
  );
};

// Helper to safely parse JSON or return array (handles JSONB objects)
const safeJsonArray = (input: any): string[] => {
  if (Array.isArray(input)) return input;
  const parsed = parseJSONSafe<string[]>(input, 'safeJsonArray');
  if (Array.isArray(parsed)) return parsed;
  if (typeof input === 'string' && input) return [input];
  return [];
};

// 2. Exercise Row: One line per exercise, horizontal scrolling for sets
const ExerciseRow: React.FC<{ exercise: Exercise }> = ({ exercise }) => {
  const type = getExerciseType(exercise);
  const sets = exercise.sets || [];

  // derivation of tags
  const tags: { label: string; color: string }[] = [];

  // 1. Body Category (High Priority)
  if (exercise.body_category) {
    tags.push({ label: exercise.body_category, color: 'bg-blue-50 text-blue-700 border-blue-100' });
  }

  // 2. Equipment (Medium Priority) - Parse JSON if needed
  const equipment = safeJsonArray(exercise.equipment_required);
  if (equipment.length > 0) {
    // Take at most 2 items to avoid clutter
    equipment.slice(0, 2).forEach(eq => {
      tags.push({ label: eq, color: 'bg-gray-100 text-gray-600 border-gray-200' });
    });
  }

  // 3. Muscle Groups (Low Priority, if no body category)
  if (!exercise.body_category) {
    const muscles = safeJsonArray(exercise.muscle_groups);
    if (muscles.length > 0) {
      tags.push({ label: muscles[0], color: 'bg-indigo-50 text-indigo-700 border-indigo-100' });
    }
  }

  // 4. Cardio Mode (Specific for cardio)
  if (exercise.metadata?.cardioMode) {
    const modeMap: Record<string, string> = {
      'TIME_COUNTDOWN': '倒计时',
      'DISTANCE_TARGET': '目标距离',
      'FREE_RUN': '自由模式'
    };
    const modeLabel = modeMap[exercise.metadata.cardioMode];
    if (modeLabel) {
      tags.push({ label: modeLabel, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' });
    }
  }

  // 5. Exercise Type (Fallback or specific contexts)
  const typeLabelMap: Record<string, string> = {
    'resistance': '力量',
    'bodyweight': '自重',
    'cardio': '有氧',
    'assisted': '辅助',
    'isometric': '静力',
    'outdoor': '户外'
  };
  // Only show generic type if no specific cardio mode is shown to avoid redundancy
  // e.g. "Outdoor" + "Free Mode" is fine, but maybe "Cardio" + "Countdown" is better than just "Cardio"
  const typeLabel = typeLabelMap[type];
  if (typeLabel) {
    tags.push({ label: typeLabel, color: 'bg-orange-50 text-orange-700 border-orange-100' });
  }

  return (
    <div className="group relative flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 rounded-lg px-2 -mx-2 transition-colors">
      {/* Header Column: Name + Icon + Count */}
      <div className="flex items-center gap-2 sm:w-48 sm:flex-shrink-0 pt-1">
        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-100 shadow-sm">
          {getTypeIcon(type)}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-gray-800 truncate" title={exercise.name}>
            {exercise.name}
          </h4>

          {/* Tags Row */}
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.map((tag, i) => (
              <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded border ${tag.color} whitespace-nowrap`}>
                {tag.label}
              </span>
            ))}
            {tags.length === 0 && (
              <span className="text-[10px] text-gray-300">无属性</span>
            )}
          </div>

          <div className="text-[10px] text-gray-400 mt-0.5">
            {sets.length} 组动作
          </div>
        </div>
      </div>

      {/* Sets Column: Wrap Flow */}
      <div className="flex-1 flex flex-wrap gap-2 items-center">
        {sets.map((set, idx) => (
          <SetCapsule key={idx} set={set} type={type} index={idx} />
        ))}
        {sets.length === 0 && (
          <span className="text-xs text-gray-300 italic px-2">未记录组数据</span>
        )}
      </div>
    </div>
  );
};

// 3. Session Card: The container for a workout
const SessionCard: React.FC<{
  session: Session;
  onDelete: (id: string) => void;
  onShowAudit: (session: Session) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
}> = ({ session, onDelete, onShowAudit, confirmDeleteId, setConfirmDeleteId }) => {
  const date = new Date(session.start_time);

  // Safe parsing - handles both JSON strings and parsed objects (JSONB)
  const sessionData = parseJSONSafe<any>(session.raw_json, 'TrainingHistoryPanel session.raw_json') || {};
  const exercises: Exercise[] = sessionData.exercises || [];

  const durationMins = Math.round((session.duration || sessionData.duration || 0) / 60);
  const title = session.title || sessionData.title || '训练记录';
  const isConfirming = confirmDeleteId === session.id;

  // Calculate total volume for badge
  const totalVolume = exercises.reduce((acc, ex) => {
    return acc + (ex.sets || []).reduce((sAcc, s) => sAcc + ((s.weight || 0) * (s.reps || 0)), 0);
  }, 0);

  return (
    <div className="pl-4 sm:pl-6 pb-8 relative border-l border-gray-200 last:border-0 last:pb-0">
      {/* Timeline Bullet */}
      <div className="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-gray-300 ring-4 ring-white" />

      {/* Date Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
        </span>
        <span className="text-xs text-gray-400">
          {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Card Content */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden group">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50/50 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-gray-900 text-sm sm:text-base">{title}</h3>

            {/* Stats Badges */}
            <div className="flex items-center gap-2 text-[10px] sm:text-xs">
              <span className="flex items-center gap-1 text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-100 text-nowrap">
                <Clock size={10} />
                {durationMins}分钟
              </span>
              {totalVolume > 0 && (
                <span className="flex items-center gap-1 text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-100 hidden sm:flex text-nowrap">
                  <Zap size={10} className="text-amber-500" />
                  {Math.round(totalVolume / 1000)}k kg
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center pl-2 gap-2">
            {session.ai_audit_text && (
              <button
                onClick={() => onShowAudit(session)}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 border-dashed rounded-lg hover:bg-emerald-100 transition-colors"
                title="查看 AI 审计报告"
              >
                <ClipboardList size={12} />
                查看AI审计
              </button>
            )}

            {isConfirming ? (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200 bg-white shadow-sm p-1 rounded-lg border border-red-100">
                <span className="text-xs text-red-600 font-medium whitespace-nowrap px-1">确认删除?</span>
                <button
                  onClick={() => onDelete(session.id)}
                  className="p-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                  title="确认"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="p-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200"
                  title="取消"
                >
                  <Minimize size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(session.id)}
                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                title="删除记录"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Exercises List (Always visible) */}
        <div className="p-3">
          {exercises.length > 0 ? (
            exercises.map((ex, idx) => (
              <ExerciseRow key={idx} exercise={ex} />
            ))
          ) : (
            <div className="text-center py-4 text-xs text-gray-400 italic">
              本次训练未记录动作
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

// --- Main Component ---

export const TrainingHistoryPanel: React.FC<TrainingHistoryPanelProps> = ({
  userId,
  loading,
  onSessionDeleted,
  onSessionDelete,
  onLoadMoreSessions
}) => {
  console.log('[TrainingHistoryPanel] Mounted with userId:', userId);
  console.log('[TrainingHistoryPanel] Props - loading:', loading);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [selectedAuditSession, setSelectedAuditSession] = useState<Session | null>(null);
  const [visibleBlocks, setVisibleBlocks] = useState<string[]>(['highlights', 'frequency', 'volumeTrend']);
  const [showBlockSelector, setShowBlockSelector] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  
  const [sessions, setSessions] = useState<Session[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const PAGE_SIZE = 20;
  
  const selectorRef = useRef<HTMLDivElement>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setShowBlockSelector(false);
      }
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Extract unique dates with training records from loaded sessions
  const availableDates = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return [];
    }
    const dates = sessions.map((s: any) => {
      const date = format(new Date(s.start_time), 'yyyy-MM-dd');
      return date;
    });
    return [...new Set(dates)].sort((a, b) => b.localeCompare(a));
  }, [sessions]);

  // Set default view date to the most recent training date
  React.useEffect(() => {
    if (availableDates.length > 0) {
      const latestDate = new Date(availableDates[0]);
      if (!filterDate) {
        setViewDate(latestDate);
      }
    }
  }, [availableDates, filterDate]);

  // Initial load of sessions
  React.useEffect(() => {
    const loadInitialSessions = async () => {
      if (onLoadMoreSessions) {
        setIsLoadingMore(true);
        try {
          const initialSessions = await onLoadMoreSessions(PAGE_SIZE, 0);
          setSessions(initialSessions);
          setHasMore(initialSessions.length === PAGE_SIZE);
        } catch (error) {
          console.error('[TrainingHistoryPanel] Failed to load initial sessions:', error);
        } finally {
          setIsLoadingMore(false);
        }
      }
    };

    loadInitialSessions();
  }, [userId, onLoadMoreSessions]);

  // Load more sessions when scrolling to bottom
  const loadMoreSessions = async () => {
    if (isLoadingMore || !hasMore || !onLoadMoreSessions) return;
    
    setIsLoadingMore(true);
    try {
      const newSessions = await onLoadMoreSessions(PAGE_SIZE, sessions.length);
      setSessions(prev => [...prev, ...newSessions]);
      setHasMore(newSessions.length === PAGE_SIZE);
    } catch (error) {
      console.error('[TrainingHistoryPanel] Failed to load more sessions:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Intersection Observer for infinite scroll
  React.useEffect(() => {
    if (!scrollContainerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreSessions();
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: '100px',
        threshold: 0.1
      }
    );

    const sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    sentinel.style.height = '10px';
    sentinel.style.position = 'absolute';
    sentinel.style.bottom = '0';
    sentinel.style.left = '0';
    sentinel.style.right = '0';
    sentinel.style.pointerEvents = 'none';
    
    scrollContainerRef.current.appendChild(sentinel);
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      if (scrollContainerRef.current && scrollContainerRef.current.contains(sentinel)) {
        scrollContainerRef.current.removeChild(sentinel);
      }
    };
  }, [hasMore, isLoadingMore, loadMoreSessions]);

  const toggleBlock = (blockId: string) => {
    setVisibleBlocks(prev => 
      prev.includes(blockId) 
        ? prev.filter(id => id !== blockId)
        : [...prev, blockId]
    );
  };

  const enhancedSessions = useMemo(() => {
    let list = sessions;
    
    // Apply date filter if set - use local time format to match calendar
    if (filterDate) {
      list = list.filter((s: any) => {
        const sessionDate = format(new Date(s.start_time), 'yyyy-MM-dd');
        return sessionDate === filterDate;
      });
    }

    return list.slice().sort((a: any, b: any) =>
      new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );
  }, [sessions, filterDate]);

  const handleDelete = async (id: string) => {
    if (onSessionDelete) {
      await onSessionDelete(id);
    }
    setDeleteConfirmId(null);
    onSessionDeleted();
  };

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center h-full">
        <div className="animate-spin text-star-accent">
          <Activity size={32} />
        </div>
      </div>
    );
  }

  if (enhancedSessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50/50 rounded-xl m-4">
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
          <Calendar className="text-gray-400" size={24} />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">暂无训练记录</h3>
        <p className="text-xs text-gray-500 mt-1 max-w-[200px]">
          开始您的第一次训练，记录将在这里显示。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-gray-50" data-testid="training-history-panel">

      {/* LEFT: Timeline Panel (Flex-grow) */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-gray-100">

        {/* Header */}
        <div className="flex-shrink-0 h-[72px] px-6 border-b border-gray-100 flex items-center justify-between bg-white z-10">
          <h2 className="font-bold text-gray-900 text-lg flex items-center gap-2">
            {filterDate ? '训练记录' : '近期训练'}
            <span className="text-xs font-normal text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
              {enhancedSessions.length}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {filterDate && (
              <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-star-accent text-xs font-medium rounded-lg border border-blue-100 animate-in fade-in slide-in-from-right-2">
                <span>{format(new Date(filterDate), 'M月d日')}</span>
                <button 
                  onClick={() => setFilterDate(null)}
                  className="p-0.5 hover:bg-blue-100 rounded-full transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="relative" ref={datePickerRef}>
              <Button
                variant="ghost"
                size="sm"
                className={`text-gray-400 hover:text-star-accent ${filterDate || showDatePicker ? 'text-star-accent bg-blue-50' : ''}`}
                title="按日历查询"
                onClick={() => setShowDatePicker(!showDatePicker)}
              >
                <Calendar size={18} />
              </Button>

              {/* Date Selection Menu (Calendar View) */}
              {showDatePicker && (
                <div className="absolute top-[48px] right-0 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-1">
                      <button onClick={() => setViewDate(subYears(viewDate, 1))} className="p-1 hover:bg-gray-100 rounded text-gray-400"><ChevronsLeft size={16} /></button>
                      <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="p-1 hover:bg-gray-100 rounded text-gray-400"><ChevronLeft size={16} /></button>
                    </div>
                    <span className="text-sm font-bold text-gray-700">{format(viewDate, 'yyyy年 M月', { locale: zhCN })}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="p-1 hover:bg-gray-100 rounded text-gray-400"><ChevronRight size={16} /></button>
                      <button onClick={() => setViewDate(addYears(viewDate, 1))} className="p-1 hover:bg-gray-100 rounded text-gray-400"><ChevronsRight size={16} /></button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                      <div key={d} className="text-[10px] font-bold text-gray-400 text-center py-1">{d}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {(() => {
                      const start = startOfWeek(startOfMonth(viewDate));
                      const end = endOfWeek(endOfMonth(viewDate));
                      const days = eachDayOfInterval({ start, end });
                      
                      return days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const hasRecord = availableDates.includes(dateStr);
                        const isSelected = filterDate === dateStr;
                        const isCurrentMonth = isSameMonth(day, viewDate);

                        return (
                          <button
                            key={dateStr}
                            disabled={!hasRecord}
                            onClick={() => {
                              setFilterDate(dateStr);
                              setShowDatePicker(false);
                            }}
                            className={`
                              relative aspect-square flex flex-col items-center justify-center rounded-lg text-xs transition-all
                              ${!isCurrentMonth ? 'opacity-20' : ''}
                              ${hasRecord 
                                ? isSelected 
                                  ? 'bg-star-accent text-white font-bold shadow-md scale-105' 
                                  : 'hover:bg-blue-50 text-gray-700 font-semibold' 
                                : 'text-gray-300 cursor-not-allowed'}
                            `}
                          >
                            {format(day, 'd')}
                            {hasRecord && !isSelected && (
                              <div className="absolute bottom-1 w-1 h-1 rounded-full bg-blue-400" />
                            )}
                          </button>
                        );
                      });
                    })()}
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-50 flex justify-between items-center">
                    <button 
                      onClick={() => {
                        const latestDate = availableDates.sort((a, b) => b.localeCompare(a))[0];
                        if (latestDate) {
                          setFilterDate(latestDate);
                          setViewDate(new Date(latestDate));
                          setShowDatePicker(false);
                        }
                      }}
                      className="text-[10px] text-star-accent hover:underline font-bold"
                    >
                      跳转到最新记录
                    </button>
                    <span className="text-[10px] text-gray-400">
                      共 {availableDates.length} 天有记录
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Timeline */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-thumb-gray-200 relative">
          <div className="w-full max-w-4xl mx-auto">
            {enhancedSessions.map((session: any) => (
              <SessionCard
                key={session.id}
                session={session}
                onDelete={handleDelete}
                onShowAudit={(s) => setSelectedAuditSession(s)}
                confirmDeleteId={deleteConfirmId}
                setConfirmDeleteId={setDeleteConfirmId}
              />
            ))}

            {/* Loading indicator */}
            {isLoadingMore && hasMore && (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-3 text-gray-400 text-sm">
                  <div className="w-4 h-4 border-2 border-gray-200 border-t-star-accent rounded-full animate-spin" />
                  <span>加载更多...</span>
                </div>
              </div>
            )}

            {/* End of list indicator */}
            {!hasMore && sessions.length > 0 && !isLoadingMore && (
              <div className="flex items-center justify-center py-8 text-gray-300 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                  <span>已显示全部记录</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                </div>
              </div>
            )}

            {!filterDate && (
              <div className="pl-6 pt-4 pb-8">
                <div className="flex items-center gap-2 text-gray-300 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                  Start of journey
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: Stats Sidebar (Fixed width) */}
      <div className="w-[320px] 2xl:w-[360px] flex-shrink-0 flex flex-col bg-gray-50 overflow-hidden">
        {/* Unified Header for Stats Sidebar */}
        <div className="flex-shrink-0 h-[72px] px-6 border-b border-gray-100 flex items-center justify-between bg-white relative">
          <h2 className="font-bold text-gray-900 text-lg">训练洞察</h2>
          <div ref={selectorRef}>
            <Button
              variant="ghost"
              size="sm"
              className={`text-gray-400 hover:text-star-accent ${showBlockSelector ? 'text-star-accent bg-blue-50' : ''}`}
              title="选择激活的洞察区块"
              onClick={() => setShowBlockSelector(!showBlockSelector)}
            >
              <BarChart3 size={18} />
            </Button>

            {/* Block Selector Menu */}
            {showBlockSelector && (
              <div className="absolute top-[60px] right-6 w-48 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-200">
                <div className="text-[10px] font-bold text-gray-400 px-2 py-1 uppercase tracking-wider">显示区块</div>
                {[
                  { id: 'highlights', label: '数据概览', icon: <Zap size={14} /> },
                  { id: 'frequency', label: '训练频率', icon: <Calendar size={14} /> },
                  { id: 'volumeTrend', label: '容量趋势', icon: <Activity size={14} /> },
                  { id: 'muscleHeatmap', label: '部位概览', icon: <User size={14} /> },
                ].map((block) => (
                  <button
                    key={block.id}
                    onClick={() => toggleBlock(block.id)}
                    className="w-full flex items-center justify-between px-2 py-2 hover:bg-gray-50 rounded-lg transition-colors group"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="text-gray-400 group-hover:text-star-accent">{block.icon}</span>
                      {block.label}
                    </div>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${visibleBlocks.includes(block.id) ? 'bg-star-accent border-star-accent text-white' : 'border-gray-200'}`}>
                      {visibleBlocks.includes(block.id) && <Check size={10} strokeWidth={3} />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <TrainingStatsSidebar sessions={enhancedSessions} visibleBlocks={visibleBlocks} />
        </div>
      </div>

      {/* AI Audit Modal */}
      <AnimatePresence>
        {selectedAuditSession && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedAuditSession(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-3xl max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <ClipboardList size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">AI 训练审计报告</h3>
                    <p className="text-xs text-gray-500">
                      {selectedAuditSession.title || '训练记录'} · {format(new Date(selectedAuditSession.start_time), 'yyyy年M月d日 HH:mm')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedAuditSession(null)}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-8 tutorial-content max-w-none scrollbar-thin">
                <MarkdownRenderer content={selectedAuditSession.ai_audit_text || ''} />
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-gray-100 flex justify-end bg-gray-50/50">
                <Button variant="outline" size="sm" onClick={() => setSelectedAuditSession(null)}>
                  关闭窗口
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
