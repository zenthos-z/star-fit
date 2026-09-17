import React, { useRef, useState, useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { haptic } from '../src/lib/nativeHaptics';

interface SwipeAction {
  label: string;
  icon?: React.ReactNode;
  color: string;
  onClick: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  leftActions: SwipeAction[]; // Actions when swiping from left to right (e.g. Delete)
  rightActions: SwipeAction[]; // Actions when swiping from right to left (e.g. Tutorial/Settings)
  className?: string;
  actionWidth?: number;
  onLongPress?: () => void;
  onDragStatusChange?: (status: 'start' | 'move' | 'end', x: number, y: number) => void;
}

const SwipeableRow: React.FC<SwipeableRowProps> = ({ 
  children, 
  leftActions,
  rightActions,
  className = "", 
  actionWidth = 80,
  onLongPress,
  onDragStatusChange
}) => {
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isLongPressTriggered, setIsLongPressTriggered] = useState(false);
  const isLongPressTriggeredRef = useRef(false); // Mutable ref for immediate access in event handlers
  const controls = useAnimation();
  const outerRef = useRef<HTMLDivElement>(null);
  // 内缩量：动作按钮层比卡片表面小一圈，白卡盖住圆角边缘，防透色
  const ACTION_INSET = 3;
  // 动作层圆角 = 卡片实际圆角 - 内缩量（运行时读取，适配不同调用方的圆角规格）
  const [actionRadius, setActionRadius] = useState(0);
  
  const startX = useRef(0);
  const startY = useRef(0);
  const currentOffset = useRef(0);
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasMoved = useRef(false);
  const pressStartPos = useRef<{ x: number; y: number } | null>(null); // Track position during press delay
  // 横滑意图锁：判定本次触摸是横向滑动还是纵向滚动，判定后本次触摸内不再改变
  const swipeAxisRef = useRef<'x' | 'y' | null>(null);
  const swipeBaseRef = useRef(0); // 意图确认时的横向位移基准，防止卡片跳变
  
  const leftMaxOffset = leftActions.length * 80;
  const rightMaxOffset = rightActions.length > 0 ? 80 : 0; 
  const MIN_SWIPE_DISTANCE = 40;
  const SWIPE_AXIS_THRESHOLD = 18;   // 横滑意图确认所需最小横向位移(px)
  const SWIPE_AXIS_RATIO = 1.6;      // 横向位移需达到纵向的倍数才判为横滑
  const LONG_PRESS_DELAY = 500;
  const PRESS_DELAY = 150; // Delay before showing press effect - only triggers for taps, not swipes
  const PRESS_MOVE_THRESHOLD = 8; // Max movement allowed during press delay to consider it a tap

  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ isLongPressTriggered, isSwiping, offset });

  // 卡片完全闭合时不绘制动作按钮层：红/蓝底色不进渲染树绘制，
  // 既消除静止时圆角边缘透出的淡色圈，也消除快速滚动时圆角裁剪
  // 偶发失效导致的红蓝闪现（contain:paint + 合成层 + 圆角遮罩的已知抖动源）。
  const showActions = Math.abs(offset) > 0.5;
  
  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = { isLongPressTriggered, isSwiping, offset };
    // Also sync the ref just in case
    isLongPressTriggeredRef.current = isLongPressTriggered;
  }, [isLongPressTriggered, isSwiping, offset]);

  // 运行时读取卡片实际圆角（调用方可能是 rounded-[40px] 或 rounded-2xl 等）
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    setActionRadius(Math.max(0, r - ACTION_INSET));
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    setIsSwiping(true);
    hasMoved.current = false;
    swipeAxisRef.current = null; // 每次触摸重新判定滑动方向
    setIsLongPressTriggered(false);
    isLongPressTriggeredRef.current = false;

    // Delay press effect - only trigger if finger hasn't moved much (tap, not swipe)
    pressStartPos.current = { x: startX.current, y: startY.current };
    pressTimeoutRef.current = setTimeout(() => {
        // Check if finger has moved beyond threshold during the delay
        if (pressStartPos.current) {
            const moveDistance = Math.sqrt(
                Math.pow(startX.current - pressStartPos.current.x, 2) +
                Math.pow(startY.current - pressStartPos.current.y, 2)
            );
            // Only show press effect if finger hasn't moved significantly
            if (moveDistance < PRESS_MOVE_THRESHOLD) {
                setIsPressing(true);
            }
        }
    }, PRESS_DELAY);

    if (onLongPress) {
      longPressTimeoutRef.current = setTimeout(() => {
        if (!hasMoved.current) {
          haptic('medium'); // 长按触发：中等确认触感
          setIsLongPressTriggered(true);
          isLongPressTriggeredRef.current = true;
          onLongPress();
          // Notify start of drag for reordering immediately upon long press
          onDragStatusChange?.('start', startX.current, startY.current);
          setIsPressing(false);
        }
      }, LONG_PRESS_DELAY);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Mouse support for long press is less critical for this specific touch interaction, 
    // but we maintain basic compatibility
    pressTimeoutRef.current = setTimeout(() => {
        setIsPressing(true);
    }, PRESS_DELAY);

    if (onLongPress) {
      longPressTimeoutRef.current = setTimeout(() => {
        onLongPress();
        setIsPressing(false);
      }, LONG_PRESS_DELAY);
    }
  };

  const handleMouseUp = () => {
    setIsPressing(false);
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    if (pressTimeoutRef.current) {
      clearTimeout(pressTimeoutRef.current);
      pressTimeoutRef.current = null;
    }
  };

  // Native touch move handler to support non-passive event listener
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      const { isSwiping, offset } = stateRef.current;
      const isLongPress = isLongPressTriggeredRef.current; // Use ref for immediate value

      // If long press already triggered, we hijack the move for reordering
      if (isLongPress) {
          if (e.cancelable) e.preventDefault(); // Prevent scrolling
          const touchX = e.touches[0].clientX;
          const touchY = e.touches[0].clientY;
          onDragStatusChange?.('move', touchX, touchY);
          return;
      }

      if (!isSwiping) return;
      const touchX = e.touches[0].clientX;
      const touchY = e.touches[0].clientY;
      const deltaX = touchX - startX.current;
      const deltaY = touchY - startY.current;

      // ── 横滑意图锁 ──────────────────────────────────────────────
      // 用户以纵向滚动为主，横滑菜单必须"明确横向意图"才触发：
      // 横向位移 ≥ SWIPE_AXIS_THRESHOLD 且 ≥ 纵向的 SWIPE_AXIS_RATIO 倍，
      // 才锁定为横滑；一旦先判为纵向，本次触摸内不再响应横滑。
      if (swipeAxisRef.current === null) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        if (absX >= SWIPE_AXIS_THRESHOLD && absX >= absY * SWIPE_AXIS_RATIO) {
          swipeAxisRef.current = 'x';
          // 以当前点为新基准，避免判定前的位移让卡片瞬间跳开
          startX.current = touchX;
          currentOffset.current = offset;
        } else if (absY >= SWIPE_AXIS_THRESHOLD) {
          swipeAxisRef.current = 'y';
          return; // 纵向滚动，交给页面
        } else {
          return; // 位移还太小，继续观察
        }
      } else if (swipeAxisRef.current === 'y') {
        return; // 已判定为纵向滚动，本次触摸内横滑菜单不再响应
      }

      // Only prevent default if we are swiping horizontally to avoid vertical scroll interference
      if (e.cancelable) {
          e.preventDefault();
      }

      if (Math.abs(deltaX) > PRESS_MOVE_THRESHOLD || Math.abs(deltaY) > PRESS_MOVE_THRESHOLD) {
        hasMoved.current = true;
        // Immediately cancel press effect if moved beyond threshold
        setIsPressing(false);
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
        if (pressTimeoutRef.current) {
            clearTimeout(pressTimeoutRef.current);
            pressTimeoutRef.current = null;
        }
      }

      let newOffset = currentOffset.current + deltaX;

      // Clamp and Dampen
      if (newOffset > leftMaxOffset) {
        const extra = newOffset - leftMaxOffset;
        newOffset = leftMaxOffset + (leftMaxOffset > 0 ? extra * 0.3 : 0);
      } else if (newOffset < -rightMaxOffset) {
        const extra = newOffset - (-rightMaxOffset);
        newOffset = -rightMaxOffset + (rightMaxOffset > 0 ? extra * 0.3 : 0);
      }

      // Additional strict check: if no actions in a direction, don't allow movement that way
      if (leftMaxOffset === 0 && newOffset > 0) newOffset = 0;
      if (rightMaxOffset === 0 && newOffset < 0) newOffset = 0;

      setOffset(newOffset);
    };

    element.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => {
      element.removeEventListener('touchmove', handleNativeTouchMove);
    };
  }, [leftMaxOffset, rightMaxOffset, onDragStatusChange]); // Dependencies for logic inside

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isLongPressTriggeredRef.current) {
        setIsLongPressTriggered(false);
        isLongPressTriggeredRef.current = false;
        const touchX = e.changedTouches[0].clientX;
        const touchY = e.changedTouches[0].clientY;
        onDragStatusChange?.('end', touchX, touchY);
        return;
    }

    setIsSwiping(false);
    setIsPressing(false);

    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }

    if (pressTimeoutRef.current) {
        clearTimeout(pressTimeoutRef.current);
        pressTimeoutRef.current = null;
    }

    const delta = e.changedTouches[0].clientX - startX.current;

    // Swipe Right to open Left Actions
    if (delta > MIN_SWIPE_DISTANCE && offset > leftMaxOffset * 0.4) {
      setOffset(leftMaxOffset);
      currentOffset.current = leftMaxOffset;
    }
    // Swipe Left to open Right Actions
    else if (delta < -MIN_SWIPE_DISTANCE && offset < -rightMaxOffset * 0.4) {
      setOffset(-rightMaxOffset);
      currentOffset.current = -rightMaxOffset;
    }
    // Close
    else {
      setOffset(0);
      currentOffset.current = 0;
    }
  };

  const handleContentClick = (e: React.MouseEvent) => {
    if (currentOffset.current !== 0) {
      e.preventDefault();
      e.stopPropagation();
      setOffset(0);
      currentOffset.current = 0;
    }
  };

  return (
    <motion.div
      ref={outerRef}
      animate={{
        scale: isPressing ? 0.96 : 1,
        boxShadow: isPressing
          ? "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)"
          : "0 1px 2px 0 rgba(0, 0, 0, 0.05)"
      }}
      whileHover={{ scale: 1.025, boxShadow: "0 6px 16px -4px rgba(0, 0, 0, 0.1)" }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`relative select-none rounded-[40px] ${className}`}
      style={{ contain: 'paint' }}
    >
       {/* Left Actions (Delete) —— 内缩一圈，白卡表面盖住圆角边缘，防透色。
           圆角只保留外侧（左圆右直）：滑出层是卡片本体的延伸，内侧直角与卡片内容自然衔接（用户拍板 2026-09-15） */}
       <div
         className="absolute z-0 overflow-hidden"
         style={{
           width: leftMaxOffset,
           top: ACTION_INSET,
           bottom: ACTION_INSET,
           left: ACTION_INSET,
           borderRadius: `${actionRadius}px 0 0 ${actionRadius}px`,
           visibility: showActions ? 'visible' : 'hidden'
         }}
       >
         {leftActions.map((action, idx) => (
           <button
             key={idx}
             onClick={(e) => {
                e.stopPropagation();
                action.onClick();
                setOffset(0);
                currentOffset.current = 0;
             }}
             className={`w-full h-full flex flex-col items-center justify-center text-white font-black text-[10px] tracking-widest uppercase ${action.color} active:scale-95 transition-all`}
           >
              {action.icon && <div className="mb-1.5 scale-110">{action.icon}</div>}
              {action.label}
           </button>
         ))}
       </div>

        {/* Right Actions (Tutorial & Settings - Stacked Vertically) —— 内缩一圈，同上（右圆左直） */}
       <div
         className="absolute z-0 flex flex-col overflow-hidden"
         style={{
           width: rightMaxOffset,
           top: ACTION_INSET,
           bottom: ACTION_INSET,
           right: ACTION_INSET,
           borderRadius: `0 ${actionRadius}px ${actionRadius}px 0`,
           visibility: showActions ? 'visible' : 'hidden'
         }}
       >
         {rightActions.map((action, idx) => (
           <button
             key={idx}
             onClick={(e) => {
                e.stopPropagation();
                action.onClick();
                setOffset(0);
                currentOffset.current = 0;
             }}
             className={`flex-1 flex flex-col items-center justify-center text-white font-black text-[10px] tracking-widest uppercase ${action.color} active:scale-95 transition-all ${idx > 0 ? 'border-t border-white/10' : ''}`}
           >
              {action.icon && <div className="mb-1.5 scale-110">{action.icon}</div>}
              <span className="leading-tight">{action.label}</span>
           </button>
         ))}
       </div>

       {/* Foreground Content Layer */}
       <div
         ref={containerRef}
         className="relative z-10 w-full h-full"
         style={{ 
            transform: `translateX(${offset}px)`,
            transition: isSwiping ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            willChange: 'transform'
         }}
         onTouchStart={handleTouchStart}
         onTouchEnd={handleTouchEnd}
         onMouseDown={handleMouseDown}
         onMouseUp={handleMouseUp}
         onMouseLeave={handleMouseUp}
         onClick={handleContentClick}
       >
         {children}
       </div>
    </motion.div>
  );
};

export default SwipeableRow;
