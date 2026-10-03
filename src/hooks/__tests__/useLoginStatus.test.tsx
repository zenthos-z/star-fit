/**
 * [#115] useLoginStatus 登录态快速判定 + login() 写入时序回归
 *
 * 覆盖修复点 ③④：
 * - boot 快速判定：localStorage 镜像同步立判 isLoggedIn（不等 IDB）；
 *   登出墓碑优先于镜像
 * - IDB 后台校准：镜像缺失但 IDB 有凭据 → 回填镜像并升格登录态
 * - IDB 读超时（5s race）：按未登录处理但不清数据（WKWebView 启动期挂起）
 * - login() 凭据写入时序：镜像五连写 + 墓碑清除 + 状态置位全部先于首个
 *   await——reload/刷新竞速下尾部写入被吃掉曾是循环自持的根因（RC1）
 *
 * 环境口径：@/storage 整体 mock（jsdom 无 indexedDB），凭据断言直接读
 * localStorage 镜像。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const storageMocks = vi.hoisted(() => ({
  loadLoginCredentials: vi.fn(),
  saveLoginCredentials: vi.fn(),
  clearLoginCredentials: vi.fn(),
  clearLoginSession: vi.fn(),
  clearUserStateStorage: vi.fn(),
}));

vi.mock('@/storage', () => storageMocks);

import {
  useLoginStatus,
  IDB_LOGIN_READ_TIMEOUT_MS,
} from '../../hooks/useLoginStatus';

const SERVER = 'http://192.168.1.245:43111/api';

/** 永不 resolve 的 promise：模拟 WKWebView IDB 挂起 */
const hang = () => new Promise(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  storageMocks.loadLoginCredentials.mockResolvedValue({ userId: null, serverUrl: null });
  storageMocks.saveLoginCredentials.mockResolvedValue(undefined);
  storageMocks.clearLoginCredentials.mockResolvedValue(undefined);
  storageMocks.clearLoginSession.mockResolvedValue(undefined);
  storageMocks.clearUserStateStorage.mockResolvedValue(0);
});

describe('useLoginStatus · boot 快速判定（#115 ③）', () => {
  it('镜像存在且无墓碑：首渲染即 isLoggedIn=true，不等 IDB（IDB 挂起也不落登录页）', () => {
    localStorage.setItem('starfit_user_id', 'user-abc');
    localStorage.setItem('starfit_server_url', SERVER);
    localStorage.setItem('starfit_server_ip', '192.168.1.245');
    storageMocks.loadLoginCredentials.mockReturnValue(hang()); // IDB 永久挂起

    const { result } = renderHook(() => useLoginStatus());

    // 同步断言（未 waitFor、未推进任何微任务）：镜像已定登录态
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.userId).toBe('user-abc');
    expect(result.current.serverUrl).toBe(SERVER);
  });

  it('登出墓碑优先：镜像残留 + starfit_logged_out=1 → 保持未登录', () => {
    localStorage.setItem('starfit_user_id', 'user-abc');
    localStorage.setItem('starfit_logged_out', '1');

    const { result } = renderHook(() => useLoginStatus());

    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.userId).toBeNull();
  });

  it('IDB 校准升格：镜像缺失但 IDB 有凭据 → 置登录态并回填镜像', async () => {
    storageMocks.loadLoginCredentials.mockResolvedValue({ userId: 'user-idb', serverUrl: SERVER });

    const { result } = renderHook(() => useLoginStatus());
    expect(result.current.isLoggedIn).toBe(false); // 快速判定先落未登录

    await waitFor(() => expect(result.current.isLoggedIn).toBe(true));
    expect(result.current.userId).toBe('user-idb');
    expect(localStorage.getItem('starfit_user_id')).toBe('user-idb');
    expect(localStorage.getItem('starfit_server_url')).toBe(SERVER);
    expect(localStorage.getItem('starfit_server_ip')).toBe('192.168.1.245');
  });

  it('墓碑 + IDB 凭据残留 → 懒清除并保持登录页（#82 行为保留）', async () => {
    localStorage.setItem('starfit_logged_out', '1');
    storageMocks.loadLoginCredentials.mockResolvedValue({ userId: 'user-stale', serverUrl: SERVER });

    const { result } = renderHook(() => useLoginStatus());

    await waitFor(() => expect(storageMocks.clearLoginCredentials).toHaveBeenCalled());
    expect(result.current.isLoggedIn).toBe(false);
  });
});

