/**
 * #108 机制一：401 全局拦截 → 半自动登出
 *
 * 覆盖验收场景：
 * - 登录态下命中服务器的 401 → 清凭据（镜像清空 + 登出墓碑 + 令牌清除）
 *   且用户数据保留（history/计划/会话草稿不动）→ 触发一次回登录页跳转
 * - 401 风暴（3 个并发请求全 401）→ 只登出一次（模块级 flag）
 * - 未登录态（登录页自身请求）401 → 不触发登出
 * - 非目标服务器的 401 → 不触发登出
 *
 * 环境口径：jsdom 无 indexedDB → storage 走 localStorage 降级路径，
 * 凭据与用户数据断言直接读 localStorage；fetch 全局 stub（setup.ts 基线），
 * 先 stub 再 install——包装层包住的是 stub 后的全局 fetch。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  installUnauthorizedInterceptor,
  handleUnauthorized,
  isServerRequest,
  __reloadHook,
  __resetForTest
} from './authInterceptor';

const SERVER = 'http://192.168.1.245:43111/api';

const loginRes = () => ({ status: 200, ok: true, json: async () => ({ ok: true }) });
const unauthorizedRes = () => ({ status: 401, ok: false, json: async () => ({ error: 'unauthorized' }) });

/** 预置登录态：localStorage 凭据镜像 + 用户数据（含 IDB 键名形态） */
const seedLoggedInState = () => {
  localStorage.setItem('starfit_user_id', 'user-abc');
  localStorage.setItem('starfit_server_url', SERVER);
  localStorage.setItem('starfit_server_ip', '192.168.1.245');
  localStorage.setItem('starfit_access_token', 'tok-123');
  // 用户数据（jsdom 下经 localStorage 降级路径读写）
  localStorage.setItem('starfit_history:device-1', JSON.stringify([{ id: 's1' }]));
  localStorage.setItem('starfit_next_plan', JSON.stringify({ plan: [] }));
  localStorage.setItem('chat_draft:session-1', JSON.stringify([{ role: 'user' }]));
};

/** stub 全局 fetch 并安装拦截器（顺序关键：包装层必须包住 stub 后的 fetch）；
 *  断言/触发一律走 window.fetch（= 包装层），直接调 fetchMock 会绕过拦截 */
const stubFetchAndInstall = (impl: (url: any) => any = () => unauthorizedRes()) => {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  installUnauthorizedInterceptor();
  return fetchMock;
};

/** 拦截器对 401 是 fire-and-forget：让清理链（含 await 段）落地 */
const flushAsync = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  __resetForTest();
  __reloadHook.fn = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => unauthorizedRes()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isServerRequest', () => {
  it('同源且 path 在服务器 URL 之下 → 命中', () => {
    localStorage.setItem('starfit_server_url', SERVER);
    expect(isServerRequest('http://192.168.1.245:43111/api/sync/push')).toBe(true);
    expect(isServerRequest('http://192.168.1.245:43111/api/admin/users')).toBe(true);
  });

  it('不同 origin（局域网扫描探测其它主机）→ 不命中', () => {
    localStorage.setItem('starfit_server_url', SERVER);
    expect(isServerRequest('http://192.168.1.247:43111/health')).toBe(false);
  });

  it('无登录服务器记录 → 不命中', () => {
    expect(isServerRequest('http://192.168.1.245:43111/api/sync/push')).toBe(false);
  });
});

describe('handleUnauthorized', () => {
  it('登录态 401 → 清凭据且用户数据保留，触发一次回登录页跳转', async () => {
    seedLoggedInState();

    await handleUnauthorized();

    // 凭据清空（镜像 + 令牌）+ 登出墓碑
    expect(localStorage.getItem('starfit_user_id')).toBeNull();
    expect(localStorage.getItem('starfit_server_url')).toBeNull();
    expect(localStorage.getItem('starfit_server_ip')).toBeNull();
    expect(localStorage.getItem('starfit_access_token')).toBeNull();
    expect(localStorage.getItem('starfit_logged_out')).toBe('1');
    // 切号/切服务器墓碑留存（供下次登录检测）
    expect(localStorage.getItem('starfit_last_user_id')).toBe('user-abc');
    expect(localStorage.getItem('starfit_last_server_url')).toBe(SERVER);

    // 用户数据保留（防偶发 401 误伤）
    expect(localStorage.getItem('starfit_history:device-1')).not.toBeNull();
    expect(localStorage.getItem('starfit_next_plan')).not.toBeNull();
    expect(localStorage.getItem('chat_draft:session-1')).not.toBeNull();

    // 踢回登录页（既有 reload 语义）
    expect(__reloadHook.fn).toHaveBeenCalledTimes(1);
  });

  it('未登录态（登录页自身请求）401 → 不触发登出', async () => {
    // 无 starfit_user_id：login-or-create 令牌错误的 401 不应 reload（吞掉错误提示）
    localStorage.setItem('starfit_server_url', SERVER);

    await handleUnauthorized();

    expect(__reloadHook.fn).not.toHaveBeenCalled();
    expect(localStorage.getItem('starfit_logged_out')).toBeNull();
  });

  it('模块级 flag：并发重复调用只登出一次', async () => {
    seedLoggedInState();

    await Promise.all([handleUnauthorized(), handleUnauthorized(), handleUnauthorized()]);

    expect(__reloadHook.fn).toHaveBeenCalledTimes(1);
  });
});

describe('installUnauthorizedInterceptor（fetch 包装层）', () => {
  it('登录态 401 风暴（3 个并发请求全 401）→ 只登出一次', async () => {
    seedLoggedInState();
    stubFetchAndInstall();

    // sync push 轮询 + UI 请求同时失败的风暴形态（经包装层 window.fetch 发出）
    await Promise.all([
      window.fetch('http://192.168.1.245:43111/api/sync/push', { method: 'POST' }),
      window.fetch('http://192.168.1.245:43111/api/sync/pull'),
      window.fetch('http://192.168.1.245:43111/api/suggestions'),
    ]);
    await flushAsync();

    expect(__reloadHook.fn).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('starfit_user_id')).toBeNull();
    expect(localStorage.getItem('starfit_logged_out')).toBe('1');
  });

  it('登录态 200 → 不触发登出', async () => {
    seedLoggedInState();
    stubFetchAndInstall(() => loginRes());

    await window.fetch('http://192.168.1.245:43111/api/sync/pull');
    await flushAsync();

    expect(__reloadHook.fn).not.toHaveBeenCalled();
    expect(localStorage.getItem('starfit_user_id')).toBe('user-abc');
  });

  it('非目标服务器的 401 → 不触发登出', async () => {
    seedLoggedInState();
    stubFetchAndInstall();

    await window.fetch('http://other-host.example:9999/api/something');
    await flushAsync();

    expect(__reloadHook.fn).not.toHaveBeenCalled();
    expect(localStorage.getItem('starfit_user_id')).toBe('user-abc');
  });

  it('重复安装是幂等的（HMR/重复 import 防御）', async () => {
    seedLoggedInState();
    stubFetchAndInstall();
    const wrappedOnce = window.fetch;
    installUnauthorizedInterceptor();
    expect(window.fetch).toBe(wrappedOnce);

    await wrappedOnce('http://192.168.1.245:43111/api/ping');
    await flushAsync();
    expect(__reloadHook.fn).toHaveBeenCalledTimes(1);
  });
});
