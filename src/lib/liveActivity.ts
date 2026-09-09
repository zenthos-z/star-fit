/**
 * liveActivity — 训练计时灵动岛桥（iOS Live Activity）。
 *
 * 退到桌面/锁屏后，计时以系统灵动岛胶囊 + 锁屏实时活动呈现；
 * 时间语义与 TimerCapsule 完全一致：elapsed = now - startTime - pausedDuration。
 * 跳秒由系统 Text(timerInterval:) 渲染，App 被杀也持续准确。
 *
 * 全部调用静默降级：Web / Android / 未授权 / 桥缺失 → no-op，App 内计时不受影响。
 */
import { Capacitor } from '@capacitor/core';

const platform = Capacitor.getPlatform();
const enabled = platform === 'ios';

interface LiveActivityBridge {
  nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
}
const bridge = Capacitor as unknown as LiveActivityBridge;

async function call(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!enabled) return null;
  try {
    if (!bridge.nativePromise) return null;
    return await bridge.nativePromise('LiveActivityPlugin', method, args);
  } catch {
    return null; // 静默：Live Activity 是增强能力，永不阻塞主流程
  }
}

export async function isLiveActivitySupported(): Promise<boolean> {
  const r = await call('isSupported') as { supported?: boolean } | null;
  return r?.supported === true;
}

/** 训练开始 / 恢复 / App 启动时重建。displayStartMs = startTime + pausedDuration（毫秒） */
export function startLiveActivity(workoutId: string, displayStartMs: number): void {
  void call('startActivity', { workoutId, displayStart: displayStartMs });
}

/** 暂停：冻结在 frozenAtMs（毫秒时间戳） */
export function pauseLiveActivity(frozenAtMs: number): void {
  void call('pauseActivity', { frozenAt: frozenAtMs });
}

/** 结束：立即移除灵动岛与锁屏卡 */
export function endLiveActivity(): void {
  void call('endActivity');
}
