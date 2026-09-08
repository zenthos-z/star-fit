/**
 * SuggestionService（前端）- 动作建议值三级链 + 离线缓存 + 后台刷新
 *
 * 模式照 exerciseLibraryService：缓存优先 + 互斥 sync + subscribe 通知。
 * 三级链：
 *   ① 缓存命中（版本+TTL 通过，stale 也照常读 —— 离线兜底）
 *      → deriveSuggestion(entry, rpe) 本地确定性导出（换 RPE 零请求）
 *   ② miss → POST /api/suggestions（批量 ≤20）
 *   ③ 后端不可达 → predictMetrics 本地启发式（来源标 heuristic）
 *
 * 失效通道：window 'history-updated' / invalidate()（训练结束、登录）
 * 标脏 + 在线时后台刷新；TTL 24h 兜底。
 */

import { API_BASE, getHeaders, predictMetrics } from './geminiService';
import { storageGet, storageSet } from '@/storage';
import { Keys, type SuggestionCache, type SuggestionCacheEntry } from '@/storage/schemas';
import { checkServerHealth } from '../../services/serverDetector';
import {
  deriveSuggestion,
  normalizeSuggestionExerciseType,
  type ExerciseSuggestion,
  type SuggestionResponse,
  type SuggestionValues,
} from 'shared/contracts';

const CACHE_KEY = Keys.suggestionCache;
const CACHE_VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000;
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const BATCH_SIZE = 20;
/** 上次成功同步时间早于该阈值且页面重新可见 → 后台刷新 */
const VISIBLE_RESYNC_MS = 10 * 60 * 1000;

/** 徽标来源：云端 formula/hybrid、缓存 cache、本地估算 heuristic */
export type SuggestionSource = 'hybrid' | 'formula' | 'cache' | 'heuristic';

/** modal 消费的解析结果（解释窗口数据全在这里） */
export interface ResolvedSuggestion {
  values: SuggestionValues;
  source: SuggestionSource;
  reason?: string;
  safetyNote?: string;
  baselineRpe?: number;
  generatedAt?: number;
  /** 数据依据（解释窗口展示） */
  dataBasis?: string;
  est1rm?: number;
  anchorConfidence?: number;
  /** Agent 调整明细（解释窗口展示） */
  adjustmentActions?: Array<{ field: string; mode: string; value: number }>;
}

export interface SuggestionSyncStatus {
  hasCache: boolean;
  isSyncing: boolean;
  stale: boolean;
  lastSyncTime: number | null;
  count: number;
  /** 最近一次健康探测结果（null = 本会话未探测） */
  serverOnline: boolean | null;
  lastError?: string;
}

export interface ExerciseRef {
  name: string;
  type: string;
  current?: SuggestionValues;
}

let isSyncing = false;
let serverOnline: boolean | null = null;
let lastError: string | undefined;
let listeners: Set<() => void> = new Set();

// ---------------------------------------------------------------------------
// 缓存读写
// ---------------------------------------------------------------------------

function cacheKey(type: string, name: string): string {
  return `${normalizeSuggestionExerciseType(type)}:${name}`;
}

async function loadCache(): Promise<SuggestionCache | null> {
  try {
    const cache = await storageGet<SuggestionCache>(CACHE_KEY);
    if (!cache || !cache.meta || cache.meta.version !== CACHE_VERSION) return null;
    if (!cache.entries || typeof cache.entries !== 'object') return null;
    return cache;
  } catch (e) {
    console.error('[SuggestionService] Failed to load cache:', e);
    return null;
  }
}

function entryUsable(entry: SuggestionCacheEntry | undefined, now = Date.now()): boolean {
  return !!entry && now - entry.generated_at < TTL_MS;
}

async function saveCache(cache: SuggestionCache): Promise<void> {
  try {
    await storageSet(CACHE_KEY, cache);
  } catch (e) {
    console.error('[SuggestionService] Failed to save cache:', e);
  }
}

// ---------------------------------------------------------------------------
// 网络层
// ---------------------------------------------------------------------------

