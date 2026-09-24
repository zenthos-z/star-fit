/**
 * watchConnectivity — 手表伴侣桥（ADR-0001）。
 *
 * 方向：
 * - 手机 → 手表：broadcastCurrentSet()（把当前焦点组镜像到手表单组屏）
 * - 手表 → 手机：watchEvent 订阅（set_completed / rest_action / hr_batch）
 * - 心率样本：syncHeartRateSamples() 把训后批量样本 POST 到后端
 *   heart_rate_samples 表（5s 降采样分析级副本，真源在 HealthKit）。
 *
 * Web/Android 无此桥：全部静默 no-op（Capacitor.nativePromise 失败即跳过），
 * 与 nativeGlassMenu 等既有桥同一模式。
 */
import { Capacitor } from '@capacitor/core';
import { parseJSONSafe } from 'shared/contracts';
import { API_BASE, getHeaders } from './geminiService';

export const isWatchBridge = Capacitor.getPlatform() === 'ios';

/** 镜像给手表的状态（与 WatchSetState.swift 契约对齐，camelCase） */
export interface WatchSetMirror {
  exerciseName: string;
  exerciseType: string;
  /** 动作在 session.exercises 中的下标（遥控回传焦点校验用，缺口C） */
  exerciseIndex?: number;
  /** 单侧训练标志（与 type 正交：负重也能单侧，如单臂哑铃卧推）→ 手表目标显示「每侧」 */
  isUnilateral?: boolean;
  setIndex: number;
  totalSets: number;
  completedCount: number;
  weight?: number;
  reps?: number;
  durationSec?: number;
  distanceM?: number;
  status: string;
  isResting: boolean;
  restEndTime?: number;
  /** 休息剩余秒数（优先于 restEndTime：手表按本地时钟换算，免两端漂移） */
  restRemainSec?: number;
  /**
   * 会话层状态（2026-09-20 修复 status 语义混用）：
   * set 的 status 只描述组；手表 phase 由 sessionPhase 驱动。
   * READY=已导计划未开练 ACTIVE=训练中 REST=休息中 PAUSED=暂停 DONE=全部结束
   */
  sessionPhase?: 'READY' | 'ACTIVE' | 'REST' | 'PAUSED' | 'DONE';
  /**
   * 计时虚拟起点（epoch ms）= startTime + 已扣暂停 +（暂停中的实时补偿）。
   * 手表 elapsed = now − displayStartMs；PAUSED 时手表冻结增量。
   * 手机端改训练时间（TimeEditor）→ startTime 变化 → 本值随之重播。
   */
  displayStartMs?: number;
}

/** 手表 → 手机事件 */
export interface WatchEvent {
  kind: 'set_completed' | 'rest_action' | 'hr_batch' | 'request_sync' | 'watch_status' | 'hr_live';
  exercise_index?: number;
  set_index?: number;
  avg_hr?: number;
  action?: string;
  seconds?: number;
  samples?: Array<{ bpm: number; recorded_at: string; exercise_index?: number; set_index?: number }>;
  completed_at?: string;
  /** hr_live 实时心率 */
  bpm?: number;
}

async function callPlugin(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  try {
    return await (Capacitor as unknown as {
      nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
    }).nativePromise?.('WatchConnectivityPlugin', method, args);
  } catch {
    return null; // 非 iOS 原生 / 旧版本：静默
  }
}

/** 手机 → 手表：镜像当前焦点组 */
export async function broadcastCurrentSet(state: WatchSetMirror): Promise<boolean> {
  const res = (await callPlugin('broadcastSetState', { state })) as { ok?: boolean } | null;
  return res?.ok === true;
}

export async function isWatchReachable(): Promise<boolean> {
  const res = (await callPlugin('isWatchReachable')) as { reachable?: boolean } | null;
  return res?.reachable === true;
}

/** 手表连接完整状态（设置页「Apple Watch」卡数据源） */
export interface WatchStatus {
  supported: boolean;
  activated: boolean;
  paired: boolean;
  appInstalled: boolean;
  reachable: boolean;
}

export async function getWatchStatus(): Promise<WatchStatus | null> {
  const res = (await callPlugin('getWatchStatus')) as Partial<WatchStatus> | null;
  if (!res || typeof res.supported !== 'boolean') return null;
  return {
    supported: res.supported === true,
    activated: res.activated === true,
    paired: res.paired === true,
    appInstalled: res.appInstalled === true,
    reachable: res.reachable === true,
  };
}

/** 拉取原生层缓冲的上行事件（读即清；推模式丢失的兜底通道，2s 轮询） */
export async function drainWatchEvents(): Promise<WatchEvent[]> {
  const res = (await callPlugin('drainWatchEvents')) as { events?: string[] } | null;
  if (!res?.events) return [];
  const out: WatchEvent[] = [];
  for (const raw of res.events) {
    const parsed = parseJSONSafe(raw, 'drainWatchEvents') as WatchEvent | null;
    if (parsed?.kind) out.push(parsed);
  }
  return out;
}

/** 主动重连：重新激活 WCSession（手表刚解锁/进入设置页时可触发） */
export async function reconnectWatch(): Promise<boolean> {
  const res = (await callPlugin('reconnect')) as { ok?: boolean } | null;
  return res?.ok === true;
}

/**
 * 订阅手表事件。返回取消函数。
 * 双通道：原生 notifyListeners（addListener）+ evaluateJavaScript 直调 CustomEvent
 * （既有教训：事件通道不可靠，直调兜底）。
 */
export function onWatchEvent(cb: (event: WatchEvent) => void): () => void {
  let disposed = false;
  const listener = (e: Event) => {
    if (disposed) return;
    const detail = (e as CustomEvent).detail;
    const parsed = parseJSONSafe(detail, 'starfit:watch-event') as WatchEvent | null;
    if (parsed?.kind) cb(parsed);
  };
  window.addEventListener('starfit:watch-event', listener);

  // P1 兜底：每 2s 主动拉取原生缓冲（推模式在真机转发链上已证明不可靠；
  // 拉取到的可能与推送重复，消费端须幂等——hr_batch 去重、set_completed 以手机状态机为准）
  const poll = setInterval(() => {
    if (disposed) return;
    void drainWatchEvents().then((events) => events.forEach(cb));
  }, 2000);

  // 原生通道（iOS 桥）
  void callPlugin('addListener', { eventName: 'watchEvent' }).then((res) => {
    const anyRes = res as { handle?: unknown } | null;
    if (anyRes?.handle && !disposed) {
      // Capacitor 桥 addListener 经 nativePromise 不可直接订阅；用 window 事件双通道即可，
      // 原生插件侧 notifyListeners 已同时走 CustomEvent 直调兜底。
      void anyRes.handle;
    }
  });

  return () => {
    disposed = true;
    clearInterval(poll);
    window.removeEventListener('starfit:watch-event', listener);
  };
}

/** 训后批量同步心率样本到后端 heart_rate_samples 表 */
export async function syncHeartRateSamples(
  sessionId: string,
  samples: Array<{ bpm: number; recorded_at: string; exercise_index?: number; set_index?: number }>,
): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  if (samples.length === 0) return { ok: true, inserted: 0 };
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/hr-samples`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ session_id: sessionId, samples }),
    });
    const data = parseJSONSafe(await res.text(), 'hr-samples sync') as { ok?: boolean; inserted?: number; error?: string };
    return { ok: data.ok === true, inserted: data.inserted, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
