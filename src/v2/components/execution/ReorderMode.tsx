import React, { useState, useEffect, useMemo } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence, useSpring } from 'framer-motion';

interface ReorderModeProps {
  exerciseName: string;
  exerciseIndex: number;
  exercises: { id: string; name: string }[];
  currentPointer?: { x: number; y: number };
  isDropping?: boolean;
  isDragEnded?: boolean;
  onDrop: (targetIndex: number) => void;
  onCancel: () => void;
}

const ReorderMode: React.FC<ReorderModeProps> = ({
  exerciseName,
  exerciseIndex,
  exercises,
  currentPointer,
  isDropping,
  isDragEnded,
  onDrop,
  onCancel
}) => {
  const totalCount = exercises.length;
  const [targetIndex, setTargetIndex] = useState<number>(exerciseIndex);
  
  // Motion values for the ghost card
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  
  // Visible exercises (excluding the one being dragged)
  const visibleExercises = useMemo(() => 
    exercises.filter((_, i) => i !== exerciseIndex),
  [exercises, exerciseIndex]);

  // Ref for drag start position to enable relative mapping
  const startYRef = React.useRef<number | null>(null);

  // Listen for global drag events to avoid App re-renders
  useEffect(() => {
    const handleDragMove = (e: CustomEvent<{ x: number; y: number }>) => {
      const { x: px, y: py } = e.detail;
      x.set(px);
      y.set(py);

      // Initialize startY if not set
      if (startYRef.current === null) {
          startYRef.current = currentPointer?.y || py;
      }

      // Relative Drag Mapping for One-Handed Optimization
      // Instead of mapping absolute screen position to index,
      // we map relative movement from the start position.
      // 30px drag = 1 item slot change. More sensitive for less finger travel.
      const SENSITIVITY_PIXELS = 30; 
      
      const deltaY = py - startYRef.current;
      const steps = Math.round(deltaY / SENSITIVITY_PIXELS);
      
      let newIndex = exerciseIndex + steps;
      newIndex = Math.max(0, Math.min(newIndex, totalCount - 1));
      
      if (newIndex !== targetIndex) {
        setTargetIndex(newIndex);
        if (navigator.vibrate) navigator.vibrate(10);
      }
    };

    const handleDragEnd = () => {
        onDrop(targetIndex);
    };

    window.addEventListener('reorder-drag-move', handleDragMove as EventListener);
    window.addEventListener('reorder-drag-end', handleDragEnd as EventListener);

    return () => {
        window.removeEventListener('reorder-drag-move', handleDragMove as EventListener);
        window.removeEventListener('reorder-drag-end', handleDragEnd as EventListener);
    };
  }, [totalCount, x, y, targetIndex, onDrop]);

  // Initialize position if provided
  useEffect(() => {
    if (currentPointer) {
        x.set(currentPointer.x);
        y.set(currentPointer.y);
    }
  }, []);

  // Handle immediate drag end (race condition fix)
  useEffect(() => {
    if (isDragEnded) {
        onDrop(targetIndex);
    }
  }, [isDragEnded, targetIndex, onDrop]);

  // Ghost card simple float effect
  const rotateZ = useTransform(x, (v) => (v - window.innerWidth / 2) * 0.02); // Very subtle rotation
  const scale = useSpring(1.05, { stiffness: 400, damping: 30 }); // Constant slight scale up

  // Arc Configuration
  const ARC_RADIUS = 260; // Much larger radius for flatter curve
  const ITEM_ANGLE = 15; // Smaller angle since radius is huge
  const VISIBLE_RANGE = 7; 
  const GAP_ANGLE_OFFSET = 12; // Adjusted gap for new scale

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex pointer-events-none"
    >
      {/* Background Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
        onClick={onCancel}
      />

      {/* Right Side Fixed Arc Wheel */}
      {/* Shifted off-screen to the right to create a flatter arc effect */}
      <div className="fixed right-0 top-1/2 -translate-y-1/2 pointer-events-none z-20" style={{ width: 0, height: 0, right: '-160px' }}>
        
        {/* Visual Arc Line (Subtle Guide) */}
        <div className="absolute right-0 top-0 overflow-visible opacity-20" style={{ width: ARC_RADIUS + 40, height: ARC_RADIUS * 2 + 80, transform: 'translate(0, -50%)' }}>
            <svg 
                width="100%" 
                height="100%" 
                viewBox={`0 0 ${ARC_RADIUS + 40} ${ARC_RADIUS * 2 + 80}`}
                style={{ overflow: 'visible' }}
            >
                <path 
                    d={`
                        M ${ARC_RADIUS + 40} 40 
                        A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 0 ${ARC_RADIUS + 40} ${ARC_RADIUS * 2 + 40}
                    `}
                    fill="none" 
                    stroke="white" 
                    strokeWidth="2"
                    strokeLinecap="round"
                />
            </svg>
        </div>

        <div className="relative">
            {visibleExercises.map((ex, i) => {
                const visualIndex = i; 
                
                // Effective target in *visible* list space
                // We map targetIndex directly to the gap position in the visible list.
                // Gap k is before visible item k.
                // For a list of N visible items, valid gaps are 0..N.
                // This matches exactly with targetIndex range 0..(totalCount-1).
                let visualTarget = targetIndex;
                visualTarget -= 0.5; // Center the gap
                
                const dist = visualIndex - visualTarget;
                
                // Filter out items that are too far to render (Optimization)
                if (Math.abs(dist) > VISIBLE_RANGE) return null;

                // Angle calculation with Extra Gap
                const baseAngle = dist * ITEM_ANGLE;
                const gapOffset = dist > 0 ? GAP_ANGLE_OFFSET : -GAP_ANGLE_OFFSET;
                const angle = baseAngle + gapOffset;

                const rad = (angle * Math.PI) / 180;
                
                // Position on Arc (Bulging Left)
                // Center is (0,0). x negative is left.
                const x = -Math.cos(rad) * ARC_RADIUS;
                const y = Math.sin(rad) * ARC_RADIUS;
                
                // Rotation of the text itself
                // In CSS rotate, positive is CW (Left end Up for origin-right).
                // But our angle negative is Up (y < 0).
                // So we need to invert the angle for rotation to match the visual position.
                const rotate = -angle;

                const isActive = Math.abs(dist) < 0.8;
                const opacity = 1 - Math.abs(dist) / (VISIBLE_RANGE * 0.8);
                const scale = isActive ? 1.1 : 0.9;
                
                return (
                    <motion.div
                        key={ex.id}
                        className="absolute flex items-center justify-end w-64 origin-right"
                        style={{
                            right: 0,
                            top: 0,
                            transformOrigin: 'right center' // Pivot at the dot (right edge)
                        }}
                        animate={{
                            x: x, 
                            y: y,
                            rotate: rotate,
                            opacity: Math.max(0, opacity),
                            scale: scale,
                        }}
                        transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 35,
                            mass: 0.5
                        }}
                    >
                        <span className={`text-right font-bold truncate text-sm shadow-black/50 drop-shadow-md transition-colors ${isActive ? 'text-white' : 'text-white/50'}`}>
                            {ex.name}
                        </span>
                        <div className={`ml-3 rounded-full shadow-sm transition-all ${isActive ? 'bg-amber-400 w-2 h-2' : 'bg-white/30 w-1.5 h-1.5'}`} />
                    </motion.div>
                );
            })}
        </div>
      </div>

      {/* Ghost Card (The Dragged Item) */}
      {currentPointer && (
          <motion.div
            className="fixed w-64 bg-white/90 backdrop-blur-md rounded-2xl p-4 shadow-2xl flex items-center gap-3 border border-white/40 z-50 pointer-events-none"
            style={{ 
                left: 0, 
                top: 0,
                x, 
                y, 
                rotateZ, 
                scale,
                translateX: '-115%', // Shift left to avoid covering the arc/gap
                translateY: '-50%' 
            }}
          >
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg shrink-0">
              {exerciseIndex + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-gray-900 font-bold text-base truncate">{exerciseName}</div>
            </div>
          </motion.div>
      )}

    </motion.div>
  );
};

export default ReorderMode;
