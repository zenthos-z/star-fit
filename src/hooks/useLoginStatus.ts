import { useState, useEffect } from 'react';
import {
  loadLoginCredentials,
  saveLoginCredentials,
  clearLoginCredentials,
  clearLoginSession,
  clearUserStateStorage
} from '@/storage';
import { Keys } from '@/storage/schemas';

/**
 * [#82 方案A] 切号清理超时：WKWebView 的 IDB 可能挂起（见 logout 同类处理）。
 * 超时后放行登录、清理在后台择机完成——宁可偶发残留，不可卡死登录。
 */
export const USER_STATE_CLEAR_TIMEOUT_MS = 3000;

/**
 * [#115 ④] IDB 凭据读超时（对齐 LoginV2 既有 5s race 模式）：boot 校准读挂起时
 * 按「无 IDB 信息」处理——镜像快速判定已就位，不无限等、不清数据。
 */
export const IDB_LOGIN_READ_TIMEOUT_MS = 5000;

export interface LoginStatusReturn {
  isLoggedIn: boolean;
  userId: string | null;
  serverUrl: string | null;
  serverIp: string | null;
  login: (userId: string, serverUrl: string, serverIp: string) => Promise<void>;
  logout: () => void;
}

/**
 * [#115 ③] localStorage 凭据镜像同步快照：boot 登录态快速判定的唯一依据。
 * login() 在首个 await 之前同步维护镜像（见 login），reload/刷新竞速下总是
 * 最新；登出墓碑（starfit_logged_out）由 clearLoginSession 同步置位，判定
 * 优先于镜像（登出后 IDB 凭据可能残留，#82）。
 */
const readMirrorSnapshot = () => {
  const loggedOut = localStorage.getItem('starfit_logged_out') === '1';
  return {
    loggedOut,
    userId: loggedOut ? null : localStorage.getItem('starfit_user_id'),
    serverUrl: loggedOut ? null : localStorage.getItem('starfit_server_url'),
    serverIp: loggedOut ? null : localStorage.getItem('starfit_server_ip')
  };
};

/**
 * 自定义 Hook：管理用户登录状态 (V2 - L2 IDB Storage)
 *
 * 功能：
 * - boot 快速判定：同步读 localStorage 镜像，首渲染即定 isLoggedIn（#115 ③）
 * - IDB 凭据后台校准（5s race 超时兜底，#115 ④）
 * - 监听 storage 事件实现跨标签页同步
 * - 提供 login/logout 方法
 *
 * @returns {LoginStatusReturn} 登录状态和相关方法
 */
export const useLoginStatus = (): LoginStatusReturn => {
  // [#115 ③] boot 快速判定：不等 IDB——WKWebView 启动期 IDB 挂起曾使判定
  // 卡在 false → 渲染登录页 → 自动登录 → reload 的整页闪烁循环（#115）。
  const [mirror] = useState(readMirrorSnapshot);
  const [isLoggedIn, setIsLoggedIn] = useState(!!mirror.userId);
  const [userId, setUserId] = useState<string | null>(mirror.userId);
  const [serverUrl, setServerUrl] = useState<string | null>(mirror.serverUrl);
  const [serverIp, setServerIp] = useState<string | null>(mirror.serverIp);

  // IDB 凭据后台校准（原 boot 主判定降级为校准，#115 ③④）：
  // - 墓碑在 + IDB 凭据残留 → 懒清除，保持登录页（logout 的 IDB 清除可能挂起）
  // - 镜像缺失 + IDB 有凭据（旧版本升级设备）→ 回填镜像并升格登录态
  // - IDB 读挂起 → 5s race 超时按「无 IDB 信息」处理，不清数据
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const creds = await Promise.race([
          loadLoginCredentials(),
          new Promise<null>((resolve) => {
            timeoutId = setTimeout(() => resolve(null), IDB_LOGIN_READ_TIMEOUT_MS);
          })
        ]);
        if (timeoutId) clearTimeout(timeoutId);
        const loggedOut = localStorage.getItem('starfit_logged_out') === '1';
        if (creds && creds.userId && loggedOut) {
          // Logout tombstone: IDB creds are stale (IDB delete can hang in
          // WKWebView) — ignore them and stay on the login page.
          clearLoginCredentials().catch(() => {});
          return;
        }
        if (creds && creds.userId && !localStorage.getItem('starfit_user_id')) {
          // 镜像缺失但 IDB 有凭据：回填镜像并置登录态
          setUserId(creds.userId);
          setIsLoggedIn(true);
          localStorage.setItem('starfit_user_id', creds.userId);
          if (creds.serverUrl) {
            setServerUrl(creds.serverUrl);
            localStorage.setItem('starfit_server_url', creds.serverUrl);
            const ip = creds.serverUrl.replace('http://', '').replace('/api', '').split(':')[0];
            setServerIp(ip);
            localStorage.setItem('starfit_server_ip', ip);
          }
        }
      } catch (e) {
        console.warn('[useLoginStatus] Failed to load from IDB (mirror state kept):', e);
      }
    })();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
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
    // [#115 ③] 凭据同步写先行（首个 await 之前）：旧序的镜像五连写全在 IDB
    // await 之后，window.location.reload()/刷新竞速会吃掉尾部写入 → boot 判定
    // 落空（墓碑残留/镜像缺失）→ 登录页 → 再次自动登录的循环自持（#115 RC1）。
    // 切号检测须先读旧墓碑（下方立即覆写 lastUserId）。
    const prevTombstoneUserId = localStorage.getItem(Keys.lastUserId);
    localStorage.setItem('starfit_user_id', newUserId);
    localStorage.setItem('starfit_server_url', newServerUrl);
    localStorage.setItem('starfit_server_ip', newServerIp);
    localStorage.setItem(Keys.lastUserId, newUserId);
    localStorage.removeItem('starfit_logged_out');

    // 状态先行置位：主界面渲染不等待任何存储 IO
    setUserId(newUserId);
    setServerUrl(newServerUrl);
    setServerIp(newServerIp);
    setIsLoggedIn(true);

    // [#82 方案A] 切号检测：上一身份优先取切号墓碑（LoginV2 在回调本方法前已把
    // IDB 凭据覆写为新用户，凭据读取仅作旧版本升级设备的兜底）。
    // 两处皆无 = 全新设备首次登录（含 guest 数据），不触发清理。
    const prevUserId =
      prevTombstoneUserId ||
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

    // Save to IDB —— 镜像已同步落盘，IDB 写后台完成即可（挂起不再致命）
    saveLoginCredentials(newUserId, newServerUrl).catch(console.error);
  };

  const logout = async () => {
    // Clear state
    setUserId(null);
    setServerUrl(null);
    setServerIp(null);
    setIsLoggedIn(false);

    // 存储侧清理收敛到共用路径（#108：401 强制登出复用同一链路）——
    // 双墓碑（切号 lastUserId / 切服务器 lastServerUrl）+ 清镜像 + IDB 凭据 best-effort
    await clearLoginSession();
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
