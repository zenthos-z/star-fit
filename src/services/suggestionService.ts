/**
 * SuggestionService（前端）- 动作建议值三级链 + 对账缓存 + 秒回同步读
 *
 * 模式照 exerciseLibraryService：缓存优先 + 互斥 sync + subscribe 通知。
 * 三级链（resolve，异步）：
 *   ① 缓存命中（版本+TTL 通过）→ deriveFromEntry 本地确定性导出（换 RPE 零请求）
 *   ② miss → POST /api/suggestions（批量 ≤20）+ 异步触发对账
 *   ③ 后端不可达 → predictMetrics 本地启发式（来源标 heuristic）
 *
 * B6 对账通道（issue #39，reconcileFromServer）：
 *   开 App/前台恢复/online/定时 → GET /api/suggestions/cache?fingerprint=本地指纹
 *   ① matched=true → 零渲染沿用本地（仅刷新同步时间，不广播）
 *   ② matched=false → 静默全量并入 + 换新指纹（用户无感知，AI 隐形）
 *   ③ 冷缓存 → 不带指纹直拉全量
 * 取代旧「POST 硬编码 RPE7 批量刷新」——两读点（应用建议/购物车预填）
 * 同源同一份对账缓存，不一致根除。
 *
 * 秒回通道（resolveSync）：内存镜像同步读出，命中零等待上屏；
 * miss 返回 null，调用方回退 resolve 异步链（对账已在服务层自动触发）。
 *
 * 失效通道：window 'history-updated' / invalidate()（训练结束、登录）
 * 标脏 + 在线时对账刷新；TTL 24h 兜底。
 */

import { API_BASE, getHeaders, predictMetrics } from './geminiService';
import { storageGet, storageSet } from '@/storage';
import { Keys, type SuggestionCache, type SuggestionCacheEntry } from '@/storage/schemas';
import { checkServerHealth } from '@/services/serverDetector';
import {
  applyAdjustment,
  computeBaseline,
  finalizeValues,
  normalizeSuggestionExerciseType,
  SuggestionCacheResponseSchema,
  type SuggestionCacheResponse,
  type SuggestionResponse,
  type SuggestionValues,
} from 'shared/contracts';

const CACHE_KEY = Keys.suggestionCache;
// B6：条目新增 plan_context + 对账全量并入语义 → schema 变更弃 v1 旧缓存
const CACHE_VERSION = 2;
const TTL_MS = 24 * 60 * 60 * 1000;
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
/** 上次成功同步时间早于该阈值且页面重新可见 → 前台恢复对账 */
const VISIBLE_RESYNC_MS = 10 * 60 * 1000;
/** miss 触发对账的节流窗口（防连续添加动作时反复整批拉取） */
const MISS_RECONCILE_THROTTLE_MS = 60 * 1000;

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
const listeners: Set<() => void> = new Set();
/** B6 秒回内存镜像：与存储同写同载，resolveSync 零异步读的前提 */
let memoryCache: SuggestionCache | null = null;
/** 上次 miss 触发对账的时间戳（节流） */
let lastMissReconcileAt = 0;

// ---------------------------------------------------------------------------
// 缓存读写
// ---------------------------------------------------------------------------

function cacheKey(type: string, name: string): string {
  return `${normalizeSuggestionExerciseType(type)}:${name}`;
}

