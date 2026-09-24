import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../../lib/nativeHaptics';
import { setTabBarHidden } from '../../../lib/nativeTabBar';
import { HoldToConfirm, HOLD_MS } from './HoldToConfirm';
import { LOCK_MOTION } from './lockMotion';
import { isWatchBridge, onWatchEvent, type WatchEvent } from '../../services/watchConnectivity';
import { useLoadAnchors } from '../../hooks/useLoadAnchors';
import { getUserId } from '@/services';
import type { Exercise, ExerciseType } from '@/src/types/legacy';

/**
 * 胶囊内圆形长按钮（锁屏暂停控制条专用，2026-09-17）：
 * 环形进度 + HOLD_MS 长按 + 三段震动，与 HoldToConfirm 同语义（防误触铁律）。
 */
const HoldCircle: React.FC<{
  label: string;
  tone: 'danger' | 'primary';
  onConfirm: () => void;
}> = ({ label, tone, onConfirm }) => {
  const [progress, setProgress] = useState(0);
  const [pressed, setPressed] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const firedRef = useRef(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

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
    if (elapsed >= 1) {
      stop();
      if (!firedRef.current) {
        firedRef.current = true;
        haptic('success');
        onConfirm();
      }
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const handleDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    firedRef.current = false;
    startRef.current = Date.now();
    haptic('light');
    setPressed(true);
    stop();
    rafRef.current = requestAnimationFrame(tick);
  };
  const handleUp = () => {
    stop();
    setProgress(0);
    setPressed(false);
  };

  const isDanger = tone === 'danger';
  const ringColor = isDanger ? 'rgba(255,59,48,0.95)' : 'rgba(59,130,246,0.95)';
  // 正圆进度环：半径按量测尺寸算
  const pad = 3;
  const d = Math.max(0, Math.min(size.w, size.h) - pad * 2);
  const r = d / 2;
  const perimeter = 2 * Math.PI * r;

  return (
    <motion.div
      ref={trackRef}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      animate={{ scale: pressed ? LOCK_MOTION.pressScale : 1 }}
      transition={LOCK_MOTION.spring}
      className={`relative w-[52px] h-[52px] rounded-full flex items-center justify-center ${
        isDanger ? 'bg-red-500/15 border border-red-500/40' : 'bg-blue-500/15 border border-blue-500/40'
      }`}
      style={{ touchAction: 'none' }}
      aria-label={label}
    >
      {size.w > 0 && (
        <svg
          className="absolute pointer-events-none"
          style={{ inset: 0, overflow: 'visible' }}
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
        >
          <circle
            cx={size.w / 2}
            cy={size.h / 2}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${perimeter * progress} ${perimeter}`}
            transform={`rotate(-90 ${size.w / 2} ${size.h / 2})`}
            style={{ visibility: progress > 0 ? 'visible' : 'hidden' }}
          />
        </svg>
      )}
      {isDanger ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF3B30" className="w-[26px] h-[26px]">
          <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3B82F6" className="w-[26px] h-[26px]">
          <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
        </svg>
      )}
    </motion.div>
  );
};

/**
 * 锁定训练屏 v6（2026-09-17 用户拍板：锁屏交互重构）：
 * - 进入：训练中把计时胶囊往下滑（TimerCapsule 手势，不变）
 * - 解锁：上滑时间胶囊，Android 返回键保留为逃生通道
 * - 布局三段式：上方=时间胶囊（17%），中间=信息视窗（固定 340×300 圆角玻璃窗），下方=交互按钮（拇指黄金区）
 * - ★时间胶囊交互（v6 重构，与未锁屏态区分）：
 *   a) 单击不暂停（锁屏防误触）；长按 700ms → 暂停 + 胶囊原地展开成控制条
 *   b) 控制条：左「结束」红钮 / 中时间 / 右「继续」蓝钮，两钮均为环形进度长按激活
 *   c) 上滑解锁手势不受影响（位移>10px 自动作废长按）；控制条展开时轻点胶囊可收起
 * - 信息视窗：所有状态（运动/休息/倒计时/全部完成）共用同一固定窗，内容窗内居中、
 *   超出裁剪；休息态徽章绿点「休息中」+ 刚完成组参数 + 「接下来」前瞻
 * - 按钮防误触：长按 700ms + 环形进度 + 三段震动（HoldToConfirm）
 * - 户外地图实时轨迹：数据模型暂无 GPS 流，本期不伪造，只显示已记录字段
 */

interface LockScreenProps {
  status: 'active' | 'paused';
  startTime: number;
  pausedDuration: number;
  exercises: Exercise[];
  /** 当前训练会话 id（后端 heart_rate_samples 归属锚点）；缺省时 hr_batch 上传跳过 */
  sessionId?: string;
  onExit: () => void;
  onCompleteSet: (exId: string, setId: string, opts?: { avgHr?: number }) => void;
  onFinishCountdown: (exId: string, setId: string, durationSec: number) => void;
  onEndRest: (exId: string, setId: string) => void;
  onExtendRest: (exId: string, setId: string, extraSec: number) => void;
  // 暂停/继续/结束训练（2026-09-17 锁屏防误触拍板）：App.tsx 既有 handler 透传
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

type Focus =
  | { kind: 'rest'; exId: string; setId: string; exName: string; exType: ExerciseType; setNo: number; total: number; end: number }
  | { kind: 'confirm'; exId: string; setId: string; exName: string; exType: ExerciseType; setNo: number; total: number }
  | { kind: 'countdown'; exId: string; setId: string; exName: string; exType: ExerciseType; setNo: number; total: number; target: number }
  | { kind: 'done' };

const isSetDone = (s: any) => s.completed === true || s.status === 'COMPLETED';

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const TYPE_LABEL: Record<string, string> = {
  resistance: '力量训练',
  cardio: '有氧训练',
  bodyweight: '自重训练',
  isometric: '静力计时',
  assisted: '辅助训练',
  unilateral: '单侧训练',
  weight_only: '负重',
  reps_only: '次数训练',
  outdoor: '户外运动'
};

const TYPE_DOT: Record<string, string> = {
  resistance: '#F87171',
  cardio: '#60A5FA',
  bodyweight: '#34D399',
  isometric: '#FBBF24',
  assisted: '#A78BFA',
  unilateral: '#F472B6',
  weight_only: '#F87171',
  reps_only: '#F87171',
  outdoor: '#34D399'
};

// 训练态计时胶囊的中心 y（TimerCapsule：top = safe-top + 12px，高 64 → 中心 = safe-top + 44）
// safe-top 模拟器/全面屏典型 59px；morph 入场起点用它近似（跟手动画，微差不显）
const CAPSULE_ORIGIN_CENTER_Y = 44 + 59;


export const LockScreen: React.FC<LockScreenProps> = ({
  status,
  startTime,
  pausedDuration,
  exercises,
  sessionId,
  onExit,
  onCompleteSet,
  onFinishCountdown,
  onEndRest,
  onExtendRest,
  onPause,
  onResume,
  onEnd
}) => {
  const [now, setNow] = useState(Date.now());
  const [counting, setCounting] = useState<{ exId: string; setId: string; startedAt: number; target: number } | null>(null);
  // C3（2026-09-17 用户反馈）：力量训练信息卡缺推荐配重——计划 weight=0（用户自选）时
  // 从 load_anchors 锚点推算建议重量（est_1rm × 0.7 ≈ 8-12 次组的工作重量；无 est_1rm 用
  // Epley 公式由 best_weight/best_reps 估 1RM）。锚点也缺则不显示，不编数字。
  const { getAnchor } = useLoadAnchors(getUserId());

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

  // Android/系统返回键：退出锁定而非退出 App（上滑解锁之外的逃生通道）
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
    let rest: { exId: string; setId: string; end: number; exName: string; exType: ExerciseType; setNo: number; total: number } | null = null;
    for (const ex of exercises) {
      const total = ex.sets.length;
      ex.sets.forEach((s: any, idx: number) => {
        if (typeof s.restEndTime === 'number' && s.restEndTime > now) {
          if (!rest || s.restEndTime < rest.end) {
            rest = { exId: ex.id, setId: s.id, end: s.restEndTime, exName: ex.name, exType: ex.type, setNo: idx + 1, total };
          }
        }
      });
    }
    if (rest) {
      const r = rest as { exId: string; setId: string; end: number; exName: string; exType: ExerciseType; setNo: number; total: number };
      return { kind: 'rest', exId: r.exId, setId: r.setId, exName: r.exName, exType: r.exType, setNo: r.setNo, total: r.total, end: r.end };
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
        return { kind: 'countdown', exId: ex.id, setId: set.id, exName: ex.name, exType: ex.type, setNo: idx + 1, total, target };
      }
      return { kind: 'confirm', exId: ex.id, setId: set.id, exName: ex.name, exType: ex.type, setNo: idx + 1, total };
    }

    return { kind: 'done' };
  }, [exercises, now]);

  // 焦点变了（组完成/休息切换）→ 组倒计时作废
  const focusKey = focus.kind === 'done' ? 'done' : `${focus.exId}:${focus.setId}:${focus.kind}`;
  const countingKey = counting ? `${counting.exId}:${counting.setId}:countdown` : '';

  // 手表镜像（ADR-0001）：已上提 App 层 useWatchMirror（2026-09-19 修复：
  // 原挂 LockScreen 内，不进锁定屏就不广播，手表永远演示态）。此处不再本地广播。
  useEffect(() => {
    if (counting && countingKey !== focusKey && focus.kind !== 'countdown') setCounting(null);
  }, [focusKey, countingKey, counting, focus.kind]);

  // 手表 → 手机事件消费（set_completed / rest_action）已上提到 App 层
  // useWatchRemoteControl（2026-09-20 用户实锤：锁屏不开 → 手表完成组手机无反应，
  // 原消费点在条件挂载的 LockScreen 内）。hr_batch 一直在 App 层全局订阅。

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

  // ---- 上滑解锁：胶囊跟手 + 按压态 + 弹簧回弹（动效统一走 LOCK_MOTION） ----
  const UNLOCK_DRAG_THRESHOLD = -72; // px，上滑约一个胶囊高度
  const [dragY, setDragY] = useState(0);
  const [capsulePressed, setCapsulePressed] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const dragAccum = useRef(0);

  // ---- 胶囊长按暂停（2026-09-17 锁屏防误触拍板）----
  // 交互：长按 700ms → 暂停 + 弹出控制条（左「结束」/右「继续」，均为长按激活）；
  // 控制条已开时长按胶囊或轻点 → 收起控制条（暂停态保持）；上滑解锁手势不受影响
  const HOLD_MS = 700;
  const TAP_SLOP = 10; // px，位移超过此值=拖拽（上滑解锁），取消长按
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);
  const holdFiredRef = useRef(false);

  const stopHold = () => {
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
  };
  useEffect(() => stopHold, []);

  const startHold = () => {
    holdFiredRef.current = false;
    holdStartRef.current = Date.now();
    stopHold();
    const tick = () => {
      const elapsed = Date.now() - holdStartRef.current;
      if (elapsed >= HOLD_MS && !holdFiredRef.current) {
        holdFiredRef.current = true;
        stopHold();
        haptic('medium');
        if (!pauseMenuOpen) {
          onPause();
          setPauseMenuOpen(true);
        } else {
          setPauseMenuOpen(false); // 控制条已开：长按收起（保持暂停态）
        }
        return;
      }
      holdRafRef.current = requestAnimationFrame(tick);
    };
    holdRafRef.current = requestAnimationFrame(tick);
  };

  const handleUnlockTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0]?.clientY ?? null;
    dragAccum.current = 0;
    setCapsulePressed(true);
    startHold(); // 长按计时开始；移动超 TAP_SLOP 或抬指早于 HOLD_MS 自动作废
  };
  const handleUnlockTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const y = e.touches[0]?.clientY;
    if (typeof y !== 'number') return;
    dragAccum.current = y - dragStartY.current;
    if (Math.abs(dragAccum.current) > TAP_SLOP && !holdFiredRef.current) {
      stopHold(); // 转为拖拽手势：作废长按（上滑解锁优先）
    }
    // 只跟随向上拖（dy<0），向下拖不位移
    setDragY(Math.max(-56, Math.min(0, dragAccum.current * 0.7)));
  };
  const handleUnlockTouchEnd = () => {
    const dy = dragAccum.current;
    const holdElapsed = Date.now() - holdStartRef.current;
    const wasHold = holdFiredRef.current;
    stopHold();
    dragStartY.current = null;
    dragAccum.current = 0;
    setDragY(0); // LOCK_MOTION.spring 弹回（未过阈值）或随退出动画离场
    setCapsulePressed(false);
    if (wasHold) return; // 长按已触发（暂停菜单开合），不当滑动处理
    // 未满 HOLD_MS 的短触：控制条已开时轻点 = 收起
    if (Math.abs(dy) <= TAP_SLOP && holdElapsed < HOLD_MS && pauseMenuOpen) {
      setPauseMenuOpen(false);
      return;
    }
    if (dy < UNLOCK_DRAG_THRESHOLD) {
      haptic('medium');
      onExit();
    }
  };

  // ---- 信息区数据：当前动作 / 进度 / 户外附加数据 ----
  const currentEx = focus.kind !== 'done' ? exercises.find(e => e.id === focus.exId) : undefined;
  const completedCount = currentEx ? currentEx.sets.filter(isSetDone).length : 0;
  const isOutdoorLike = !!currentEx && (currentEx.type === 'outdoor' || currentEx.type === 'cardio' || currentEx.metadata?.isOutdoor === true);
  const outdoorStats = useMemo(() => {
    if (!isOutdoorLike || !currentEx) return null;
    let distance = 0; // 已记录距离（米）
    let lastHr: number | undefined;
    for (const s of currentEx.sets) {
      if (typeof s.distance === 'number') distance += s.distance;
      if (typeof s.heartRate === 'number') lastHr = s.heartRate;
    }
    const activeSet = currentEx.sets.find((s: any) => !isSetDone(s)) || currentEx.sets[0];
    const targetDistance = activeSet?.targetDistance ?? currentEx.metadata?.targetDistanceMeters;
    const targetDuration = activeSet?.targetDuration ?? currentEx.metadata?.targetDurationSec;
    const hrZone = currentEx.metadata?.targetHeartRateZone;
    return { distance, lastHr, targetDistance, targetDuration, hrZone };
  }, [isOutdoorLike, currentEx]);

  const typeLabel = focus.kind !== 'done' ? (TYPE_LABEL[focus.exType] ?? '训练') : '';
  const typeDot = focus.kind !== 'done' ? (TYPE_DOT[focus.exType] ?? '#9CA3AF') : '';

  // ---- 当前组参数（信息区展示）：从焦点组/动作元数据提取，无则不出 ----
  // 户外/有氧附加模式标签：TIME_COUNTDOWN=目标时长 / DISTANCE_TARGET=目标距离 / FREE_RUN=自由模式
  const cardioModeLabel = useMemo(() => {
    if (focus.kind === 'done' || !currentEx) return null;
    const isCardio = currentEx.type === 'cardio' || currentEx.type === 'outdoor' || currentEx.metadata?.isOutdoor === true;
    if (!isCardio) return null;
    const mode = currentEx.metadata?.cardioMode;
    if (mode === 'TIME_COUNTDOWN') return '目标时长';
    if (mode === 'DISTANCE_TARGET') return '目标距离';
    return '自由模式';
  }, [focus, currentEx]);

  // 动作间休息前瞻：rest 态时找下一个还有未完成组的动作（跳过当前动作）。
  // 显示在信息区（用户拍板 2026-09-16：前瞻信息归信息区，不进按钮）。
  const nextExerciseName = useMemo(() => {
    if (focus.kind !== 'rest') return null;
    for (const ex of exercises) {
      if (ex.id === focus.exId) continue;
      if (ex.sets.some((s: any) => !isSetDone(s))) return ex.name;
    }
    return null; // 没有下一动作（当前是最后一个）→ 不显示
  }, [focus, exercises]);

  const setParams = useMemo(() => {
    if (focus.kind === 'done' || !currentEx) return null;
    const set: any = focus.kind === 'rest'
      ? currentEx.sets[focus.setNo - 1]
      : currentEx.sets.find((s: any) => !isSetDone(s));
    if (!set) return null;
    const parts: { value: string; unit: string }[] = [];
    // 力量/自重：重量 × 次数（assisted 负重量按辅助语义显示）
    if (typeof set.weight === 'number' && set.weight !== 0) {
      parts.push({ value: String(Math.abs(set.weight)), unit: set.weight < 0 ? 'kg 辅助' : 'kg' });
    } else if (set.weight === 0 || set.weight === undefined) {
      // 计划未定重量（0 = 用户自选）：从锚点推算建议工作重量（1RM × 0.7）
      const strengthTypes = ['resistance', 'heavy_weight', 'unilateral', 'isometric'];
      if (strengthTypes.includes(currentEx.type) || currentEx.metadata?.exercise_type) {
        const anchor = getAnchor(currentEx.id);
        const est1rm =
          typeof anchor?.est_1rm === 'number' && anchor.est_1rm > 0
            ? anchor.est_1rm
            : typeof anchor?.best_weight === 'number' && anchor.best_weight > 0
            ? anchor.best_weight * (1 + (anchor.best_reps ?? 5) / 30) // Epley: w*(1+r/30)
            : 0;
        const suggested = est1rm > 0 ? Math.round((est1rm * 0.7) / 2.5) * 2.5 : 0; // 按 2.5kg 取整
        if (suggested > 0) {
          parts.push({ value: `建议 ~${suggested}`, unit: 'kg' });
        }
      }
    }
    if (typeof set.reps === 'number' && set.reps > 0) {
      parts.push({ value: String(set.reps), unit: '次' });
    }
    // 计时/距离目标
    const dur = set.targetDuration ?? currentEx.metadata?.targetDurationSec;
    if (!parts.length && typeof dur === 'number' && dur > 0) {
      parts.push({ value: String(dur), unit: '秒' });
    }
    const dist = set.targetDistance ?? currentEx.metadata?.targetDistanceMeters;
    if (!parts.length && typeof dist === 'number' && dist > 0) {
      parts.push({ value: (dist / 1000).toFixed(dist % 1000 === 0 ? 0 : 2), unit: 'km' });
    }
    return parts.length ? parts : null;
  }, [focus, currentEx, getAnchor]);

  // ---- 按钮区（下方）：全部长按制 + 环形进度 + 震动 ----
  const renderButtons = () => {
    if (focus.kind === 'done') {
      // 全部完成：无破坏性，点按即可（与胶囊上滑解锁双通道）
      return (
        <motion.button
          onClick={() => {
            haptic('light');
            onExit();
          }}
          whileTap={{ scale: LOCK_MOTION.pressScale }}
          transition={LOCK_MOTION.spring}
          className="w-full h-[76px] rounded-full bg-white text-gray-900 flex flex-col items-center justify-center gap-0.5 shadow-[0_8px_40px_rgba(255,255,255,0.18)]"
        >
          <span className="text-[22px] font-semibold">退出锁定</span>
          <span className="text-[13px] font-medium text-gray-500">本次训练动作已全部完成</span>
        </motion.button>
      );
    }

    if (focus.kind === 'rest') {
      // 2026-09-17 用户反馈：+10 秒压在「结束休息」上方会占用信息栏高度并导致文字重叠，
      // 改为主按钮「结束休息」在上、副按钮「+10 秒」垫底（2026-09-17 二次反馈后定稿）
      return (
        <div className="flex flex-col gap-4">
          <HoldToConfirm
            variant="primary"
            label="结束休息"
            onConfirm={() => onEndRest(focus.exId, focus.setId)}
          />
          <HoldToConfirm
            variant="secondary"
            label="+10 秒"
            onConfirm={() => onExtendRest(focus.exId, focus.setId, 10)}
          />
        </div>
      );
    }

    if (focus.kind === 'countdown' && counting) {
      // 同休息态：副按钮（放弃）在上、主按钮（结束并记录）压底，主钮位置恒定
      return (
        <div className="flex flex-col gap-4">
          <HoldToConfirm
            variant="secondary"
            label="放弃本次"
            onConfirm={() => setCounting(null)}
          />
          <HoldToConfirm
            variant="primary"
            label="结束并记录"
            onConfirm={() => {
              // 提前结束：按已计时秒数写完成
              const elapsed = Math.max(1, Math.floor((Date.now() - counting.startedAt) / 1000));
              onFinishCountdown(counting.exId, counting.setId, elapsed);
              setCounting(null);
            }}
          />
        </div>
      );
    }

    if (focus.kind === 'countdown') {
      return (
        <HoldToConfirm
          variant="primary"
          label={`开始第 ${focus.setNo} 组 · ${focus.target}s`}
          onConfirm={() => setCounting({ exId: focus.exId, setId: focus.setId, startedAt: Date.now(), target: focus.target })}
        />
      );
    }

    // confirm：力量/户外确认当前组
    return (
      <HoldToConfirm
        variant="primary"
        label={`完成第 ${focus.setNo} 组`}
        onConfirm={() => onCompleteSet(focus.exId, focus.setId)}
      />
    );
  };

  // ---- 信息视窗（中间固定窗 340×300，2026-09-17 用户拍板）----
  // 统一字号阶梯（窗内）：状态徽章 13px / 主数值 60px / 动作名 24px / 参数 16px / 说明 14px
  // 休息态信息层级：休息倒计时为主数值 → 刚完成组的参数 → 「接下来」前瞻 → 组进度
  // 运动态信息层级：倒计时或动作名为主数值 → 当前组参数 → 组进度
  const renderInfo = () => {
    if (focus.kind === 'done') {
      return (
        <div className="flex flex-col items-center gap-3">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={LOCK_MOTION.spring}
            className="w-16 h-16 rounded-full bg-green-400/15 border border-green-400/30 flex items-center justify-center"
          >
            <svg className="w-9 h-9 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
          <span className="text-[20px] font-semibold text-white">全部完成</span>
        </div>
      );
    }

    // 休息态：主数值 = 休息倒计时；运动态：主数值 = 组倒计时（计时类）或动作名（力量类）
    const isRest = focus.kind === 'rest';
    const isCounting = focus.kind === 'countdown' && counting && countRemaining !== null;
    const heroValue = isRest ? fmt(restRemaining) : isCounting ? fmt(countRemaining!) : null;
    // 运动态无 hero 数字时，动作名升为主视觉（与倒计时同级大字）
    const heroIsName = !isRest && !isCounting;

    return (
      <div className="flex flex-col items-center gap-2 px-3 w-full">
        {/* ① 状态徽章（休息态绿点「休息中」/ 运动态类型点）——有氧/户外附加模式标签 */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/8 border border-white/10">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: isRest ? '#34D399' : typeDot }} />
            <span className="text-[12px] font-medium tracking-wide text-white/70">
              {isRest ? '休息中' : typeLabel}
            </span>
          </div>
          {!isRest && cardioModeLabel && (
            <div className="flex items-center px-3 py-1 rounded-full bg-white/8 border border-white/10">
              <span className="text-[12px] font-medium tracking-wide text-white/70">{cardioModeLabel}</span>
            </div>
          )}
        </div>

        {/* ② 主数值：休息倒计时 / 组倒计时（窗内 60px） */}
        {heroValue && (
          <span style={{ fontFeatureSettings: "'tnum'" }} className="font-mono text-[60px] font-light tracking-tight leading-none text-white">
            {heroValue}
          </span>
        )}

        {/* ③ 动作名：休息态作次级说明；运动态（力量）作主视觉 */}
        <span className={`font-bold text-white leading-tight text-center max-w-[92%] truncate ${heroIsName ? 'text-[30px]' : 'text-[20px] text-white/85'}`}>
          {focus.exName}
        </span>

        {/* ④ 当前组参数行：休息态 = 刚完成组；运动态 = 当前组（窗内紧凑字号） */}
        {setParams && (
          <div className="flex items-center gap-1.5">
            {setParams.map((p, i) => (
              <span key={i} className="flex items-baseline gap-1 px-2.5 py-0.5 rounded-full bg-white/8 border border-white/10">
                <span style={{ fontFeatureSettings: "'tnum'" }} className="text-[15px] font-bold text-white leading-none">{p.value}</span>
                <span className="text-[11px] font-medium text-white/60">{p.unit}</span>
              </span>
            ))}
          </div>
        )}

        {/* ④b 动作间休息前瞻（仅 rest 态且有下一动作时）：窗内预告下一个动作 */}
        {isRest && nextExerciseName && (
          <span className="text-[14px] font-medium text-white/55">
            接下来 · <span className="text-white/85 font-semibold">{nextExerciseName}</span>
          </span>
        )}

        {/* ⑤ 组进度：单组动作不显示 */}
        {focus.total > 1 && (
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-[14px] font-medium text-white/65">
              第 <span className="text-white text-[16px] font-bold">{focus.setNo}</span> / {focus.total} 组
              <span className="text-white/45">{isRest ? ' · 已完成' : ''}</span>
            </span>
            {focus.total <= 10 && (
              <div className="flex items-center gap-1.5">
                {Array.from({ length: focus.total }).map((_, i) => (
                  <motion.span
                    key={i}
                    animate={{
                      backgroundColor:
                        i < completedCount ? '#34d399' : i === focus.setNo - 1 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)',
                      width: i === focus.setNo - 1 ? 18 : 6
                    }}
                    transition={LOCK_MOTION.spring}
                    className="rounded-full"
                    style={{ height: 6 }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ⑥ 户外/有氧附加数据：只显示真实记录，最多两项（窗内紧凑） */}
        {outdoorStats && (
          <div className="flex items-center gap-2 max-h-[52px] overflow-hidden">
            {typeof outdoorStats.lastHr === 'number' && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/8 border border-white/10">
                <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                <span style={{ fontFeatureSettings: "'tnum'" }} className="text-[13px] font-semibold text-white">{outdoorStats.lastHr}</span>
                <span className="text-[11px] text-white/55">bpm</span>
              </div>
            )}
            {outdoorStats.distance > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/8 border border-white/10">
                <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span style={{ fontFeatureSettings: "'tnum'" }} className="text-[13px] font-semibold text-white">
                  {(outdoorStats.distance / 1000).toFixed(2)}
                </span>
                <span className="text-[11px] text-white/55">km</span>
              </div>
            )}
            {!outdoorStats.lastHr && outdoorStats.distance === 0 && (
              <span className="text-[11px] text-white/40">连接 Apple Watch 自动记录心率</span>
            )}
          </div>
        )}
      </div>
    );
  };

  // 状态切换 key：focus.kind 变化 → 交叉溶解（同位，不跳动）
  // 状态切换 key：kind + 动作 id。★跨动作切换（动作A→动作B）即使 kind 相同也换 key →
  // 信息区/按钮区交叉溶解，消灭硬切（2026-09-16 用户反馈：动作直切无过渡让人不适）
  const infoKey = focus.kind === 'done' ? 'done' : `${focus.kind}:${focus.exId}`;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[140]"
      style={{
        touchAction: 'none',
        // 锁定屏防误触根基：禁文本选择 + 禁 iOS 长按系统菜单（拷贝/查询/翻译），
        // 否则 WKWebView 里长按确认按钮会被系统文本选择劫持，HOLD 长按永远到不了位
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none'
      }}
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

      {/* 解锁提示（stage 1）：2026-09-17 用户反馈「上滑解锁提示没在页面中间居中」——
          从胶囊上方（top 17% 容器挂件）移到屏幕垂直居中的独立层，水平垂直双居中 */}
      <motion.div
        {...LOCK_MOTION.enter(1)}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 pointer-events-none"
      >
        <motion.svg
          animate={{ y: [2, -3, 2] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="w-4 h-4 text-white/40"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </motion.svg>
        <span className="text-[12px] font-medium text-white/40">上滑解锁</span>
      </motion.div>

      {/* 【上方】时间胶囊（stage 0）：入场 morph（从小胶囊原位放大滑到锁定位）+ 跟手拖拽 + 统一弹簧。
          定位层 / 拖拽层 / motion 层分离（motion 会覆写 transform） */}
      <div
        className="absolute inset-x-0 flex flex-col items-center"
        style={{ top: '17%' }}
      >
        <motion.div
          animate={{ y: dragY, scale: capsulePressed && dragY === 0 ? LOCK_MOTION.pressScale : 1 }}
          transition={LOCK_MOTION.spring}
          onTouchStart={handleUnlockTouchStart}
          onTouchMove={handleUnlockTouchMove}
          onTouchEnd={handleUnlockTouchEnd}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {pauseMenuOpen ? (
              /* 暂停控制条（2026-09-17）：长按胶囊暂停后，胶囊原地展开成
                 左「结束」红 / 中时间 / 右「继续」蓝，两钮均为长按激活（防误触） */
              <motion.div
                key="pause-controls"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={LOCK_MOTION.spring}
                aria-label="暂停控制"
                className="frost-lens-dark flex items-center justify-between gap-3 origin-top"
                style={{ width: 336, height: 84, borderRadius: 9999, padding: '0 14px' }}
              >
                <HoldCircle
                  label="结束运动"
                  tone="danger"
                  onConfirm={() => {
                    onEnd();
                  }}
                />
                <span
                  style={{ fontFeatureSettings: "'tnum'" }}
                  className="font-mono text-[30px] font-medium tracking-tight leading-none text-white/40"
                >
                  {mm}:{ss}
                </span>
                <HoldCircle
                  label="继续训练"
                  tone="primary"
                  onConfirm={() => {
                    onResume();
                    setPauseMenuOpen(false);
                  }}
                />
              </motion.div>
            ) : (
              <motion.button
                key="capsule"
                initial={{ opacity: 0.6, scale: 180 / 260, y: -(window.innerHeight * 0.17 - (CAPSULE_ORIGIN_CENTER_Y)) }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={undefined}
                transition={LOCK_MOTION.spring}
                aria-label="上滑解锁"
                className="frost-lens-dark flex items-center justify-center gap-3 origin-top"
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
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* 【中间】信息视窗（stage 1）：★固定圆角玻璃窗（340×272，2026-09-17 用户拍板+重叠修正：
          300→272、top 46%→43%——iPhone 11 896pt 屏上 300 高窗底(≈562)与按钮区顶(=554)静止态即重叠 8px，
          休息态双钮时副按钮撞进窗内（用户实锤）。272 高信息内容(≈246)仍放得下，与胶囊/按钮均留 13px+ 间隙）——
          所有状态（运动/休息/倒计时/全部完成）共用同一视窗排版，内容在窗内居中、
          超出裁剪（overflow hidden），状态切换 = 交叉溶解（AnimatePresence popLayout） */}
      <motion.div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: '43%', transform: 'translateY(-50%)' }}
      >
        <div
          className="rounded-[28px] border border-white/10 bg-white/[0.06] overflow-hidden"
          style={{ width: 340, height: 272, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={infoKey}
              {...LOCK_MOTION.swap}
              className="w-full h-full flex justify-center items-center"
            >
              {renderInfo()}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      {/* 【下方】交互按钮区：★固定锚位——容器恒高 172px（主92+间距16+副64），内容底对齐。
          单/双按钮状态切换时主按钮位置纹丝不动（双钮向上生长），拇指肌肉记忆不失效 */}
      <div
        className="absolute inset-x-0 flex justify-center items-end"
        style={{
          bottom: 'calc(var(--safe-bottom, 0px) + 170px)',
          height: 172
        }}
      >
        {/* ★恒定高度 172 + 内容底对齐：主按钮底边在所有状态（rest 双钮 / confirm 单钮 /
            countdown 单钮）几何恒定——双钮时副按钮向上生长，单钮时上方留白，
            主按钮位置/尺寸纹丝不动（2026-09-16 用户反馈状态间按钮不对应） */}
        <motion.div
          className="w-[260px] flex flex-col justify-end"
          style={{ height: 172 }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={infoKey}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 172 }}
              {...LOCK_MOTION.swap}
            >
              {renderButtons()}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>,
    document.body
  );
};

export default LockScreen;
