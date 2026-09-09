/**
 * SessionTimeline — 训练记录时间线 + 详情抽屉（2026-09 第三轮）
 *
 * 定位：旧的 TrainingHistoryPanel 已整体删除，训练数据可视化从头重新设计。
 * 当前形态：
 * - **时间线布局**：左侧日期轨道（圆点 + 连续竖线），右侧每天训练一张圆角卡片。
 * - **类型化组数据**：抗阻/自重/辅助/静态/有氧字段语义不同（shared/contracts
 *   Flat Format v3），列表与抽屉均按类型分别渲染，不共用模板。
 * - **详情抽屉**：点击卡片 → 右侧滑出抽屉，逐动作逐组查看完整记录。
 * - **附加到 Agent**：悬停卡片出「+」→ 整条训练挂到 Agent 对话上下文
 *   （agentContextStore, source='session'），以附件 chip 呈现。
 * - 支持删除与无限滚动。
 *
 * 视觉：Codex 式极简——1px 灰边框、扁平、悬停态出现操作、黑=唯一强调色。
 *
 * @module SessionTimeline
 * @version 3.0.0 (timeline rail + per-type set chips + drawer)
 */

import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2, Check, X, Minimize, Dumbbell, Activity, Heart, MapPin, HelpCircle,
  User as UserIcon, Calendar, Plus, Timer, Weight,
} from 'lucide-react';
import { AppExerciseType, getExerciseType } from '../../services/types';
import { parseJSONSafe } from '../../../../types/validation';
import { agentContextStore, useAgentContextAttachments } from '../../state/agentContextStore';
import { transitions } from '../../../../v2/lib/animations';

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
}

export interface TimelineSession {
  id: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  duration?: number;
  title?: string;
  raw_json?: string;
}

interface SessionTimelineProps {
  userId: string;
  loading: boolean;
  onSessionDeleted: () => void;
  onSessionDelete?: (sessionId: string) => Promise<void>;
  onLoadMoreSessions?: (limit: number, offset: number) => Promise<TimelineSession[]>;
}

// ============================================================================
// Helpers
// ============================================================================

const getTypeIcon = (type: AppExerciseType) => {
  switch (type) {
    case 'resistance': return <Dumbbell size={12} className="text-gray-500" />;
    case 'bodyweight': return <UserIcon size={12} className="text-gray-500" />;
    case 'assisted': return <HelpCircle size={12} className="text-gray-500" />;
    case 'isometric': return <Minimize size={12} className="text-gray-500" />;
    case 'cardio': return <Heart size={12} className="text-gray-500" />;
    case 'outdoor': return <MapPin size={12} className="text-gray-500" />;
    default: return <Activity size={12} className="text-gray-400" />;
  }
};

const formatDurationShort = (seconds: number) => {
  if (!seconds) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 1) return `${Math.round(seconds)}s`;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

/** 一条训练的解析结果（列表与抽屉共用） */
const parseSession = (session: TimelineSession) => {
  const sessionData = parseJSONSafe<any>(session.raw_json, 'SessionTimeline raw_json') || {};
  const exercises: Exercise[] = sessionData.exercises || [];
  const durationSec = session.duration || sessionData.duration || 0;
  const title = session.title || sessionData.title || '训练记录';
  const totalVolume = exercises.reduce((acc, ex) => acc + (ex.sets || []).reduce(
    (sAcc, s) => sAcc + ((s.weight || 0) * (s.reps || 0)), 0), 0);
  return { exercises, durationSec, title, totalVolume };
};

/** 附加内容体（整条训练，含全部组数据） */
const buildSessionContent = (session: TimelineSession) => {
  const { exercises, durationSec, title, totalVolume } = parseSession(session);
  return {
    session_id: session.id,
    title,
    start_time: session.start_time,
    end_time: session.end_time,
    duration_seconds: durationSec,
    total_volume_kg: Math.round(totalVolume),
    exercises,
  };
};

