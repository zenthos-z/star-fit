import React, { useRef, useState, useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';

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
  
  const startX = useRef(0);
  const startY = useRef(0);
  const currentOffset = useRef(0);
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasMoved = useRef(false);
  const pressStartPos = useRef<{ x: number; y: number } | null>(null); // Track position during press delay
  
  const leftMaxOffset = leftActions.length * 80;
  const rightMaxOffset = rightActions.length > 0 ? 80 : 0; 
  const MIN_SWIPE_DISTANCE = 40;
  const LONG_PRESS_DELAY = 500;
  const PRESS_DELAY = 150; // Delay before showing press effect - only triggers for taps, not swipes
  const PRESS_MOVE_THRESHOLD = 8; // Max movement allowed during press delay to consider it a tap

  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ isLongPressTriggered, isSwiping, offset });
  
  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = { isLongPressTriggered, isSwiping, offset };
    // Also sync the ref just in case
    isLongPressTriggeredRef.current = isLongPressTriggered;
  }, [isLongPressTriggered, isSwiping, offset]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    setIsSwiping(true);
    hasMoved.current = false;
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
          if (navigator.vibrate) navigator.vibrate(50);
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

      if (Math.abs(deltaY) > Math.abs(deltaX)) return;

      // Only prevent default if we are swiping horizontally to avoid vertical scroll interference
      if (Math.abs(deltaX) > 10 && e.cancelable) {
          e.preventDefault();
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
      animate={{
        scale: isPressing ? 0.96 : 1,
        boxShadow: isPressing
          ? "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)"
          : "0 1px 2px 0 rgba(0, 0, 0, 0.05)"
      }}
      whileHover={{ scale: 1.025, boxShadow: "0 6px 16px -4px rgba(0, 0, 0, 0.1)" }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`relative select-none rounded-2xl ${className}`}
      style={{ contain: 'paint' }}
    >
       {/* Left Actions (Delete) */}
       <div 
         className="absolute top-0 left-0 bottom-0 z-0"
         style={{ width: leftMaxOffset }}
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

       {/* Right Actions (Tutorial & Settings - Stacked Vertically) */}
       <div 
         className="absolute top-0 right-0 bottom-0 z-0 flex flex-col"
         style={{ width: rightMaxOffset }}
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
