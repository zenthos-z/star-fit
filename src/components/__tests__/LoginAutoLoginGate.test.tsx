/**
 * [#115] LoginV2 跨 reload 自动登录防循环闸（②）+ 登录成功后 token 探活（⑤）
 *
 * 覆盖：
 * - 防循环闸：sessionStorage 计数（starfit_autologin_count）≥2 时自动登录
 *   不再触发（不健康检查、不打 login-or-create、计数不再递增），停在已填表单
 * - 计数 <2 时放行（第 2 次尝试仍可自动登录——容忍单次偶发 reload）
 * - 自动登录成功 → 计数清除（下次开机会话从头开始）
 * - 新 token 轻量探活（RC2 日志实锤：token 网关下 login-or-create 200 ≠ 其余
 *   路由可用）：探活 401 → 停在表单（不 onLogin、不写凭据、不作废数据缓存）
 *
 * serverDetector 整体 mock（保留 formatServerUrl/parseServerInput 真实现），
 * fetch stub 兜 /admin/users（探活）与 /admin/login-or-create。
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { detectServersMock, checkServerHealthMock } = vi.hoisted(() => ({
  detectServersMock: vi.fn(),
  checkServerHealthMock: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  loadLoginCredentials: vi.fn(),
  saveLoginCredentials: vi.fn(),
  addServerToHistory: vi.fn(),
  loadServerHistory: vi.fn(),
  invalidateUserDataOnServerChange: vi.fn(async () => 0),
}));

vi.mock('@/services/serverDetector', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/serverDetector')>();
  return {
    ...actual,
    detectServers: detectServersMock,
    checkServerHealth: checkServerHealthMock,
  };
});

vi.mock('@/storage', () => storageMocks);

vi.mock('../QRScanner', () => ({ default: () => null }));

vi.mock('@/services/geminiService', () => ({
  getAccessToken: vi.fn(() => ''),
  setAccessToken: vi.fn(),
}));

import LoginV2, {
  AUTO_LOGIN_COUNT_KEY,
  getAutoLoginAttempts,
} from '../LoginV2';

const fetchMock = vi.fn();

const okHealth = { ok: true, message: 'Server is online', latency: 10, version: '2.0.0' };

const jsonRes = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

/** 默认 stub：探活与登录均 200 */
const stubHappyFetch = () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/admin/users')) return jsonRes(200, { users: [] });
    if (url.includes('/admin/login-or-create')) {
      return jsonRes(200, { userId: 'test002', displayName: 'test002' });
    }
    throw new TypeError('Failed to fetch');
  });
};

