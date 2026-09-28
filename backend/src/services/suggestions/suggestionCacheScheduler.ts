/**
 * Suggestion Cache Scheduler - 心跳触发的空闲重算队列（issue #39 B6）
 *
 * 触发方（画像更新 / 周计划更新 / 训练完成）→ notifySuggestionCacheInvalidation
 * 静默登记延迟重算任务：
 *   - 空闲窗口：默认 5 分钟（env 可调），窗口内重复触发尾随去抖（trailing
 *     debounce，每次触发重置计时 —— 「触发后 N 分钟无新触发」语义）
 *   - 与对话隔离：独立 Node 定时器/微任务执行，绝不占用 chat SSE 流；
 *     窗口到期时若该用户有进行中的 chat 流（activeChatTracker），延后
 *     CHAT_DEFER_CHECK_INTERVAL_MS 复查，最多等待 CHAT_DEFER_MAX_WAIT_MS
 *     后无论如何执行（有界防饿死）
 *   - 用户级串行：同一用户同时至多一个重算在跑；执行失败仅记日志，
 *     不重试、不抛出（缓存任务绝不影响触发方请求路径）
 *
 * 环境变量：
 *   SUGGESTION_CACHE_IDLE_WINDOW_MINUTES  空闲窗口分钟数（默认 5，支持小数）
 *   SUGGESTION_CACHE_IDLE_WINDOW_MS       毫秒级覆盖（优先于分钟数，验证/测试用）
 */

import { getPostgresClient } from "../../db/postgresql/client/postgres-client.js";
import {
  createExerciseRepository,
  createSuggestionCacheRepository,
  createUserRepository,
} from "../../db/postgresql/repository/index.js";
import { createWeeklyPlanRepository } from "../../db/postgresql/repository/weeklyPlan.repository.js";
import { isChatActive } from "./activeChatTracker.js";
import { SuggestionCacheService } from "./suggestionCacheService.js";
import type { SuggestionAgentPort } from "./suggestionService.js";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** chat 活跃时重算复查间隔（毫秒） */
const CHAT_DEFER_CHECK_INTERVAL_MS = 10_000;
/** chat 活跃延后总上限（毫秒）——到期强制执行，防长对话饿死缓存更新 */
const CHAT_DEFER_MAX_WAIT_MS = 10 * 60_000;

export function resolveIdleWindowMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const msRaw = Number(env.SUGGESTION_CACHE_IDLE_WINDOW_MS);
  if (Number.isFinite(msRaw) && msRaw >= 0) return Math.floor(msRaw);
  const minRaw = Number(env.SUGGESTION_CACHE_IDLE_WINDOW_MINUTES);
  if (Number.isFinite(minRaw) && minRaw >= 0) {
    return Math.floor(minRaw * 60_000);
  }
  return 5 * 60_000; // 默认 5 分钟
}

// ---------------------------------------------------------------------------
// 可注入依赖（单测 fake；生产走默认装配）
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  /** 真正执行重算（默认：懒装配 SuggestionCacheService + 生产 Repository） */
  recompute(userId: string): Promise<{ fingerprint: string; rowCount: number }>;
  /** 该用户是否有进行中的 chat SSE 流 */
  chatActive(userId: string): boolean;
  /** 当前时间（epoch ms） */
  now(): number;
  /** 定时器原语（单测用 jest fake timers 覆盖） */
  setTimer(ms: number, fn: () => void): { cancel(): void };
  /** 结构化日志 */
  log: Pick<Console, "info" | "warn" | "error">;
}

/** 懒装配生产重算服务（Agent 端口仅在 hybrid 模式且 DeepAgent 可用时注入） */
let serviceCache: SuggestionCacheService | null = null;
let agentPortCache: SuggestionAgentPort | null = null;

async function buildService(): Promise<SuggestionCacheService> {
  if (serviceCache) return serviceCache;
  const client = getPostgresClient();
  const agentMode =
    process.env.SUGGESTION_AGENT_MODE === "hybrid" ? "hybrid" : "off";
  if (agentMode === "hybrid" && agentPortCache === null) {
    try {
      // 懒动态导入：避免 mcpTools ↔ scheduler 环（DeepAgentService 静态依赖
      // mcpTools，而 mcpTools 触发本调度器）
      const [{ deepAgentService }, { SuggestionAgentAdapter }] =
        await Promise.all([
          import("../agent/DeepAgentService.js"),
          import("./suggestionAgentAdapter.js"),
        ]);
      agentPortCache = new SuggestionAgentAdapter(deepAgentService);
    } catch (err) {
      console.warn(
        "[suggestionCacheScheduler] agent adapter unavailable, formula-only:",
        err,
      );
      agentPortCache = null;
    }
  }
  serviceCache = new SuggestionCacheService(
    createUserRepository(client),
    createWeeklyPlanRepository(client),
    createExerciseRepository(client),
    createSuggestionCacheRepository(client),
    agentPortCache,
  );
  return serviceCache;
}

