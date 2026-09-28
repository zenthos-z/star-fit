/**
 * Frontend SuggestionService tests（vitest, jsdom）。
 *
 * 三级链钉死：
 * - 缓存命中 → deriveFromEntry 本地导出（fetch 零调用）、换 RPE 数值变化
 * - miss → POST 拉取入缓存 + 异步触发对账、source=服务端值、subscribe 通知
 * - fetch 失败 → predictMetrics 启发式降级（source=heuristic）
 * - 版本失配 / TTL 过期 → 缓存作废走网络
 * B6 对账三分支（issue #39）：
 * - matched=true → 零渲染沿用本地（条目不动、不广播）
 * - matched=false → 全量并入 + 新指纹 + 广播；指纹更新链路（下次回传新指纹）
 * - 冷缓存 → 不带指纹直拉全量
 * 秒回（resolveSync）：镜像同步读与 resolve 同条目同导出链（两读点同源）；
 * plan_context.factor 降载保真（基线 RPE 处导出=缓存 values）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyAdjustment,
  computeBaseline,
  finalizeValues,
  type SuggestionValues,
} from 'shared/contracts';

// ---------------------------------------------------------------------------
// Mocks（hoisted）
// ---------------------------------------------------------------------------

const memory = new Map<string, unknown>();

vi.mock('@/storage', () => ({
  storageGet: vi.fn(async (key: string) => (memory.has(key) ? memory.get(key) : null)),
  storageSet: vi.fn(async (key: string, value: unknown) => {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }),
}));

vi.mock('./geminiService', () => ({
  API_BASE: 'http://test:43111/api',
  getHeaders: () => ({ 'X-User-Id': 'test', 'Content-Type': 'application/json' }),
  predictMetrics: vi.fn(async () => ({ weight: 40, reps: 10 })),
}));

vi.mock('../../services/serverDetector', () => ({
  checkServerHealth: vi.fn(async () => ({ online: true, latencyMs: 5 })),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CACHE_KEY = 'starfit_suggestion_cache';

function seedEntry(name = '杠铃卧推', overrides: Record<string, unknown> = {}) {
  return {
    exercise_name: name,
    exercise_type: 'resistance',
    baseline_rpe: 8,
    values: { weight: 70, reps: 10, set_count: 4 },
    profile: {
      exercise_name: name,
      exercise_type: 'resistance',
      data_basis: 'anchor',
      est_1rm: 100,
      modifiers: { injury_scale: 1, novice_cap: 1, recovery_scale: 1 },
    },
    adjustment: {
      exercise_name: name,
      actions: [{ field: 'weight', mode: 'multiply', value: 0.9 }],
      reason: '恢复偏弱',
    },
    source: 'hybrid',
    generated_at: Date.now(),
    context_fingerprint: 'aaaa',
    ...overrides,
  };
}

function seedCache(entries: Record<string, unknown>, metaOverrides: Record<string, unknown> = {}) {
  memory.set(CACHE_KEY, {
    entries,
    meta: {
      version: 2,
      lastSyncTime: Date.now(),
      goal: 'muscle_gain',
      count: Object.keys(entries).length,
      ...metaOverrides,
    },
  });
}

/** B6 对账 GET 响应桩（SuggestionCacheResponse 形状） */
function cacheOkResponse(data: {
  fingerprint: string;
  matched: boolean;
  suggestions: unknown[];
  baseline_rpe?: number;
}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      fingerprint: data.fingerprint,
      matched: data.matched,
      baseline_rpe: data.baseline_rpe ?? 7,
      agent_mode: 'off',
      generated_at: Date.now(),
      suggestions: data.suggestions,
    }),
  };
}

/** B6 服务端整批条目桩（CachedSuggestion = ExerciseSuggestion + plan_context） */
function seedCachedSuggestion(
  name: string,
  overrides: Record<string, unknown> = {},
  planContext: Record<string, unknown> | null = null,
) {
  const base = seedEntry(name, overrides);
  return planContext ? { ...base, plan_context: planContext } : base;
}

/** 前端 compose-derive 期望值（与服务层同序：baseline → factor → intent → finalize） */
function expectedDerive(
  entry: ReturnType<typeof seedEntry>,
  rpe: number,
  factor = 1,
  goal?: string,
): SuggestionValues {
  const baseline = computeBaseline(
    entry.profile as unknown as Parameters<typeof computeBaseline>[0],
    entry.exercise_type,
    rpe,
    goal,
  );
  const modulated = factor >= 1 ? baseline : {
    ...baseline,
    ...(baseline.weight !== undefined ? { weight: baseline.weight * factor } : {}),
    ...(baseline.duration_sec !== undefined ? { duration_sec: baseline.duration_sec * factor } : {}),
    ...(baseline.distance_m !== undefined ? { distance_m: baseline.distance_m * factor } : {}),
    ...(baseline.reps !== undefined ? { reps: Math.round(baseline.reps * factor) } : {}),
  };
  return finalizeValues(
    applyAdjustment(modulated, entry.adjustment as Parameters<typeof applyAdjustment>[1], {
      injuryLimited: (entry.profile as { modifiers: { injury_scale: number } }).modifiers.injury_scale < 1,
    }),
    entry.exercise_type,
  );
}

