import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../lib/nativeHaptics';

export interface StartMenuOption {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

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
  // 空状态点击「开始运动」时弹出的分裂菜单选项；不传则保持旧行为（直接 onStart）
  startOptions?: StartMenuOption[];
  // 训练中（active/paused）把胶囊往下滑 → 进入锁定训练屏
  onLockScreen?: () => void;
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
  onEnd,
  startOptions,
  onLockScreen
}) => {
  const [displayTime, setDisplayTime] = useState("00:00");
  const [textIndex, setTextIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const requestRef = useRef<number | null>(null);

  const isCentered = status === 'idle' && !hasExercises;
  const hasMenu = !!startOptions && startOptions.length > 0;

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

  // 离开空状态时自动收起菜单（如选项动作添加了卡片）
  useEffect(() => {
    if (!isCentered && menuOpen) setMenuOpen(false);
  }, [isCentered, menuOpen]);

  // 硬件返回键：菜单打开时拦截一层，只关菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onBack = (e: Event) => {
      e.preventDefault();
      setMenuOpen(false);
    };
    window.addEventListener('starfit-back-button', onBack);
    return () => window.removeEventListener('starfit-back-button', onBack);
  }, [menuOpen]);

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

  // --- 下滑进入锁定屏（训练中）：下拉拖拽 + 阈值触发 ---
  // iOS WebKit 坑：touchstart 后浏览器会合成 click 二次触发，须在 touchend 后窗口期拦截
  const dragStartY = useRef<number | null>(null);
  const dragAccum = useRef(0);
  const lastTouchEnd = useRef(0);
  const LOCK_DRAG_THRESHOLD = 90; // px，约 1.2 个胶囊高度的下滑量
  const TAP_SLOP = 8; // px，轻点时的触摸抖动上限（超过=拖拽/滚动，非轻点）

  const handleTouchStart = (e: React.TouchEvent) => {
    if (status === 'idle' || status === 'finished') return;
    dragStartY.current = e.touches[0]?.clientY ?? null;
    dragAccum.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const y = e.touches[0]?.clientY;
    if (typeof y !== 'number') return;
    dragAccum.current = y - dragStartY.current;
  };

  const handleTouchEnd = () => {
    const dy = dragAccum.current;
    dragStartY.current = null;
    dragAccum.current = 0;
    // 只有真实拖拽/滚动（位移超轻点抖动）才拦截后续合成 click——
    // 纯轻点（|dy|≈0）的 touchend→click 间隔 <500ms，若也记录时间戳会把
    // 正常暂停点击一起拦死（2026-09-15 实锤：锁屏手势上线后单击暂停全灭的根因）
    if (Math.abs(dy) > TAP_SLOP) {
      lastTouchEnd.current = Date.now();
    }
    // 明确往下拖过阈值 → 进入锁定屏；轻点交给 click 走暂停逻辑
    if (dy > LOCK_DRAG_THRESHOLD && onLockScreen) {
      // 只有真正拖拽过阈值才记录时间戳：防止拖拽后的合成 click 被当成暂停
      // （2026-09-15 回归修复：之前无条件记录导致普通轻点暂停被 500ms 窗口吞掉，点击无效）
      lastTouchEnd.current = Date.now();
      haptic('medium');
      onLockScreen();
    }
  };

  // 合成 click 防护：仅在"下滑锁定手势"后生效，500ms 内的合成 click 不当暂停
  const guardClick = (fn: () => void) => {
    if (Date.now() - lastTouchEnd.current < 500) return;
    fn();
  };

  // iOS-style spring configuration
  const springConfig = { type: 'spring', stiffness: 400, damping: 38, mass: 1 } as const;

  const idleLabels = ["开始运动", "添加动作"];

  const handleCapsuleTap = () => {
    if (isCentered && hasMenu) {
      haptic('medium'); // 主操作：唤出开始菜单
      setMenuOpen(true);
      return;
    }
    onStart();
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-start justify-center">
      <motion.div
        initial={false}
        animate={{
          y: isCentered ? '50vh' : 'calc(var(--safe-top) + 12px)',
          translateY: isCentered ? '-50%' : '0%',
          scale: isCentered ? (menuOpen ? 0.96 : 1.05) : 1,
        }}
        transition={springConfig}
        className="pointer-events-auto origin-center"
      >
        {/* 阴影载体：不能放进 mask 容器，否则阴影被裁掉（上一轮的教训） */}
        <motion.div
          className={status === 'idle' ? 'frost-lens absolute inset-0' : 'frost-lens-dark absolute inset-0'}
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
          onClick={status === 'idle' ? handleCapsuleTap : undefined}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
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
                  onClick={isFinished ? undefined : () => guardClick(isPaused ? onOpenManual : onPause)}
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
                      style={{ fontFeatureSettings: "'tnum'", fontWeight: 600 }}
                      className={`
                        font-mono font-semibold text-4xl tracking-tight
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

      {/* 空状态分裂菜单：从胶囊下方错峰弹出，同 frost-lens 玻璃药丸 */}
      <AnimatePresence>
        {menuOpen && isCentered && hasMenu && (
          <>
            <motion.div
              key="start-menu-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/20 pointer-events-auto"
              onClick={() => setMenuOpen(false)}
            />
            {/* 菜单顶边 = 胶囊底边（50vh + 32px）+ 12px 间距 */}
            <div
              key="start-menu"
              className="absolute left-1/2 pointer-events-auto flex flex-col gap-2.5"
              style={{ top: 'calc(50vh + 44px)', transform: 'translateX(-50%)' }}
            >
              {startOptions!.map((opt, i) => (
                <motion.button
                  key={opt.key}
                  initial={{ opacity: 0, scale: 0.6, y: -28 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.6, y: -28, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 26, mass: 0.9, delay: i * 0.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    haptic('light');
                    setMenuOpen(false);
                    opt.onSelect();
                  }}
                  className="frost-lens relative w-[208px] h-[56px] rounded-full flex items-center gap-3 px-4"
                >
                  <span className="w-8 h-8 rounded-full bg-black/[0.05] flex items-center justify-center text-gray-700 shrink-0">
                    {opt.icon}
                  </span>
                  <span className="text-[15px] font-semibold text-gray-900">{opt.label}</span>
                </motion.button>
              ))}
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TimerCapsule;
