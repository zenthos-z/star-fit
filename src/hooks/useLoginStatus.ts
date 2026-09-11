import { useState, useEffect } from 'react';
import {
  loadLoginCredentials,
  saveLoginCredentials,
  clearLoginCredentials as clearStorageLoginCredentials
} from '../../storage';

export interface LoginStatusReturn {
  isLoggedIn: boolean;
  userId: string | null;
  serverUrl: string | null;
  serverIp: string | null;
  login: (userId: string, serverUrl: string, serverIp: string) => void;
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

  const login = (newUserId: string, newServerUrl: string, newServerIp: string) => {
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
    localStorage.removeItem('starfit_logged_out');
  };

  const logout = async () => {
    // Clear state
    setUserId(null);
    setServerUrl(null);
    setServerIp(null);
    setIsLoggedIn(false);

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
