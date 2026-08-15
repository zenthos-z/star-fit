import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface SliderOption {
  label: string;
  icon: React.ReactNode;
  action: (e: React.MouseEvent) => void;
  variant?: 'danger' | 'accent' | 'default';
}

interface ActionSliderProps {
  left: SliderOption;
  right: SliderOption;
  isLoading?: boolean;
  disabled?: boolean;
}

const ActionSlider: React.FC<ActionSliderProps> = ({ left, right, isLoading, disabled }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to collapse
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isExpanded]);

  const handleMainClick = () => {
    if (disabled || isLoading) return;
    if (!isExpanded) {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
      setIsExpanded(true);
    }
  };

  const handleOptionClick = (e: React.MouseEvent, action: (e: React.MouseEvent) => void) => {
    e.stopPropagation(); // Prevent bubbling to container
    if (typeof navigator.vibrate === 'function') navigator.vibrate(40);
    action(e);
    setIsExpanded(false);
  };

  return (
    <div className="fixed bottom-10 left-1/2 transform -translate-x-1/2 z-40 flex justify-center w-full max-w-[320px] px-4">
      <motion.div
        ref={containerRef}
        onClick={handleMainClick}
        initial={false}
        animate={{
          width: isExpanded ? '100%' : '96px',
          height: isExpanded ? '80px' : '56px',
          borderRadius: isExpanded ? '40px' : '28px',
        }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 35,
          mass: 0.5
        }}
        className={`
          relative bg-white/90 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.12)] 
          border border-white/50 flex items-center overflow-hidden
          ${!isExpanded ? 'cursor-pointer hover:scale-[1.02] active:scale-95' : ''}
        `}
      >
        <AnimatePresence initial={false}>
          {!isExpanded ? (
            <motion.div
              key="handle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {/* Decorative Handle Bar */}
              <div className="w-8 h-1.5 bg-gray-200 rounded-full"></div>
            </motion.div>
          ) : (
            <motion.div
              key="options"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ 
                type: 'spring',
                stiffness: 600,
                damping: 30
              }}
              className="flex w-full h-full gap-2 p-1.5"
            >
              {/* Left Button */}
              <button
                onClick={(e) => handleOptionClick(e, left.action)}
                className={`
                  flex-1 flex flex-col items-center justify-center rounded-[34px] transition-all duration-200 gap-1 group
                  active:scale-95
                  ${left.variant === 'danger' 
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/20 active:bg-red-600' 
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}
                `}
              >
                <div className="w-5 h-5 opacity-90 group-hover:scale-110 transition-transform">
                  {left.icon}
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] leading-none">
                  {left.label}
                </span>
              </button>

              {/* Right Button */}
              <button
                onClick={(e) => handleOptionClick(e, right.action)}
                className={`
                  flex-1 flex flex-col items-center justify-center rounded-[34px] transition-all duration-200 gap-1 relative overflow-hidden group
                  active:scale-95
                  ${right.variant === 'accent'
                    ? 'bg-star-dark text-white shadow-lg shadow-black/10 active:bg-black'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}
                `}
              >
                {/* Shimmer Effect for AI Agent */}
                {right.variant === 'accent' && (
                  <motion.div
                    animate={{
                      left: ['-100%', '200%'],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Infinity,
                      ease: "linear",
                      repeatDelay: 1
                    }}
                    className="absolute top-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-25deg] pointer-events-none"
                  />
                )}
                
                <div className="w-5 h-5 relative z-10 group-hover:scale-110 transition-transform">
                  {right.icon}
                </div>
                <span className="text-[11px] font-black uppercase tracking-[0.15em] leading-none relative z-10">
                  {right.label}
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default ActionSlider;