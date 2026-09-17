import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../../lib/nativeHaptics';
import { setTabBarHidden } from '../../../lib/nativeTabBar';
import { HoldToConfirm } from './HoldToConfirm';
import { LOCK_MOTION } from './lockMotion';
import { broadcastCurrentSet, isWatchBridge, onWatchEvent, syncHeartRateSamples, type WatchEvent } from '../../services/watchConnectivity';
import type { Exercise, ExerciseType } from '../../../../types';

/**
 * 锁定训练屏 v5（2026-09-15 用户拍板：交互与动效统一重构）：
 * - 进入：训练中把计时胶囊往下滑（TimerCapsule 手势，不变）
 * - 解锁：上滑时间胶囊，Android 返回键保留为逃生通道
 * - 布局三段式：上方=时间胶囊（17%），中间=信息区（46%），下方=交互按钮（拇指黄金区）
 * - ★动效统一走 lockMotion.LOCK_MOTION（本文件零散 transition 全部移除）：
 *   a) 入场：三段共用 fade+up，delay 阶梯 0/0.08/0.16 自上而下铺开
 *   b) 状态切换（休息↔确认↔计时↔完成）：AnimatePresence 交叉溶解 0.2s，不再硬切
 *   c) 按压：全部 spring scale 0.97（按钮 + 时间胶囊统一）
 *   d) 解锁手势：拖拽跟手 + 过阈值中震；未过阈值 spring 弹回
 * - 按钮防误触：长按 700ms + 环形进度 + 三段震动（HoldToConfirm）
 * - 户外地图实时轨迹：数据模型暂无 GPS 流，本期不伪造，只显示已记录字段
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
  onExtendRest: (exId: string, setId: string, extraSec: number) => void;
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
  onExit,
  onCompleteSet,
  onFinishCountdown,
  onEndRest,
  onExtendRest
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

  // 手表镜像（ADR-0001）：焦点组状态广播到 watchOS 伴侣单组屏。
  // 断连/无原生桥时静默 no-op，不阻塞训练主流程。
  useEffect(() => {
    if (focus.kind === 'done') return;
    const ex = exercises.find((e) => e.id === focus.exId);
    if (!ex) return;
    const set: any = ex.sets.find((s: any) => s.id === focus.setId);
    const completedCount = ex.sets.filter(isSetDone).length;
    void broadcastCurrentSet({
      exerciseName: ex.name,
      exerciseType: ex.type,
      setIndex: Math.max(0, focus.setNo - 1),
      totalSets: ex.sets.length,
      completedCount,
      isUnilateral: ex.unilateral === true,
      weight: typeof set?.weight === 'number' ? set.weight : undefined,
      reps: typeof set?.reps === 'number' ? set.reps : undefined,
      durationSec: typeof set?.targetDuration === 'number' ? set.targetDuration : ex.metadata?.targetDurationSec,
      distanceM: typeof set?.targetDistance === 'number' ? set.targetDistance : ex.metadata?.targetDistanceMeters,
      status: isSetDone(set) ? 'COMPLETED' : 'PLANNED',
      isResting: focus.kind === 'rest',
      restEndTime: focus.kind === 'rest' ? focus.end : undefined,
    });
  }, [focusKey, exercises]);
  useEffect(() => {
    if (counting && countingKey !== focusKey && focus.kind !== 'countdown') setCounting(null);
  }, [focusKey, countingKey, counting, focus.kind]);

  // 手表 → 手机事件消费（ADR-0001 遥控回传）：
  // - set_completed：手表上点的「完成本组」→ 推进手机训练状态机
  // - rest_action end/extend：手表休息双按钮 → 手机休息倒计时同步
  // - hr_batch：训后心率批量样本 → POST 后端 heart_rate_samples
  // 幂等：只接受当前焦点组的事件，积压补发不会误触发其他组。
  useEffect(() => {
    if (!isWatchBridge) return;
    const off = onWatchEvent((event: WatchEvent) => {
      switch (event.kind) {
        case 'set_completed': {
          // 手机在休息态 = 这是对下一组的确认 → 结束休息
          if (focus.kind === 'rest') { onEndRest(focus.exId, focus.setId); break; }
          if (focus.kind !== 'confirm' && focus.kind !== 'countdown') break;
          const ex = exercises[event.exercise_index ?? -1];
          const set: any = ex?.sets[event.set_index ?? -1];
          if (!ex || !set || ex.id !== focus.exId || set.id !== focus.setId) break; // 焦点校验
          onCompleteSet(ex.id, set.id);
          break;
        }
        case 'rest_action':
          if (focus.kind !== 'rest') break; // 幂等：非休息态忽略
          if (event.action === 'end') onEndRest(focus.exId, focus.setId);
          if (event.action === 'extend') onExtendRest(focus.exId, focus.setId, event.seconds ?? 10);
          break;
        case 'hr_batch': {
          const sessionId = (exercises[0] as any)?.sessionId ?? (exercises[0] as any)?.session_id;
          if (!sessionId || !event.samples?.length) break;
          void syncHeartRateSamples(sessionId, event.samples).then((r) => {
            if (!r.ok) console.warn('[watch] hr_batch sync failed:', r.error);
          });
          break;
        }
      }
    });
    return off;
    // focusKey 变化重新订阅：闭包内 focus/exercises 保持最新
  }, [focusKey, exercises, onCompleteSet, onEndRest, onExtendRest]);

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

  const handleUnlockTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0]?.clientY ?? null;
    dragAccum.current = 0;
    setCapsulePressed(true);
  };
  const handleUnlockTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const y = e.touches[0]?.clientY;
    if (typeof y !== 'number') return;
    dragAccum.current = y - dragStartY.current;
    // 只跟随向上拖（dy<0），向下拖不位移
    setDragY(Math.max(-56, Math.min(0, dragAccum.current * 0.7)));
  };
  const handleUnlockTouchEnd = () => {
    const dy = dragAccum.current;
    dragStartY.current = null;
    dragAccum.current = 0;
    setDragY(0); // LOCK_MOTION.spring 弹回（未过阈值）或随退出动画离场
    setCapsulePressed(false);
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
  }, [focus, currentEx]);

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
      return (
        <div className="flex flex-col gap-4">
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
          <HoldToConfirm
            variant="secondary"
            label="放弃本次"
            onConfirm={() => setCounting(null)}
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

  // ---- 信息区（中间）：休息态与运动态同一套排版骨架，只换内容 ----
  // 统一字号阶梯：类型徽章 14px / 主数值 92px / 动作名 30px / 参数 20px / 说明 16px
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
          <span className="text-[22px] font-semibold text-white">全部完成</span>
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
      <div className="flex flex-col items-center gap-3">
        {/* ① 类型徽章（两态同款）——有氧/户外附加模式标签（目标时长/目标距离/自由模式） */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/8 border border-white/10">
            <span className="w-2 h-2 rounded-full" style={{ background: typeDot }} />
            <span className="text-[14px] font-medium tracking-wide text-white/70">{typeLabel}</span>
          </div>
          {cardioModeLabel && (
            <div className="flex items-center px-4 py-2 rounded-full bg-white/8 border border-white/10">
              <span className="text-[14px] font-medium tracking-wide text-white/70">{cardioModeLabel}</span>
            </div>
          )}
        </div>

        {/* ② 主数值：倒计时大字（两态同规格） */}
        {heroValue && (
          <span style={{ fontFeatureSettings: "'tnum'" }} className="font-mono text-[92px] font-light tracking-tight leading-none text-white">
            {heroValue}
          </span>
        )}

        {/* ③ 动作名：休息态作次级说明；运动态（力量）作主视觉大字 */}
        <span className={`font-bold text-white leading-tight text-center max-w-[86vw] ${heroIsName ? 'text-[44px]' : 'text-[26px] text-white/85'}`}>
          {focus.exName}
        </span>

        {/* ④ 当前组参数行（力量 = 重量/次数，计时 = 秒数，距离 = km）——两态同款大字 */}
        {setParams && (
          <div className="flex items-center gap-2">
            {setParams.map((p, i) => (
              <span key={i} className="flex items-baseline gap-1 px-4 py-1.5 rounded-full bg-white/8 border border-white/10">
                <span style={{ fontFeatureSettings: "'tnum'" }} className="text-[24px] font-bold text-white leading-none">{p.value}</span>
                <span className="text-[15px] font-medium text-white/60">{p.unit}</span>
              </span>
            ))}
          </div>
        )}

        {/* ④b 动作间休息前瞻（仅 rest 态且有下一动作时）：信息区预告下一个动作，
            休息时提前准备换动作/器械 */}
        {isRest && nextExerciseName && (
          <span className="text-[17px] font-medium text-white/55">
            接下来 · <span className="text-white/85 font-semibold">{nextExerciseName}</span>
          </span>
        )}

        {/* ⑤ 组进度：单组动作（户外跑/有氧）不显示组进度行——单组无"第 1/1 组"信息量，
            版面让给模式目标与运动数据（用户拍板 2026-09-15） */}
        {focus.total > 1 && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-[17px] font-medium text-white/65">
              第 <span className="text-white text-[22px] font-bold">{focus.setNo}</span> / {focus.total} 组
              <span className="text-white/45">{isRest ? ' · 已完成，休息中' : ''}</span>
            </span>
            {focus.total <= 10 && (
              <div className="flex items-center gap-2">
                {Array.from({ length: focus.total }).map((_, i) => (
                  <motion.span
                    key={i}
                    animate={{
                      backgroundColor:
                        i < completedCount ? '#34d399' : i === focus.setNo - 1 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)',
                      width: i === focus.setNo - 1 ? 22 : 7
                    }}
                    transition={LOCK_MOTION.spring}
                    className="rounded-full"
                    style={{ height: 7 }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ⑥ 户外/有氧附加数据：只显示真实记录。
            ★限高：户外态信息元素多（徽章/倒计时/动作名/参数/进度/统计），统计行最多
            显示心率+实测距离两项，目标距离已在 setParams 参数行出现过，不重复；
            无实测数据时只留一行提示，防止总高度下侵按钮区（重叠实锤过） */}
        {outdoorStats && (
          <div className="flex items-center gap-3 mt-1 max-h-[76px] overflow-hidden">
            {typeof outdoorStats.lastHr === 'number' && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/8 border border-white/10">
                <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                <span style={{ fontFeatureSettings: "'tnum'" }} className="text-[17px] font-semibold text-white">{outdoorStats.lastHr}</span>
                <span className="text-[13px] text-white/55">bpm</span>
              </div>
            )}
            {outdoorStats.distance > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/8 border border-white/10">
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span style={{ fontFeatureSettings: "'tnum'" }} className="text-[17px] font-semibold text-white">
                  {(outdoorStats.distance / 1000).toFixed(2)}
                </span>
                <span className="text-[13px] text-white/55">km</span>
              </div>
            )}
            {!outdoorStats.lastHr && outdoorStats.distance === 0 && (
              <span className="text-[13px] text-white/40">连接 Apple Watch 自动记录心率，完成组后显示</span>
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
          {/* morph 入场：起点=训练态胶囊（顶部 safe-top+12px、180 宽），终点=锁定位（260 宽）。
              与上滑解锁的 spring 回弹同族参数，形成"下滑进入↔上滑退出"的对称动画语言 */}
          <motion.button
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
        </motion.div>
        {/* 解锁提示（stage 1 随入场阶梯出现） */}
        <motion.div
          {...LOCK_MOTION.enter(1)}
          className="flex flex-col items-center gap-0.5 mt-3"
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
      </div>

      {/* 【中间】信息区（stage 1）：状态切换 = 交叉溶解（AnimatePresence mode=popLayout 防双重占位） */}
      <motion.div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: '46%', transform: 'translateY(-50%)', maxHeight: '44vh', overflow: 'hidden' }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={infoKey}
            {...LOCK_MOTION.swap}
            className="flex justify-center"
          >
            {renderInfo()}
          </motion.div>
        </AnimatePresence>
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
