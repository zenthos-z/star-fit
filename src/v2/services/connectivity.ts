/**
 * connectivity — 后端连接状态服务（fix/backend-connectivity-watch）。
 *
 * 解决的问题：手机 App 对后端连通性完全无感知——请求失败只会表现为
 * 「AI 无响应 / 同步失败」，前台没有任何状态展示，也没有主动探测。
 *
 * 设计：
 * - checkBackendHealth()：单次探测 GET {API_BASE 去掉 /api}/healthz
 *   （后端根级免令牌探针，2026-09-18 起直连与经 nginx 双通道一致）。
 * - useBackendHealth()：React hook——进前台立即探测 + App/网络状态变化
 *   触发重探 + 30s 心跳轮询；订阅者共享一次探测结果。
 * - subscribeBackendHealth()：供非 hook 场景（如原生桥）订阅。
 *
 * Web/浏览器同样工作（无原生依赖）。
 */

import { useEffect, useState } from 'react';
import { API_BASE, getHeaders } from '../../../services/geminiService';

export interface BackendHealth {
  ok: boolean;
  /** 探测中（首次或重探） */
  checking: boolean;
  /** 最近一次成功探测时间；null = 从未成功 */
  lastOkAt: number | null;
  /** 最近一次失败原因（展示用） */
  error: string | null;
  /** 探测延迟 ms */
  latencyMs: number | null;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/** 单次健康探测：{API_BASE}/../healthz，免令牌 */
export async function checkBackendHealth(): Promise<Omit<BackendHealth, 'checking'>> {
  const base = API_BASE.replace(/\/api\/?$/, '');
  const started = Date.now();
  try {
    const res = await fetch(`${base}/healthz`, {
      method: 'GET',
      headers: getHeaders({}, false),
      // 探针要快失败：3s 超时，不拖累 UI
      signal: AbortSignal.timeout(3000),
    });
    const latencyMs = Date.now() - started;
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const isStarfit = data?.app === 'starfit';
      return { ok: true, lastOkAt: Date.now(), error: null, latencyMs };
    }
    return { ok: false, lastOkAt: null, error: `HTTP ${res.status}`, latencyMs };
  } catch (e) {
    const msg = e instanceof Error
      ? (e.name === 'TimeoutError' ? '连接超时' : e.message)
      : String(e);
    return { ok: false, lastOkAt: null, error: msg, latencyMs: null };
  }
}

type Listener = (h: BackendHealth) => void;

const listeners = new Set<Listener>();
let cached: BackendHealth = { ok: false, checking: false, lastOkAt: null, error: null, latencyMs: null };
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function broadcast() {
  listeners.forEach((l) => l(cached));
}

async function probe() {
  if (inFlight) return;
  inFlight = true;
  cached = { ...cached, checking: true };
  broadcast();
  const result = await checkBackendHealth();
  cached = { ...result, checking: false };
  inFlight = false;
  broadcast();
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (listeners.size > 0) void probe();
  }, HEARTBEAT_INTERVAL_MS);
}

export function subscribeBackendHealth(l: Listener): () => void {
  listeners.add(l);
  ensureHeartbeat();
  // 新订阅者立即拿到缓存 + 触发一次新探测
  l(cached);
  if (!inFlight) void probe();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
}

/** React hook：Agent 对话界面 / 设置页共用 */
export function useBackendHealth(): BackendHealth {
  const [health, setHealth] = useState<BackendHealth>(cached);

  useEffect(() => {
    const off = subscribeBackendHealth(setHealth);

    // 回前台立即重探（切网/后台回来最常见）
    const onVisible = () => {
      if (document.visibilityState === 'visible') void probe();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('offline', onVisible);

    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('offline', onVisible);
    };
  }, []);

  return health;
}
