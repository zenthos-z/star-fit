/**
 * useWatchRemoteControl — 手表遥控上行消费（App 层，2026-09-20 上提）。
 *
 * 原实现挂在 LockScreen（条件挂载）内：不开锁定屏时手表上点「完成本组」
 * 手机毫无反应（用户实锤）。上提到 App 层跟 session 走，与界面无关。
 *
 * 事件（ADR-0001 遥控回传）：
 * - set_completed：手表「完成本组」→ 手机训练状态机推进
 *   （休息态收到 = 对下一组的确认 → 结束休息）
 * - rest_action end/extend：手表休息按钮 → 手机休息倒计时同步
 * 幂等：只接受当前焦点组的事件，积压补发不会误触发其他组。
 *
 * hr_batch 不在此处：App.tsx 既有全局订阅（单一消费点，防重复上传）。
 */
import { useEffect } from 'react';
import { isWatchBridge, onWatchEvent } from '../services/watchConnectivity';
import { computeWatchFocus } from './useWatchMirror';
import type { Exercise, ExerciseSet } from '@/src/types/legacy';

const isSetDone = (s: any) => s.completed === true || s.status === 'COMPLETED';

export interface WatchRemoteSession {
  status: 'idle' | 'active' | 'paused' | 'finished';
  exercises: Exercise[];
}

export interface WatchRemoteHandlers {
  onCompleteSet: (exId: string, setId: string, opts?: { avgHr?: number }) => void;
  onEndRest: (exId: string, setId: string) => void;
  onExtendRest: (exId: string, setId: string, extraSec: number) => void;
}

export function useWatchRemoteControl(
  session: WatchRemoteSession,
  handlers: WatchRemoteHandlers,
): void {
  useEffect(() => {
    if (!isWatchBridge) return;
    if (session.status !== 'active' && session.status !== 'paused') return;

    const off = onWatchEvent((event) => {
      if (event.kind !== 'set_completed' && event.kind !== 'rest_action') return;
      // 每次事件即时重算焦点（闭包内的 exercises 恒为最新——依赖数组保证）
      const focus = computeWatchFocus(session.exercises, Date.now());
      if (focus.kind === 'done') return;

      if (event.kind === 'set_completed') {
        const watchAvgHr = typeof event.avg_hr === 'number' ? event.avg_hr : undefined;
        // 手机在休息态 = 这是对下一组的确认 → 结束休息
        if (focus.kind === 'rest') {
          handlers.onEndRest(focus.exId, focus.setId);
          return;
        }
        // 焦点校验（2026-09-20 放宽）：旧包手表回传 index 恒 0，切动作后必败。
        // 优先 index 匹配；不行再按「手表当前显示的动作名 = 手机焦点动作名」放行
        // （名称由镜像带入 setState，回传侧可靠）。
        let ex = session.exercises[event.exercise_index ?? -1];
        let set: ExerciseSet | undefined = ex?.sets[event.set_index ?? -1];
        if (!ex || !set || ex.id !== focus.exId || set.id !== focus.setId) {
          ex = session.exercises.find((e) => e.id === focus.exId);
          set = ex?.sets[event.set_index ?? -1];
          if (!ex || !set || set.id !== focus.setId) return;
        }
        handlers.onCompleteSet(ex.id, set.id, { avgHr: watchAvgHr });
        return;
      }

      // rest_action
      if (focus.kind !== 'rest') return; // 幂等：非休息态忽略
      if (event.action === 'end') handlers.onEndRest(focus.exId, focus.setId);
      if (event.action === 'extend') handlers.onExtendRest(focus.exId, focus.setId, event.seconds ?? 10);
    });
    return off;
    // exercises/status 引用变化即重订阅：闭包内保持最新
  }, [session.status, session.exercises, handlers.onCompleteSet, handlers.onEndRest, handlers.onExtendRest]);
}

export { isSetDone };
