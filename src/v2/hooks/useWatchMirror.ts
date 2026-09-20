/**
 * useWatchMirror — 手机→手表训练镜像（ADR-0001，2026-09-19 上提 App 层）。
 *
 * 修复背景：镜像广播原挂在 LockScreen（条件挂载组件）内，不进锁定屏就
 * 一个字节都不发——手表 App 永远停在演示态。训练计划出现在「开始运动」
 * 界面的训练卡片上，但该状态从未同步到手表（用户实锤反馈）。
 *
 * 现在挂在 App 层，跟 session 状态机走，与界面无关：
 * - status === 'active'：焦点组状态持续广播（applicationContext，重连自动补发）
 * - status === 'paused' / 'finished'：广播 PAUSED / COMPLETED 终态，手表回落 idle
 * - 非 iOS / 无原生桥：broadcastCurrentSet 内部静默 no-op
 *
 * 焦点计算与 LockScreen 共用同一语义：休息 > 第一个未完成组 > 全部完成。
 */
import { useEffect, useMemo } from 'react';
import { broadcastCurrentSet, isWatchBridge, onWatchEvent } from '../services/watchConnectivity';
import type { Exercise, ExerciseType } from '../../../types';

type Focus =
  | { kind: 'rest'; exId: string; setId: string; exName: string; exType: ExerciseType; setNo: number; total: number; end: number }
  | { kind: 'confirm'; exId: string; setId: string; exName: string; exType: ExerciseType; setNo: number; total: number }
  | { kind: 'countdown'; exId: string; setId: string; exName: string; exType: ExerciseType; setNo: number; total: number; target: number }
  | { kind: 'done' };

const isSetDone = (s: any) => s.completed === true || s.status === 'COMPLETED';

/** 焦点计算：休息 > 待执行组 > 全部完成（与 LockScreen focus 同语义） */
export function computeWatchFocus(exercises: Exercise[], now: number): Focus {
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
}

export interface WatchMirrorSession {
  status: 'idle' | 'active' | 'paused' | 'finished';
  exercises: Exercise[];
  /** 训练开始时刻（epoch ms），手表显示已训练时长 */
  startTime?: number;
  /** 暂停累计（ms） */
  pausedDuration?: number;
  /** 本次暂停开始时刻（epoch ms）；status=paused 时非空 */
  pauseStartTime?: number;
}

/**
 * App 层挂载：训练状态机 → 手表镜像。session.status === 'active' 期间持续广播，
 * 不依赖任何界面（锁定屏开不开都发）。
 */
