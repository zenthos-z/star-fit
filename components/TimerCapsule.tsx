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
}

const TimerCapsule: React.FC<TimerCapsuleProps> = ({ 
  status, 
  startTime, 
  pausedDuration, 
  hasExercises, 
  onStart,
  onPause,
  onResume,
  onOpenManual
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
      }, 2000);
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

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-start justify-center">
      <motion.div
        initial={false}
        animate={{
          y: isCentered ? '50vh' : 'calc(env(safe-area-inset-top, 0px) + 80px)',
          translateY: isCentered ? '-50%' : '0%',
          scale: isCentered ? 1.1 : 1,
        }}
        transition={springConfig}
        className="pointer-events-auto origin-center"
      >
        <motion.div
          className={`
            bg-star-dark/90 backdrop-blur-xl text-white shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5),0_0_40px_-10px_rgba(255,255,255,0.2)] flex items-center overflow-hidden border border-white/15
            ${status === 'idle' ? 'hover:bg-star-dark active:scale-95 transition-colors cursor-pointer' : ''}
          `}
          style={{
            borderRadius: '32px',
            WebkitMaskImage: '-webkit-radial-gradient(white, black)',
            clipPath: 'inset(0 round 32px)',
          }}
          onClick={status === 'idle' ? onStart : undefined}
          animate={{
            width: status === 'idle' ? 220 : (isPaused ? 320 : 180),
            height: status === 'idle' ? 72 : 64,
            borderRadius: '32px',
            clipPath: 'inset(0 round 32px)',
          }}
          transition={springConfig}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {status === 'idle' ? (
              <motion.div
                key="start-btn"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="w-full h-full flex items-center justify-center gap-3 relative group"
              >
                {/* Dynamic Glow Layer */}
                <motion.div
                  className="absolute inset-0 bg-star-accent/20 blur-2xl"
                  animate={{
                    opacity: [0.2, 0.4, 0.2],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />

                {/* High-light Sweep Effect */}
                <motion.div
                  animate={{
                    left: ['-100%', '200%'],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "linear",
                    repeatDelay: 1.5
                  }}
                  className="absolute top-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[-25deg] pointer-events-none z-20"
                />
                
                <div className="relative z-10 flex items-center justify-center gap-0.5 ml-2 min-w-[110px]">
                  <AnimatePresence mode="wait">
                    <motion.div 
                      key={textIndex}
                      className="flex items-center justify-center gap-0.5"
                    >
                      {(textIndex === 0 ? "START" : "添加动作").split('').map((char, i) => (
                        <motion.span
                          key={i}
                          initial={{ rotateX: -90, opacity: 0 }}
                          animate={{ rotateX: 0, opacity: 1 }}
                          exit={{ rotateX: 90, opacity: 0 }}
                          transition={{ 
                            duration: 0.15, 
                            delay: i * 0.03,
                            ease: "easeOut"
                          }}
                          className="font-black text-xl tracking-[0.02em] inline-block origin-center"
                          style={{ backfaceVisibility: 'hidden', perspective: '1000px' }}
                        >
                          {char}
                        </motion.span>
                      ))}
                    </motion.div>
                  </AnimatePresence>
                </div>
                <motion.div
                  className="relative z-10"
                  animate={{ x: [0, 4, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                >
                  <svg className="w-6 h-6 text-star-accent" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 5.757c0-1.156 1.256-1.878 2.257-1.298l9.428 5.462c1.001.58 1.001 2.017 0 2.597l-9.428 5.462C8.256 18.658 7 17.935 7 16.78V5.757z" />
                  </svg>
                </motion.div>
              </motion.div>
            ) : (
              <motion.div
                key="active-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full flex items-center relative"
              >
                {/* Paused Controls - Left */}
                <AnimatePresence>
                  {isPaused && (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="absolute left-4"
                    >
                      <button 
                        onClick={onOpenManual}
                        className="w-12 h-12 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                        </svg>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Time Display - Center */}
                <motion.button
                  onClick={isPaused || isFinished ? undefined : onPause}
                  className={`
                    flex-1 flex items-center justify-center h-full
                    ${(isPaused || isFinished) ? 'cursor-default' : 'cursor-pointer active:scale-95'}
                  `}
                >
                  <div className="w-[140px] flex justify-center">
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
                      className="absolute right-4"
                    >
                      <button 
                        onClick={onResume}
                        className="w-12 h-12 rounded-full flex items-center justify-center text-star-accent hover:bg-star-accent/10 active:scale-90 transition-all"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                          <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Pulse effect for active state */}
                {!isPaused && !isFinished && (
                  <motion.div
                    className="absolute inset-0 rounded-full pointer-events-none border-2 border-star-accent/20"
                    animate={{
                      scale: [1, 1.05, 1],
                      opacity: [0, 0.5, 0],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default TimerCapsule;
