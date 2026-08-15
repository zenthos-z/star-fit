import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ExerciseAction, LoadAnchors } from '../../../types/protocol';
import { Play, Pause, RotateCcw, CheckCircle2, Heart, Timer, MapPin, Watch, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface RunningCardProps {
  exercise: ExerciseAction;
  isPaused?: boolean;
  loadAnchors?: LoadAnchors;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
}

type RunningMode = 'TIME_COUNTDOWN' | 'DISTANCE_TARGET' | 'FREE_RUN';

const MODE_CONFIG = {
  DISTANCE_TARGET: {
    icon: MapPin,
    label: '目标距离',
    heroLabel: '目标公里 (KM)',
  },
  TIME_COUNTDOWN: {
    icon: Timer,
    label: '倒计时',
    heroLabel: '目标时长',
  },
  FREE_RUN: {
    icon: Watch,
    label: '自由跑',
    heroLabel: '当前用时',
  }
};

export const RunningCard: React.FC<RunningCardProps> = ({ exercise, isPaused, onUpdate }) => {
  const metadata = exercise.metadata || {};
  const exerciseName = metadata.name || '有氧运动';
  const cardioSubtype = metadata.cardioSubtype || 'GENERAL';

  // 已移除执行界面参考值展示与锚点读取
  
  let mode: RunningMode = 'FREE_RUN';
  if (metadata.cardioMode) {
    mode = metadata.cardioMode as RunningMode;
  } else if (metadata.targetDistanceMeters) {
    mode = 'DISTANCE_TARGET';
  } else if (metadata.targetDurationSec) {
    mode = 'TIME_COUNTDOWN';
  }
  
  const config = {
    ...MODE_CONFIG[mode],
    label: mode === 'FREE_RUN' 
      ? (cardioSubtype === 'DISTANCE' ? '自由跑' : '自由练') 
      : MODE_CONFIG[mode].label
  };
  const targetDuration = metadata.targetDurationSec ? Number(metadata.targetDurationSec) : 0;
  const targetDistance = metadata.targetDistanceMeters ? Number(metadata.targetDistanceMeters) : 0;
  const targetHeartRateZone = metadata.targetHeartRateZone || '2'; 

  const currentSet = exercise.sets[0] || { index: 0, status: 'PLANNED', duration: 0, distance: 0 };

  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(currentSet.duration || 0);
  const [isCompleted, setIsCompleted] = useState(currentSet.status === 'COMPLETED');
  
  const timerRef = useRef<any>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (isRunning && !isPaused) {
      lastTickRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const delta = (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;

        setElapsed(prev => {
          const next = prev + delta;
          if (mode === 'TIME_COUNTDOWN' && targetDuration > 0 && next >= targetDuration) {
            handleComplete(targetDuration);
            return targetDuration;
          }
          return next;
        });
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRunning, isPaused, mode, targetDuration]);

  const syncToParent = (finalElapsed?: number, isCompleted = false) => {
    if (!onUpdate) return;
    const status = isCompleted ? 'COMPLETED' : 'PLANNED';
    onUpdate({
      sets: [{
        ...currentSet,
        duration: Math.floor(finalElapsed ?? elapsed),
        status,
        // `completed` is not a property of the set type — remove it; status already
        // captures COMPLETED vs PLANNED. Keeping it in the literal would crash
        // typecheck under strict object literal checking (TS2353).
        // completed: isCompleted,
        timestamp: new Date().toISOString()
      }]
    });
  };

  const handleToggle = () => {
    const nextState = !isRunning;
    setIsRunning(nextState);
    if (!nextState) syncToParent();
  };

  const handleComplete = (finalElapsed?: number) => {
    setIsRunning(false);
    setIsCompleted(true);
    const actualElapsed = finalElapsed ?? elapsed;
    syncToParent(actualElapsed, true);
  };

  const handleUndoComplete = () => {
    setIsCompleted(false);
    setIsRunning(false);
    setElapsed(0);
    syncToParent(0, false);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatDistance = (meters: number) => (meters / 1000).toFixed(1);

  const smoothSpring = { type: "spring", stiffness: 400, damping: 30, mass: 0.8 } as const;

  const renderMetrics = () => {
    const isActive = isRunning || elapsed > 0 || isCompleted;
    
    return (
      <motion.div layout transition={smoothSpring} className="flex w-full px-8 items-center justify-center relative min-h-[120px]">
        <AnimatePresence mode="popLayout">
          {/* 距离模式：开始前大字显示目标；开始后左侧目标，右侧计时 */}
          {mode === 'DISTANCE_TARGET' && (
            <motion.div layout key="dist-target" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={smoothSpring}
              className={`flex items-center ${isActive ? '' : 'flex-col'}`}
            >
              <motion.div layout
                className={`flex flex-col items-center ${isActive ? 'pr-8 border-r border-gray-100' : ''}`}
              >
                <div className={`${isActive ? 'text-5xl' : 'text-7xl'} font-bold tracking-tighter tabular-nums text-gray-900 leading-none`}>
                  {formatDistance(targetDistance)}
                </div>
                <div className={`${isActive ? 'text-[10px]' : 'text-xs'} font-bold uppercase tracking-widest mt-3 text-gray-400`}>
                  目标公里 (KM)
                </div>
              </motion.div>
              {isActive && (
                <motion.div layout key="dist-timer" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={smoothSpring} className="flex flex-col items-center pl-8">
                  <div className="text-5xl font-bold tracking-tighter tabular-nums text-gray-900 leading-none">{formatTime(elapsed)}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mt-3 text-gray-400">运动用时</div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* 倒计时模式：开始前显示目标时长；开始后从目标时长倒计时 */}
          {mode === 'TIME_COUNTDOWN' && (
            <motion.div layout key="time-countdown" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={smoothSpring} className="flex flex-col items-center">
              <div className="text-7xl font-bold tracking-tighter tabular-nums text-gray-900 leading-none">
                {!isActive ? formatTime(targetDuration) : (isCompleted ? '00:00' : formatTime(Math.max(0, targetDuration - elapsed)))}
              </div>
              <div className="text-xs font-bold uppercase tracking-widest mt-3 text-gray-400">
                {!isActive ? '目标时长' : (isCompleted ? '已达成' : '剩余时间')}
              </div>
            </motion.div>
          )}

          {/* 自由练模式：始终为单一的大字号计时器 */}
          {mode === 'FREE_RUN' && (
            <motion.div layout key="free-run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={smoothSpring} className="flex flex-col items-center">
              <div className="text-7xl font-bold tracking-tighter tabular-nums text-gray-900 leading-none">
                {formatTime(elapsed)}
              </div>
              <div className="text-xs font-bold uppercase tracking-widest mt-3 text-gray-400">
                当前用时
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-50">
      <div className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-blue-500 rounded-2xl shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
          <h3 className="text-xl font-black text-gray-900 tracking-tight">{exerciseName}</h3>
        </div>
        <div className="flex items-center gap-2">
           <span className="flex items-center gap-1 text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded-2xl font-bold uppercase tracking-widest border border-gray-100">
               <config.icon className="w-3 h-3" />
               {config.label}
           </span>
         </div>
      </div>

      {/* 已移除执行界面参考值展示 */}

      <div className={`flex flex-col items-center justify-center py-8 mb-6 rounded-2xl border relative overflow-hidden transition-all duration-500 ${
          isCompleted ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100'
      }`}>
          {/* 仅在倒计时模式显示进度条 */}
          {mode === 'TIME_COUNTDOWN' && !isCompleted && elapsed > 0 && (
            <div className="absolute bottom-0 left-0 h-1 bg-blue-500 transition-all duration-1000 ease-linear" style={{ width: `${Math.min(100, (elapsed / targetDuration) * 100)}%` }} />
          )}
          {renderMetrics()}
          <div className={`mt-6 flex items-center gap-1.5 px-3 py-1 rounded-2xl border transition-all ${
              isCompleted ? 'bg-emerald-100/50 text-emerald-600 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-100'
          }`}>
            <Heart className={`w-3.5 h-3.5 ${isCompleted ? 'fill-emerald-600' : 'fill-rose-600'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest">目标心率: Zone {targetHeartRateZone}</span>
          </div>
      </div>

      <motion.div layout transition={smoothSpring} className="flex gap-3 h-12 w-full relative">
        <AnimatePresence mode="popLayout">
          {(isRunning || elapsed > 0 || isCompleted) && (
            <motion.div key="secondary" initial={{ opacity: 0, scale: 0.8, width: 0 }} animate={{ opacity: 1, scale: 1, width: 'auto' }} exit={{ opacity: 0, scale: 0.8, width: 0 }} transition={smoothSpring} className="flex-1 overflow-hidden">
              {isCompleted ? (
                <button onClick={handleUndoComplete} className="w-full h-full rounded-2xl flex items-center justify-center gap-2 border-2 bg-white text-gray-400 border-gray-100 active:scale-95 transition-all">
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-widest">撤销</span>
                </button>
              ) : (
                <button onClick={() => handleComplete()} className={`w-full h-full rounded-2xl flex items-center justify-center gap-2 border-2 active:scale-95 transition-all ${isRunning ? 'bg-rose-50 text-rose-500 border-rose-100' : 'bg-emerald-50 text-emerald-500 border-emerald-100'}`}>
                  {isRunning ? <Square className="w-4 h-4 fill-current" /> : <CheckCircle2 className="w-5 h-5" />}
                  <span className="text-sm font-bold uppercase tracking-widest">{isRunning ? '结束' : '完成'}</span>
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div layout key="primary" transition={smoothSpring} style={{ originX: 1 }} className="flex-[2.5]">
          {isCompleted ? (
            <div className="w-full h-full bg-emerald-500 rounded-2xl flex items-center justify-center gap-3 text-white border-2 border-emerald-500">
              <CheckCircle2 className="w-6 h-6" />
              <span className="text-lg font-bold uppercase tracking-widest">已完成</span>
            </div>
          ) : (
            <button onClick={handleToggle} className={`w-full h-full rounded-2xl flex items-center justify-center gap-3 border-2 active:scale-95 transition-all ${isRunning ? 'bg-orange-50/50 text-orange-600 border-orange-200' : 'bg-white text-gray-800 border-gray-100'}`}>
              {isRunning ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current text-blue-500" />}
              <span className="text-lg font-bold uppercase tracking-widest">{isRunning ? '暂停' : (elapsed > 0 ? '继续' : '开始')}</span>
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
};
