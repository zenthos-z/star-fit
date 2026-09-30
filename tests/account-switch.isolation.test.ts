/**
 * [#82 方案A] 账号切换清残留 · 隔离验收测试
 *
 * 独立 fixture：内存 Map 模拟 IDB / localStorage 双后端（与被 mock 的 ls 适配器
 * 共用同一 backing store，忠实还原"适配器写入 + 直写 localStorage"并存的生产形态）。
 * 不触真实 localStorage，不依赖真实登录服务。可在干净 checkout 上一键复跑：
 *
 *   env -u NODE_ENV npx vitest run tests/account-switch.isolation.test.ts
 *   （或 bash scripts/verify-82.sh 跑全部验收门）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---- hoisted：mock 工厂与用例共享的可变状态（工厂提升在普通 const 之上） ----
const { idbStore, lsStore, hangs } = vi.hoisted(() => ({
  idbStore: new Map<string, any>(),
  lsStore: new Map<string, string>(),
  hangs: { remove: false },
}));

// 让 @/storage 模块顶部的 useIDB 探测为 true，覆盖双后端清理路径
vi.hoisted(() => {
  (globalThis as any).indexedDB = {};
});

// IDB 适配器 → 内存 Map（idbRemove 可模拟 WKWebView IDB 挂起）
vi.mock('@/storage/adapters/indexeddb', () => ({
  idbGet: async (k: string) => (idbStore.has(k) ? idbStore.get(k) : null),
  idbSet: async (k: string, v: any) => {
    idbStore.set(k, v);
  },
  idbRemove: async (k: string) => {
    if (hangs.remove) return new Promise<void>(() => {}); // 永不 resolve
    idbStore.delete(k);
  },
  idbKeys: async () => Array.from(idbStore.keys()),
  idbClear: async () => {
    idbStore.clear();
  },
}));

// localStorage 适配器 → 同一 lsStore（与下方全局 shim 共享，见 makeMemoryLS）
vi.mock('@/storage/adapters/localstorage', () => ({
  lsGet: (k: string) => {
    const v = lsStore.get(k);
    if (v === null || v === undefined) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  },
  lsSet: (k: string, v: any) => {
    lsStore.set(k, JSON.stringify(v));
  },
  lsRemove: (k: string) => {
    lsStore.delete(k);
  },
  lsKeys: () => Array.from(lsStore.keys()),
  lsClear: () => {
    lsStore.clear();
  },
}));

import { clearUserStateStorage, isUserStateKey } from '@/storage';
import { useLoginStatus, USER_STATE_CLEAR_TIMEOUT_MS } from '@/hooks/useLoginStatus';
import { Keys } from '@/storage/schemas';

const USER_A = 'user-aaa';
const USER_B = 'user-bbb';
const LEGACY_USER = 'legacy-user-a';
const SERVER_URL_A = 'http://10.0.0.1:43111/api';
const SERVER_URL_B = 'http://10.0.0.2:43111/api';

/** 全局 localStorage shim：与被 mock 的 ls 适配器共用 lsStore（生产中二者同一空间） */
const makeMemoryLS = () =>
  ({
    getItem: (k: string) => (lsStore.has(k) ? (lsStore.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      lsStore.set(k, String(v));
    },
    removeItem: (k: string) => {
      lsStore.delete(k);
    },
    clear: () => lsStore.clear(),
    key: (i: number) => Array.from(lsStore.keys())[i] ?? null,
    get length() {
      return lsStore.size;
    },
  }) as unknown as Storage;

beforeEach(() => {
  idbStore.clear();
  lsStore.clear();
  hangs.remove = false;
  vi.stubGlobal('localStorage', makeMemoryLS());
});

// ---- fixtures ----

/** 设备级 / 共享内容缓存键（切号后必须保留） */
function seedDeviceLevel(): void {
  idbStore.set('starfit_device_id', 'device-1');
  idbStore.set('starfit_exercise_library', { exercises: [{ id: 'e1' }], meta: {} });
  idbStore.set('starfit_exercise_library_meta', { version: 5 });
  idbStore.set('tutorial:squat:zh', { markdown: '深蹲教程' });
  idbStore.set('starfit_server_history', [
    { url: SERVER_URL_A, lastConnected: 1, successCount: 1 },
  ]);
}

/** 当前账号（A）使用期产生的用户态数据；返回落入 IDB 的键清单 */
function seedUserStateData(): string[] {
  const keys = [
    'starfit_history:device-1', // 训练历史（设备维度键）
    'starfit_history', // 旧版无后缀历史键
    'starfit_session_active', // 进行中训练
    'chat_thread_list:device-1', // AI 教练会话列表
    'chat_messages:thread-1', // 会话消息
    'starfit_day_plan:2026-09-30', // 按天计划
    'starfit_next_plan', // 下次计划
    'starfit_pending_summary',
    'starfit_suggestion_cache', // 动作建议缓存（含用户锚点）
    'starfit_ai_config', // AI 配置（含用户上下文摘要）
    'prefs:anon', // 用户偏好
    'workout_draft:2026-09-30', // 训练草稿
    'starfit_coach_first_use_triage:user-aaa', // 首用分流标志（用户维度键）
    'STARFIT_SYNC_QUEUE', // 同步队列（未同步记录引用）
    'STARFIT_DELETE_QUEUE',
    'STARFIT_SYNC_STATE',
  ];
  for (const k of keys) idbStore.set(k, { seeded: k });
  // 直写 localStorage 的用户态（海报缓存 / 昵称）
  localStorage.setItem('starfit_poster:session-1', 'data:image/png;base64,xxx');
  localStorage.setItem('starfit_poster_nickname', '阿强');
  return keys;
}

function expectUserStateGone(idbKeys: string[]): void {
  for (const k of idbKeys) expect(idbStore.has(k)).toBe(false);
  expect(localStorage.getItem('starfit_poster:session-1')).toBeNull();
  expect(localStorage.getItem('starfit_poster_nickname')).toBeNull();
}

function expectDeviceLevelKept(): void {
  expect(idbStore.get('starfit_device_id')).toBe('device-1');
  expect(idbStore.has('starfit_exercise_library')).toBe(true);
  expect(idbStore.has('starfit_exercise_library_meta')).toBe(true);
  expect(idbStore.has('tutorial:squat:zh')).toBe(true);
  expect(idbStore.has('starfit_server_history')).toBe(true);
}

// ---- 存储层单元：保留口径与清扫 ----

describe('isUserStateKey · 切号保留口径', () => {
  it('设备级 / 登录凭据 / 共享内容缓存 → 保留（false）', () => {
    const kept = [
      'starfit_device_id',
      'starfit_user_id',
      'starfit_server_url',
      'starfit_server_ip',
      'starfit_login_creds',
      'starfit_logged_out',
      'starfit_last_user_id',
      'starfit_login_username',
      'starfit_access_token',
      'starfit_server_history',
      'starfit_exercise_library',
      'starfit_exercise_library_meta',
      'tutorial:squat:zh',
    ];
    for (const k of kept) expect(isUserStateKey(k)).toBe(false);
  });

  it('用户态键（含前缀型具体实例）→ 清除（true）', () => {
    const cleared = [
      'starfit_history:device-1',
      'starfit_history',
      'starfit_session_active',
      'chat_thread_list:device-1',
      'chat_messages:thread-1',
      'chat_draft:device-1',
      'starfit_day_plan:2026-09-30',
      'starfit_next_plan',
      'starfit_pending_summary',
      'starfit_suggestion_cache',
      'starfit_ai_config',
      'starfit_coach_first_use_triage:user-aaa',
      'workout_draft:2026-09-30',
      'prefs:anon',
      'STARFIT_SYNC_QUEUE',
      'STARFIT_DELETE_QUEUE',
      'STARFIT_SYNC_STATE',
      'starfit_poster:session-1',
      'starfit_poster_nickname',
    ];
    for (const k of cleared) expect(isUserStateKey(k)).toBe(true);
  });

  it('未知新键 → 默认视为用户态（default-clear，新用户态键无需登记）', () => {
    expect(isUserStateKey('starfit_some_future_user_key')).toBe(true);
    expect(isUserStateKey('whatever:else')).toBe(true);
  });
});

describe('clearUserStateStorage · 双后端清扫', () => {
  it('清除 IDB + localStorage 全部用户态键，保留设备级键，返回清除计数', async () => {
    seedDeviceLevel();
    const idbKeys = seedUserStateData();

    const removed = await clearUserStateStorage();

    expectUserStateGone(idbKeys);
    expectDeviceLevelKept();
    // 计数 = IDB 用户态 + 直写 localStorage 的海报两键
    expect(removed).toBe(idbKeys.length + 2);
  });

  it('空存储调用安全（返回 0）', async () => {
    expect(await clearUserStateStorage()).toBe(0);
  });
});

// ---- Hook 层：登录链路切号检测 ----

/** 渲染 hook 并等待挂载期 IDB 凭据水合完成 */
async function renderLoginHook() {
  const utils = renderHook(() => useLoginStatus());
  await act(async () => {}); // flush mount hydration
  return utils;
}

describe('useLoginStatus · 账号切换清残留 [#82 方案A]', () => {
  it('真实路径 A 登录 → 登出 → B 登录：用户态双后端清空，设备级/新凭据保留', async () => {
    seedDeviceLevel();
    const { result } = await renderLoginHook();

    // A 首次登录（全新设备：无墓碑无凭据，不触发清理）
    await act(async () => {
      await result.current.login(USER_A, SERVER_URL_A, '10.0.0.1');
    });
    expect(result.current.isLoggedIn).toBe(true);
    expect(localStorage.getItem(Keys.lastUserId)).toBe(USER_A);

    // A 使用期产生用户态数据
    const residueKeys = seedUserStateData();

    // A 登出：只清凭据，用户态保留（方案A 仅在切号时清）
    await act(async () => {
      await result.current.logout();
    });
    for (const k of residueKeys) expect(idbStore.has(k)).toBe(true);
    expect(idbStore.has('starfit_user_id')).toBe(false);
    expect(localStorage.getItem('starfit_logged_out')).toBe('1');
    expect(localStorage.getItem(Keys.lastUserId)).toBe(USER_A); // 墓碑存活

    // B 登录：检测到身份变化 → 清空用户态
    await act(async () => {
      await result.current.login(USER_B, SERVER_URL_B, '10.0.0.2');
    });

    expectUserStateGone(residueKeys);
    expectDeviceLevelKept();
    // 新凭据完整（IDB + localStorage 镜像）
    expect(idbStore.get('starfit_user_id')).toBe(USER_B);
    expect(localStorage.getItem('starfit_user_id')).toBe(USER_B);
    expect(localStorage.getItem('starfit_server_url')).toBe(SERVER_URL_B);
    // 登出墓碑被新登录清除；切号墓碑更新为 B
    expect(localStorage.getItem('starfit_logged_out')).toBeNull();
    expect(localStorage.getItem(Keys.lastUserId)).toBe(USER_B);
    expect(result.current.userId).toBe(USER_B);
    expect(result.current.isLoggedIn).toBe(true);
  });

  it('同账号登出后重登：非切号，用户态保留', async () => {
    seedDeviceLevel();
    const { result } = await renderLoginHook();

    await act(async () => {
      await result.current.login(USER_A, SERVER_URL_A, '10.0.0.1');
    });
    const residueKeys = seedUserStateData();

    await act(async () => {
      await result.current.logout();
    });
    await act(async () => {
      await result.current.login(USER_A, SERVER_URL_A, '10.0.0.1');
    });

    // 同一用户：数据不丢
    for (const k of residueKeys) expect(idbStore.has(k)).toBe(true);
    expect(localStorage.getItem('starfit_poster:session-1')).not.toBeNull();
    expect(idbStore.get('starfit_user_id')).toBe(USER_A);
    expect(localStorage.getItem('starfit_logged_out')).toBeNull();
  });

  it('全新设备首次登录（含 guest 残留数据）：无前置身份，不触发清理', async () => {
    seedDeviceLevel();
    // guest 数据：用户态键存在，但无凭据无墓碑
    const guestKeys = seedUserStateData();
    const { result } = await renderLoginHook();

    await act(async () => {
      await result.current.login(USER_B, SERVER_URL_B, '10.0.0.2');
    });

    for (const k of guestKeys) expect(idbStore.has(k)).toBe(true);
    expect(localStorage.getItem('starfit_poster:session-1')).not.toBeNull();
    expect(idbStore.get('starfit_user_id')).toBe(USER_B);
    expect(localStorage.getItem(Keys.lastUserId)).toBe(USER_B);
  });

  it('凭据兜底：无墓碑但 IDB 凭据为旧用户（旧版本升级设备）→ 触发清理', async () => {
    seedDeviceLevel();
    idbStore.set('starfit_user_id', LEGACY_USER);
    idbStore.set('starfit_login_creds', {
      userId: LEGACY_USER,
      serverUrl: SERVER_URL_A,
      lastLogin: 1,
    });
    const residueKeys = seedUserStateData();
    const { result } = await renderLoginHook();

    await act(async () => {
      await result.current.login(USER_B, SERVER_URL_B, '10.0.0.2');
    });

    expectUserStateGone(residueKeys);
    expectDeviceLevelKept();
    expect(idbStore.get('starfit_user_id')).toBe(USER_B);
  });

  it('IDB 挂起（WKWebView 病理场景）：清理超时放行，登录不被卡死', async () => {
    seedDeviceLevel();
    const { result } = await renderLoginHook();

    await act(async () => {
      await result.current.login(USER_A, SERVER_URL_A, '10.0.0.1');
    });
    seedUserStateData();
    await act(async () => {
      await result.current.logout();
    });

    // 登录期挂起：B 登录仍应在超时后完成（宁可残留，不可卡死登录）
    hangs.remove = true;
    vi.useFakeTimers();
    try {
      await act(async () => {
        const p = result.current.login(USER_B, SERVER_URL_B, '10.0.0.2');
        await vi.advanceTimersByTimeAsync(USER_STATE_CLEAR_TIMEOUT_MS + 100);
        await p;
      });
      expect(result.current.isLoggedIn).toBe(true);
      expect(result.current.userId).toBe(USER_B);
      expect(idbStore.get('starfit_user_id')).toBe(USER_B);
      expect(localStorage.getItem(Keys.lastUserId)).toBe(USER_B);
      // 已知退化：挂起路径下残留允许存活（与 logout 的超时竞速同一取舍）
      expect(idbStore.has('starfit_session_active')).toBe(true);
    } finally {
      vi.useRealTimers();
      hangs.remove = false;
    }
  });
});
