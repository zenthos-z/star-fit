/**
 * serverDetector 多后端命中收集回归（issue #84）
 *
 * 背景：detectServer 原为「命中即返回第一台」，多台 starfit 后端共存时
 * 赌运气。改为 detectServers 收集扫描窗口内全部响应者（地址+延迟+version），
 * 2026-10 再调整：Phase 0 已知地址命中不再短路——继续全网扫描后合并去重，
 * 局域网地址排前、其后公网/隧道；上游登录页任何命中都弹列表由用户点选。
 *
 * 覆盖：
 * - 双命中 → 全部返回（供登录页列出选择）
 * - 单命中 → 唯一返回（上游同样弹列表）
 * - 零命中 → 空数组（上游停留手动输入路径）
 * - 延迟最优排前；version 自 /health 响应带出
 * - Phase 0 命中 + 全网扫描另有多台 → 合并去重，局域网排在公网前
 * - isLanUrl 私网/公网判定（列表标签与排序共用）
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

import { detectServers, detectServer, checkServerHealth, isLanUrl } from './serverDetector';

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

  it('单命中：返回唯一响应者（上游同样弹列表，不自动连接）', async () => {
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

  it('Phase 0 命中 + 全网扫描另有多台：合并去重（同 url 留一条，Phase 0 来源优先）', async () => {
    loadServerHistoryMock.mockResolvedValue([
      { url: 'http://192.168.1.100:43111/api', lastConnected: 1, successCount: 1 },
    ]);
    // 原始命中 3 次（.100 被 Phase 0 与扫描重复命中）→ 合并后只留 2 条
    onlineAt('192.168.1.100', '192.168.1.7');

    const hits = await detectServers();

    expect(hits).toHaveLength(2);
    const byUrl = new Map(hits.map(h => [h.url, h]));
    // 同 url 去重：.100 保留 Phase 0 更具体的 history 来源
    expect(byUrl.get('http://192.168.1.100:43111/api')?.source).toBe('history');
    expect(byUrl.get('http://192.168.1.7:43111/api')?.source).toBe('scan');
    expect(hits.every(h => typeof h.latency === 'number')).toBe(true);
  });

  it('局域网地址排在公网/隧道地址之前（同组内才比延迟）', async () => {
    // 历史里只有公网隧道 → Phase 0 快速命中公网；全网扫描再发现局域网直连
    loadServerHistoryMock.mockResolvedValue([
      { url: 'http://8.138.169.218:19902/api', lastConnected: 1, successCount: 1 },
    ]);
    onlineAt('8.138.169.218', '192.168.1.7');

    const hits = await detectServers();

    expect(hits.map(h => h.url)).toEqual([
      'http://192.168.1.7:43111/api',   // 局域网在前（即便公网先命中且延迟更低）
      'http://8.138.169.218:19902/api', // 公网/隧道在后
    ]);
    expect(hits[0].source).toBe('scan');
    expect(hits[1].source).toBe('history');
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

describe('isLanUrl · 私网/公网判定（列表标签 + detectServers 排序共用）', () => {
  it('RFC1918 私网段与回环地址 → 局域网', () => {
    expect(isLanUrl('http://192.168.31.247:43111/api')).toBe(true);
    expect(isLanUrl('http://192.168.1.7:43111/api')).toBe(true);
    expect(isLanUrl('http://10.0.0.5:43111/api')).toBe(true);
    expect(isLanUrl('http://172.16.0.1:43111/api')).toBe(true);
    expect(isLanUrl('http://172.31.255.254:43111/api')).toBe(true);
    expect(isLanUrl('http://localhost:43111/api')).toBe(true);
    expect(isLanUrl('http://127.0.0.1:43111/api')).toBe(true);
  });

  it('公网 IP / 公网域名 / 172.16/12 之外 / 非法串 → 公网', () => {
    expect(isLanUrl('http://8.138.169.218:19902/api')).toBe(false);
    expect(isLanUrl('http://172.32.0.1:43111/api')).toBe(false); // 172.16/12 段外
    expect(isLanUrl('http://172.15.0.1:43111/api')).toBe(false);
    expect(isLanUrl('http://192.169.1.1:43111/api')).toBe(false); // 192.169 ≠ 192.168
    expect(isLanUrl('https://starfit.example.com/api')).toBe(false);
    expect(isLanUrl('not a url')).toBe(false);
  });
});