function okResponse(suggestions: unknown[], meta: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      suggestions,
      meta: { context_fingerprint: 'bbbb', agent_mode: 'off', ...meta },
    }),
  };
}

async function freshService() {
  const mod = await import('./suggestionService');
  return mod.SuggestionService;
}

beforeEach(async () => {
  memory.clear();
  fetchMock.mockReset();
  // restoreAllMocks：还原 spyOn 的 reconcileFromServer（模块级单例跨测试共享）
  vi.restoreAllMocks();
  const svc = await freshService();
  await svc.clearCache(); // 清内存镜像，隔离模块级状态
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SuggestionService.resolve 三级链', () => {
  it('缓存命中 → 本地 derive，fetch 零调用，reason/数据依据透传', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() });

    const r = await svc.resolve('杠铃卧推', 'resistance', 8);

    expect(r.source).toBe('cache');
    // est_1rm 100 × 77% × 0.9 = 69.3 → 2.5 网格 70（与后端单测同锚）
    expect(r.values.weight).toBe(70);
    expect(r.values.reps).toBe(10);
    expect(r.reason).toBe('恢复偏弱');
    expect(r.dataBasis).toBe('anchor');
    expect(r.est1rm).toBe(100);
    expect(r.adjustmentActions).toEqual([{ field: 'weight', mode: 'multiply', value: 0.9 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('换 RPE 本地导出新数值（单调），仍零请求', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() });

    const r8 = await svc.resolve('杠铃卧推', 'resistance', 8);
    const r9 = await svc.resolve('杠铃卧推', 'resistance', 9);

    expect((r9.values.weight ?? 0)).toBeGreaterThan(r8.values.weight ?? 0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('缓存 miss → POST 拉取、入缓存、source=服务端值、通知订阅者', async () => {
    const svc = await freshService();
    vi.spyOn(svc, 'reconcileFromServer').mockResolvedValue(undefined); // miss 触发的对账另测
    const serverEntry = seedEntry('深蹲', { exercise_type: 'resistance', values: { weight: 100 } });
    serverEntry.profile.exercise_type = 'resistance';
    fetchMock.mockResolvedValueOnce(okResponse([serverEntry]));

    const notified = vi.fn();
    svc.subscribe(notified);

    const r = await svc.resolve('深蹲', 'resistance', 8);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://test:43111/api/suggestions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.exercises[0].name).toBe('深蹲');
    expect(body.target_rpe).toBe(8);

    expect(r.source).toBe('hybrid');
    expect(notified).toHaveBeenCalled();
    const stored = (memory.get(CACHE_KEY) as { entries: Record<string, unknown> });
    expect(stored.entries['resistance:深蹲']).toBeTruthy();
  });

  it('fetch 失败 → predictMetrics 启发式降级 source=heuristic', async () => {
    const svc = await freshService();
    vi.spyOn(svc, 'reconcileFromServer').mockResolvedValue(undefined);
    fetchMock.mockRejectedValueOnce(new Error('backend down'));

    const r = await svc.resolve('硬拉', 'resistance', 8);

    expect(r.source).toBe('heuristic');
    expect(r.values.weight).toBe(40);
    expect(r.reason).toBeUndefined();
  });

  it('缓存版本失配 → 作废走网络', async () => {
    const svc = await freshService();
    vi.spyOn(svc, 'reconcileFromServer').mockResolvedValue(undefined);
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { version: 99 });
    fetchMock.mockResolvedValueOnce(okResponse([seedEntry()]));

    await svc.resolve('杠铃卧推', 'resistance', 8);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期 → 作废走网络', async () => {
    const svc = await freshService();
    vi.spyOn(svc, 'reconcileFromServer').mockResolvedValue(undefined);
    const expired = seedEntry();
    expired.generated_at = Date.now() - 25 * 60 * 60 * 1000; // 25h 前
    seedCache({ 'resistance:杠铃卧推': expired });
    fetchMock.mockResolvedValueOnce(okResponse([seedEntry()]));

    await svc.resolve('杠铃卧推', 'resistance', 8);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('类型词表归一化：weight_only 与 heavy_weight 同键', async () => {
    const svc = await freshService();
    const entry = seedEntry('硬拉', { exercise_type: 'heavy_weight' });
    seedCache({ 'heavy_weight:硬拉': entry });

    const r = await svc.resolve('硬拉', 'weight_only', 8);

    expect(r.source).toBe('cache');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SuggestionService.reconcileFromServer 对账三分支（B6）', () => {
  it('分支① matched=true → 零渲染沿用本地：条目不动、不广播，仅刷新同步时间', async () => {
    const svc = await freshService();
    const local = seedEntry();
    seedCache({ 'resistance:杠铃卧推': local }, { contextFingerprint: 'fp-local-1' });
    // 服务端声称匹配，但 suggestions 若被误用会换成不同数值 —— 以此断言条目未动
    fetchMock.mockResolvedValueOnce(
      cacheOkResponse({
        fingerprint: 'fp-local-1',
        matched: true,
        suggestions: [seedCachedSuggestion('杠铃卧推', { values: { weight: 1, reps: 1 } }, { factor: 1, prior_same_muscle_exercises: 0, today_planned_sets: 0 })],
      }),
    );
    const notified = vi.fn();
    svc.subscribe(notified);

    await svc.reconcileFromServer();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://test:43111/api/suggestions/cache?fingerprint=fp-local-1',
    );
    const stored = memory.get(CACHE_KEY) as {
      entries: Record<string, { values: { weight: number } }>;
      meta: { contextFingerprint: string; lastSyncTime: number; stale?: boolean };
    };
    expect(stored.entries['resistance:杠铃卧推'].values.weight).toBe(70); // 沿用本地
    expect(stored.meta.contextFingerprint).toBe('fp-local-1');
    expect(stored.meta.stale).toBe(false);
    expect(notified).not.toHaveBeenCalled(); // 零渲染
  });

  it('分支② matched=false → 静默全量并入 + 换新指纹 + 广播；plan_context 保真', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { contextFingerprint: 'old-fp', stale: true });
    const serverEntry = seedCachedSuggestion(
      '杠铃卧推',
      { values: { weight: 55, reps: 8, set_count: 4 } },
      { factor: 0.8, prior_same_muscle_exercises: 2, muscle: '胸', today_planned_sets: 12 },
    );
    fetchMock.mockResolvedValueOnce(
      cacheOkResponse({ fingerprint: 'new-fp', matched: false, suggestions: [serverEntry] }),
    );
    const notified = vi.fn();
    svc.subscribe(notified);

    await svc.reconcileFromServer();

    const stored = memory.get(CACHE_KEY) as {
      entries: Record<string, { values: { weight: number }; plan_context?: { factor: number } }>;
      meta: { contextFingerprint: string; baselineRpe?: number; stale?: boolean; count: number };
    };
    expect(stored.entries['resistance:杠铃卧推'].values.weight).toBe(55);
    expect(stored.entries['resistance:杠铃卧推'].plan_context?.factor).toBe(0.8);
    expect(stored.meta.contextFingerprint).toBe('new-fp');
    expect(stored.meta.baselineRpe).toBe(7);
    expect(stored.meta.stale).toBe(false);
    expect(stored.meta.count).toBe(1);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('分支③ 冷缓存 → 不带指纹直拉全量并落缓存', async () => {
    const svc = await freshService();
    const serverEntry = seedCachedSuggestion(
      '硬拉',
      { exercise_type: 'resistance' },
      { factor: 1, prior_same_muscle_exercises: 0, today_planned_sets: 0 },
    );
    fetchMock.mockResolvedValueOnce(
      cacheOkResponse({ fingerprint: 'cold-fp', matched: false, suggestions: [serverEntry] }),
    );

    await svc.reconcileFromServer();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('http://test:43111/api/suggestions/cache'); // 无 fingerprint 参数
    const stored = memory.get(CACHE_KEY) as { entries: Record<string, unknown>; meta: { contextFingerprint: string } };
    expect(stored.entries['resistance:硬拉']).toBeTruthy();
    expect(stored.meta.contextFingerprint).toBe('cold-fp');
  });

  it('指纹更新链路：不匹配拉取后，下次对账回传新指纹', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { contextFingerprint: 'old-fp' });
    fetchMock
      .mockResolvedValueOnce(
        cacheOkResponse({
          fingerprint: 'new-fp',
          matched: false,
          suggestions: [seedCachedSuggestion('杠铃卧推', {}, { factor: 1, prior_same_muscle_exercises: 0, today_planned_sets: 0 })],
        }),
      )
      .mockResolvedValueOnce(
        cacheOkResponse({ fingerprint: 'new-fp', matched: true, suggestions: [] }),
      );

    await svc.reconcileFromServer();
    await svc.reconcileFromServer();

    expect((fetchMock.mock.calls[1][0] as string)).toContain('fingerprint=new-fp');
  });

  it('对账失败保留旧缓存并记录 lastError（AI 隐形，无 UI 副作用）', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { contextFingerprint: 'fp-keep' });
    fetchMock.mockRejectedValue(new Error('503'));

    await svc.reconcileFromServer();

    const stored = memory.get(CACHE_KEY) as { meta: { contextFingerprint: string } };
    expect(stored.meta.contextFingerprint).toBe('fp-keep');
    const status = await svc.getSyncStatus();
    expect(status.serverOnline).toBe(false);
    expect(status.lastError).toContain('503');
  });

  it('响应契约违例（缺 fingerprint）→ 拒绝入库并记日志', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { contextFingerprint: 'fp-keep' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ matched: false, baseline_rpe: 7, suggestions: [] }),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await svc.reconcileFromServer();

    expect(errSpy).toHaveBeenCalled(); // 契约红线：Zod 失败必须记录日志
    const stored = memory.get(CACHE_KEY) as { meta: { contextFingerprint: string } };
    expect(stored.meta.contextFingerprint).toBe('fp-keep'); // 坏响应不落库
    errSpy.mockRestore();
  });

  it('离线（navigator.onLine=false）→ 不发请求直接返回', async () => {
    const svc = await freshService();
    // jsdom 的 onLine 挂在原型上（own descriptor 为 undefined），用完显式复位 true
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    try {
      await svc.reconcileFromServer();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    }
  });
});