/** 预置已保存凭据：LoginV2 水合后满足自动登录条件 */
const withSavedCreds = () => {
  storageMocks.loadLoginCredentials.mockResolvedValue({
    userId: 'test002',
    serverUrl: 'http://192.168.1.100:43111/api',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  storageMocks.loadLoginCredentials.mockResolvedValue({ userId: null, serverUrl: null });
  storageMocks.saveLoginCredentials.mockResolvedValue(undefined);
  storageMocks.addServerToHistory.mockResolvedValue(undefined);
  storageMocks.loadServerHistory.mockResolvedValue([]);
  detectServersMock.mockResolvedValue([]);
  checkServerHealthMock.mockResolvedValue(okHealth);
  fetchMock.mockReset();
  stubHappyFetch();
  vi.stubGlobal('fetch', fetchMock);
});

describe('LoginV2 · 跨 reload 防循环闸（#115 ②）', () => {
  it('sessionStorage 计数 ≥2：自动登录不再触发，停在已填表单', async () => {
    withSavedCreds();
    sessionStorage.setItem(AUTO_LOGIN_COUNT_KEY, '2');

    const onLogin = vi.fn();
    render(<LoginV2 onLogin={onLogin} />);

    // 水合完成：表单已填入凭据（停在已填表单）
    expect(
      await screen.findByDisplayValue('test002'),
    ).toBeInTheDocument();

    // 闸生效：无健康检查、无登录请求、无 onLogin；计数不再递增
    // （fetchUsers 防抖的 /admin/users 属页面常态请求，不计入——只断言登录链路）
    expect(checkServerHealthMock).not.toHaveBeenCalled();
    const loginCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('login-or-create'));
    expect(loginCalls).toHaveLength(0);
    expect(onLogin).not.toHaveBeenCalled();
    expect(getAutoLoginAttempts()).toBe(2);
    expect(
      await screen.findByText('自动连接上次服务器失败，请检查后重试或重新扫描'),
    ).toBeInTheDocument();
  });

  it('计数 <2（第 2 次尝试）：放行自动登录', async () => {
    withSavedCreds();
    sessionStorage.setItem(AUTO_LOGIN_COUNT_KEY, '1');

    const onLogin = vi.fn();
    render(<LoginV2 onLogin={onLogin} />);

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('test002', 'http://192.168.1.100:43111/api'));
  });

  it('自动登录成功：计数清除 + 计数先递增后清零', async () => {
    withSavedCreds();

    const onLogin = vi.fn();
    render(<LoginV2 onLogin={onLogin} />);

    await waitFor(() => expect(onLogin).toHaveBeenCalled());
    expect(sessionStorage.getItem(AUTO_LOGIN_COUNT_KEY)).toBeNull();
  });

  it('自动登录失败：计数保留（同次开机内累计，防残余循环）', async () => {
    withSavedCreds();
    checkServerHealthMock.mockResolvedValue({ ok: false, message: 'Connection timeout' });
    detectServersMock.mockResolvedValue([]); // 重扫零命中 → failed 终态

    render(<LoginV2 onLogin={vi.fn()} />);

    expect(
      await screen.findByText('自动连接上次服务器失败，请检查后重试或重新扫描'),
    ).toBeInTheDocument();
    expect(getAutoLoginAttempts()).toBe(1);
  });
});

describe('LoginV2 · 登录成功后 token 轻量探活（#115 ⑤·RC2）', () => {
  it('探活 401：停在表单，不 onLogin、不写凭据、不作废数据缓存', async () => {
    withSavedCreds();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/admin/users')) return jsonRes(401, { error: 'unauthorized' });
      if (url.includes('/admin/login-or-create')) {
        return jsonRes(200, { userId: 'test002', displayName: 'test002' });
      }
      throw new TypeError('Failed to fetch');
    });

    const onLogin = vi.fn();
    render(<LoginV2 onLogin={onLogin} />);

    expect(
      await screen.findByText('自动连接上次服务器失败，请检查后重试或重新扫描'),
    ).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
    expect(storageMocks.saveLoginCredentials).not.toHaveBeenCalled();
    expect(storageMocks.invalidateUserDataOnServerChange).not.toHaveBeenCalled();
    // 探活失败不清防循环闸计数（失败计入尝试次数）
    expect(getAutoLoginAttempts()).toBe(1);
  });

  it('手动登录路径探活 401：红字报错可见，不 onLogin', async () => {
    storageMocks.loadLoginCredentials.mockResolvedValue({ userId: null, serverUrl: null });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/admin/users')) return jsonRes(401, { error: 'unauthorized' });
      if (url.includes('/admin/login-or-create')) {
        return jsonRes(200, { userId: 'test002', displayName: 'test002' });
      }
      throw new TypeError('Failed to fetch');
    });

    const onLogin = vi.fn();
    render(<LoginV2 onLogin={onLogin} />);

    // 手动填表登录
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('例如: 192.168.1.100'), '192.168.1.100');
    await user.type(screen.getByPlaceholderText('例如: test002'), 'test002');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('访问令牌验证失败，请检查令牌后重试')).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
    expect(storageMocks.saveLoginCredentials).not.toHaveBeenCalled();
  });

  it('探活通过：正常走完保存凭据 + onLogin', async () => {
    withSavedCreds();

    const onLogin = vi.fn();
    render(<LoginV2 onLogin={onLogin} />);

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('test002', 'http://192.168.1.100:43111/api');
    });
    expect(storageMocks.saveLoginCredentials).toHaveBeenCalledWith(
      'test002',
      'http://192.168.1.100:43111/api',
    );
    expect(storageMocks.invalidateUserDataOnServerChange).toHaveBeenCalled();
  });
});
