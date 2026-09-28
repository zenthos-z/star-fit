/**
 * Unit tests for suggestionCacheScheduler（空闲重算队列，issue #39 B6）。
 *
 * 钉死的行为：
 * - 触发 → 空闲窗口后才执行（窗口内零重算）
 * - 尾随去抖：窗口内重复触发只留一个计时器，只跑一轮
 * - chat 活跃 → 延后复查；对话结束（或到达延后上限）后执行 —— 绝不抢占对话流
 * - 用户级串行：重算进行中再触发 → 重新排队而非并发
 * - 重算失败只记日志，绝不抛出/影响触发方
 * - 空闲窗口 env 解析（默认 5 分钟，MINUTES 支持小数，MS 优先）
 */

import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import {
  __configureSchedulerForTests,
  notifySuggestionCacheInvalidation,
  pendingInvalidations,
  resolveIdleWindowMs,
} from "../../../../src/services/suggestions/suggestionCacheScheduler.js";

// ============================================================================
// 手动假定时器（确定性推进，不依赖 jest.useFakeTimers 的异步语义）
// ============================================================================

interface FakeTimer {
  fn: () => void;
  deadline: number;
  cancelled: boolean;
}

class FakeTimers {
  private clock = 0;
  private timers: FakeTimer[] = [];

  setTimer = (ms: number, fn: () => void) => {
    // setTimeout 语义：ms 是相对延迟，换算成虚拟时钟的绝对到期点
    const timer: FakeTimer = {
      fn,
      deadline: this.clock + ms,
      cancelled: false,
    };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  };

  /** 推进虚拟时钟：执行到期计时器（fire 异步启动、不等待完成） */
  advance(ms: number): void {
    this.clock += ms;
    const due = this.timers.filter(
      (t) => !t.cancelled && t.deadline <= this.clock,
    );
    this.timers = this.timers.filter(
      (t) => t.cancelled || t.deadline > this.clock,
    );
    for (const timer of due) {
      void timer.fn();
    }
  }

  activeCount(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }
}

/** 微任务清空（让 void fire() 链推进到下一个 await 点并settled） */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// ============================================================================
// Fake deps
// ============================================================================

interface Deferred {
  resolve: () => void;
  promise: Promise<void>;
}

function makeDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

const USER = "11111111-1111-4111-8111-111111111111";

describe("suggestionCacheScheduler", () => {
  let timers: FakeTimers;
  let started: number;
  let completed: number;
  let errors: unknown[];
  let errorLogs: unknown[][];
  let gate: Deferred | null;
  let chatActiveUsers: Set<string>;

  beforeEach(() => {
    process.env.SUGGESTION_CACHE_IDLE_WINDOW_MS = "100";
    timers = new FakeTimers();
    started = 0;
    completed = 0;
    errors = [];
    errorLogs = [];
    gate = null;
    chatActiveUsers = new Set();
    __configureSchedulerForTests({
      recompute: async () => {
        started += 1;
        if (gate) await gate.promise;
        completed += 1;
        return { fingerprint: "fp", rowCount: 354 };
      },
      chatActive: (userId: string) => chatActiveUsers.has(userId),
      now: () => Date.now(),
      setTimer: timers.setTimer,
      log: {
        info: () => {},
        warn: () => {},
        error: (...args: unknown[]) => {
          errorLogs.push(args);
        },
      },
    });
  });

  afterEach(() => {
    delete process.env.SUGGESTION_CACHE_IDLE_WINDOW_MS;
    __configureSchedulerForTests(null);
  });

  it("waits for the idle window before recomputing exactly once", async () => {
    notifySuggestionCacheInvalidation(USER, "profile_updated");
    expect(timers.activeCount()).toBe(1);
    expect(pendingInvalidations()).toHaveLength(1);

    timers.advance(50); // 窗口内
    await flush();
    expect(started).toBe(0);

    timers.advance(100); // 窗口到期
    await flush();
    expect(started).toBe(1);
    expect(completed).toBe(1);
    expect(pendingInvalidations()).toHaveLength(0);
  });

  it("trailing-debounces repeated triggers within the window", async () => {
    notifySuggestionCacheInvalidation(USER, "plan_updated");
    notifySuggestionCacheInvalidation(USER, "session_completed");
    expect(timers.activeCount()).toBe(1); // 旧计时器已取消，只留一个

    timers.advance(100);
    await flush();
    expect(started).toBe(1);
  });

  it("defers while a chat SSE stream is active, then runs once idle", async () => {
    chatActiveUsers.add(USER);
    notifySuggestionCacheInvalidation(USER, "profile_updated");

    timers.advance(100); // 到期但对话进行中 → 延后复查
    await flush();
    expect(started).toBe(0);
    expect(timers.activeCount()).toBe(1); // 复查计时器已挂

    chatActiveUsers.delete(USER); // 对话结束
    timers.advance(10_100);
    await flush();
    expect(started).toBe(1);
    expect(completed).toBe(1);
  });

  it("never starts while chat stays active (bounded only by defer max wait)", async () => {
    chatActiveUsers.add(USER);
    notifySuggestionCacheInvalidation(USER, "profile_updated");

    timers.advance(100);
    await flush();
    expect(started).toBe(0);

    // 持续活跃多轮复查仍未执行
    timers.advance(30_000);
    await flush();
    expect(started).toBe(0);
  });

  it("requeues instead of running concurrently for the same user", async () => {
    gate = makeDeferred();
    notifySuggestionCacheInvalidation(USER, "plan_updated");
    timers.advance(100);
    await flush();
    expect(started).toBe(1);
    expect(completed).toBe(0); // 阻塞中

    notifySuggestionCacheInvalidation(USER, "plan_updated");
    timers.advance(100);
    await flush();
    expect(started).toBe(1); // 未并发
    expect(pendingInvalidations()).toHaveLength(1); // 已重新排队

    gate.resolve();
    await flush();
    expect(completed).toBe(1);
  });

  it("swallows recompute failures (cache task never throws to callers)", async () => {
    __configureSchedulerForTests({
      recompute: async () => {
        throw new Error("db down");
      },
      chatActive: () => false,
      now: () => Date.now(),
      setTimer: timers.setTimer,
      log: {
        info: () => {},
        warn: () => {},
        error: (...args: unknown[]) => {
          errorLogs.push(args);
        },
      },
    });
    notifySuggestionCacheInvalidation(USER, "profile_updated");
    timers.advance(100);
    await flush();
    expect(errorLogs).toHaveLength(1);
  });
});

describe("resolveIdleWindowMs", () => {
  afterEach(() => {
    delete process.env.SUGGESTION_CACHE_IDLE_WINDOW_MS;
    delete process.env.SUGGESTION_CACHE_IDLE_WINDOW_MINUTES;
  });

  it("defaults to 5 minutes", () => {
    expect(resolveIdleWindowMs({})).toBe(5 * 60_000);
  });

  it("accepts fractional minutes", () => {
    expect(
      resolveIdleWindowMs({ SUGGESTION_CACHE_IDLE_WINDOW_MINUTES: "0.5" }),
    ).toBe(30_000);
  });

  it("MS override wins over minutes", () => {
    expect(
      resolveIdleWindowMs({
        SUGGESTION_CACHE_IDLE_WINDOW_MS: "250",
        SUGGESTION_CACHE_IDLE_WINDOW_MINUTES: "9",
      }),
    ).toBe(250);
  });

  it("ignores malformed values", () => {
    expect(
      resolveIdleWindowMs({ SUGGESTION_CACHE_IDLE_WINDOW_MS: "abc" }),
    ).toBe(5 * 60_000);
  });
});
