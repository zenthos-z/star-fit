import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { haptic } from '../../../lib/nativeHaptics';
import { setTabBarHidden } from '../../../lib/nativeTabBar';
import type { Exercise } from '../../../../types';

/**
 * 锁定训练屏（2026-09-15 用户拍板）：
 * - 训练中把计时胶囊往下滑进入；全屏变暗（色与胶囊同族深色玻璃），唯一亮元素=时间下方的大动作按钮
 * - 胶囊停在屏幕中间偏上（32%），按钮在屏幕中下（62%）
 * - 底下卡片完全冻结（模糊+不可点），防误触
 * - 按钮语义与卡内逻辑共用一套（走 App.handleUpdateSet）：
 *   a) 力量训练 → 「完成第 N 组」（等同卡内✓，完成自动触发 60s 休息）
 *   b) 间歇/等长 → 倒计时按钮（开始/提前结束，到点自动写完成+时长）
 *   休息中 → 按钮切换为休息倒计时（点击提前结束）
 */

interface LockScreenProps {
  status: 'active' | 'paused';
  startTime: number;
  pausedDuration: number;
  exercises: Exercise[];
  onExit: () => void;
  onCompleteSet: (exId: string, setId: string) => void;
  onFinishCountdown: (exId: string, setId: string, durationSec: number) => void;
  onEndRest: (exId: string, setId: string) => void;
}

type Focus =
  | { kind: 'rest'; exId: string; setId: string; exName: string; setNo: number; total: number; end: number }
  | { kind: 'confirm'; exId: string; setId: string; exName: string; setNo: number; total: number }
  | { kind: 'countdown'; exId: string; setId: string; exName: string; setNo: number; total: number; target: number }
  | { kind: 'done' };