const defaultDeps: SchedulerDeps = {
  async recompute(userId) {
    const service = await buildService();
    return service.recomputeUserCache(userId);
  },
  chatActive: isChatActive,
  now: () => Date.now(),
  setTimer(ms, fn) {
    const timer = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(timer) };
  },
  log: console,
};

// ---------------------------------------------------------------------------
// 队列状态
// ---------------------------------------------------------------------------

interface PendingTask {
  userId: string;
  reason: string;
  /** 触发时间（首次登记时间，日志用） */
  firstTriggeredAt: number;
  timer: { cancel(): void };
  /** chat 延后累计等待（到期强制执行） */
  deferredMs: number;
}

const pending = new Map<string, PendingTask>();
const running = new Set<string>();
let deps: SchedulerDeps = defaultDeps;

/** 单测注入依赖 + 复位队列（生产代码禁用） */
export function __configureSchedulerForTests(
  overrides: Partial<SchedulerDeps> | null,
): void {
  if (overrides === null) {
    deps = defaultDeps;
    for (const task of pending.values()) task.timer.cancel();
    pending.clear();
    running.clear();
    return;
  }
  deps = { ...defaultDeps, ...overrides };
  for (const task of pending.values()) task.timer.cancel();
  pending.clear();
  running.clear();
}

export interface PendingInvalidation {
  userId: string;
  reason: string;
  pendingCount: number;
  firstTriggeredAt: number;
}

/** 当前待执行任务快照（监控/验证脚本用） */
export function pendingInvalidations(): PendingInvalidation[] {
  return [...pending.values()].map(({ userId, reason, firstTriggeredAt }) => ({
    userId,
    reason,
    pendingCount: pending.size,
    firstTriggeredAt,
  }));
}

// ---------------------------------------------------------------------------
// 触发入口（画像/计划/训练完成心跳调用；fire-and-forget，绝不阻塞调用方）
// ---------------------------------------------------------------------------

/**
 * 静默失效登记：取消旧计时（尾随去抖）并按空闲窗口重新起表。
 * 同步纯内存操作 —— 触发方请求路径零 DB/IO 开销。
 */
export function notifySuggestionCacheInvalidation(
  userId: string,
  reason: string,
): void {
  const existing = pending.get(userId);
  if (existing) existing.timer.cancel();

  const task: PendingTask = {
    userId,
    reason: existing ? `${existing.reason}+${reason}` : reason,
    firstTriggeredAt: existing?.firstTriggeredAt ?? deps.now(),
    timer: { cancel: () => {} }, // 占位，下一行立即替换
    deferredMs: 0,
  };
  task.timer = deps.setTimer(resolveIdleWindowMs(), () => void fire(task));
  pending.set(userId, task);
  deps.log.info(
    { userId, reason, idleWindowMs: resolveIdleWindowMs() },
    "suggestion_cache_invalidation_scheduled",
  );
}

/** 计时器到期：chat 活跃则延后复查；空闲则执行重算 */
async function fire(task: PendingTask): Promise<void> {
  const { userId } = task;
  if (deps.chatActive(userId)) {
    const waited = task.deferredMs + CHAT_DEFER_CHECK_INTERVAL_MS;
    if (waited < CHAT_DEFER_MAX_WAIT_MS) {
      task.deferredMs = waited;
      task.timer = deps.setTimer(
        CHAT_DEFER_CHECK_INTERVAL_MS,
        () => void fire(task),
      );
      deps.log.info(
        { userId, deferredMs: waited },
        "suggestion_cache_recompute_deferred_chat_active",
      );
      return;
    }
    deps.log.warn(
      { userId, deferredMs: task.deferredMs },
      "suggestion_cache_recompute_defer_max_wait",
    );
  }
  pending.delete(userId);
  await runRecompute(userId, task.reason);
}

/** 执行重算：用户级串行 + 全捕获（缓存任务绝不影响任何请求路径） */
async function runRecompute(userId: string, reason: string): Promise<void> {
  if (running.has(userId)) {
    // 上一轮还在跑：重新起一个短窗口稍后再试（不丢触发）
    notifySuggestionCacheInvalidation(userId, `${reason}(requeued)`);
    return;
  }
  running.add(userId);
  const startedAt = deps.now();
  try {
    const { fingerprint, rowCount } = await deps.recompute(userId);
    deps.log.info(
      {
        userId,
        reason,
        fingerprint,
        rowCount,
        durationMs: deps.now() - startedAt,
      },
      "suggestion_cache_recomputed",
    );
  } catch (err) {
    deps.log.error(
      { err, userId, reason },
      "suggestion_cache_recompute_failed",
    );
  } finally {
    running.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// 启动钩子（server.ts 调用；当前无后台轮询，仅保留装配点与日志）
// ---------------------------------------------------------------------------

export function startSuggestionCacheScheduler(): void {
  defaultDeps.log.info(
    { idleWindowMs: resolveIdleWindowMs() },
    "suggestion_cache_scheduler_started",
  );
}
