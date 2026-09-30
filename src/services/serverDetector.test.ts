/**
 * serverDetector 多后端命中收集回归（issue #84）
 *
 * 背景：detectServer 原为「命中即返回第一台」，多台 starfit 后端共存时
 * 赌运气。改为 detectServers 收集扫描窗口内全部响应者（地址+延迟+version），
 * 上游登录页按命中数分流：零命中手输 / 单命中自动连 / 多命中列列表。
 *
 * 覆盖：
 * - 双命中 → 全部返回（供登录页列出选择）
 * - 单命中 → 唯一返回（上游自动连接）
 * - 零命中 → 空数组（上游停留手动输入路径）
 * - 延迟最优排前；version 自 /health 响应带出
 * - Phase 0 已知地址直查命中 → 单元素列表（现状保持）
 * - checkServerHealth exact 识别 + 版本捕获语义不变
 *
 * 环境口径：jsdom 无 RTCPeerConnection → 本机 IP 探测降级 null →
 * 网段回退 192.168.1；fetch 全局 stub 按 URL 路由模拟响应者。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { loadServerHistoryMock } = vi.hoisted(() => ({
  loadServerHistoryMock: vi.fn(),
}));

vi.mock('@/storage', () => ({
  loadServerHistory: loadServerHistoryMock,
  addServerToHistory: vi.fn(async () => {}),
}));

import { detectServers, detectServer, checkServerHealth } from './serverDetector';

const fetchMock = vi.fn();

/** /health 的 starfit 标准响应体（仅用到 status + json，无需真实 Response） */
const okRes = (version = '2.0.0') => ({
  status: 200,
  json: async () => ({ ok: true, app: 'starfit', version, ts: 1 }),
});

/** 只让指定 IP 的 /health 返回 starfit 命中，其余全部不可达 */
const onlineAt = (...ips: string[]) => {
  fetchMock.mockImplementation(async (url: string) => {
    const m = url.match(/^http:\/\/(\d+\.\d+\.\d+\.\d+):\d+\/health$/);
    if (m && ips.includes(m[1])) return okRes();
    throw new TypeError('Failed to fetch');
  });
};

beforeEach(() => {
  localStorage.clear();
  loadServerHistoryMock.mockReset();
  loadServerHistoryMock.mockResolvedValue([]);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectServers · 多后端命中收集（#84）', () => {
  it('双命中：返回窗口内全部响应者（含延迟与版本），上游列出选择', async () => {
    onlineAt('192.168.1.100', '192.168.1.7');

    const hits = await detectServers();

    expect(hits).toHaveLength(2);
    expect(hits.map(h => h.url).sort()).toEqual([
      'http://192.168.1.100:43111/api',
      'http://192.168.1.7:43111/api',
    ]);
    for (const h of hits) {
      expect(h.source).toBe('scan');
      expect(h.version).toBe('2.0.0');
      expect(typeof h.latency).toBe('number');
    }
  });

  it('单命中：返回唯一响应者，上游自动连接', async () => {
    onlineAt('192.168.1.100');

    const hits = await detectServers();

    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('http://192.168.1.100:43111/api');
    expect(hits[0].version).toBe('2.0.0');
  });

  it('零命中：返回空数组，上游停留手动输入路径', async () => {
    const hits = await detectServers();
    expect(hits).toEqual([]);
  });

  it('延迟最优排前：慢响应者排在快响应者之后', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'http://192.168.1.200:43111/health') {
        await new Promise(r => setTimeout(r, 30));
        return okRes();
      }
      if (url === 'http://192.168.1.100:43111/health') return okRes();
      throw new TypeError('Failed to fetch');
    });

    const hits = await detectServers();

    expect(hits).toHaveLength(2);
    expect(hits[0].url).toBe('http://192.168.1.100:43111/api');
    expect(hits[1].url).toBe('http://192.168.1.200:43111/api');
  });

  it('Phase 0 已知地址直查命中：返回单元素列表（现状保持）', async () => {
    loadServerHistoryMock.mockResolvedValue([
      { url: 'http://192.168.1.100:43111/api', lastConnected: 1, successCount: 1 },
    ]);
    onlineAt('192.168.1.100', '192.168.1.7');

    const hits = await detectServers();

    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('history');
    expect(hits[0].url).toBe('http://192.168.1.100:43111/api');
  });

  it('detectServer 兼容封装：返回首个（延迟最优）命中', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'http://192.168.1.101:43111/health') {
        await new Promise(r => setTimeout(r, 20));
        return okRes();
      }
      if (url === 'http://192.168.1.100:43111/health') return okRes();
      throw new TypeError('Failed to fetch');
    });

    const first = await detectServer();

    expect(first?.url).toBe('http://192.168.1.100:43111/api');
  });
});

describe('checkServerHealth · exact 识别与版本捕获', () => {
  it('exact：非 starfit 响应不命中，starfit 响应带出 version', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, app: 'other-service', version: '9.9.9' }),
    });
    const reject = await checkServerHealth('http://10.0.0.5:43111/api', 1000, true);
    expect(reject.ok).toBe(false);

    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, app: 'starfit', version: '2.1.0' }),
    });
    const hit = await checkServerHealth('http://10.0.0.5:43111/api', 1000, true);
    expect(hit.ok).toBe(true);
    expect(hit.version).toBe('2.1.0');
  });

  it('exact：非 JSON 响应不命中（语义不变）', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => { throw new Error('invalid json'); },
    });
    const result = await checkServerHealth('http://10.0.0.5:43111/api', 1000, true);
    expect(result.ok).toBe(false);
  });

  it('非 exact：非 JSON 响应仍算在线，version 缺省（直查放宽语义不变）', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => { throw new Error('invalid json'); },
    });
    const result = await checkServerHealth('http://10.0.0.5:43111/api', 1000);
    expect(result.ok).toBe(true);
    expect(result.version).toBeUndefined();
  });
});
