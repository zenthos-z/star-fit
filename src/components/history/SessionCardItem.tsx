/**
 * SessionCardItem — 训练历史卡（从 History.tsx SessionItem 原样抽取）。
 *
 * C2（issue #6）：信息页「训练历史」区复用本卡，视觉零改动——圆点 + 日期 +
 * 时间 chip + › 圆钮 / 斜体动作名 / 时长·容量·组数三列，无进度条。
 * 容量口径统一走 workoutSummary.setVolume（与结算页/落库一致）。
 */
import React from 'react';
import type { Session, Exercise } from '@/src/types/legacy';
import SwipeableRow from '../SwipeableRow';
import { setVolume } from '@/utils/workoutSummary';
import { resolveExerciseDisplayName } from '@/utils/exerciseDisplay';
import { useExerciseLibraryIndex } from '@/hooks/useExerciseLibraryIndex';

const calculateVolume = (ex: Exercise) => {
  let vol = 0;
  ex.sets.forEach(set => {
    if (!set.completed) return;
    vol += setVolume(ex, set);
  });
  return vol;
};

export interface SessionCardItemProps {
  session: Session;
  onSelect: (s: Session) => void;
  onDelete: (sessionId: string) => void;
}

export function SessionCardItem({ session, onSelect, onDelete }: SessionCardItemProps): JSX.Element {
  const dateObj = new Date(session.startTime);
  const dateStr = dateObj.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  const timeStr = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const duration = Math.floor((session.endTime! - session.startTime - session.pausedDuration) / 1000 / 60);
  const totalVolume = session.exercises.reduce((acc, ex) => acc + calculateVolume(ex), 0);
  const libraryIndex = useExerciseLibraryIndex();
  // A6 中文优先：历史会话动作名统一中文展示（存量英文名经库索引解析）
  const exerciseNames = session.exercises
    .map(e => resolveExerciseDisplayName(e.name, { library: libraryIndex }))
    .slice(0, 3)
    .join(', ');

  return (
    <SwipeableRow
      key={session.id}
      className="rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
      leftActions={[
        {
          label: '删除',
          icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
          color: 'bg-red-500',
          onClick: () => onDelete(session.id)
        }
      ]}
      rightActions={[]}
    >
      <div
        onClick={() => onSelect(session)}
        role="button"
        aria-label={`${dateStr} 训练记录，${duration} 分钟`}
        className="w-full bg-white p-5 text-left active:bg-gray-50 transition-all rounded-2xl rounded-tl-sm"
      >
        <div className="flex justify-between items-start mb-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-star-primary shadow-[0_0_8px_rgba(24,24,27,0.2)]"></div>
              <span className="text-sm font-black text-star-dark uppercase tracking-tight">{dateStr}</span>
              <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">{timeStr}</span>
            </div>
            <p className="text-[11px] text-gray-400 font-medium truncate max-w-[240px] italic">
              {exerciseNames}{session.exercises.length > 3 ? '...' : ''}
            </p>
          </div>
          <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-active:text-star-primary transition-colors" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-gray-50">
          <div className="flex flex-col">
            <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">时长</span>
            <span className="text-sm font-mono font-black text-star-dark">{duration}<span className="text-[10px] ml-0.5 font-sans font-bold text-gray-400">分</span></span>
          </div>
          <div className="flex flex-col border-l border-gray-100 pl-3">
            <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">容量</span>
            <span className="text-sm font-mono font-black text-star-dark">{totalVolume}<span className="text-[10px] ml-0.5 font-sans font-bold text-gray-400">kg</span></span>
          </div>
          <div className="flex flex-col border-l border-gray-100 pl-3">
            <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">组数</span>
            <span className="text-sm font-mono font-black text-star-dark">{session.exercises.reduce((acc, ex) => acc + ex.sets.filter(s => s.completed).length, 0)}</span>
          </div>
        </div>
      </div>
    </SwipeableRow>
  );
}