const isSetDone = (s: any) => s.completed === true || s.status === 'COMPLETED';

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const LockScreen: React.FC<LockScreenProps> = ({
  status,
  startTime,
  pausedDuration,
  exercises,
  onExit,
  onCompleteSet,
  onFinishCountdown,
  onEndRest
}) => {
  const [now, setNow] = useState(Date.now());
  const [counting, setCounting] = useState<{ exId: string; setId: string; startedAt: number; target: number } | null>(null);

  // 全局 500ms 心跳：驱动总计时显示、休息倒计时、组倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // sheet 规范：锁定层盖住原生 tab bar，卸载恢复（桥内引用计数，层叠安全）
  useEffect(() => {
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, []);

  // Android/系统返回键：退出锁定而非退出 App
  useEffect(() => {
    const onBack = (e: Event) => {
      e.preventDefault();
      haptic('light');
      onExit();
    };
    window.addEventListener('starfit-back-button', onBack);
    return () => window.removeEventListener('starfit-back-button', onBack);
  }, [onExit]);

  // 焦点计算：休息 > 待执行组 > 全部完成
  const focus: Focus = useMemo(() => {
    // 1) 任意组休息中（restEndTime 在未来，取最近的一个）
    let rest: { exId: string; setId: string; end: number; exName: string; setNo: number; total: number } | null = null;
    for (const ex of exercises) {
      const total = ex.sets.length;
      ex.sets.forEach((s: any, idx: number) => {
        if (typeof s.restEndTime === 'number' && s.restEndTime > now) {
          if (!rest || s.restEndTime < rest.end) {
            rest = { exId: ex.id, setId: s.id, end: s.restEndTime, exName: ex.name, setNo: idx + 1, total };
          }
        }
      });
    }
    if (rest) {
      const r = rest as { exId: string; setId: string; end: number; exName: string; setNo: number; total: number };
      return { kind: 'rest', exId: r.exId, setId: r.setId, exName: r.exName, setNo: r.setNo, total: r.total, end: r.end };
    }

    // 2) 第一个还有未完成组的动作
    for (const ex of exercises) {
      const total = ex.sets.length;
      const idx = ex.sets.findIndex((s: any) => !isSetDone(s));
      if (idx === -1) continue;
      const set: any = ex.sets[idx];
      const isCountdown =
        ex.type === 'isometric' ||
        (ex.type === 'cardio' && ex.metadata?.cardioMode === 'TIME_COUNTDOWN');
      const target =
        set.targetDuration ||
        ex.metadata?.targetDurationSec ||
        (isCountdown ? 30 : 0);
      if (isCountdown && target > 0) {
        return { kind: 'countdown', exId: ex.id, setId: set.id, exName: ex.name, setNo: idx + 1, total, target };
      }
      return { kind: 'confirm', exId: ex.id, setId: set.id, exName: ex.name, setNo: idx + 1, total };
    }

    return { kind: 'done' };
  }, [exercises, now]);

  // 焦点变了（组完成/休息切换）→ 组倒计时作废
  const focusKey = focus.kind === 'done' ? 'done' : `${focus.exId}:${focus.setId}:${focus.kind}`;
  const countingKey = counting ? `${counting.exId}:${counting.setId}:countdown` : '';
  useEffect(() => {
    if (counting && countingKey !== focusKey && focus.kind !== 'countdown') setCounting(null);
  }, [focusKey, countingKey, counting, focus.kind]);

  // 组倒计时到点 → 自动写完成
  const countRemaining = counting ? Math.max(0, counting.target - Math.floor((now - counting.startedAt) / 1000)) : null;
  useEffect(() => {
    if (counting && countRemaining !== null && countRemaining <= 0) {
      haptic('success');
      onFinishCountdown(counting.exId, counting.setId, counting.target);
      setCounting(null);
    }
  }, [counting, countRemaining, onFinishCountdown]);

  // 总训练时长（与 TimerCapsule 同公式）
  const totalSec = Math.max(0, Math.floor((now - startTime - pausedDuration) / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const ss = (totalSec % 60).toString().padStart(2, '0');
  const isPaused = status === 'paused';

  const restRemaining = focus.kind === 'rest'
    ? Math.max(0, Math.ceil((focus.end - now) / 1000))
    : 0;

  // ---- 按钮内容与动作 ----
  const renderButton = () => {
    if (focus.kind === 'done') {
      return (
        <button
          disabled
          className="w-full h-[88px] rounded-full bg-white/25 text-white/70 flex flex-col items-center justify-center gap-0.5 cursor-default"
        >
          <span className="text-xl font-semibold">全部完成</span>
          <span className="text-[13px] text-white/50">点击上方胶囊退出锁定</span>
        </button>
      );
    }

    if (focus.kind === 'rest') {
      return (
        <button
          onClick={() => {
            haptic('light');
            onEndRest(focus.exId, focus.setId);
          }}
          className="w-full h-[88px] rounded-full bg-white text-gray-900 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform shadow-[0_8px_40px_rgba(255,255,255,0.18)]"
        >
          <span style={{ fontFeatureSettings: "'tnum'" }} className="text-3xl font-medium font-mono tracking-tight">
            {fmt(restRemaining)}
          </span>
          <span className="text-[13px] font-medium text-gray-500">休息中 · 点击结束</span>
        </button>
      );
    }

    if (focus.kind === 'countdown' && counting) {
      return (
        <button
          onClick={() => {
            // 提前结束：按已计时秒数写完成
            const elapsed = Math.max(1, Math.floor((Date.now() - counting.startedAt) / 1000));
            haptic('success');
            onFinishCountdown(counting.exId, counting.setId, elapsed);
            setCounting(null);
          }}
          className="w-full h-[88px] rounded-full bg-white text-gray-900 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform shadow-[0_8px_40px_rgba(255,255,255,0.18)]"
        >
          <span style={{ fontFeatureSettings: "'tnum'" }} className="text-3xl font-medium font-mono tracking-tight">
            {countRemaining}s
          </span>
          <span className="text-[13px] font-medium text-gray-500">第 {focus.setNo} 组 · 点击提前结束</span>
        </button>
      );
    }

    if (focus.kind === 'countdown') {
      return (
        <button
          onClick={() => {
            haptic('light');
            setCounting({ exId: focus.exId, setId: focus.setId, startedAt: Date.now(), target: focus.target });
          }}
          className="w-full h-[88px] rounded-full bg-white text-gray-900 flex items-center justify-center gap-2.5 active:scale-95 transition-transform shadow-[0_8px_40px_rgba(255,255,255,0.18)]"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 000-1.76L9.56 4.26A1.04 1.04 0 008 5.14z" />
          </svg>
          <span className="text-xl font-semibold">
            开始第 {focus.setNo} 组 · {focus.target}s
          </span>
        </button>
      );
    }

    // confirm：力量训练确认当前组
    return (
      <button
        onClick={() => {
          haptic('success');
          onCompleteSet(focus.exId, focus.setId);
        }}
        className="w-full h-[88px] rounded-full bg-white text-gray-900 flex items-center justify-center gap-2.5 active:scale-95 transition-transform shadow-[0_8px_40px_rgba(255,255,255,0.18)]"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-xl font-semibold">
          完成第 {focus.setNo} 组
        </span>
      </button>
    );
  };

  const contextLine = (() => {
    if (focus.kind === 'done') return '本次训练动作已全部完成';
    if (focus.kind === 'rest') return `${focus.exName} · 休息中 · 第 ${focus.setNo}/${focus.total} 组`;
    return `${focus.exName} · 第 ${focus.setNo}/${focus.total} 组`;
  })();

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[140]"
      style={{ touchAction: 'none' }}
    >
      {/* 暗场：色与计时胶囊同族深色玻璃，blur 冻结底下内容 */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(28,28,32,0.88) 0%, rgba(16,16,20,0.95) 100%)',
          WebkitBackdropFilter: 'blur(30px) saturate(140%)',
          backdropFilter: 'blur(30px) saturate(140%)'
        }}
      />

      {/* 计时胶囊：屏幕中间偏上（32%），放大版。定位层与动画层分离（motion 会覆写 transform） */}
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: '32%', transform: 'translateY(-50%)' }}
      >
        <motion.button
          initial={{ opacity: 0, y: -32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
          onClick={() => {
            haptic('light');
            onExit();
          }}
          aria-label="退出锁定"
          className="frost-lens-dark flex items-center justify-center gap-3"
          style={{
            width: 260,
            height: 84,
            borderRadius: 9999
          }}
        >
        {!isPaused && (
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-green-400" />
          </span>
        )}
        <span
          style={{ fontFeatureSettings: "'tnum'" }}
          className={`font-mono text-[44px] font-medium tracking-tight leading-none transition-colors duration-300 ${
            isPaused ? 'text-white/40' : 'text-white'
          }`}
        >
          {mm}:{ss}
        </span>
        </motion.button>
      </div>

      {/* 上下文一行：动作名 + 组进度 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.12 }}
        className="absolute inset-x-0 flex justify-center whitespace-nowrap text-[15px] font-medium text-white/50"
        style={{ top: 'calc(32% + 62px)' }}
      >
        {contextLine}
      </motion.div>

      {/* 大动作按钮：屏幕中下（62%）——包一层定位 div，motion 动画在内层（motion 会覆写 transform） */}
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: '62%', transform: 'translateY(-50%)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 34, delay: 0.06 }}
          className="w-[72%] max-w-[300px]"
        >
          {renderButton()}
        </motion.div>
      </div>
    </motion.div>,
    document.body
  );
};

export default LockScreen;