async function loadCache(): Promise<SuggestionCache | null> {
  try {
    const cache = await storageGet<SuggestionCache>(CACHE_KEY);
    if (!cache || !cache.meta || cache.meta.version !== CACHE_VERSION) {
      memoryCache = null;
      return null;
    }
    if (!cache.entries || typeof cache.entries !== 'object') {
      memoryCache = null;
      return null;
    }
    memoryCache = cache;
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
  memoryCache = cache; // 镜像先行：同步读不等存储落盘
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

/** 服务端响应并入缓存（新条目覆盖同键旧值；POST 单拉通道用） */
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

/**
 * B6 对账响应并入缓存：新指纹全量条目按键覆盖（后端整批只覆盖动作库全集，
 * 用户自建动作的 POST 条目保留），meta 换新指纹并解除脏标。
 */
function mergeCacheResponseIntoCache(
  data: SuggestionCacheResponse,
  previous: SuggestionCache | null,
): SuggestionCache {
  const entries = { ...(previous?.entries ?? {}) };
  for (const s of data.suggestions) {
    entries[cacheKey(s.exercise_type, s.exercise_name)] = s as unknown as SuggestionCacheEntry;
  }
  return {
    entries,
    meta: {
      version: CACHE_VERSION,
      lastSyncTime: Date.now(),
      contextFingerprint: data.fingerprint,
      baselineRpe: data.baseline_rpe,
      goal: previous?.meta.goal,
      count: Object.keys(entries).length,
      stale: false,
    },
  };
}

// ---------------------------------------------------------------------------
// 三级链
// ---------------------------------------------------------------------------

/**
 * B6：缓存条目 → 任意 RPE 建议值。与后端缓存生成同序组合：
 * computeBaseline → 计划上下文降载（plan_context.factor）→ Agent 意图重放 →
 * finalizeValues。条目无 plan_context（POST 通道/旧数据）时 factor=1，
 * 与 deriveSuggestion 完全等价；基线 RPE 处导出值与缓存 values 逐字段一致。
 */
function deriveFromEntry(entry: SuggestionCacheEntry, rpe: number, goal?: string): SuggestionValues {
  const baseline = computeBaseline(
    entry.profile as unknown as Parameters<typeof computeBaseline>[0],
    entry.exercise_type,
    rpe,
    goal,
  );
  const factor = entry.plan_context?.factor ?? 1;
  const modulated = applyPlanContextFactorLocal(baseline, factor);
  // storage 层放宽了 intent 字段类型（field/mode 为 string），这里收敛回契约联合
  const adjusted = applyAdjustment(
    modulated,
    entry.adjustment as unknown as Parameters<typeof applyAdjustment>[1],
    { injuryLimited: entry.profile.modifiers.injury_scale < 1 },
  );
  return finalizeValues(adjusted, entry.exercise_type);
}

/** 计划上下文降载的前端镜像（与后端 applyPlanContextFactor 同义）：
    ≥1 直通；负重/时长/距离乘系数，reps 缩放取整，set_count/target_rpe 不动。 */
function applyPlanContextFactorLocal(values: SuggestionValues, factor: number): SuggestionValues {
  if (factor >= 1) return values;
  const out: SuggestionValues = { ...values };
  if (out.weight !== undefined) out.weight = out.weight * factor;
  if (out.duration_sec !== undefined) out.duration_sec = out.duration_sec * factor;
  if (out.distance_m !== undefined) out.distance_m = out.distance_m * factor;
  if (out.reps !== undefined) out.reps = Math.round(out.reps * factor);
  return out;
}

function resolvedFromEntry(
  entry: SuggestionCacheEntry,
  source: SuggestionSource,
  rpe: number,
  goal?: string,
): ResolvedSuggestion {
  const values = deriveFromEntry(entry, rpe, goal);
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
   * ① 缓存本地导出（含 stale —— 离线兜底）→ ② 拉取 + 异步对账 → ③ 启发式。
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

    // B6：真 miss（本地无可用条目）→ 异步触发整批对账（互斥+节流，AI 隐形），
    // 不阻塞下方回退计算
    scheduleReconcileAfterMiss();

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
   * B6 秒回：从内存镜像同步读出（零网络/零异步）。命中 = 与 resolve 同一条目
   * 同一导出链（两读点同源）；miss 返回 null，调用方回退 resolve 异步链。
   * 前提：warmCache() 已装载镜像（App 启动时 init 调用）。
   */
  resolveSync(name: string, type: string, targetRpe: number): ResolvedSuggestion | null {
    const key = cacheKey(type, name);
    const entry = memoryCache?.entries[key];
    if (!entry || !entryUsable(entry)) return null;
    return resolvedFromEntry(entry, 'cache', targetRpe, memoryCache?.meta.goal);
  },

  /** B6：预热内存镜像（resolveSync 同步读的前提；App 启动与测试种子后调用） */
  async warmCache(): Promise<void> {
    await loadCache();
  },

  /**
   * B6 对账（issue #39）：GET /api/suggestions/cache?fingerprint=本地指纹
   * ① matched=true → 零渲染沿用本地（仅刷新同步时间/清脏，不动条目不广播）
   * ② matched=false → 静默全量并入 + 换新指纹（用户无感知）
   * ③ 冷缓存（无本地指纹）→ 不带指纹直拉全量
   * 互斥；失败仅记日志（AI 隐形：无 UI 提示），旧缓存照常可读。
   */
  async reconcileFromServer(): Promise<void> {
    if (isSyncing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    isSyncing = true;
    try {
      const cache = await loadCache();
      const localFp = cache?.meta.contextFingerprint;
      const url = `${API_BASE}/suggestions/cache${
        localFp ? `?fingerprint=${encodeURIComponent(localFp)}` : ''
      }`;
      const res = await fetch(url, { method: 'GET', headers: getHeaders() });
      if (!res.ok) {
        throw new Error(`suggestions/cache HTTP ${res.status}`);
      }
      const parsed = SuggestionCacheResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        // 契约红线：Zod 验证失败必须记录日志
        console.error('[SuggestionService] cache response schema mismatch:', parsed.error.message);
        throw new Error('suggestions/cache malformed response');
      }
      const data = parsed.data;
      serverOnline = true;
      lastError = undefined;

      if (data.matched && cache) {
        // 分支①匹配：零渲染沿用本地 —— 条目未变，不广播不重渲染
        await saveCache({
          ...cache,
          meta: { ...cache.meta, version: CACHE_VERSION, lastSyncTime: Date.now(), stale: false },
        });
        return;
      }
      // 分支②不匹配 / 分支③冷缓存：全量并入 + 换新指纹，广播刷新读点
      await saveCache(mergeCacheResponseIntoCache(data, cache));
      this.notifyListeners();
    } catch (e) {
      serverOnline = false;
      lastError = e instanceof Error ? e.message : String(e);
      console.warn('[SuggestionService] Reconcile failed:', lastError);
    } finally {
      isSyncing = false;
    }
  },

  /** 失效（训练结束/登录/历史更新）：标脏 + 在线时对账刷新；离线时缓存照常可读 */
  async invalidate(): Promise<void> {
    const cache = await loadCache();
    if (!cache) return;
    if (!cache.meta.stale) {
      cache.meta.stale = true;
      await saveCache(cache);
      this.notifyListeners();
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      this.reconcileFromServer();
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

  /** 手动强制刷新（Settings 状态卡按钮）→ 对账 */
  async forceRefresh(): Promise<void> {
    console.log('[SuggestionService] Force refresh requested');
    isSyncing = false; // 卡死互斥逃逸（保留旧行为）
    await this.reconcileFromServer();
  },

  async clearCache(): Promise<void> {
    memoryCache = null;
    await storageSet(CACHE_KEY, null);
    this.notifyListeners();
  },

  /**
   * App 启动挂载（B6）：预热内存镜像 + 开 App 对账；
   * online/前台恢复（可见性）/定时/history-updated 触发对账。
   */
  init(): void {
    if (typeof window === 'undefined') return;

    const tryReconcile = async () => {
      if (!navigator.onLine) return;
      const healthy = await checkServerHealth(API_BASE, 1500).catch(() => null);
      serverOnline = !!healthy?.online;
      if (serverOnline) {
        await this.reconcileFromServer();
      }
    };

    void this.warmCache(); // 秒回镜像预热（resolveSync 前提）
    void tryReconcile(); // 开 App 对账：匹配零渲染沿用 / 不匹配静默全量

    window.addEventListener('online', () => {
      console.log('[SuggestionService] Network online, reconciling...');
      void tryReconcile();
    });

    // 前台恢复：Capacitor 回前台 = visibilitychange → visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      this.getSyncStatus().then((status) => {
        const age = status.lastSyncTime ? Date.now() - status.lastSyncTime : Infinity;
        if (status.stale || age > VISIBLE_RESYNC_MS) void tryReconcile();
      });
    });

    setInterval(() => { void tryReconcile(); }, SYNC_INTERVAL_MS);

    // 训练历史变化（WebSocketClient 广播）→ 锚点可能更新 → 失效对账
    window.addEventListener('history-updated', () => {
      console.log('[SuggestionService] History updated, invalidating suggestions');
      this.invalidate();
    });
  },
};

/**
 * B6：缓存 miss 后的异步对账触发（互斥 + 60s 节流）——回退计算照常先行，
 * 对账在后台静默补齐整批。
 */
function scheduleReconcileAfterMiss(): void {
  const now = Date.now();
  if (now - lastMissReconcileAt < MISS_RECONCILE_THROTTLE_MS) return;
  lastMissReconcileAt = now;
  void SuggestionService.reconcileFromServer();
}
