import React, { useState, useEffect, useCallback } from 'react';
import { ExerciseAction, LoadAnchors } from '../../../types/protocol';
import { Attachment } from '../FloatingAttachment';
import { getExerciseTypeLabel } from '../../../../utils/exerciseTypeLabels';

interface IsometricCardProps {
  exercise: ExerciseAction;
  isPaused?: boolean;
  loadAnchors?: LoadAnchors;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
  addAttachment?: (attachment: Omit<Attachment, 'id' | 'timestamp'>) => void;
}

/**
 * IsometricCard Plugin
 * Specialized for static hold exercises (e.g., Plank, Wall Sit).
 * Features: Countdown/Count-up timer, intensity tracking, target duration progress.
 * Based on EXERCISE_EXECUTION_REFACTOR_GUIDE.md
 */
export const IsometricCard: React.FC<IsometricCardProps> = ({ exercise, isPaused, onUpdate, addAttachment }) => {
  const [activeSetIndex, setActiveSetIndex] = useState<number | null>(null);
  const [elapsedMap, setElapsedMap] = useState<Record<number, number>>({});

  // Timer logic for active hold - 每组独立计时
  useEffect(() => {
    if (activeSetIndex === null) return;

    const currentActiveIndex = activeSetIndex;
    const set = exercise.sets.find(s => Number(s.index) === currentActiveIndex);
    const targetDuration = (set as any)?.targetDuration || (exercise.metadata as any)?.targetDuration || 30;

    const timer = setInterval(() => {
      if (!isPaused) {
        setElapsedMap(prev => {
          const currentVal = prev[currentActiveIndex] || 0;
          const newVal = currentVal + 1;
          
          // 自动停止逻辑：达到目标时长
          if (newVal >= targetDuration) {
            clearInterval(timer);
            // [FIX] 使用 setTimeout 将 side effects 移出 render/updater 阶段，防止 React 警告
            setTimeout(() => {
              setActiveSetIndex(null);
              handleBatchUpdate(currentActiveIndex, { status: 'COMPLETED', duration: targetDuration });
            }, 0);
            return {
              ...prev,
              [currentActiveIndex]: targetDuration
            };
          }
          
          return {
            ...prev,
            [currentActiveIndex]: newVal
          };
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeSetIndex, isPaused, exercise.sets, exercise.metadata]);

  const handleBatchUpdate = (setIndex: any, updates: Record<string, any>) => {
    const numericIndex = Number(setIndex);
    const updatedSets = exercise.sets.map(set => {
      if (Number(set.index) === numericIndex) {
        const newSet = { ...set, ...updates };
        if (updates.status === 'COMPLETED') {
          newSet.timestamp = new Date().toISOString();
          if (newSet.duration === undefined || newSet.duration === 0) {
            newSet.duration = elapsedMap[numericIndex] || 0;
          }
          // Sync completed boolean with status enum
          (newSet as any).completed = true;
        } else if (updates.status === 'PLANNED') {
          (newSet as any).completed = false;
        }
        return newSet;
      }
      return set;
    });
    onUpdate?.({ sets: updatedSets });
  };

  const toggleStatus = (setIndex: any) => {
    const numericIndex = Number(setIndex);
    const set = exercise.sets.find(s => Number(s.index) === numericIndex);
    if (!set) return;

    const isActive = activeSetIndex === numericIndex;
    const isCompleted = set.status === 'COMPLETED';

    // 状态机：待开始 (PLANNED) -> 运动中 (ACTIVE) -> 运动终止 (COMPLETED) -> 待开始 (PLANNED)
    
    if (!isActive && !isCompleted) {
      // 1. 待开始 -> 运动中
      if (activeSetIndex !== null) {
        const prevActive = activeSetIndex;
        const finalDuration = elapsedMap[prevActive] || 0;
        // 这里也应该用批量更新，但因为是更新不同的组，需要更复杂的逻辑
        // 或者简单的循环处理所有组
        const updatedSets = exercise.sets.map(s => {
          if (Number(s.index) === prevActive) {
            return { ...s, status: 'COMPLETED', completed: true, duration: finalDuration, timestamp: new Date().toISOString() };
          }
          if (Number(s.index) === numericIndex) {
            return { ...s, status: 'PLANNED', completed: false };
          }
          return s;
        });
        onUpdate?.({ sets: updatedSets as any });
      } else {
        handleBatchUpdate(numericIndex, { status: 'PLANNED' });
      }
      
      setActiveSetIndex(numericIndex);
      setElapsedMap(prev => ({ ...prev, [numericIndex]: prev[numericIndex] || 0 }));
      
    } else if (isActive) {
      // 2. 运动中 -> 运动终止
      const finalDuration = elapsedMap[numericIndex] || 0;
      setActiveSetIndex(null);
      handleBatchUpdate(numericIndex, { status: 'COMPLETED', duration: finalDuration });
      
    } else if (isCompleted) {
      // 3. 运动终止 -> 待开始 (重置)
      setActiveSetIndex(null);
      setElapsedMap(prev => ({ ...prev, [numericIndex]: 0 }));
      handleBatchUpdate(numericIndex, { status: 'PLANNED' });
    }
  };

  const completedSets = exercise.sets.filter(s => s.status === 'COMPLETED').length;
  const totalSets = exercise.sets.length;

  return (
    <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-50">
      {/* Header - Standard Structure */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-blue-500 rounded-2xl shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
          <h3 className="text-xl font-black text-gray-900 tracking-tight">
            {exercise.metadata?.name || '静力动作'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded-2xl font-black uppercase tracking-widest border border-blue-100">
            {getExerciseTypeLabel(exercise.type)}
          </span>
        </div>
      </div>

      <div className="space-y-10">
        {exercise.sets.map((set, idx) => {
          const isCompleted = set.status === 'COMPLETED';
          const isActive = activeSetIndex !== null && Number(activeSetIndex) === Number(set.index);
          const displayDuration = isActive ? (elapsedMap[Number(set.index)] || 0) : ((set as any).targetDuration || (exercise.metadata as any)?.targetDuration || 30);
          const targetDuration = (set as any).targetDuration || (exercise.metadata as any)?.targetDuration || 30;
          const progressPercent = Math.min((displayDuration / targetDuration) * 100, 100);
          const shouldGrayOut = isCompleted && !isActive;

          return (
            <div 
              key={set.index} 
              className={`grid grid-cols-[48px_1fr_1fr_80px] items-center gap-x-4 transition-all duration-300 ${
                isActive ? 'scale-[1.02] bg-orange-50/30 rounded-2xl -mx-2 px-2 py-4' : ''
              } ${
                shouldGrayOut ? 'opacity-30' : 'opacity-100'
              }`}
            >
              {/* 1. Set Number */}
              <div className="flex flex-col">
                <span className="font-mono text-gray-400 font-black text-lg leading-none">{(idx + 1).toString().padStart(2, '0')}</span>
              </div>

              {/* 2. Duration/Timer */}
              <div className="flex flex-col items-center justify-center relative">
                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl font-black tabular-nums leading-none ${isActive ? 'text-orange-600' : 'text-gray-800'}`}>
                    {displayDuration}
                  </span>
                  <span className={`text-[12px] font-black uppercase tracking-widest ${isActive ? 'text-orange-400' : 'text-gray-400'}`}>s</span>
                </div>
                <span className="text-[12px] text-gray-400 font-bold mt-1">目标: {targetDuration}s</span>
                
                {/* Progress Mini-Bar */}
                <div className="absolute -bottom-2 w-12 h-0.5 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${isActive ? 'bg-orange-500' : isCompleted ? 'bg-emerald-400' : 'bg-gray-200'}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* 3. Weight */}
              <div className="flex flex-col items-center justify-center">
                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl font-black tabular-nums leading-none ${isCompleted ? 'text-gray-400' : 'text-gray-800'}`}>
                    {set.weight || 0}
                  </span>
                </div>
                <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">kg 配重</span>
              </div>

              {/* 4. Action Button */}
              <div className="flex justify-center">
                <button
                  onClick={() => toggleStatus(set.index)}
                  className={`w-16 h-10 rounded-2xl border-2 flex items-center justify-center transition-all duration-300 active:scale-95 shadow-sm ${
                    isActive 
                      ? 'bg-amber-500 border-amber-500 text-white shadow-lg shadow-amber-500/20' 
                      : isCompleted
                        ? 'bg-white border-emerald-100 text-emerald-500 shadow-sm'
                        : 'bg-white border-gray-100 text-gray-300 active:border-gray-200 active:bg-gray-50'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                    </svg>
                  ) : isActive ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z"/>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                      <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
