import { describe, it, expect } from 'vitest';
import type { Session } from '../../../types/legacy';
import { shouldAutoActivateTimer, activateSessionTimer } from '../timerActivation';

/**
 * #123 全局计时自动激活测试：idle 态完成动作 → 计时自动开始（status=active 且 startTime 已设）；
 * 已 active 态完成 → 不触发（计时不受干扰）。
 * 跃迁收口在 activateSessionTimer——手动「开始训练」（App handleStartSession）与
 * 卡片/锁屏/手表完成自动激活（App handleUpdateSet）共用同一套计时启动代码。
 */

const mkIdleSession = (over: Partial<Session> = {}): Session => ({
  id: 'sess-old',
  startTime: 0,
  pausedDuration: 0,
  status: 'idle',
  exercises: [],
  ...over,
});

describe('shouldAutoActivateTimer（仅 idle 态完成跃迁触发）', () => {
  it('idle 态完成动作 → 触发自动激活', () => {
    expect(shouldAutoActivateTimer('idle', true)).toBe(true);
  });

  it('idle 态非完成更新（改重量/清休息/取消完成）→ 不触发', () => {
    expect(shouldAutoActivateTimer('idle', undefined)).toBe(false);
    expect(shouldAutoActivateTimer('idle', false)).toBe(false);
  });

  it('已 active 态完成 → 不触发（计时不受干扰）', () => {
    expect(shouldAutoActivateTimer('active', true)).toBe(false);
  });

  it('paused / finished 态完成 → 不触发', () => {
    expect(shouldAutoActivateTimer('paused', true)).toBe(false);
    expect(shouldAutoActivateTimer('finished', true)).toBe(false);
  });
});

describe('activateSessionTimer（开始跃迁：手动开始与自动激活共用）', () => {
  it('idle 态完成动作 → session.status 变 active 且 startTime 已设', () => {
    const prev = mkIdleSession();
    const now = 1_760_000_000_000;
    const next = activateSessionTimer(prev, now);
    expect(next.status).toBe('active');
    expect(next.startTime).toBe(now);
  });

  it('与手动「开始训练」同语义：重生 session id、清零暂停、保留训练内容', () => {
    const prev = mkIdleSession({ startTime: 999, pausedDuration: 5000 });
    const next = activateSessionTimer(prev, 1_760_000_000_000);
    expect(next.id).not.toBe(prev.id);
    expect(next.pausedDuration).toBe(0);
    expect(next.exercises).toBe(prev.exercises);
  });

  it('已有训练内容时自动激活：动作与组原样保留（完成动作发生在内容之上）', () => {
    const ex = {
      id: 'ex-1', name: '杠铃卧推', libraryId: '', type: 'resistance' as const,
      sets: [{ id: 's1', reps: 8, weight: 60, completed: true }],
    };
    const prev = mkIdleSession({ exercises: [ex] });
    const next = activateSessionTimer(prev, 1_760_000_000_000);
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].sets[0].completed).toBe(true);
  });
});