describe('useLoginStatus · IDB 读超时兜底（#115 ④）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('IDB 挂起 5s 超时：按未登录处理，不清任何数据', async () => {
    localStorage.setItem('starfit_logged_out', '1'); // 墓碑在：若读到凭据会触发懒清除
    storageMocks.loadLoginCredentials.mockReturnValue(hang());

    const { result } = renderHook(() => useLoginStatus());
    expect(result.current.isLoggedIn).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDB_LOGIN_READ_TIMEOUT_MS + 100);
    });

    // 超时按「无 IDB 信息」处理：不清数据、状态不变
    expect(result.current.isLoggedIn).toBe(false);
    expect(storageMocks.clearLoginCredentials).not.toHaveBeenCalled();
    expect(storageMocks.saveLoginCredentials).not.toHaveBeenCalled();
    // 镜像登录态不受校准影响（不会被超时降级登出）
    expect(localStorage.getItem('starfit_logged_out')).toBe('1');
  });
});

describe('useLoginStatus · login() 凭据写入时序（#115 ③）', () => {
  it('镜像五连写 + 墓碑清除 + 状态置位先于首个 await（IDB 挂起也已完成）', async () => {
    localStorage.setItem('starfit_logged_out', '1'); // 登出墓碑残留（RC1 子机制 b）
    storageMocks.loadLoginCredentials.mockReturnValue(hang()); // 首个 await 永久挂起

    const { result } = renderHook(() => useLoginStatus());
    expect(result.current.isLoggedIn).toBe(false);

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.login('user-new', SERVER, '192.168.1.245');
      // 不 await pending：断言同步前缀的落盘（模拟 reload 在 await 后立即打断）
      expect(localStorage.getItem('starfit_user_id')).toBe('user-new');
      expect(localStorage.getItem('starfit_server_url')).toBe(SERVER);
      expect(localStorage.getItem('starfit_server_ip')).toBe('192.168.1.245');
      expect(localStorage.getItem('starfit_last_user_id')).toBe('user-new');
      expect(localStorage.getItem('starfit_logged_out')).toBeNull();
    });
    // 状态先行置位：首个 await 挂起，本页也已切主界面渲染
    expect(result.current.isLoggedIn).toBe(true);
    // 挂起的 promise 不影响断言（防 unhandled rejection 噪音）
    pending.catch(() => {});
  });

  it('切号：lastUserId 墓碑 ≠ 新用户 → 清用户态（沿用 #82 路径）', async () => {
    localStorage.setItem('starfit_last_user_id', 'user-old');

    const { result } = renderHook(() => useLoginStatus());
    await act(async () => {
      await result.current.login('user-new', SERVER, '192.168.1.245');
    });

    expect(storageMocks.clearUserStateStorage).toHaveBeenCalledTimes(1);
    expect(storageMocks.saveLoginCredentials).toHaveBeenCalledWith('user-new', SERVER);
    expect(result.current.isLoggedIn).toBe(true);
  });

  it('同用户重登：墓碑即上一身份，不触发用户态清理、不再读 IDB', async () => {
    localStorage.setItem('starfit_last_user_id', 'user-abc');

    const { result } = renderHook(() => useLoginStatus());
    await act(async () => {
      await result.current.login('user-abc', SERVER, '192.168.1.245');
    });

    expect(storageMocks.clearUserStateStorage).not.toHaveBeenCalled();
    // 墓碑优先：login 不再兜底读 IDB 旧凭据（仅 mount 校准那一次调用）
    expect(storageMocks.loadLoginCredentials).toHaveBeenCalledTimes(1);
    expect(storageMocks.saveLoginCredentials).toHaveBeenCalledWith('user-abc', SERVER);
  });
});
