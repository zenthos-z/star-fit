/**
 * #108 机制二：登录时服务器变更 → 用户数据缓存整体作废
 *
 * 覆盖验收场景：
 * - serverUrl 变化（.245 → .247）→ 用户数据键全部作废、设备级键豁免
 * - serverUrl 不变 → 缓存不作废
 * - 首次登录（无 lastServerUrl 记录）→ 不作废（无从谈「变化」）
 *
 * 环境口径：jsdom 无 indexedDB → storage 走 localStorage 降级路径，
 * 键断言直接读 localStorage。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Keys } from './schemas';
import {
  invalidateUserDataStorage,
  invalidateUserDataOnServerChange
} from './index';

const SERVER_A = 'http://192.168.1.245:43111/api';
const SERVER_B = 'http://192.168.1.247:43111/api';

/** 预置一次完整使用后的本地状态：用户数据 + 设备级键 + 凭据 */
const seedFullLocalState = () => {
  // --- 用户数据（应作废） ---
  localStorage.setItem('starfit_history:device-1', JSON.stringify([{ id: 's1' }]));
  localStorage.setItem('starfit_history', JSON.stringify([{ id: 'legacy' }])); // legacy
  localStorage.setItem('starfit_session_active', JSON.stringify({ id: 'active-1' }));
  localStorage.setItem('starfit_next_plan', JSON.stringify({ plan: [1] }));
  localStorage.setItem('starfit_day_plan:2026-10-01', JSON.stringify({ date: '2026-10-01', plan: [] }));
  localStorage.setItem('workout_draft:2026-10-01', JSON.stringify({ id: 'd1' }));
  localStorage.setItem('starfit_exercise_library', JSON.stringify({ exercises: [] }));
  localStorage.setItem('starfit_exercise_library_meta', JSON.stringify({ version: 1 }));
  localStorage.setItem('starfit_suggestion_cache', JSON.stringify({ entries: {} }));
  localStorage.setItem('chat_draft:session-1', JSON.stringify([])); // legacy 草稿
  localStorage.setItem('chat_thread_list:device-1', JSON.stringify([]));
  localStorage.setItem('chat_messages:thread-1', JSON.stringify([]));
  localStorage.setItem('starfit_pending_summary', 'true');
  localStorage.setItem('starfit_poster:abc', 'data:image/png;base64,x');
  localStorage.setItem('STARFIT_SYNC_QUEUE', JSON.stringify(['s1']));
  localStorage.setItem('STARFIT_DELETE_QUEUE', JSON.stringify([]));
  localStorage.setItem('STARFIT_SYNC_STATE', JSON.stringify({}));

  // --- 设备级 / 凭据 / 内容缓存（应豁免） ---
  localStorage.setItem('starfit_device_id', 'device-1');
  localStorage.setItem('starfit_ai_config', JSON.stringify({}));
  localStorage.setItem('prefs:anon', JSON.stringify({ theme: 'dark' }));
  localStorage.setItem('tutorial:深蹲:zh', JSON.stringify({ markdown: 'x' }));
  localStorage.setItem('starfit_coach_first_use_triage:user-abc', 'true'); // userId 维度
  localStorage.setItem('starfit_user_id', 'user-abc');
  localStorage.setItem('starfit_server_url', SERVER_A);
  localStorage.setItem('starfit_server_history', JSON.stringify([]));
  localStorage.setItem('starfit_last_user_id', 'user-abc');
  localStorage.setItem('starfit_logged_out', '1');
  localStorage.setItem('starfit_login_username', 'tester');
};

beforeEach(() => {
  localStorage.clear();
});

