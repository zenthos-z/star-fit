import { describe, it, expect } from 'vitest';
import type { Session } from '../../../types/legacy';
import { resolveTimerAction, activateSessionTimer, resumeSessionTimer } from '../timerActivation';

/**
 * #123 全局计时自动激活/恢复测试：
 * - idle 态完成动作 → 计时自动开始（status=active 且 startTime 已设）
 * - paused 态完成组（返工）→ 计时恢复（status=active 且 pausedDuration 正确结算）
 * - 已 active 态完成 → 无变化（计时不受干扰）；finished 不重启
 * 判定收口在 resolveTimerAction，跃迁收口在 activateSessionTimer / resumeSessionTimer——
 * 手动「开始训练」/「继续」（App handleStartSession / handleResumeSession）与
 * 卡片/锁屏/手表完成自动激活（App handleUpdateSet）共用同一套计时启停代码。
 */

const mkIdleSession = (over: Partial<Session> = {}): Session => ({
  id: 'sess-old',
  startTime: 0,
  pausedDuration: 0,
  status: 'idle',
  exercises: [],
  ...over,
});

describe('resolveTimerAction（完成跃迁的计时动作判定）', () => {
  it('idle 态完成动作 → activate（自动开始计时）', () => {
    expect(resolveTimerAction('idle', true)).toBe('activate');
  });

  it('paused 态完成组 → resume（恢复计时，返工新增语义）', () => {
    expect(resolveTimerAction('paused', true)).toBe('resume');
  });

  it('已 active 态完成 → none（计时不受干扰）', () => {
    expect(resolveTimerAction('active', true)).toBe('none');
  });

  it('finished 态完成 → none（历史态不自动重启）', () => {
    expect(resolveTimerAction('finished', true)).toBe('none');
  });

  it('非完成更新（改重量/清休息/取消完成）→ 各态一律 none', () => {
    for (const status of ['idle', 'active', 'paused', 'finished'] as const) {
      expect(resolveTimerAction(status, undefined)).toBe('none');
      expect(resolveTimerAction(status, false)).toBe('none');
    }
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

describe('resumeSessionTimer（恢复跃迁：手动「继续」与 paused 完成组自动恢复共用）', () => {
  it('paused 态完成组 → status 变 active 且 pausedDuration 正确结算（累加本次暂停段）', () => {
    const pauseStart = 1_760_000_000_000;
    const now = pauseStart + 90_000; // 暂停了 90s
    const prev = mkIdleSession({
      status: 'paused',
      startTime: pauseStart - 600_000,
      pausedDuration: 30_000, // 此前已累计 30s 暂停
      pauseStartTime: pauseStart,
    });
    const next = resumeSessionTimer(prev, now);
    expect(next.status).toBe('active');
    expect(next.pausedDuration).toBe(30_000 + 90_000); // 30s + 本次 90s
    expect(next.pauseStartTime).toBeUndefined();
  });

  it('暂停前已在休息的组：restEndTime 顺延暂停段，休息在恢复后继续计时', () => {
    const pauseStart = 1_760_000_000_000;
    const now = pauseStart + 60_000;
    const restEndBeforePause = pauseStart + 30_000; // 暂停时休息还剩 30s
    const ex = {
      id: 'ex-1', name: '杠铃卧推', libraryId: '', type: 'resistance' as const,
      sets: [{ id: 's1', reps: 8, weight: 60, completed: true, restEndTime: restEndBeforePause }],
    };
    const prev = mkIdleSession({ status: 'paused', pausedDuration: 0, pauseStartTime: pauseStart, exercises: [ex] });
    const next = resumeSessionTimer(prev, now);
    expect(next.exercises[0].sets[0].restEndTime).toBe(restEndBeforePause + 60_000);
  });

  it('早于暂停起点已到期的休息终点不顺延；训练内容原样保留', () => {
    const pauseStart = 1_760_000_000_000;
    const now = pauseStart + 60_000;
    const expiredRestEnd = pauseStart - 5_000; // 暂停前已到期
    const ex = {
      id: 'ex-1', name: '杠铃卧推', libraryId: '', type: 'resistance' as const,
      sets: [{ id: 's1', reps: 8, weight: 60, completed: true, restEndTime: expiredRestEnd }],
    };
    const prev = mkIdleSession({ status: 'paused', pausedDuration: 0, pauseStartTime: pauseStart, exercises: [ex] });
    const next = resumeSessionTimer(prev, now);
    expect(next.exercises[0].sets[0].restEndTime).toBe(expiredRestEnd);
    expect(next.exercises[0].sets[0].completed).toBe(true);
  });

  it('pauseStartTime 缺失（防御）→ 不结算暂停段，仅恢复 active', () => {
    const prev = mkIdleSession({ status: 'paused', pausedDuration: 12_000, pauseStartTime: undefined });
    const next = resumeSessionTimer(prev, 1_760_000_000_000);
    expect(next.status).toBe('active');
    expect(next.pausedDuration).toBe(12_000);
  });
});
