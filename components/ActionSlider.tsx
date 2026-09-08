// ActionSlider — 底部菜单：iOS 系统组件版（官方 Segmented 视觉/交互）+ 多端回落
// 交互流：
//   收起态点按 → 展开（原生系统菜单接管：点击选/拖动换选，全系统手势）
//   系统菜单选择 → menuSelect 事件 → fire 触发动作 → 收起
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import GlassSurface from '../src/lib/GlassSurface';
import { isNativeGlass, showMenu, hideMenu, onMenuSelect } from '../src/lib/nativeGlass';

export interface SliderOption {
  label: string;
  icon: React.ReactNode;
  action: (e?: React.MouseEvent) => void;
  variant?: 'danger' | 'accent' | 'default';
}

interface ActionSliderProps {
  left: SliderOption;
  right: SliderOption;
  isLoading?: boolean;
  disabled?: boolean;
}

// Apple 风格弹簧：欠阻尼（ζ≈0.65），展开可见 1~2 次柔和回弹
const springExpand = { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 } as const;

type OptionSide = 'left' | 'right';

const ActionSlider: React.FC<ActionSliderProps> = ({ left, right, isLoading, disabled }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const capsuleRef = useRef<HTMLDivElement>(null);

  const haptic = (ms: number) => {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  };

  const setExpanded = useCallback((v: boolean) => {
    setIsExpanded(v);
  }, []);

  /** Web 图标 → SF Symbol 名（原生层渲染） */
  const sfSymbol = (side: OptionSide): string => {
    const opt = side === 'left' ? left : right;
    if (opt.variant === 'danger') return 'stop.fill';
    if (opt.label === '历史') return 'clock.arrow.circlepath';
    return 'sparkles';
  };

  const fire = useCallback((side: OptionSide, pt?: { x: number; y: number }) => {
    const opt = side === 'left' ? left : right;
    haptic(40);
    const syntheticEvent = {
      clientX: pt?.x ?? 0,
      clientY: pt?.y ?? 0,
      stopPropagation: () => {},
      preventDefault: () => {},
    } as unknown as React.MouseEvent;
    opt.action(syntheticEvent);
  }, [left, right]);

  const collapsedBlocked = disabled || isLoading;

  // ============ 原生系统菜单（iOS：官方 Segmented 组件全权接管）============
  // 展开后：等胶囊布局稳定，把菜单 rect+选项交给原生系统组件渲染。
  // 选择回调 → fire 动作 → 收起。
  useEffect(() => {
    if (!isNativeGlass) return;
    const off = onMenuSelect((index) => {
      fire(index === 0 ? 'left' : 'right');
      setExpanded(false);
    });
    return off;
  }, [fire, setExpanded]);

  useEffect(() => {
    if (!isNativeGlass || !isExpanded) return;
    let raf = 0;
    let lastW = -1;
    let stableFrames = 0;
    let done = false;
    const settle = () => {
      const cap = capsuleRef.current?.getBoundingClientRect();
      const capW = cap?.width ?? 0;
      if (capW >= 280) {
        if (Math.abs(capW - lastW) < 0.5) {
          stableFrames += 1;
          if (stableFrames >= 6) {
            done = true;
            if (cap) {
              // 菜单 rect：比 Web 容器外扩一圈（系统组件自带玻璃边距）
              showMenu(
                { x: cap.left, y: cap.top, width: cap.width, height: cap.height },
                [
                  { title: left.label, icon: sfSymbol('left') },
                  { title: right.label, icon: sfSymbol('right') },
                ],
                0,
              );
            }
            return;
          }
        } else {
          stableFrames = 0;
        }
      } else {
        stableFrames = 0;
      }
      lastW = capW;
      raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);
    return () => { if (!done) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNativeGlass, isExpanded]);

  // 收起：清除原生菜单
  useEffect(() => {
    if (!isNativeGlass) return;
    if (!isExpanded) hideMenu();
  }, [isNativeGlass, isExpanded]);

  // 组件卸载（路由切换）：清理原生层
  useEffect(() => {
    if (!isNativeGlass) return;
    return () => hideMenu();
  }, [isNativeGlass]);

  // ============ Web 层手势（展开/收起控制 + 非 iOS 菜单）============
  // iOS：把手点按展开后，菜单区域由原生系统组件接管（原生层在 WebView 之上，
  // 点击/拖动直接走系统手势，不会穿透到本组件）。
  const openedThisGestureRef = useRef(false);
  const suppressClickRef = useRef(0);

  useEffect(() => {
    const capsule = capsuleRef.current;
    if (!capsule) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (collapsedBlocked) return;
      if (!isExpanded) {
        haptic(10);
        openedThisGestureRef.current = true;
        setExpanded(true);
      }
      void t;
    };
    const onTouchEnd = () => {
      // 展开菜单的那一下不触发动作（菜单交给原生系统组件）
      if (openedThisGestureRef.current) {
        suppressClickRef.current = Date.now();
        openedThisGestureRef.current = false;
      }
    };
    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() - suppressClickRef.current < 500) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    capsule.addEventListener('touchstart', onTouchStart, { passive: true });
    capsule.addEventListener('touchend', onTouchEnd, { passive: true });
    capsule.addEventListener('click', onClickCapture, { capture: true });
    return () => {
      capsule.removeEventListener('touchstart', onTouchStart);
      capsule.removeEventListener('touchend', onTouchEnd);
      capsule.removeEventListener('click', onClickCapture, { capture: true } as EventListenerOptions);
    };
  }, [collapsedBlocked, isExpanded, setExpanded]);

  // 点击外部收起（仅 Web 层把手/空白；原生菜单自身点击由 menuSelect 处理）
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (capsuleRef.current && !capsuleRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isExpanded, setExpanded]);

  // 非 iOS tier：选项按钮（CSS 玻璃 + 点击选中）
  const renderOption = (side: OptionSide, opt: SliderOption) => (
    <button
      type="button"
      className="flex-1 flex flex-col items-center justify-center gap-1 relative"
      onClick={(e) => { fire(side, { x: e.clientX, y: e.clientY }); setExpanded(false); }}
    >
      {!isNativeGlass && (
        <>
          <GlassSurface
            id={`action-slider-${side}`}
            radius={30}
            variant="regular"
            refreshKey={`${isExpanded}`}
            className="absolute inset-0"
          />
          <div className="w-5 h-5 opacity-90 relative z-10">{opt.icon}</div>
          <span className="text-[10px] font-black uppercase tracking-[0.2em] leading-none relative z-10">
            {opt.label}
          </span>
        </>
      )}
    </button>
  );

  return (
    createPortal(
      <div className="fixed bottom-0 left-1/2 transform -translate-x-1/2 z-40 flex justify-center w-full max-w-[320px] px-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}>
      <motion.div
        ref={capsuleRef}
        initial={false}
        animate={{
          width: isExpanded ? (isNativeGlass ? '288px' : '100%') : '96px',
          height: isExpanded ? '80px' : '56px',
          borderRadius: isExpanded ? '40px' : '28px',
          opacity: isExpanded && isNativeGlass ? 0 : 1,
        }}
        transition={springExpand}
        className={`
          relative text-star-dark flex items-center overflow-hidden touch-none select-none
          ${!isNativeGlass ? 'liquid-glass' : 'bg-white shadow-[0_2px_16px_rgba(0,0,0,0.08)]'}
          ${!isExpanded && !collapsedBlocked ? 'cursor-pointer' : ''}
          ${collapsedBlocked ? 'opacity-60' : ''}
        `}
        style={{ transition: 'opacity 0.2s ease' }}
      >
        <motion.div
          animate={{ opacity: isExpanded ? 0 : 1 }}
          transition={{ duration: 0.12 }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ visibility: isExpanded ? 'hidden' : 'visible' }}
        >
          {/* 收起把手：纯白 + 灰色暗示条 */}
          {isNativeGlass && <div className="absolute inset-0 bg-white" />}
          <div className="w-8 h-1.5 bg-gray-300/80 rounded-full" />
        </motion.div>

        <motion.div
          animate={{ opacity: isExpanded ? 1 : 0 }}
          transition={{ duration: 0.15 }}
          className="flex w-full h-full p-1.5"
          style={{ visibility: isExpanded ? 'visible' : 'hidden' }}
        >
          {/* iOS：原生系统菜单覆盖此区域（Web 层透明占位）；其他端 CSS 玻璃选项 */}
          {!isNativeGlass && (
            <>
              {renderOption('left', left)}
              {renderOption('right', right)}
            </>
          )}
        </motion.div>
      </motion.div>
      </div>,
      document.body
    )
  );
};

export default ActionSlider;
