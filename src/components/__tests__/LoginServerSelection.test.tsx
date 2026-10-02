/**
 * 登录页扫描多后端命中分流回归（issue #84）
 *
 * 覆盖 detectServers 命中数分流（mock 扫描结果，验证页面编排）：
 * - 双命中 → 弹选择列表（地址 + 延迟 + 版本号），不自动登录
 * - 单命中 → 自动连接（已填用户名时直接登录）
 * - 零命中 → 手动输入路径（无弹窗、无报错、输入框可编辑）
 * - 自动登录连接失败 → 自动重扫：多命中带「上次连接的地址已不可用」
 *   提示重选，选定后静默重连；单命中直接自动重连
 *
 * serverDetector 整体 mock（保留 formatServerUrl/parseServerInput 真实现），
 * fetch stub 兜 /admin/users 与 /admin/login-or-create。
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { detectServersMock, detectServerMock, checkServerHealthMock } = vi.hoisted(() => ({
  detectServersMock: vi.fn(),
  detectServerMock: vi.fn(),
  checkServerHealthMock: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  loadLoginCredentials: vi.fn(),
  saveLoginCredentials: vi.fn(),
  addServerToHistory: vi.fn(),
  loadServerHistory: vi.fn(),
  invalidateUserDataOnServerChange: vi.fn(async () => 0), // #108 机制二（登录页不触发作废路径）
}));

vi.mock('@/services/serverDetector', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/serverDetector')>();
  return {
    ...actual,
    detectServers: detectServersMock,
    detectServer: detectServerMock,
    checkServerHealth: checkServerHealthMock,
  };
});

vi.mock('@/storage', () => storageMocks);

vi.mock('../QRScanner', () => ({ default: () => null }));

vi.mock('@/services/geminiService', () => ({
  getAccessToken: vi.fn(() => ''),
  setAccessToken: vi.fn(),
}));

import LoginV2 from '../LoginV2';

const fetchMock = vi.fn();

const HIT_A = { url: 'http://192.168.1.100:43111/api', source: 'scan', latency: 12, version: '2.0.0' };
const HIT_B = { url: 'http://192.168.1.7:43111/api', source: 'scan', latency: 7, version: '2.0.0' };

const okHealth = { ok: true, message: 'Server is online', latency: 10, version: '2.0.0' };
const failHealth = { ok: false, message: 'Connection timeout' };

const jsonRes = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  storageMocks.loadLoginCredentials.mockResolvedValue({ userId: null, serverUrl: null });
  storageMocks.saveLoginCredentials.mockResolvedValue(undefined);
  storageMocks.addServerToHistory.mockResolvedValue(undefined);
  storageMocks.loadServerHistory.mockResolvedValue([]);
  detectServersMock.mockResolvedValue([]);
  detectServerMock.mockResolvedValue(null);
  checkServerHealthMock.mockResolvedValue(okHealth);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/admin/users')) return jsonRes(200, { users: [] });
    if (url.includes('/admin/login-or-create')) {
      return jsonRes(200, { userId: 'test002', displayName: 'test002' });
    }
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetchMock);
});

const renderLogin = (onLogin = vi.fn()) => {
  const utils = render(<LoginV2 onLogin={onLogin} />);
  return { onLogin, ...utils };
};

describe('LoginV2 · 扫描命中分流（#84）', () => {
  it('双命中：弹出选择列表（地址+延迟+版本号），不自动登录', async () => {
    detectServersMock.mockResolvedValue([HIT_A, HIT_B]);
    const { onLogin } = renderLogin();

    const user = userEvent.setup();
    // 等凭据水合完成（表单渲染出扫描钮）再扫描
    await user.click(await screen.findByTitle('扫描局域网服务器'));

    expect(await screen.findByText('发现 2 个服务器')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.100:43111')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.7:43111')).toBeInTheDocument();
    // 延迟 + 版本号逐行展示
    expect(screen.getByText('12ms')).toBeInTheDocument();
    expect(screen.getByText('7ms')).toBeInTheDocument();
    expect(screen.getAllByText('v2.0.0').length).toBeGreaterThanOrEqual(2);
    // 多命中只列列表，不擅自登录
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('单命中：已填用户名时自动连接登录', async () => {
    detectServersMock.mockResolvedValue([HIT_A]);
    const { onLogin } = renderLogin();

    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('例如: test002'), 'test002');
    await user.click(screen.getByTitle('扫描局域网服务器'));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('test002', 'http://192.168.1.100:43111/api');
    });
    // 单命中无列表
    expect(screen.queryByText('发现 1 个服务器')).not.toBeInTheDocument();
  });

  it('零命中：静默收场，输入框保持可编辑（手动输入路径）', async () => {
    detectServersMock.mockResolvedValue([]);
    renderLogin();

    const user = userEvent.setup();
    await user.click(await screen.findByTitle('扫描局域网服务器'));
    await waitFor(() => expect(detectServersMock).toHaveBeenCalled());

    expect(screen.queryByText(/发现.*服务器/)).not.toBeInTheDocument();
    expect(screen.queryByText(/无法连接/)).not.toBeInTheDocument();

    // 手输路径不受影响
    const input = screen.getByPlaceholderText('例如: 192.168.1.100') as HTMLInputElement;
    await user.type(input, '10.0.0.9');
    expect(input.value).toBe('10.0.0.9');
  });
});

describe('LoginV2 · 自动登录失败自动重扫（#84）', () => {
  const withSavedCreds = () => {
    storageMocks.loadLoginCredentials.mockResolvedValue({
      userId: 'test002',
      serverUrl: 'http://192.168.1.100:43111/api',
    });
    // 首次直连（自动登录健康检查）失败 → 触发重扫；其后连接均成功
    checkServerHealthMock.mockResolvedValueOnce(failHealth);
    checkServerHealthMock.mockResolvedValue(okHealth);
  };

  it('重扫双命中：列表附「上次连接的地址已不可用」提示，选定后静默重连', async () => {
    withSavedCreds();
    detectServersMock.mockResolvedValue([HIT_A, HIT_B]);
    const { onLogin } = renderLogin();

    // 自动登录失败 → 自动重扫 → 多命中弹列表
    expect(await screen.findByText('发现 2 个服务器')).toBeInTheDocument();
    expect(
      screen.getByText('上次连接的地址已不可用，请重新选择'),
    ).toBeInTheDocument();

    // 选定另一台 → 静默重连成功
    await userEvent.setup().click(screen.getByText('192.168.1.7:43111'));
    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('test002', 'http://192.168.1.7:43111/api');
    });
    expect(storageMocks.saveLoginCredentials).toHaveBeenCalledWith(
      'test002',
      'http://192.168.1.7:43111/api',
    );
  });

  it('重扫单命中：不弹列表，直接自动重连', async () => {
    withSavedCreds();
    detectServersMock.mockResolvedValue([HIT_B]);
    const { onLogin } = renderLogin();

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('test002', 'http://192.168.1.7:43111/api');
    });
    expect(screen.queryByText(/发现.*服务器/)).not.toBeInTheDocument();
  });

  it('重扫零命中：不弹列表，停在已填表单走手输路径', async () => {
    withSavedCreds();
    detectServersMock.mockResolvedValue([]);
    renderLogin();

    // 直连失败 + 重扫无果 → 失败横幅，无弹窗
    expect(
      await screen.findByText('自动连接上次服务器失败，请检查后重试或重新扫描'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/发现.*服务器/)).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('例如: test002') as HTMLInputElement,
    ).toHaveValue('test002');
  });
});