/**
 * 按动作类型逐组取显示参数——各类型字段语义不同（shared/contracts Flat v3）：
 * - resistance: 重量×次数（无重量只显次数）
 * - bodyweight: 次数（weight>0 为附加负重 +Nkg）
 * - assisted:   weight 为**辅助配重**（减负），显示「辅助Nkg」
 * - isometric:  保持时长（weight>0 为负重静态）
 * - cardio/outdoor: 距离优先，其次时长
 */
const formatSets = (sets: Set[], type: AppExerciseType): string[] => {
  return sets.map((s) => {
    switch (type) {
      case 'resistance':
        if (s.weight !== undefined || s.reps !== undefined) {
          return s.weight ? `${s.weight}kg×${s.reps ?? 0}` : `×${s.reps ?? 0}`;
        }
        return '-';
      case 'bodyweight':
        if (s.reps !== undefined) {
          return s.weight ? `+${s.weight}kg×${s.reps}` : `×${s.reps}`;
        }
        return '-';
      case 'assisted':
        if (s.reps !== undefined) {
          return s.weight ? `辅助${s.weight}kg×${s.reps}` : `×${s.reps}`;
        }
        return '-';
      case 'isometric':
        if (s.duration !== undefined) {
          return s.weight ? `${formatDurationShort(s.duration)}+${s.weight}kg` : formatDurationShort(s.duration);
        }
        return '-';
      case 'cardio':
      case 'outdoor':
        if (s.distance !== undefined) return `${(s.distance / 1000).toFixed(2)}km`;
        if (s.duration !== undefined) return formatDurationShort(s.duration);
        return '-';
      default:
        if (s.reps !== undefined) return `×${s.reps}`;
        if (s.duration !== undefined) return formatDurationShort(s.duration);
        return '-';
    }
  });
};

const fmtDay = (d: Date) => d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
const fmtTime = (d: Date) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

// ============================================================================
// TimelineRow — 左侧日期轨道 + 右侧圆角卡片
// ============================================================================