export function useWatchMirror(session: WatchMirrorSession): void {
  // 500ms 心跳：驱动休息态焦点切换（restEndTime 到点后焦点从 rest 回到 confirm）
  const now = useMemo(() => Date.now(), [session.exercises, session.status]);
  void now;

  const focus = useMemo(
    () => (session.status === 'active' || session.status === 'paused'
      ? computeWatchFocus(session.exercises, Date.now())
      : ({ kind: 'done' } as Focus)),
    [session.status, session.exercises],
  );
  const focusKey = focus.kind === 'done' ? 'done' : `${focus.exId}:${focus.setId}:${focus.kind}`;

  // 休息倒计时是时间驱动的：restEndTime 过后需要重算焦点。
  // 用轻量定时器在「有休息进行中」时每秒 tick 一次（只影响本 hook，不惊动全局）。
  useEffect(() => {
    if (!isWatchBridge) return;
    if (session.status !== 'active') return;
    const hasRest = session.exercises.some((ex) =>
      ex.sets.some((s: any) => typeof s.restEndTime === 'number' && s.restEndTime > Date.now()),
    );
    if (!hasRest) return;
    const t = setInterval(() => {
      // tick 仅触发依赖数组重算（exercises 引用不变时由 focusKey 时间性兜底：
      // 休息结束后下一次任意状态变化会重广播；此处主动重算一次）
      const f = computeWatchFocus(session.exercises, Date.now());
      const key = f.kind === 'done' ? 'done' : `${f.exId}:${f.setId}:${f.kind}`;
      if (key !== focusKey) mirrorTick(session, f);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, session.status, session.exercises]);

  // 焦点/状态变化 → 广播（applicationContext 重连自动补发，无需手动重试）
  useEffect(() => {
    if (!isWatchBridge) return;
    mirrorTick(session, focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, session.status, session.exercises]);

  // 启动重发（用户实锤场景）：手表后开 / 手机刚启动时 WCSession 可能尚未激活，
  // 首次广播发出去就丢——而之后状态不再变化就不会再触发上面的 effect。
  // 手机侧就绪后延迟重发一串（3s/8s/15s），覆盖手表晚开、隧道慢建立的情况。
  // applicationContext 是「最新快照」语义，重复发送无副作用（手表只保留最后一份）。
  useEffect(() => {
    if (!isWatchBridge) return;
    const delays = [3000, 8000, 15000];
    const timers = delays.map((d) =>
      setTimeout(() => mirrorTick(session, focus), d),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, session.status, session.exercises]);

  // 暂停期间每秒重播（Bug2 修复）：displayStartMs 需随 now 平移让手表冻结；
  // 恢复时 pausedDuration 变化自动触发上面的焦点 effect。
  useEffect(() => {
    if (!isWatchBridge) return;
    if (session.status !== 'paused') return;
    const t = setInterval(() => mirrorTick(session, focus), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, session.status, session.exercises]);

  // 手表同步按钮（2026-09-19）：手表发 request_sync → 手机立即重播当前状态。
  // 与启动重发同语义：sendMessage 实时通道直推，applicationContext 同步更新快照。
  useEffect(() => {
    if (!isWatchBridge) return;
    const off = onWatchEvent((event) => {
      if (event.kind === 'request_sync') {
        mirrorTick(session, focus);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, session.status, session.exercises]);
}

function mirrorTick(session: WatchMirrorSession, focus: Focus): void {
  // ── 计时虚拟起点（Bug1/Bug2 修复）：手表 elapsed = now − displayStartMs。
  // 暂停中：起点随 now 平移 → 手表读数冻结；
  // 恢复：pausedDuration 累加后起点固定，与手机胶囊一致；
  // 手机改训练时间：startTime/pausedDuration 变化 → 本函数重算重播。
  const now = Date.now();
  const pausedExtra = session.status === 'paused' && session.pauseStartTime
    ? now - session.pauseStartTime : 0;
  const displayStartMs = session.startTime && session.startTime > 0
    ? session.startTime + (session.pausedDuration ?? 0) + pausedExtra
    : undefined;

  // 计划已导入、尚未开练（idle + 有动作）→ READY 预告态
  if (session.status === 'idle') {
    if (session.exercises.length > 0) {
      broadcastPlanMirror(session, 'READY', undefined);
      return;
    }
  }
  // 训练结束/无焦点 → DONE 终态（手表回落 idle）
  if (session.status === 'finished' || session.status === 'idle' || focus.kind === 'done') {
    void broadcastCurrentSet({
      exerciseName: '', exerciseType: 'resistance',
      setIndex: 0, totalSets: 0, completedCount: 0,
      status: 'PLANNED', isResting: false,
      sessionPhase: 'DONE', displayStartMs,
    });
    return;
  }

  const ex = session.exercises.find((e) => e.id === (focus as any).exId);
  if (!ex) return;
  const set: any = ex.sets.find((s: any) => s.id === (focus as any).setId);
  const completedCount = ex.sets.filter(isSetDone).length;
  // Bug3 修复：set.status 只描述组（手表不再用它切会话态）；
  // 会话层用 sessionPhase：休息中=REST（含「完成组后的组间休息」）。
  const sessionPhase = session.status === 'paused'
    ? 'PAUSED'
    : focus.kind === 'rest' ? 'REST' : 'ACTIVE';
  // 缺口C修复（2026-09-20）：带真实 exerciseIndex——手表遥控回传的
  // exercise_index 之前恒 0，切动作后手机焦点校验必败 → 静默丢弃。
  const exerciseIndex = session.exercises.findIndex((e) => e.id === ex.id);
  void broadcastCurrentSet({
    exerciseName: ex.name,
    exerciseType: ex.type,
    setIndex: Math.max(0, (focus as any).setNo - 1),
    totalSets: ex.sets.length,
    completedCount,
    isUnilateral: ex.unilateral === true,
    exerciseIndex: exerciseIndex >= 0 ? exerciseIndex : 0,
    weight: typeof set?.weight === 'number' ? set.weight : undefined,
    reps: typeof set?.reps === 'number' ? set.reps : undefined,
    durationSec: typeof set?.targetDuration === 'number' ? set.targetDuration : ex.metadata?.targetDurationSec,
    distanceM: typeof set?.targetDistance === 'number' ? set.targetDistance : ex.metadata?.targetDistanceMeters,
    status: isSetDone(set) ? 'COMPLETED' : 'PLANNED',
    isResting: focus.kind === 'rest',
    restEndTime: focus.kind === 'rest' ? (focus as any).end : undefined,
    // P2：剩余秒数优先（手表按本地时钟换算终点，免两端时钟漂移）
    restRemainSec: focus.kind === 'rest' ? Math.max(0, Math.ceil(((focus as any).end - Date.now()) / 1000)) : undefined,
    sessionPhase,
    displayStartMs,
  });
  console.log(`[watch-mirror] broadcast: ${ex.name} ${completedCount}/${ex.sets.length} phase=${sessionPhase} focus=${focus.kind}`);
}

/** 广播计划（READY 预告 / 其余态共用字段拼装） */
function broadcastPlanMirror(session: WatchMirrorSession, phase: 'READY', _displayStartMs?: number): void {
  const ex = session.exercises[0];
  if (!ex) return;
  const set: any = ex.sets?.[0];
  void broadcastCurrentSet({
    exerciseName: ex.name,
    exerciseType: ex.type,
    setIndex: 0,
    totalSets: ex.sets.length,
    completedCount: 0,
    isUnilateral: ex.unilateral === true,
    weight: typeof set?.weight === 'number' ? set.weight : undefined,
    reps: typeof set?.reps === 'number' ? set.reps : undefined,
    durationSec: typeof set?.targetDuration === 'number' ? set.targetDuration : ex.metadata?.targetDurationSec,
    distanceM: typeof set?.targetDistance === 'number' ? set.targetDistance : ex.metadata?.targetDistanceMeters,
    status: 'PLANNED',
    isResting: false,
    sessionPhase: phase,
  });
}
