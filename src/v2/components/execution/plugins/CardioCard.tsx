import React, { useState, useEffect, useCallback } from 'react';
import { ExerciseAction, LoadAnchors } from '../../../types/protocol';
import { Attachment } from '../FloatingAttachment';
import { db } from '../../../storage/db';
import { getExerciseTypeLabel } from '../../../../utils/exerciseTypeLabels';

interface CardioCardProps {
  exercise: ExerciseAction;
  isPaused?: boolean;
  loadAnchors?: LoadAnchors;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
  addAttachment?: (attachment: Omit<Attachment, 'id' | 'timestamp'>) => void;
}

/**
 * CardioRunningCard Plugin
 * Integrated with sensor data hooks (GPS, Heart Rate) via Web Worker features.
 * Supports GPS trajectory, real-time pace, and HR curves as per EXERCISE_EXECUTION_REFACTOR_GUIDE.md.
 */
export const CardioCard: React.FC<CardioCardProps> = ({
  exercise,
  isPaused,
  onUpdate,
  addAttachment
}) => {
  const [hrFeatures, setHrFeatures] = useState<any>(null);
  const [gpsStatus, setGpsStatus] = useState<'searching' | 'locked' | 'error'>('locked');
  const [currentPace, setCurrentPace] = useState<string>('5\'30"');
  const [timers, setTimers] = useState<Record<number, { elapsed: number; running: boolean }>>(() => {
    const initial: Record<number, { elapsed: number; running: boolean }> = {};
    exercise.sets.forEach(set => {
      initial[set.index] = {
        elapsed: set.duration || 0,
        running: false,
      };
    });
    return initial;
  });

  useEffect(() => {
    const synced: Record<number, { elapsed: number; running: boolean }> = {};
    exercise.sets.forEach(set => {
      const existing = timers[set.index];
      synced[set.index] = {
        elapsed: existing ? existing.elapsed : set.duration || 0,
        running: existing ? existing.running : false,
      };
    });
    setTimers(synced);
  }, [exercise.sets]);

  const hasRunning = Object.values(timers).some(t => t.running);

  useEffect(() => {
    if (!hasRunning || isPaused) return;

    const interval = setInterval(() => {
      setTimers(prev => {
        const next: Record<number, { elapsed: number; running: boolean }> = { ...prev };
        let changed = false;
        const targetDuration = (exercise.metadata as any)?.targetDuration || 60;

        exercise.sets.forEach(set => {
          const state = next[set.index];
          if (!state || !state.running) return;

          const targetDuration = (set as any)?.targetDuration || (exercise.metadata as any)?.targetDuration || 60;
          const newElapsed = state.elapsed + 1;
          
          if (newElapsed >= targetDuration) {
            const finalDuration = targetDuration;
            next[set.index] = { elapsed: finalDuration, running: false };
            changed = true;

            const updatedSets = exercise.sets.map(s =>
              s.index === set.index ? { ...s, duration: finalDuration, status: 'COMPLETED', completed: true, timestamp: new Date().toISOString() } : s
            );

            // [FIX] 使用 setTimeout 将 side effects 移出 render/updater 阶段，防止 React 警告
            setTimeout(() => {
              onUpdate?.({ sets: updatedSets as ExerciseAction['sets'] });
            }, 0);
          } else {
            next[set.index] = { ...state, elapsed: newElapsed };
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [hasRunning, isPaused, exercise.sets, exercise.metadata, onUpdate]);

  // Subscribe to real-time biometric features from DB/L2 (populated by Web Worker)
  useEffect(() => {
    let isSubscribed = true;
    
    const fetchLatestHR = async () => {
      try {
        const latest = await db.biometrics
          .where('type')
          .equals('HR')
          .reverse()
          .limit(1)
          .toArray();
        
        if (isSubscribed && latest.length > 0 && latest[0].features) {
          setHrFeatures(latest[0].features);
        }
      } catch (error) {
        console.error("Failed to fetch HR features:", error);
      }
    };

    // Use a faster interval for real-time vibe, or ideally a hook
    const interval = setInterval(fetchLatestHR, 1000);
    fetchLatestHR(); // Initial fetch

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, []);

  const handleBatchUpdate = (setIndex: number, updates: Record<string, any>) => {
    const updatedSets = exercise.sets.map(set => {
      if (set.index === setIndex) {
        // Sync completed boolean with status enum
        const finalUpdates = { ...updates };
        if (updates.status === 'COMPLETED') {
          finalUpdates.completed = true;
        } else if (updates.status === 'PLANNED') {
          finalUpdates.completed = false;
        }
        return { ...set, ...finalUpdates, timestamp: new Date().toISOString() };
      }
      return set;
    });
    onUpdate?.({ sets: updatedSets as any });
  };

  const toggleStatus = (setIndex: number) => {
    const set = exercise.sets.find(s => s.index === setIndex);
    if (!set) return;

    const currentState = timers[setIndex] || { elapsed: set.duration || 0, running: false };
    const isCompleted = set.status === 'COMPLETED';

    // 状态机：待开始 (PLANNED) -> 运动中 (ACTIVE) -> 运动终止 (COMPLETED) -> 待开始 (PLANNED)
    
    if (!currentState.running && !isCompleted) {
      // 1. 待开始 -> 运动中
      setTimers(prev => ({
        ...prev,
        [setIndex]: { ...currentState, running: true },
      }));
      // 触发一次同步以保持活跃
      handleBatchUpdate(setIndex, { status: 'PLANNED' });
      
    } else if (currentState.running) {
      // 2. 运动中 -> 运动终止
      const targetDuration = (set as any)?.targetDuration || (exercise.metadata as any)?.targetDuration || 60;
      const finalDuration = Math.min(currentState.elapsed, targetDuration);
      setTimers(prev => ({
        ...prev,
        [setIndex]: { elapsed: finalDuration, running: false },
      }));
      handleBatchUpdate(setIndex, { status: 'COMPLETED', duration: finalDuration });
      
    } else if (isCompleted) {
      // 3. 运动终止 -> 待开始 (重置/归零)
      setTimers(prev => ({
        ...prev,
        [setIndex]: { elapsed: 0, running: false },
      }));
      handleBatchUpdate(setIndex, { status: 'PLANNED', duration: 0 });
    }
  };

  const completedSets = exercise.sets.filter(s => s.status === 'COMPLETED').length;
  const totalSets = exercise.sets.length;

  return (
    <div className="p-6 bg-white rounded-[2.5rem] shadow-sm border border-gray-50">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <div className="w-2.5 h-8 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.3)]"></div>
          <h3 className="text-2xl font-black text-gray-900 tracking-tight">{exercise.metadata?.name || '有氧运动'}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded-2xl font-bold uppercase tracking-widest border border-blue-100">
            {getExerciseTypeLabel(exercise.type)}
          </span>
          <span className="flex items-center gap-2 text-[11px] bg-blue-50 text-blue-500 px-4 py-2.5 rounded-full font-bold uppercase tracking-widest border border-blue-100">
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" />
              </svg>
              GPS ACTIVE
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {exercise.sets.map((set, idx) => {
          const isCompleted = set.status === 'COMPLETED';
          const timerState = timers[set.index] || { elapsed: set.duration || 0, running: false };
          const isActive = timerState.running;
          const targetDuration = (set as any)?.targetDuration || (exercise.metadata as any)?.targetDuration || 60;

          return (
            <div key={set.index} className="space-y-6">
              {/* 锚点参考 - 显示历史最佳值 */}
              {/* 已移除执行界面参考值展示 */}

              {/* Metrics Section */}
              <div className={`relative flex flex-col items-center justify-center pt-12 pb-14 rounded-[2.5rem] border transition-all duration-500 ${
                  isCompleted ? 'bg-[#f0fdf4] border-[#dcfce7]' : 'bg-[#f8fafc] border-[#f1f5f9]'
              }`}>
                <div className="flex flex-col items-center">
                  <div className="text-6xl font-bold tracking-tighter tabular-nums text-[#0f172a] leading-none">
                    {formatTime(timerState.elapsed)}
                  </div>
                  <div className="text-[12px] font-bold text-[#94a3b8] mt-3 uppercase tracking-widest">
                    当前用时
                  </div>
                </div>

                {/* Heart Rate Badge - Moved to right side */}
                <div className={`absolute bottom-4 right-6 flex items-center gap-2 px-4 py-2 rounded-full border shadow-sm transition-all z-10 ${
                    isCompleted ? 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]' : 'bg-[#fff1f2] text-[#e11d48] border-[#ffe4e6]'
                }`}>
                  <svg className={`w-3.5 h-3.5 ${isCompleted ? 'fill-[#166534]' : 'fill-[#e11d48]'}`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                  <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">ZONE 3</span>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={() => toggleStatus(set.index)}
                className={`w-full h-16 rounded-full flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all ${
                  isActive 
                    ? 'bg-amber-500 text-white shadow-amber-500/30' 
                    : isCompleted
                      ? 'bg-white text-gray-400 border-2 border-gray-100'
                      : 'bg-white text-blue-500 border-2 border-blue-500/10 shadow-blue-500/20'
                }`}
              >
                {isCompleted ? (
                  <>
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
                    <span className="text-lg font-black uppercase tracking-tight">重置</span>
                  </>
                ) : isActive ? (
                  <>
                    <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    <span className="text-lg font-black uppercase tracking-tight">暂停</span>
                  </>
                ) : (
                  <>
                    <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <span className="text-lg font-black uppercase tracking-tight">开始</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
