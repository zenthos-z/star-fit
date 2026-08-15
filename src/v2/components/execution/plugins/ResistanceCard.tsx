import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ExerciseAction, LoadAnchors, LoadAnchor } from '../../../types/protocol';
import { deviationBuffer } from '../../../services/DeviationBuffer';
import { DeviationWarningModal } from '../../DeviationWarningModal';
import { getExerciseTypeLabel } from '../../../../utils/exerciseTypeLabels';

interface ResistanceCardProps {
  exercise: ExerciseAction;
  exerciseIndex?: number;
  isPaused?: boolean;
  pauseStartTime?: number;
  loadAnchors?: LoadAnchors;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
}

// 震动反馈辅助函数
const triggerVibration = (pattern: number | number[] = 200) => {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
};

/**
 * ResistanceCard Plugin
 * Specialized for strength training (e.g., Bench Press, Squat).
 * Features: Rest timer, set completion flow, historical PR comparison.
 * Based on EXERCISE_EXECUTION_REFACTOR_GUIDE.md
 */
export const ResistanceCard: React.FC<ResistanceCardProps> = ({
  exercise,
  exerciseIndex = 0,
  isPaused,
  pauseStartTime,
  onUpdate
}) => {
  const [showDeviationModal, setShowDeviationModal] = useState(false);
  const [pendingDeviation, setPendingDeviation] = useState<{
    exerciseName: string;
    field: 'weight' | 'reps' | 'targetRpe';
    original: number;
    current: number;
    setIndex: number;
  } | null>(null);

  const [activeSetIndex, setActiveSetIndex] = useState<number | null>(null);
  const [pressStartTime, setPressStartTime] = useState(0);
  const [isLongPress, setIsLongPress] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [, forceUpdate] = useState(0);
  const previousRestStatesRef = useRef<Record<number, boolean>>({});
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});

  // 倒计时更新 - 每秒刷新以更新所有组的倒计时显示
  useEffect(() => {
    const nowRef = (isPaused && pauseStartTime) ? pauseStartTime : Date.now();
    // 初始化每个组的休息状态
    exercise.sets.forEach(set => {
      previousRestStatesRef.current[set.index] = !!(set.restEndTime && set.restEndTime > nowRef);
    });

    const hasRestingSet = exercise.sets.some(s => s.restEndTime && s.restEndTime > nowRef);
    if (hasRestingSet && !isPaused) {
      const interval = setInterval(() => {
        // 检查是否有组的倒计时刚刚结束
        exercise.sets.forEach(set => {
          const wasInRest = previousRestStatesRef.current[set.index];
          const isInRestNow = set.restEndTime && set.restEndTime > Date.now();
          // 如果之前在休息，现在不在休息了，说明倒计时刚刚结束
          if (wasInRest && !isInRestNow) {
            triggerVibration([100, 50, 100]); // 双击震动模式
          }
          // 更新当前状态
          previousRestStatesRef.current[set.index] = !!isInRestNow;
        });
        forceUpdate(prev => prev + 1);
      }, 100);
      return () => clearInterval(interval);
    }
    // 清空状态记录
    previousRestStatesRef.current = {};
  }, [exercise.sets, isPaused]);

  // 获取指定组的剩余休息秒数
  const getRestSecondsLeft = useCallback((setIndex: number) => {
    const set = exercise.sets.find(s => s.index === setIndex);
    if (!set?.restEndTime) return 0;
    
    // 如果处于暂停状态，使用 pauseStartTime 作为当前时间参考，使倒计时显示冻结
    const now = (isPaused && pauseStartTime) ? pauseStartTime : Date.now();
    const remaining = Math.ceil((set.restEndTime - now) / 1000);
    return Math.max(0, remaining);
  }, [exercise.sets, isPaused, pauseStartTime]);

  // 判断指定组是否在休息中
  const isInRest = useCallback((setIndex: number) => {
    const restSecondsLeft = getRestSecondsLeft(setIndex);
    return restSecondsLeft > 0;
  }, [getRestSecondsLeft]);

  // 更新组数据
  const updateSet = (setIndex: number, updates: any, skipDeviationCheck = false) => {
    const updatedSets = exercise.sets.map(set => {
      if (set.index === setIndex) {
        const newSet = { ...set, ...updates };

        if (!skipDeviationCheck) {
          if (updates.weight !== undefined && set.weight !== updates.weight) {
            const diff = Math.abs(updates.weight - set.weight);
            const threshold = set.weight * 0.1;
            if (diff > threshold) {
              setPendingDeviation({
                exerciseName: exerciseName,
                field: 'weight',
                original: set.weight,
                current: updates.weight,
                setIndex
              });
              setShowDeviationModal(true);
              return set;
            }
          }

          if (updates.reps !== undefined && set.reps !== updates.reps) {
            const diff = Math.abs(updates.reps - set.reps);
            const threshold = set.reps * 0.2;
            if (diff > threshold) {
              setPendingDeviation({
                exerciseName: exerciseName,
                field: 'reps',
                original: set.reps,
                current: updates.reps,
                setIndex
              });
              setShowDeviationModal(true);
              return set;
            }
          }
        }

        return newSet;
      }
      return set;
    });
    onUpdate?.({ sets: updatedSets });
  };

  const handleDeviationConfirm = (reason: string) => {
    if (pendingDeviation) {
      const recordIndex = deviationBuffer.addDeviation(
        exercise.exerciseId,
        pendingDeviation.exerciseName,
        exerciseIndex,
        pendingDeviation.setIndex,
        pendingDeviation.field,
        pendingDeviation.original,
        pendingDeviation.current
      );
      if (reason) {
        deviationBuffer.updateReason(recordIndex, reason);
      }
      updateSet(pendingDeviation.setIndex, { [pendingDeviation.field]: pendingDeviation.current }, true);
    }
    setShowDeviationModal(false);
    setPendingDeviation(null);
  };

  // 状态切换：完成 / 未完成
  const toggleComplete = (setIndex: number) => {
    const set = exercise.sets.find(s => s.index === setIndex);
    if (!set) return;

    const isCompleted = set.status === 'COMPLETED';
    if (isCompleted) {
      // 完成 -> 未完成
      updateSet(setIndex, { status: 'PLANNED', restEndTime: undefined });
    } else {
      // 未完成 -> 完成 (触发休息)
      updateSet(setIndex, { status: 'COMPLETED', restEndTime: Date.now() + 60000 });
      triggerVibration(200);
    }
  };

  // 结束指定组的休息
  const endRest = (setIndex: number) => {
    updateSet(setIndex, { restEndTime: undefined });
  };

  // 增加指定组休息时间20秒
  const addRestTime = (setIndex: number) => {
    const set = exercise.sets.find(s => s.index === setIndex);
    const currentRestEndTime = set?.restEndTime || Date.now();
    updateSet(setIndex, { restEndTime: currentRestEndTime + 20000 });
  };

  // 按下开始
  const handlePointerDown = (setIndex: number) => {
    setPressStartTime(Date.now());
    setIsLongPress(false);

    // 只有在休息中的组才能长按增加时间
    if (isInRest(setIndex)) {
      longPressTimerRef.current = setTimeout(() => {
        setIsLongPress(true);
        addRestTime(setIndex);
      }, 500);
    }
  };

  // 松开结束
  const handlePointerUp = (setIndex: number) => {
    // 清除长按计时器
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // 如果触发了长按，不处理短按逻辑
    if (isLongPress) {
      setIsLongPress(false);
      return;
    }

    // 短按逻辑
    if (isInRest(setIndex)) {
      endRest(setIndex);
      triggerVibration(150);
      return;
    }

    toggleComplete(setIndex);
  };

  // 离开按钮区域
  const handlePointerLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsLongPress(false);
    setPressStartTime(0);
  };

  const exerciseName = exercise.metadata?.name || 'Unknown Exercise';
  const targetRpe = exercise.metadata?.targetRpe;
  const completedCount = exercise.sets.filter(s => s.status === 'COMPLETED').length;
  const totalCount = exercise.sets.length;

  return (
    <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-50">
      {/* Header */}
      <div className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-blue-500 rounded-2xl shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
          <h3 className="text-xl font-black text-gray-900 tracking-tight">{exerciseName}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-2xl font-bold uppercase tracking-widest border border-blue-100">
            {getExerciseTypeLabel(exercise.type)}
          </span>
        </div>
      </div>

      {/* Sets List */}
      <div className="space-y-10">
        {exercise.sets.map((set, idx) => {
          const isCompleted = set.status === 'COMPLETED';
          const isActive = activeSetIndex === set.index;
          const inRest = isInRest(set.index);
          const restSecondsLeft = getRestSecondsLeft(set.index);
          const shouldGrayOut = isCompleted && !inRest;

          return (
            <div 
              key={set.index} 
              className={`grid grid-cols-[48px_1fr_1fr_80px] items-center gap-x-4 transition-all duration-300 ${
                shouldGrayOut ? 'opacity-30' : 'opacity-100'
              }`}
            >
              {/* Set Number */}
              <div className="flex flex-col">
                <span className="font-mono text-gray-400 font-black text-lg leading-none">{(idx + 1).toString().padStart(2, '0')}</span>
              </div>

              {/* Weight */}
              <div className="flex flex-col items-center justify-center">
                <div className="flex items-baseline">
                  <input
                    type="number"
                    value={editingValues[`weight-${set.index}`] ?? String(set.weight ?? '')}
                    onChange={(e) => setEditingValues(prev => ({ ...prev, [`weight-${set.index}`]: e.target.value }))}
                    onBlur={() => {
                      const key = `weight-${set.index}`;
                      const rawValue = editingValues[key];
                      if (rawValue === undefined) return;
                      const trimmed = String(rawValue).trim();
                      const finalValue = trimmed === '' ? 0 : Number(trimmed);
                      if (!Number.isFinite(finalValue)) {
                        setEditingValues(prev => { const next = { ...prev }; delete next[key]; return next; });
                        return;
                      }
                      updateSet(set.index, { weight: finalValue });
                      setEditingValues(prev => { const next = { ...prev }; delete next[key]; return next; });
                    }}
                    disabled={isCompleted}
                    className="w-full text-center font-black text-3xl bg-transparent border-b-2 border-transparent focus:border-blue-400 outline-none disabled:cursor-not-allowed transition-all tabular-nums text-gray-800"
                  />
                </div>
                <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">kg</span>
              </div>

              {/* Reps */}
              <div className="flex flex-col items-center justify-center">
                <div className="flex items-baseline">
                  <input
                    type="number"
                    value={editingValues[`reps-${set.index}`] ?? String(set.reps ?? '')}
                    onChange={(e) => setEditingValues(prev => ({ ...prev, [`reps-${set.index}`]: e.target.value }))}
                    onBlur={() => {
                      const key = `reps-${set.index}`;
                      const rawValue = editingValues[key];
                      if (rawValue === undefined) return;
                      const trimmed = String(rawValue).trim();
                      const finalValue = trimmed === '' ? 0 : Number.parseInt(trimmed, 10);
                      if (!Number.isFinite(finalValue)) {
                        setEditingValues(prev => { const next = { ...prev }; delete next[key]; return next; });
                        return;
                      }
                      updateSet(set.index, { reps: finalValue });
                      setEditingValues(prev => { const next = { ...prev }; delete next[key]; return next; });
                    }}
                    disabled={isCompleted}
                    className="w-full text-center font-black text-3xl bg-transparent border-b-2 border-transparent focus:border-blue-400 outline-none disabled:cursor-not-allowed transition-all tabular-nums text-gray-800"
                  />
                </div>
                <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">次数</span>
              </div>

              {/* Action Button - Moved to 4th column */}
              <div className="flex justify-center">
                <button
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handlePointerDown(set.index);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    handlePointerUp(set.index);
                  }}
                  onPointerLeave={(e) => {
                    e.stopPropagation();
                    handlePointerLeave();
                  }}
                  onTouchStart={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`w-16 h-12 rounded-2xl border-2 flex items-center justify-center transition-all duration-300 active:scale-90 shadow-sm relative overflow-hidden ${
                    inRest
                      ? 'bg-orange-500 border-orange-400 shadow-lg shadow-orange-500/40'
                      : isCompleted
                      ? 'bg-green-500 border-green-400 shadow-lg shadow-green-500/40'
                      : 'bg-white border-gray-100 active:bg-gray-50'
                  }`}
                >
                  {/* High-speed scan effect for active/resting states */}
                  {(inRest || (isCompleted && !shouldGrayOut)) && (
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite] pointer-events-none"></div>
                  )}

                  {inRest ? (
                    <div className="flex flex-col items-center">
                      <span className="text-lg font-black text-white tabular-nums leading-none">{restSecondsLeft}</span>
                      <span className="text-[7px] text-white/80 font-bold uppercase tracking-tighter">REST</span>
                    </div>
                  ) : isCompleted ? (
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg 
                      className="w-6 h-6 text-gray-200 transition-all duration-300" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24" 
                      strokeWidth="3.5"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      
      <DeviationWarningModal
        isOpen={showDeviationModal}
        onClose={() => setShowDeviationModal(false)}
        onConfirm={handleDeviationConfirm}
        context={pendingDeviation ? {
          exerciseName: pendingDeviation.exerciseName,
          field: pendingDeviation.field,
          original: pendingDeviation.original,
          current: pendingDeviation.current
        } : { exerciseName: '', field: 'weight', original: 0, current: 0 }}
      />
    </div>
  );
};