async function fetchSuggestions(
  exercises: ExerciseRef[],
  targetRpe: number,
): Promise<SuggestionResponse> {
  const res = await fetch(`${API_BASE}/suggestions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      exercises: exercises.map((e) => ({
        name: e.name,
        type: e.type,
        ...(e.current ? { current: e.current } : {}),
      })),
      target_rpe: targetRpe,
    }),
  });
  if (!res.ok) {
    throw new Error(`suggestions HTTP ${res.status}`);
  }
  const data = (await res.json()) as SuggestionResponse;
  if (!data || !Array.isArray(data.suggestions)) {
    throw new Error('suggestions malformed response');
  }
  return data;
}

/** 服务端响应并入缓存（新条目覆盖同键旧值） */
async function mergeIntoCache(
  response: SuggestionResponse,
  previous: SuggestionCache | null,
): Promise<SuggestionCache> {
  const entries = { ...(previous?.entries ?? {}) };
  for (const s of response.suggestions) {
    entries[cacheKey(s.exercise_type, s.exercise_name)] = s as unknown as SuggestionCacheEntry;
  }
  return {
    entries,
    meta: {
      version: CACHE_VERSION,
      lastSyncTime: Date.now(),
      contextFingerprint: response.meta?.context_fingerprint,
      goal: previous?.meta.goal,
      count: Object.keys(entries).length,
    },
  };
}

// ---------------------------------------------------------------------------
// 三级链
// ---------------------------------------------------------------------------

function resolvedFromEntry(
  entry: SuggestionCacheEntry,
  source: SuggestionSource,
  rpe: number,
  goal?: string,
): ResolvedSuggestion {
  // 缓存条目即后端 ExerciseSuggestion 契约形状（storage 层故意放宽了字段类型，
  // 这里收敛回 deriveSuggestion 的输入）
  const values = deriveSuggestion(
    entry as unknown as ExerciseSuggestion,
    rpe,
    goal,
  );
  return {
    values,
    source,
    reason: entry.adjustment?.reason,
    safetyNote: entry.adjustment?.safety_note,
    baselineRpe: entry.baseline_rpe,
    generatedAt: entry.generated_at,
    dataBasis: entry.profile?.data_basis,
    est1rm: entry.profile?.est_1rm,
    anchorConfidence: entry.profile?.anchor_confidence,
    adjustmentActions: entry.adjustment?.actions,
  };
}

/** heuristic（predictMetrics）→ SuggestionValues 形状 */
function heuristicValues(
  name: string,
  type: string,
  rpe: number,
): Promise<ResolvedSuggestion> {
  return predictMetrics(name, type, rpe).then((m) => ({
    values: {
      ...(m.weight !== undefined && m.weight > 0 ? { weight: m.weight } : {}),
      ...(m.reps !== undefined ? { reps: Math.round(m.reps) } : {}),
      ...(m.duration !== undefined ? { duration_sec: Math.round(m.duration * 60) } : {}),
      ...(m.distance !== undefined ? { distance_m: Math.round(m.distance * 1000) } : {}),
    } as SuggestionValues,
    source: 'heuristic' as const,
  }));
}

export const SuggestionService = {
  /**
   * 解析单个动作在某 RPE 档的建议值（modal 防抖后调用）。
   * ① 缓存本地导出（含 stale —— 离线兜底）→ ② 拉取 → ③ 启发式。
   */
  async resolve(
    name: string,
    type: string,
    targetRpe: number,
    current?: SuggestionValues,
  ): Promise<ResolvedSuggestion> {
    const key = cacheKey(type, name);
    const cache = await loadCache();
    const entry = cache?.entries[key];

    if (entry && entryUsable(entry)) {
      return resolvedFromEntry(entry, 'cache', targetRpe, cache?.meta.goal);
    }

    try {
      const response = await fetchSuggestions([{ name, type, current }], targetRpe);
      const fresh = response.suggestions.find(
        (s) => cacheKey(s.exercise_type, s.exercise_name) === key,
      );
      if (!fresh) throw new Error('suggestion missing in response');
      const merged = await mergeIntoCache(response, cache);
      await saveCache(merged);
      this.notifyListeners();
      serverOnline = true;
      return resolvedFromEntry(
        fresh as unknown as SuggestionCacheEntry,
        fresh.source,
        targetRpe,
        merged.meta.goal,
      );
    } catch (e) {
      serverOnline = false;
      lastError = e instanceof Error ? e.message : String(e);
      console.warn('[SuggestionService] Fetch failed, falling back:', lastError);
      return heuristicValues(name, type, targetRpe);
    }
  },

  /**
   * 后台批量刷新（全部已缓存动作 —— 「连上后端后自动更新」的实现）。
   * 互斥；失败保留旧缓存。
   */
  async syncSuggestions(): Promise<void> {
    if (isSyncing) return;
    const cache = await loadCache();
    const refs: ExerciseRef[] = Object.values(cache?.entries ?? {}).map((entry) => ({
      name: entry.exercise_name,
      type: entry.exercise_type,
    }));
    if (refs.length === 0) return;

    isSyncing = true;
    try {
      let current = cache;
      for (let i = 0; i < refs.length; i += BATCH_SIZE) {
        const batch = refs.slice(i, i + BATCH_SIZE);
        const response = await fetchSuggestions(batch, 7);
        current = await mergeIntoCache(response, current);
      }
      if (current) await saveCache(current);
      serverOnline = true;
      lastError = undefined;
      this.notifyListeners();
    } catch (e) {
      serverOnline = false;
      lastError = e instanceof Error ? e.message : String(e);
      console.warn('[SuggestionService] Sync failed:', lastError);
    } finally {
      isSyncing = false;
    }
  },

  /** 失效（训练结束/登录/历史更新）：标脏 + 尝试在线刷新；离线时缓存照常可读 */
  async invalidate(): Promise<void> {
    const cache = await loadCache();
    if (!cache) return;
    if (!cache.meta.stale) {
      cache.meta.stale = true;
      await saveCache(cache);
      this.notifyListeners();
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      this.syncSuggestions();
    }
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  notifyListeners(): void {
    listeners.forEach((listener) => listener());
  },

  async getSyncStatus(): Promise<SuggestionSyncStatus> {
    const cache = await loadCache();
    return {
      hasCache: !!cache && Object.keys(cache.entries).length > 0,
      isSyncing,
      stale: !!cache?.meta.stale,
      lastSyncTime: cache?.meta.lastSyncTime ?? null,
      count: cache ? Object.keys(cache.entries).length : 0,
      serverOnline,
      ...(lastError ? { lastError } : {}),
    };
  },

  /** 手动强制刷新（Settings 状态卡按钮） */
  async forceRefresh(): Promise<void> {
    console.log('[SuggestionService] Force refresh requested');
    isSyncing = false;
    await this.syncSuggestions();
  },

  async clearCache(): Promise<void> {
    await storageSet(CACHE_KEY, null);
    this.notifyListeners();
  },

  /** App 启动挂载：online/可见性/定时/history-updated 触发后台刷新 */
  init(): void {
    if (typeof window === 'undefined') return;

    const trySync = async () => {
      if (!navigator.onLine) return;
      const healthy = await checkServerHealth(API_BASE, 1500).catch(() => null);
      serverOnline = !!healthy?.online;
      if (serverOnline) {
        await this.syncSuggestions();
      }
    };

    trySync();

    window.addEventListener('online', () => {
      console.log('[SuggestionService] Network online, syncing...');
      trySync();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      this.getSyncStatus().then((status) => {
        const age = status.lastSyncTime ? Date.now() - status.lastSyncTime : Infinity;
        if (status.stale || age > VISIBLE_RESYNC_MS) trySync();
      });
    });

    setInterval(trySync, SYNC_INTERVAL_MS);

    // 训练历史变化（WebSocketClient 广播）→ 锚点可能更新 → 失效重算
    window.addEventListener('history-updated', () => {
      console.log('[SuggestionService] History updated, invalidating suggestions');
      this.invalidate();
    });
  },
};
