import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TimerCapsuleProps {
  status: 'idle' | 'active' | 'paused' | 'finished';
  startTime: number;
  pausedDuration: number;
  hasExercises: boolean; // Triggers the move to top
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenManual: () => void;
  onEnd: () => void;
}

const TimerCapsule: React.FC<TimerCapsuleProps> = ({ 
  status, 
  startTime, 
  pausedDuration, 
  hasExercises, 
  onStart,
  onPause,
  onResume,
  onOpenManual,
  onEnd
}) => {
  const [displayTime, setDisplayTime] = useState("00:00");
  const [textIndex, setTextIndex] = useState(0);
  const requestRef = useRef<number | null>(null);

  const isCentered = status === 'idle' && !hasExercises;

  // Text rotation for idle state without exercises
  useEffect(() => {
    if (isCentered) {
      const interval = setInterval(() => {
        setTextIndex(prev => (prev + 1) % 2);
      }, 2600);
      return () => clearInterval(interval);
    } else {
      setTextIndex(0);
    }
  }, [isCentered]);

  useEffect(() => {
    if (status !== 'active') {
      if (status === 'paused' || status === 'finished') {
        const diff = Date.now() - startTime - pausedDuration;
        updateDisplay(diff);
      } else {
        setDisplayTime("00:00");
      }
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diff = now - startTime - pausedDuration;
      updateDisplay(diff);
      requestRef.current = requestAnimationFrame(updateTimer);
    };

    requestRef.current = requestAnimationFrame(updateTimer);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [status, startTime, pausedDuration]);

  const updateDisplay = (diff: number) => {
    if (diff < 0) diff = 0;
    const totalSeconds = Math.floor(diff / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    setDisplayTime(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
  };

  // --- Render Logic ---

  const isPaused = status === 'paused';
  const isFinished = status === 'finished';

  // iOS-style spring configuration
  const springConfig = { type: 'spring', stiffness: 400, damping: 38, mass: 1 } as const;

  const idleLabels = ["开始运动", "添加动作"];

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-start justify-center">
      <motion.div
        initial={false}
        animate={{
          y: isCentered ? '50vh' : 'calc(var(--safe-top) + 12px)',
          translateY: isCentered ? '-50%' : '0%',
          scale: isCentered ? 1.05 : 1,
        }}
        transition={springConfig}
        className="pointer-events-auto origin-center"
      >
        {/* 阴影载体：不能放进 mask 容器，否则阴影被裁掉（上一轮的教训） */}
        <motion.div
          className={status === 'idle' ? 'liquid-glass absolute inset-0' : 'liquid-glass-dark absolute inset-0'}
          style={{ borderRadius: '32px' }}
          animate={{
            width: status === 'idle' ? 208 : (isPaused ? 320 : 180),
            height: 64,
          }}
          transition={springConfig}
        />
        {/* 玻璃本体 + 流光：mask 裁切层，WebKit 上 overflow:hidden 裁不住 blur 合成层，
            必须用 -webkit-mask（此 hack 为 iOS WebKit 必需，勿删） */}
        <motion.div
          className="relative flex items-center overflow-hidden"
          style={{
            borderRadius: '32px',
            WebkitMaskImage: '-webkit-radial-gradient(white, black)',
            maskImage: 'radial-gradient(white, black)',
          }}
          onClick={status === 'idle' ? onStart : undefined}
          animate={{
            width: status === 'idle' ? 208 : (isPaused ? 320 : 180),
            height: 64,
          }}
          transition={springConfig}
        >
          {/* Siri 风格边缘流光（仅 idle 态）：被 mask 裁进胶囊内部 */}
          {status === 'idle' && <div className="siri-glow" />}
          <AnimatePresence mode="popLayout" initial={false}>
            {status === 'idle' ? (
              <motion.div
                key="start-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full flex items-center justify-center relative"
              >
                {/* 文案：双文案同格叠放，纯交叉溶解（无位移、不卸载，杜绝跑马灯感和掉帧） */}
                <div className="grid items-center justify-items-center">
                  {idleLabels.map((label, i) => (
                    <motion.span
                      key={label}
                      initial={false}
                      animate={{ opacity: textIndex === i ? 1 : 0 }}
                      transition={{ duration: 0.45, ease: "easeInOut" }}
                      className="col-start-1 row-start-1 text-[19px] font-semibold tracking-[0.06em] whitespace-nowrap"
                    >
                      {label}
                    </motion.span>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="active-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full flex items-center relative"
              >
                {/* Paused Controls - Left：红色停止（结束运动） */}
                <AnimatePresence>
                  {isPaused && (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="absolute left-3"
                    >
                      <button
                        onClick={onEnd}
                        aria-label="结束运动"
                        className="w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-all"
                      >
                        {/* 纯红色小矩形：比三角形大 5px，视觉均衡（方形同面积显小） */}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF3B30" className="w-[33px] h-[33px]">
                          <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
                        </svg>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Time Display - Center */}
                <motion.button
                  onClick={isFinished ? undefined : (isPaused ? onOpenManual : onPause)}
                  className={`
                    flex-1 flex items-center justify-center h-full
                    ${isFinished ? 'cursor-default' : 'cursor-pointer active:scale-95'}
                  `}
                >
                  <div className="w-[140px] flex items-center justify-center gap-2.5">
                    {/* 运行状态指示点：代替旧的脉冲描边 */}
                    {!isPaused && !isFinished && (
                      <span className="relative flex w-2 h-2">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60 animate-ping" />
                        <span className="relative inline-flex w-2 h-2 rounded-full bg-green-400" />
                      </span>
                    )}
                    <span 
                      style={{ fontFeatureSettings: "'tnum'" }}
                      className={`
                        font-mono font-black text-4xl tracking-tight
                        ${isPaused ? 'text-white/40' : 'text-white'}
                        transition-colors duration-300
                      `}
                    >
                      {displayTime}
                    </span>
                  </div>
                </motion.button>


                {/* Paused Controls - Right */}
                <AnimatePresence>
                  {isPaused && (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="absolute right-3"
                    >
                      <button 
                        onClick={onResume}
                        className="w-12 h-12 rounded-full flex items-center justify-center text-blue-400 hover:bg-blue-400/10 active:scale-90 transition-all"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                          <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default TimerCapsule;
