import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../lib/nativeHaptics';

/**
 * 锁定屏防误触按钮：长按 HOLD_MS 确认 + 按钮周围环形进度条 + 分段震动反馈。
 * 纯点击一律不触发——这是锁定屏防误触的根基。
 *
 * 动效统一走 lockMotion.LOCK_MOTION：弹簧按压（0.97 过冲回弹）、
 * 进度环是唯一线性动画（计时语义）。
 */

import { LOCK_MOTION } from './lockMotion';

export const HOLD_MS = 700;

export const HoldToConfirm: React.FC<{
  label: React.ReactNode;
  hint?: string;
  variant: 'primary' | 'secondary';
  onConfirm: () => void;
}> = ({ label, hint, variant, onConfirm }) => {
  const [progress, setProgress] = useState(0);
  const [pressed, setPressed] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const firedMidRef = useRef(false);
  const firedRef = useRef(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // 量尺寸 → SVG 进度环贴按钮外沿（圆角药丸描边）
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => stop, []);

  const tick = () => {
    const elapsed = Math.min(1, (Date.now() - startRef.current) / HOLD_MS);
    setProgress(elapsed);
    if (!firedMidRef.current && elapsed >= 0.5) {
      firedMidRef.current = true;
      haptic('light'); // 过半轻震：告诉你快到了
    }
    if (elapsed >= 1) {
      stop();
      if (!firedRef.current) {
        firedRef.current = true;
        haptic('success'); // 成功重震
        onConfirm();
      }
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const handleDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    firedRef.current = false;
    firedMidRef.current = false;
    startRef.current = Date.now();
    haptic('light'); // 落指轻震
    setPressed(true);
    stop();
    rafRef.current = requestAnimationFrame(tick);
  };
  const handleUp = () => {
    stop();
    setProgress(0);
    setPressed(false);
  };

  const isPrimary = variant === 'primary';
  // 进度环几何：JS 直接算药丸周长。★勿改回 SVG pathLength——WebKit 不尊重 rect 上的
  // pathLength，dasharray 会错乱成虚线碎段，进度圈整个画不出来（2026-09-15 模拟器实锤）
  const pad = 3; // 描边与按钮的间距
  const w = size.w - pad * 2;
  const h = size.h - pad * 2;
  const rx = Math.max(4, h / 2);
  const perimeter = 2 * (w + h) - rx * (8 - 2 * Math.PI);
  const ringColor = isPrimary ? 'rgba(16,185,129,0.95)' : 'rgba(52,211,153,0.9)';

  return (
    <motion.div
      ref={trackRef}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      animate={{ scale: pressed ? LOCK_MOTION.pressScale : 1 }}
      transition={LOCK_MOTION.spring}
      className={`relative select-none ${isPrimary ? 'h-[92px]' : 'h-[64px]'} w-full`}
      style={{ touchAction: 'none' }}
    >
      {/* 进度环：围绕按钮一整圈，随长按填充 */}
      {size.w > 0 && (
        <svg
          className="absolute pointer-events-none"
          style={{ inset: 0, overflow: 'visible' }}
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
        >
          <rect
            x={pad}
            y={pad}
            width={w}
            height={h}
            rx={rx}
            fill="none"
            stroke={ringColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${perimeter * progress} ${perimeter}`}
            // progress=0 时 SVG 不渲染：round 线帽会把零长度 dash 画成一个绿点（实锤过）
            style={{ visibility: progress > 0 ? 'visible' : 'hidden' }}
          />
        </svg>
      )}
      <div
        className={`w-full h-full rounded-full flex items-center justify-center px-6 ${
          isPrimary
            ? 'bg-white text-gray-900 shadow-[0_8px_40px_rgba(255,255,255,0.18)]'
            : 'bg-white/10 border border-white/15 text-white'
        }`}
      >
        {isPrimary ? (
          // 主按钮：label 单行横向居中（长按提示语由进度环+震动承担，不再占第二行）
          <span className="text-[22px] font-semibold leading-tight text-center">{label}</span>
        ) : (
          <span className="flex items-center gap-2 text-[16px] font-semibold text-white/85">
            {label}
            <span className="text-[12px] font-medium text-white/40">{hint ?? '长按'}</span>
          </span>
        )}
      </div>
    </motion.div>
  );
};