describe('SuggestionService.invalidate（B6 对账化）', () => {
  it('标脏 + 在线时走对账刷新，成功后清脏', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { stale: false, contextFingerprint: 'old-fp' });
    fetchMock.mockResolvedValue(
      cacheOkResponse({
        fingerprint: 'refreshed-fp',
        matched: false,
        suggestions: [seedCachedSuggestion('杠铃卧推', {}, { factor: 1, prior_same_muscle_exercises: 0, today_planned_sets: 0 })],
      }),
    );

    await svc.invalidate();
    await new Promise((r) => setTimeout(r, 0)); // 等 invalidate 内部 fire-and-forget 对账收敛

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/suggestions/cache?fingerprint=old-fp');
    const status = await svc.getSyncStatus();
    expect(status.stale).toBe(false); // 对账成功后清脏
  });

  it('标脏后离线读取仍返回缓存值', async () => {
    const svc = await freshService();
    vi.spyOn(svc, 'reconcileFromServer').mockResolvedValue(undefined);
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { stale: true });

    const r = await svc.resolve('杠铃卧推', 'resistance', 8);
    expect(r.source).toBe('cache');
    expect(r.values.weight).toBe(70);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SuggestionService.resolveSync 秒回与两读点同源（B6）', () => {
  it('镜像命中：同步读出与 resolve 同值（两读点同源），fetch 零调用', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() });
    await svc.warmCache();

    const synced = svc.resolveSync('杠铃卧推', 'resistance', 8);
    const asynced = await svc.resolve('杠铃卧推', 'resistance', 8);

    expect(synced).not.toBeNull();
    expect(synced!.source).toBe('cache');
    expect(synced!.values).toEqual(asynced.values);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('镜像未预热 / 条目缺失 → 返回 null（调用方回退异步链）', async () => {
    const svc = await freshService();
    expect(svc.resolveSync('杠铃卧推', 'resistance', 8)).toBeNull(); // 未预热

    seedCache({ 'resistance:杠铃卧推': seedEntry() });
    await svc.warmCache();
    expect(svc.resolveSync('深蹲', 'resistance', 8)).toBeNull(); // 条目缺失
  });

  it('版本失配（v1 旧缓存）→ warmCache 弃旧，resolveSync 返回 null', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { version: 1 });
    await svc.warmCache();

    expect(svc.resolveSync('杠铃卧推', 'resistance', 8)).toBeNull();
  });

  it('plan_context.factor 降载保真：基线 RPE 处导出值 = 缓存服务端 values', async () => {
    const svc = await freshService();
    const factor = 0.8;
    const entry = seedEntry();
    // 服务端生成序：baseline(baseline_rpe) → ×factor → intent → finalize
    const serverValues = expectedDerive(entry, entry.baseline_rpe as number, factor);
    seedCache({
      'resistance:杠铃卧推': {
        ...entry,
        values: serverValues,
        plan_context: { factor, prior_same_muscle_exercises: 2, muscle: '胸', today_planned_sets: 12 },
      },
    });
    await svc.warmCache();

    const atBaseline = svc.resolveSync('杠铃卧推', 'resistance', entry.baseline_rpe as number);
    expect(atBaseline!.values).toEqual(serverValues); // 导出与缓存值逐字段一致（同源闭环）

    // 非 baseline RPE：单调且与服务端同序导出一致
    const atNine = svc.resolveSync('杠铃卧推', 'resistance', 9);
    expect(atNine!.values).toEqual(expectedDerive(entry, 9, factor));
    expect(atNine!.values.weight ?? 0).toBeGreaterThan(atBaseline!.values.weight ?? 0);
  });
});