const TimelineRow: React.FC<{
  session: TimelineSession;
  isFirst: boolean;
  isLast: boolean;
  attached: boolean;
  onOpen: (s: TimelineSession) => void;
  onAttach: (s: TimelineSession) => void;
  onDeleteRequest: (id: string) => void;
  isConfirmingDelete: boolean;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}> = ({
  session, isFirst, isLast, attached, onOpen, onAttach, onDeleteRequest,
  isConfirmingDelete, onConfirmDelete, onCancelDelete,
}) => {
  const date = new Date(session.start_time);
  const { exercises, durationSec, title, totalVolume } = parseSession(session);

  return (
    <div
      className="relative flex items-start pl-6 pr-6"
      data-testid={`session-row-${session.id}`}
    >
      {/* 左：日期时间（右侧贴轨道） */}
      <div
        className="w-14 shrink-0 text-right pt-3 cursor-pointer"
        onClick={() => onOpen(session)}
      >
        <p className="text-xs font-semibold text-gray-800 tabular-nums leading-tight">{fmtDay(date)}</p>
        <p className="text-[10px] text-gray-400 tabular-nums mt-0.5">{fmtTime(date)}</p>
      </div>

      {/* 轨道：连续竖线（首尾各留半段） */}
      <div className="relative w-6 shrink-0 self-stretch">
        {!isFirst && <div className="absolute left-1/2 top-0 bottom-1/2 w-px bg-gray-200" style={{ marginBottom: 18 }} />}
        {!isLast && <div className="absolute left-1/2 top-1/2 bottom-0 w-px bg-gray-200" style={{ marginTop: 18 }} />}
        {/* 圆点 */}
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full border-[1.5px] border-gray-300 bg-white" />
      </div>

      {/* 右：卡片 */}
      <div
        className="group flex-1 min-w-0 my-2.5 ml-2 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-gray-300 transition-colors cursor-pointer"
        onClick={() => onOpen(session)}
      >
        {/* 卡片头：标题 + 指标 + 悬停操作 */}
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-900 truncate">{title}</h3>
          <div className="shrink-0 flex items-center gap-3 text-gray-400">
            {durationSec > 0 && (
              <span className="flex items-center gap-1 text-xs tabular-nums" title="训练时长">
                <Timer size={12} />
                {formatDurationShort(durationSec)}
              </span>
            )}
            {totalVolume > 0 && (
              <span className="flex items-center gap-1 text-xs tabular-nums" title="总容量">
                <Weight size={12} />
                {(totalVolume / 1000).toFixed(1)}k kg
              </span>
            )}
          </div>

          <div
            className="ml-auto shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            {isConfirmingDelete ? (
              <>
                <span className="text-xs text-red-600 whitespace-nowrap">确认删除?</span>
                <button
                  onClick={() => onConfirmDelete(session.id)}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-md"
                  aria-label="确认删除"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={onCancelDelete}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md"
                  aria-label="取消删除"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                {attached ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-900 text-white whitespace-nowrap">已附加</span>
                ) : (
                  <button
                    onClick={() => onAttach(session)}
                    className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-md"
                    aria-label={`将「${title}」加入 Agent 上下文`}
                    title="整条训练加入 Agent 对话上下文"
                    data-testid={`session-attach-${session.id}`}
                  >
                    <Plus size={15} />
                  </button>
                )}
                <button
                  onClick={() => onDeleteRequest(session.id)}
                  className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md"
                  aria-label="删除记录"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 逐动作（类型图标 + 每组独立标签） */}
        {exercises.length === 0 ? (
          <p className="text-xs text-gray-300 mt-2">未记录动作</p>
        ) : (
          <div className="mt-2 space-y-1">
            {exercises.map((ex, idx) => {
              const type = getExerciseType(ex);
              const sets = formatSets(ex.sets || [], type);
              return (
                <div key={idx} className="flex items-center gap-1.5 flex-wrap">
                  <span className="shrink-0 flex items-center gap-1">
                    {getTypeIcon(type)}
                    <span className="text-xs text-gray-600">{ex.name}</span>
                  </span>
                  {sets.map((s, si) => (
                    <span
                      key={si}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-500 tabular-nums"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// SessionDetailDrawer — 右侧详情抽屉（逐动作逐组，类型化表格）
// ============================================================================

const SetTable: React.FC<{ sets: Set[]; type: AppExerciseType }> = ({ sets, type }) => {
  const isResistance = type === 'resistance';
  const isBodyweight = type === 'bodyweight';
  const isAssisted = type === 'assisted';
  const isIsometric = type === 'isometric';
  const isCardio = type === 'cardio' || type === 'outdoor';

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-gray-400 border-b border-gray-100">
          <th className="text-left font-normal py-1 w-8">组</th>
          {isResistance && <th className="text-right font-normal py-1">重量 × 次数</th>}
          {isResistance && <th className="text-right font-normal py-1 w-14">RPE</th>}
          {isBodyweight && <th className="text-right font-normal py-1">附加负重 × 次数</th>}
          {isBodyweight && <th className="text-right font-normal py-1 w-14">RPE</th>}
          {isAssisted && <th className="text-right font-normal py-1">辅助配重 × 次数</th>}
          {isAssisted && <th className="text-right font-normal py-1 w-14">RPE</th>}
          {isIsometric && <th className="text-right font-normal py-1">保持时长</th>}
          {isIsometric && <th className="text-right font-normal py-1 w-14">负重</th>}
          {isCardio && <th className="text-right font-normal py-1">距离</th>}
          {isCardio && <th className="text-right font-normal py-1">时长</th>}
          <th className="text-right font-normal py-1 w-14">休息</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {sets.map((s, i) => (
          <tr key={s.id ?? i} className="border-b border-gray-50 last:border-0">
            <td className="py-1.5 text-gray-400">{i + 1}</td>
            {isResistance && (
              <td className="py-1.5 text-right text-gray-700">
                {s.weight !== undefined || s.reps !== undefined
                  ? `${s.weight ?? 0}kg × ${s.reps ?? 0}`
                  : '-'}
              </td>
            )}
            {(isResistance || isBodyweight || isAssisted) && <td className="py-1.5 text-right text-gray-500">{s.rpe ?? '-'}</td>}
            {isBodyweight && (
              <td className="py-1.5 text-right text-gray-700">
                {s.weight ? `+${s.weight}kg × ${s.reps ?? 0}` : `×${s.reps ?? 0}`}
              </td>
            )}
            {isAssisted && (
              <td className="py-1.5 text-right text-gray-700">
                {s.weight ? `${s.weight}kg × ${s.reps ?? 0}` : `×${s.reps ?? 0}`}
              </td>
            )}
            {isIsometric && (
              <td className="py-1.5 text-right text-gray-700">{s.duration ? formatDurationShort(s.duration) : '-'}</td>
            )}
            {isIsometric && <td className="py-1.5 text-right text-gray-500">{s.weight ? `${s.weight}kg` : '-'}</td>}
            {isCardio && <td className="py-1.5 text-right text-gray-700">{s.distance ? `${(s.distance / 1000).toFixed(2)}km` : '-'}</td>}
            {isCardio && <td className="py-1.5 text-right text-gray-700">{s.duration ? formatDurationShort(s.duration) : '-'}</td>}
            <td className="py-1.5 text-right text-gray-400">{s.rest ? `${s.rest}s` : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const SessionDetailDrawer: React.FC<{
  session: TimelineSession | null;
  onClose: () => void;
}> = ({ session, onClose }) => {
  const parsed = useMemo(() => (session ? parseSession(session) : null), [session]);

  return (
    <AnimatePresence>
      {session && parsed && (
        <>
          {/* 遮罩 */}
          <motion.div
            className="fixed inset-0 bg-black/20 z-[160]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* 抽屉（右侧滑入） */}
          <motion.div
            className="fixed top-0 right-0 bottom-0 w-[520px] max-w-[90vw] bg-white border-l border-gray-200 z-[161] flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={transitions.springGentle}
            data-testid="session-detail-drawer"
          >
            {/* 头部 */}
            <div className="shrink-0 border-b border-gray-200 px-5 py-4 flex items-start justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 truncate">{parsed.title}</h2>
                <p className="text-xs text-gray-400 mt-1 tabular-nums flex items-center gap-2">
                  <span>{new Date(session.start_time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  {parsed.durationSec > 0 && (
                    <span className="flex items-center gap-1"><Timer size={11} />{formatDurationShort(parsed.durationSec)}</span>
                  )}
                  {parsed.totalVolume > 0 && <span>{Math.round(parsed.totalVolume).toLocaleString()} kg 总容量</span>}
                  <span>{parsed.exercises.length} 个动作</span>
                </p>
              </div>
              <button
                className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-400 flex items-center justify-center transition-colors shrink-0 ml-3"
                aria-label="关闭详情"
                onClick={onClose}
              >
                <X size={15} />
              </button>
            </div>

            {/* 逐动作逐组 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {parsed.exercises.length === 0 && (
                <p className="text-xs text-gray-300 py-8 text-center">本次训练未记录动作</p>
              )}
              <div className="space-y-5">
                {parsed.exercises.map((ex, idx) => {
                  const type = getExerciseType(ex);
                  return (
                    <div key={idx} data-testid={`drawer-exercise-${idx}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        {getTypeIcon(type)}
                        <h3 className="text-sm font-medium text-gray-800">{ex.name}</h3>
                        <span className="text-[10px] text-gray-400">{(ex.sets || []).length} 组</span>
                      </div>
                      {(ex.sets || []).length > 0 ? (
                        <SetTable sets={ex.sets} type={type} />
                      ) : (
                        <p className="text-xs text-gray-300">无组数据</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// Main
// ============================================================================

export const SessionTimeline: React.FC<SessionTimelineProps> = ({
  userId, loading, onSessionDeleted, onSessionDelete, onLoadMoreSessions,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TimelineSession[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [detailSession, setDetailSession] = useState<TimelineSession | null>(null);
  const PAGE_SIZE = 20;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const attachments = useAgentContextAttachments();
  const attachedIds = useMemo(
    () => new Set(attachments.filter((a) => a.source === 'session').map((a) => a.id)),
    [attachments],
  );

  // 初始加载
  React.useEffect(() => {
    const loadInitialSessions = async () => {
      if (onLoadMoreSessions) {
        setIsLoadingMore(true);
        try {
          const initialSessions = await onLoadMoreSessions(PAGE_SIZE, 0);
          setSessions(initialSessions);
          setHasMore(initialSessions.length === PAGE_SIZE);
        } catch (error) {
          console.error('[SessionTimeline] Failed to load initial sessions:', error);
        } finally {
          setIsLoadingMore(false);
        }
      }
    };
    loadInitialSessions();
  }, [userId, onLoadMoreSessions]);

  const loadMoreSessions = async () => {
    if (isLoadingMore || !hasMore || !onLoadMoreSessions) return;
    setIsLoadingMore(true);
    try {
      const newSessions = await onLoadMoreSessions(PAGE_SIZE, sessions.length);
      setSessions((prev) => [...prev, ...newSessions]);
      setHasMore(newSessions.length === PAGE_SIZE);
    } catch (error) {
      console.error('[SessionTimeline] Failed to load more sessions:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // 无限滚动
  React.useEffect(() => {
    if (!scrollContainerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreSessions(); },
      { root: scrollContainerRef.current, rootMargin: '100px', threshold: 0.1 }
    );
    const sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    sentinel.style.cssText = 'height:10px;position:absolute;bottom:0;left:0;right:0;pointer-events:none';
    scrollContainerRef.current.appendChild(sentinel);
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      if (scrollContainerRef.current?.contains(sentinel)) {
        scrollContainerRef.current.removeChild(sentinel);
      }
    };
  }, [hasMore, isLoadingMore, loadMoreSessions]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()),
    [sessions]
  );

  const handleDelete = async (id: string) => {
    if (onSessionDelete) await onSessionDelete(id);
    setDeleteConfirmId(null);
    onSessionDeleted();
  };

  const handleAttach = (session: TimelineSession) => {
    const { title } = parseSession(session);
    const dateStr = fmtDay(new Date(session.start_time));
    agentContextStore.add({
      id: `session:${session.id}`,
      title: `${title} · ${dateStr}`,
      source: 'session',
      content: buildSessionContent(session),
    });
  };

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center h-full">
        <div className="animate-spin text-gray-400"><Activity size={28} /></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0" data-testid="session-timeline">
      {/* 列头 */}
      <div className="shrink-0 border-b border-gray-200 px-6 py-3 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-gray-900">训练记录</span>
        <span className="text-[11px] text-gray-400 hidden md:block">
          点击卡片查看逐组详情 · 悬停卡片点 <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-900 text-white text-[9px] align-middle mx-0.5">+</span> 附加给 Agent
        </span>
      </div>

      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 relative py-2">
        {sortedSessions.length === 0 && !isLoadingMore && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <Calendar className="text-gray-400" size={24} />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">暂无训练记录</h3>
            <p className="text-xs text-gray-400 mt-1">App 端开始训练后记录将显示在这里</p>
          </div>
        )}

        {sortedSessions.map((session, i) => (
          <TimelineRow
            key={session.id}
            session={session}
            isFirst={i === 0}
            isLast={i === sortedSessions.length - 1 && !hasMore}
            attached={attachedIds.has(`session:${session.id}`)}
            onOpen={setDetailSession}
            onAttach={handleAttach}
            onDeleteRequest={setDeleteConfirmId}
            isConfirmingDelete={deleteConfirmId === session.id}
            onConfirmDelete={handleDelete}
            onCancelDelete={() => setDeleteConfirmId(null)}
          />
        ))}

        {isLoadingMore && hasMore && (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
          </div>
        )}

        {!hasMore && sessions.length > 0 && (
          <div className="flex items-center justify-center py-6 text-gray-300 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
              <span>已显示全部记录</span>
              <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
            </div>
          </div>
        )}
      </div>

      {/* 详情抽屉 */}
      <SessionDetailDrawer session={detailSession} onClose={() => setDetailSession(null)} />
    </div>
  );
};
