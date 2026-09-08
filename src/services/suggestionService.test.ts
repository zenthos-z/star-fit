/**
 * Frontend SuggestionService tests（vitest, jsdom）。
 *
 * 三级链钉死：
 * - 缓存命中 → deriveSuggestion 本地导出（fetch 零调用）、换 RPE 数值变化
 * - miss → POST 拉取入缓存、source=服务端值、subscribe 通知
 * - fetch 失败 → predictMetrics 启发式降级（source=heuristic）
 * - 版本失配 / TTL 过期 → 缓存作废走网络
 * - syncSuggestions 批量 ≤20/批；invalidate 标脏但离线仍可读
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
      version: 1,
      lastSyncTime: Date.now(),
      goal: 'muscle_gain',
      count: Object.keys(entries).length,
      ...metaOverrides,
    },
  });
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

beforeEach(() => {
  memory.clear();
  fetchMock.mockReset();
  vi.clearAllMocks();
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
    fetchMock.mockRejectedValueOnce(new Error('backend down'));

    const r = await svc.resolve('硬拉', 'resistance', 8);

    expect(r.source).toBe('heuristic');
    expect(r.values.weight).toBe(40);
    expect(r.reason).toBeUndefined();
  });

  it('缓存版本失配 → 作废走网络', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { version: 99 });
    fetchMock.mockResolvedValueOnce(okResponse([seedEntry()]));

    await svc.resolve('杠铃卧推', 'resistance', 8);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期 → 作废走网络', async () => {
    const svc = await freshService();
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

describe('SuggestionService.syncSuggestions / invalidate', () => {
  function seedMany(n: number) {
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < n; i += 1) {
      entries[`resistance:动作${i}`] = seedEntry(`动作${i}`);
    }
    seedCache(entries);
  }

  it('批量刷新按 ≤20 分批；成功后更新 lastSyncTime 并清除 stale', async () => {
    const svc = await freshService();
    seedMany(45);
    fetchMock.mockImplementation(async () =>
      okResponse([seedEntry('批量结果', { generated_at: Date.now() })]),
    );

    await svc.syncSuggestions();

    expect(fetchMock.mock.calls.length).toBe(3); // 20 + 20 + 5
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body.exercises.length).toBeLessThanOrEqual(20);
    }
    const status = await svc.getSyncStatus();
    expect(status.count).toBeGreaterThan(0);
    expect(status.lastSyncTime).not.toBeNull();
    expect(status.serverOnline).toBe(true);
  });

  it('invalidate 标脏 + 在线时自动刷新；标脏后离线读取仍返回缓存值', async () => {
    const svc = await freshService();
    seedCache({ 'resistance:杠铃卧推': seedEntry() }, { stale: false });
    fetchMock.mockResolvedValue(okResponse([seedEntry()]));

    await svc.invalidate();
    await new Promise((r) => setTimeout(r, 0)); // 等后台 sync 收敛

    const status = await svc.getSyncStatus();
    expect(status.stale).toBe(false); // 刷新成功后清脏
    expect(fetchMock).toHaveBeenCalled();

    // 离线场景：直接读脏缓存仍有值
    const cache = memory.get(CACHE_KEY) as { meta: { stale?: boolean } };
    cache.meta.stale = true;
    memory.set(CACHE_KEY, cache);
    fetchMock.mockClear();
    fetchMock.mockRejectedValue(new Error('offline'));

    const r = await svc.resolve('杠铃卧推', 'resistance', 8);
    expect(r.source).toBe('cache');
    expect(r.values.weight).toBe(70);
  });

  it('sync 失败保留旧缓存并记录 lastError', async () => {
    const svc = await freshService();
    seedMany(1);
    fetchMock.mockRejectedValue(new Error('503'));

    await svc.syncSuggestions();

    const status = await svc.getSyncStatus();
    expect(status.hasCache).toBe(true);
    expect(status.serverOnline).toBe(false);
    expect(status.lastError).toContain('503');
  });

  it('空缓存 sync 不发请求', async () => {
    const svc = await freshService();
    await svc.syncSuggestions();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