describe('invalidateUserDataStorage', () => {
  it('扫除用户数据键，设备级/凭据/内容缓存键豁免', async () => {
    seedFullLocalState();

    const removed = await invalidateUserDataStorage();

    // 用户数据全部作废
    const invalidatedKeys = [
      'starfit_history:device-1', 'starfit_history', 'starfit_session_active',
      'starfit_next_plan', 'starfit_day_plan:2026-10-01', 'workout_draft:2026-10-01',
      'starfit_exercise_library', 'starfit_exercise_library_meta', 'starfit_suggestion_cache',
      'chat_draft:session-1', 'chat_thread_list:device-1', 'chat_messages:thread-1',
      'starfit_pending_summary', 'starfit_poster:abc',
      'STARFIT_SYNC_QUEUE', 'STARFIT_DELETE_QUEUE', 'STARFIT_SYNC_STATE',
    ];
    for (const k of invalidatedKeys) {
      expect(localStorage.getItem(k), `应作废: ${k}`).toBeNull();
    }

    // 设备级 / 凭据 / 内容缓存全部保留
    const keptKeys: Array<[string, string]> = [
      ['starfit_device_id', 'device-1'],
      ['starfit_ai_config', '{}'],
      ['prefs:anon', '{"theme":"dark"}'],
      ['tutorial:深蹲:zh', '{"markdown":"x"}'],
      ['starfit_coach_first_use_triage:user-abc', 'true'],
      ['starfit_user_id', 'user-abc'],
      ['starfit_server_url', SERVER_A],
      ['starfit_server_history', '[]'],
      ['starfit_logged_out', '1'],
      ['starfit_login_username', 'tester'],
    ];
    for (const [k, v] of keptKeys) {
      expect(localStorage.getItem(k), `应保留: ${k}`).toBe(v);
    }

    // jsdom 走 localStorage 单后端：双后端合计 = localStorage 键数
    expect(removed).toBe(invalidatedKeys.length);
  });
});

describe('invalidateUserDataOnServerChange', () => {
  it('serverUrl 变化（.245 → .247）→ 用户数据作废、记录更新为新 URL', async () => {
    seedFullLocalState();
    localStorage.setItem(Keys.lastServerUrl, SERVER_A);

    const removed = await invalidateUserDataOnServerChange(SERVER_B);

    expect(removed).toBeGreaterThan(0);
    expect(localStorage.getItem('starfit_history:device-1')).toBeNull();
    expect(localStorage.getItem('starfit_next_plan')).toBeNull();
    // 设备级豁免不受影响
    expect(localStorage.getItem('starfit_device_id')).toBe('device-1');
    // 归属记录更新
    expect(localStorage.getItem(Keys.lastServerUrl)).toBe(SERVER_B);
  });

  it('serverUrl 不变 → 缓存不作废', async () => {
    seedFullLocalState();
    localStorage.setItem(Keys.lastServerUrl, SERVER_A);

    const removed = await invalidateUserDataOnServerChange(SERVER_A);

    expect(removed).toBe(0);
    // 用户数据原样保留
    expect(localStorage.getItem('starfit_history:device-1')).not.toBeNull();
    expect(localStorage.getItem('starfit_next_plan')).not.toBeNull();
    expect(localStorage.getItem('chat_thread_list:device-1')).not.toBeNull();
    // 归属记录仍为本次 URL
    expect(localStorage.getItem(Keys.lastServerUrl)).toBe(SERVER_A);
  });

  it('首次登录（无归属记录）→ 不作废，仅记录本次 URL', async () => {
    seedFullLocalState();
    expect(localStorage.getItem(Keys.lastServerUrl)).toBeNull();

    const removed = await invalidateUserDataOnServerChange(SERVER_A);

    expect(removed).toBe(0);
    expect(localStorage.getItem('starfit_history:device-1')).not.toBeNull();
    expect(localStorage.getItem(Keys.lastServerUrl)).toBe(SERVER_A);
  });

  it('连续登录同一台 → 第二次起不再作废（记录已随首次登录更新）', async () => {
    seedFullLocalState();
    localStorage.setItem(Keys.lastServerUrl, SERVER_A);

    await invalidateUserDataOnServerChange(SERVER_B);
    const second = await invalidateUserDataOnServerChange(SERVER_B);

    expect(second).toBe(0);
    expect(localStorage.getItem(Keys.lastServerUrl)).toBe(SERVER_B);
  });
});
