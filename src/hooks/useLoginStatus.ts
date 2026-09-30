import { useState, useEffect } from 'react';
import {
  loadLoginCredentials,
  saveLoginCredentials,
  clearLoginCredentials as clearStorageLoginCredentials,
  clearUserStateStorage
} from '@/storage';
import { Keys } from '@/storage/schemas';

/**
 * [#82 方案A] 切号清理超时：WKWebView 的 IDB 可能挂起（见 logout 同类处理）。
 * 超时后放行登录、清理在后台择机完成——宁可偶发残留，不可卡死登录。
 */
export const USER_STATE_CLEAR_TIMEOUT_MS = 3000;

export interface LoginStatusReturn {
  isLoggedIn: boolean;
  userId: string | null;
  serverUrl: string | null;
  serverIp: string | null;
  login: (userId: string, serverUrl: string, serverIp: string) => Promise<void>;
  logout: () => void;
}

/**
 * 自定义 Hook：管理用户登录状态 (V2 - L2 IDB Storage)
 *
 * 功能：
 * - 自动从 IDB 读取登录状态
 * - 监听 storage 事件实现跨标签页同步
 * - 提供 login/logout 方法
 * - 兼容旧 localStorage 格式
 *
 * @returns {LoginStatusReturn} 登录状态和相关方法
 */
export const useLoginStatus = (): LoginStatusReturn => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [serverIp, setServerIp] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Load credentials from IDB on mount
  useEffect(() => {
    (async () => {
      try {
        const creds = await loadLoginCredentials();
        // Logout tombstone: if present, IDB creds are stale (IDB delete can
        // hang in WKWebView) — ignore them and stay on the login page.
        const loggedOut = localStorage.getItem('starfit_logged_out') === '1';
        if (creds.userId && !loggedOut) {
          setUserId(creds.userId);
          setIsLoggedIn(true);
        } else if (creds.userId && loggedOut) {
          clearStorageLoginCredentials().catch(() => {});
        }
        if (creds.serverUrl) {
          setServerUrl(creds.serverUrl);
          // Extract IP from URL for display
          setServerIp(creds.serverUrl.replace('http://', '').replace('/api', '').split(':')[0]);
        }
      } catch (e) {
        console.warn('[useLoginStatus] Failed to load from IDB, trying localStorage:', e);
        // Fallback to localStorage for compatibility
        const lsUserId = localStorage.getItem('starfit_user_id');
        const lsServerUrl = localStorage.getItem('starfit_server_url');
        const lsServerIp = localStorage.getItem('starfit_server_ip');
        if (lsUserId) setUserId(lsUserId);
        if (lsServerUrl) setServerUrl(lsServerUrl);
        if (lsServerIp) setServerIp(lsServerIp);
        setIsLoggedIn(!!lsUserId);
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Only respond to legacy localStorage events for compatibility
      if (e.key && ['starfit_user_id', 'starfit_server_url', 'starfit_server_ip'].includes(e.key)) {
        const newUserId = localStorage.getItem('starfit_user_id');
        const newServerUrl = localStorage.getItem('starfit_server_url');
        const newServerIp = localStorage.getItem('starfit_server_ip');

        const newStatus = !!newUserId;

        if (newStatus !== isLoggedIn || newUserId !== userId) {
          setIsLoggedIn(newStatus);
          setUserId(newUserId);
          setServerUrl(newServerUrl);
          setServerIp(newServerIp);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [isLoggedIn, userId]);

  const login = async (newUserId: string, newServerUrl: string, newServerIp: string) => {
    // [#82 方案A] 切号检测：上一身份优先取切号墓碑（LoginV2 在回调本方法前已把
    // IDB 凭据覆写为新用户，凭据读取仅作旧版本升级设备的兜底）。
    // 两处皆无 = 全新设备首次登录（含 guest 数据），不触发清理。
    const prevUserId =
      localStorage.getItem(Keys.lastUserId) ||
      (await loadLoginCredentials().catch(() => ({ userId: null as string | null }))).userId ||
      null;
    if (prevUserId && prevUserId !== newUserId) {
      try {
        await Promise.race([
          clearUserStateStorage(),
          new Promise<void>((r) => setTimeout(r, USER_STATE_CLEAR_TIMEOUT_MS)),
        ]);
      } catch (e) {
        console.warn('[useLoginStatus] user-state clear failed (non-fatal):', e);
      }
    }

    // Save to IDB
    saveLoginCredentials(newUserId, newServerUrl).catch(console.error);

    // Update state
    setUserId(newUserId);
    setServerUrl(newServerUrl);
    setServerIp(newServerIp);
    setIsLoggedIn(true);

    // Also update localStorage for compatibility with existing services
    localStorage.setItem('starfit_user_id', newUserId);
    localStorage.setItem('starfit_server_url', newServerUrl);
    localStorage.setItem('starfit_server_ip', newServerIp);
    // 切号墓碑：登出不清除，供下次登录检测身份变化（#82）
    localStorage.setItem(Keys.lastUserId, newUserId);
    localStorage.removeItem('starfit_logged_out');
  };

  const logout = async () => {
    // Clear state
    setUserId(null);
    setServerUrl(null);
    setServerIp(null);
    setIsLoggedIn(false);

    // [#82] 切号墓碑：凭据即将被清，此键是下次登录检测身份变化的唯一活口
    // （A 登出 → B 登录时由此触发用户态清理）
    if (userId) {
      localStorage.setItem(Keys.lastUserId, userId);
    }

    // Clear localStorage FIRST (synchronous, cannot fail) so a reload
    // right after this call always lands on the login page.
    localStorage.removeItem('starfit_user_id');
    localStorage.removeItem('starfit_server_url');
    localStorage.removeItem('starfit_server_ip');
    // Tombstone: survives even if the IDB delete below hangs, so the app
    // boots logged-out and lazily purges the stale IDB creds on next launch.
    localStorage.setItem('starfit_logged_out', '1');

    // Clear IDB best-effort: WKWebView IndexedDB can hang or reject
    // transiently (observed on iOS sim 2026-09-10: logout never reloaded
    // because await hung here). Never let it block the reload.
    try {
      await Promise.race([
        clearStorageLoginCredentials(),
        new Promise<void>((r) => setTimeout(r, 2000)),
      ]);
    } catch (e) {
      console.warn('[useLoginStatus] IDB credential clear failed (non-fatal):', e);
    }
  };

  return {
    isLoggedIn,
    userId,
    serverUrl,
    serverIp,
    login,
    logout
  };
};
