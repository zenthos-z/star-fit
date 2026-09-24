import { useRef, useCallback, useEffect } from 'react';

interface UseLongPressOptions {
  delay?: number;
  onStart?: () => void;
  onFinish?: () => void;
  onCancel?: () => void;
}

export const useLongPress = (
  callback: () => void,
  options: UseLongPressOptions = {}
) => {
  const { delay = 500, onStart, onFinish, onCancel } = options;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPressedRef = useRef(false);

  const start = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    isPressedRef.current = true;
    onStart?.();
    
    timeoutRef.current = setTimeout(() => {
      if (isPressedRef.current) {
        e.stopPropagation();
        callback();
        onFinish?.();
      }
    }, delay);
  }, [callback, delay, onStart, onFinish]);

  const clear = useCallback((e?: React.MouseEvent | React.TouchEvent) => {
    isPressedRef.current = false;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    onCancel?.();
  }, [onCancel]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
  };
};
