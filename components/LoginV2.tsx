/**
 * LoginV2 - Enhanced Login Component with Server Scanning
 *
 * Features:
 * - Server IP input FIRST (swapped order)
 * - Auto-fetch users when server is valid
 * - User ID input with dropdown selection
 * - Integrated scan button inside input field
 * - Scanning animation with spinner
 * - Server list popup for selection
 * - Auto-discover LAN servers
 * - Integration with L2 IDB storage
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isNativeTabBar, hideTabBar } from '../src/lib/nativeTabBar';
import {
  detectServer,
  checkServerHealth,
  formatServerUrl,
  parseServerInput
} from '../services/serverDetector';
import {
  saveLoginCredentials,
  loadLoginCredentials,
  loadServerHistory,
  addServerToHistory
} from '../storage';
import { getAccessToken, setAccessToken } from '../services/geminiService';
import QRScanner from './QRScanner';

interface LoginProps {
  onLogin: (userId: string, serverUrl: string) => void;
}

interface DiscoveredServer {
  url: string;
  source: string;
  latency?: number;
}

interface User {
  id: string;
  username?: string;
  /** GET /admin/users 实际返回的人类可读 ID（无 username 字段） */
  display_name?: string;
}

/** 下拉列表展示/登录用的用户标识：username 兜底 display_name */
const getUserLabel = (u: User): string => u.username || u.display_name || '';

// Chevron Down Icon
const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2.5}
    stroke="currentColor"
    className={className}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

// Simple Radar/Scan Icon
const ScanIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={className}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

// Loading Spinner Icon
const SpinnerIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2.5}
    stroke="currentColor"
    className={className}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
    />
  </svg>
);

/**
 * Frontend validation for username input
 * @note UUID format is still accepted for backward compatibility, but not mentioned in UI
 */
const validateUsernameInput = (value: string): { valid: boolean; error?: string } => {
  if (!value.trim()) return { valid: false, error: '请输入用户名' };

  // Silently accept UUID format for backward compatibility
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(value)) return { valid: true };

  if (value.length < 2) return { valid: false, error: '用户名至少2个字符' };
  if (value.length > 20) return { valid: false, error: '用户名最多20个字符' };

  const usernamePattern = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/;
  if (!usernamePattern.test(value)) return { valid: false, error: '只能包含字母、数字、下划线和中文' };

  return { valid: true };
};

const LoginV2: React.FC<LoginProps> = ({ onLogin }) => {
  const [userId, setUserId] = useState('');
  const [serverIp, setServerIp] = useState('');
  const [accessToken, setAccessTokenState] = useState('');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([]);
  const [showServerList, setShowServerList] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [isServerValid, setIsServerValid] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [autoLoginStatus, setAutoLoginStatus] = useState<'idle' | 'connecting' | 'failed'>('idle');
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const autoLoginAttemptedRef = useRef(false);

  // 登录页隐藏原生 Tab Bar：
  // MainTabBar 只在登录后的分支渲染，注销 reload 后没人调 hideTabBar()，
  // 原生 SwiftUI TabBar 会常驻在登录页上——挂载时主动隐藏 + 撤掉底部让位。
  useEffect(() => {
    if (!isNativeTabBar) return;
    hideTabBar();
    document.body.classList.remove('native-tabbar');
    return () => { document.body.classList.add('native-tabbar'); };
  }, []);

  // 键盘避让（HIG：正在编辑的输入框必须保持可见）：
  // 全局 KeyboardResize.None（capacitor.config.ts，防整页顶上灵动岛），
  // webview 不缩放，可见性由页面自管——键盘高度注入 paddingBottom 推起表单。
  // keyboardHeight 是键盘净高，中文输入法的候选联想条会再高一截，
  // 故补 ACCESSORY_INSET 余量；另加聚焦框 scrollIntoView 居中兜底（不依赖高度猜准）。
  const [kbHeight, setKbHeight] = useState(0);
  const focusedElRef = useRef<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 记录正在编辑的输入框（聚焦切换时键盘已弹起、不会再发 willShow，须单独跟）
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        focusedElRef.current = t;
        // 键盘已开着时的聚焦切换：按当前 kbHeight 做确定性避让
        if (kbHeight > 0) {
          const tryReveal = () => {
            const el = focusedElRef.current;
            const container = scrollContainerRef.current;
            if (!el || !container) return;
            const elBottom = el.getBoundingClientRect().bottom + 40;
            const visibleBottom = container.getBoundingClientRect().bottom;
            const delta = elBottom - visibleBottom;
            if (delta > 0) container.scrollTop += delta;
          };
          [320, 550, 850].forEach((ms) => setTimeout(tryReveal, ms));
        }
      }
    };
    window.addEventListener('focusin', onFocusIn, true);
    return () => window.removeEventListener('focusin', onFocusIn, true);
  }, [kbHeight]);

  useEffect(() => {
    let cancelled = false;
    const handles: import('@capacitor/core').PluginListenerHandle[] = [];
    // 确定性避让：聚焦框底边(含 helper 文案 ~40px)与「可视区底线 = viewport 高 - 键盘总高」直接求差，
    // 差多少滚多少——不猜输入法候选条高度。可视区 = scrollContainer 自身高度（fixed inset-0 被压缩后）。
    // 直接赋值 scrollTop（WKWebView 对嵌套容器 smooth scrollBy 常被吞），
    // 键盘动画期间布局在变，320/550/850ms 三次重试直到滚够
    const revealFocused = () => {
      const tryReveal = () => {
        const el = focusedElRef.current;
        const container = scrollContainerRef.current;
        if (!el || !container) return false;
        const elBottom = el.getBoundingClientRect().bottom + 40; // 输入框 + 下方 helper 文案
        const visibleBottom = container.getBoundingClientRect().bottom; // 容器底边=键盘顶
        const delta = elBottom - visibleBottom;
        if (delta > 0) container.scrollTop += delta;
      };
      [320, 550, 850].forEach((ms) => setTimeout(() => { tryReveal(); }, ms));
    };
    (async () => {
      try {
        const { Keyboard } = await import('@capacitor/keyboard');
        if (cancelled) return;
        handles.push(
          await Keyboard.addListener('keyboardWillShow', (info) => {
            // +56：中文输入法候选条在键盘净高之外
            const total = (info?.keyboardHeight ?? 0) + 56;
            setKbHeight(total);
            revealFocused();
          }),
          await Keyboard.addListener('keyboardWillHide', () => setKbHeight(0)),
        );
      } catch { /* 非 Capacitor 环境（纯浏览器调试）：静默降级 */ }
    })();
    return () => {
      cancelled = true;
      handles.forEach(h => h.remove());
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load saved credentials on mount
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    (async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Load credentials timeout')), 5000);
        });
        const creds: any = await Promise.race([loadLoginCredentials(), timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);
        if (creds.userId) setUserId(creds.userId);
        if (creds.serverUrl) {
          setServerIp(formatServerUrl(creds.serverUrl));
        }
        setAccessTokenState(getAccessToken() || '');
      } catch (e) {
        console.warn('[LoginV2] Failed to load credentials:', e);
      } finally {
        setHydrated(true);
      }
    })();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // 自动登录：有保存的凭据（= 非第一次使用）时静默直连上次服务器。
  // 第一次使用（无凭据）不受影响 —— 手动输入 / 点放大镜扫描。
  useEffect(() => {
    if (!hydrated || autoLoginAttemptedRef.current) return;
    autoLoginAttemptedRef.current = true;
    if (!serverIp.trim() || !userId.trim()) return; // 第一次使用：什么都不做
    setAutoLoginStatus('connecting');
    loginWithCredentials(serverIp, userId, true).then((ok) => {
      if (!ok) setAutoLoginStatus('failed'); // 失败停在已填好的表单，等用户手动
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Fetch users when server IP changes and is valid
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const fetchUsers = async () => {
      if (!serverIp.trim()) {
        setIsServerValid(false);
        setUsers([]);
        return;
      }

      const serverUrl = parseServerInput(serverIp);
      setIsLoadingUsers(true);
      setError('');

      try {
        // Quick health check + fetch users
        const response = await fetch(`${serverUrl}/admin/users`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(getAccessToken() ? { 'X-Access-Token': getAccessToken()! } : {})
          },
          signal: AbortSignal.timeout(3000)
        });

        if (response.ok) {
          const data = await response.json();
          const userList = Array.isArray(data) ? data : (data.users || []);
          setUsers(userList);
          setIsServerValid(true);
        } else {
          setUsers([]);
          setIsServerValid(false);
        }
      } catch (e) {
        setUsers([]);
        setIsServerValid(false);
      } finally {
        setIsLoadingUsers(false);
      }
    };

    // Debounce fetch
    timeoutId = setTimeout(() => {
      fetchUsers();
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [serverIp]);

  const handleScan = async () => {
    setIsScanning(true);
    setError('');
    setDiscoveredServers([]);

    try {
      const result = await detectServer();

      if (result) {
        setDiscoveredServers([result]);
        setShowServerList(true);
      }
      // 未命中：静默收场，不弹错误——用户直接在输入框手输 IP 即可
    } catch (e) {
      console.warn('[LoginV2] Scan failed:', e);
      setDiscoveredServers([]);
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelectServer = (server: DiscoveredServer) => {
    setServerIp(formatServerUrl(server.url));
    setShowServerList(false);
    setDiscoveredServers([]);

    // Add to history
    addServerToHistory(server.url, server.latency).catch(console.error);
  };

  const handleSelectUser = (user: User) => {
    // Use username (or display_name returned by /admin/users) for login
    setUserId(getUserLabel(user) || user.id);
    setShowUserDropdown(false);
  };

  const handleQRScan = (scannedUrl: string) => {
    setServerIp(formatServerUrl(scannedUrl));
  };

  /**
   * 登录核心：健康检查 → login-or-create → 保存凭据 → onLogin。
   * @param silent true = 自动登录路径（上次凭据直连）：失败不弹红色错误，
   *               只标记 autoLoginStatus 让用户看到"自动连接失败"，停在已填好的表单前。
   */
  const loginWithCredentials = async (rawServerIp: string, rawUserId: string, silent = false): Promise<boolean> => {
    const ip = rawServerIp.trim();
    const uid = rawUserId.trim();
    if (!ip || !uid) return false;

    if (!silent) {
      const validation = validateUsernameInput(uid);
      if (!validation.valid) {
        setError(validation.error || '输入格式无效');
        return false;
      }
    }

    const serverUrl = parseServerInput(ip);

    if (!silent) setError('');
    const healthCheck = await checkServerHealth(serverUrl, silent ? 3000 : 5000);

    if (!healthCheck.ok) {
      if (silent) {
        setAutoLoginStatus('failed');
        return false;
      }
      setError(`无法连接到服务器: ${healthCheck.message}`);
      return false;
    }

    try {
      // 调用登录或创建用户的 API
      const response = await fetch(`${serverUrl}/admin/login-or-create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken.trim() ? { 'X-Access-Token': accessToken.trim() } : {})
        },
        body: JSON.stringify({ userId: uid })
      });

      if (response.status === 401) {
        throw new Error('访问令牌错误或未填写，请检查后重试');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '登录失败' }));
        throw new Error(errorData.error || '登录失败');
      }

      const data = await response.json();

      // 使用后端返回的 userId（可能是新创建的）
      const finalUserId = data.userId || uid;

      // 保存凭据（token 存 localStorage，getHeaders 自动携带）
      setAccessToken(accessToken.trim() || null);
      await saveLoginCredentials(finalUserId, serverUrl);
      await addServerToHistory(serverUrl, healthCheck.latency);

      onLogin(finalUserId, serverUrl);
      return true;
    } catch (e) {
      if (silent) {
        setAutoLoginStatus('failed');
        return false;
      }
      setError((e as Error).message);
      return false;
    }
  };

  const handleLogin = () => loginWithCredentials(serverIp, userId);

  if (!hydrated) {
    return (
      <div className="fixed inset-0 z-[100] bg-star-white flex items-center justify-center">
        <div className="text-gray-400 text-sm font-bold">加载中...</div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className={`fixed left-0 right-0 top-0 z-[100] bg-star-white flex flex-col items-center px-6 overflow-y-auto ${
        kbHeight > 0 ? 'justify-start' : 'justify-center'
      }`}
      style={{
        // 键盘弹出：容器底边直接提到键盘顶（+56 候选条余量）——WebKit 里容器自身的
        // padding-bottom 不产生可滚动溢出（实测 scrollHeight==clientHeight），padding 路线无效。
        bottom: kbHeight > 0 ? `${kbHeight}px` : '0px',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}
    >
      <div className="w-full max-w-md space-y-8">
        {/* Header — STARFIT 文字标志（对齐 AI 教练 Welcome 屏终版） */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-tighter text-star-dark">
            STAR<span className="text-star-accent">FIT</span>
          </h1>
          <p className="text-gray-400 text-[13px] font-medium">登录到你的训练服务器</p>
        </div>

        {/* Login Form */}
        <div className="bg-white p-8 rounded-3xl shadow-white-model space-y-6">
          <div className="space-y-4">
            {/* Server IP Input with Integrated Scan Buttons - NOW FIRST */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-500 ml-1">服务器地址</label>
              <div className="relative">
                <input
                  type="text"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder="例如: 192.168.1.100"
                  className="w-full bg-star-gray border-none rounded-2xl px-5 py-4 pr-24 text-star-dark font-bold placeholder:text-gray-300 focus:ring-2 focus:ring-star-accent transition-all outline-none"
                />
                {/* Scan Buttons Container */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {/* QR Scan Button */}
                  <button
                    onClick={() => setShowQRScanner(true)}
                    className="p-2 rounded-lg text-gray-400 hover:text-star-accent hover:bg-star-accent/10 active:scale-90 transition-all"
                    title="扫描二维码"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="w-5 h-5"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                    </svg>
                  </button>

                  {/* Divider */}
                  <div className="w-px h-4 bg-gray-300" />

                  {/* LAN Scan Button */}
                  <button
                    onClick={handleScan}
                    disabled={isScanning}
                    className={`
                      p-2 rounded-lg transition-all
                      ${isScanning
                        ? 'text-gray-400 cursor-wait'
                        : 'text-gray-400 hover:text-star-accent hover:bg-star-accent/10 active:scale-90'
                      }
                    `}
                    title="扫描局域网服务器"
                  >
                    {isScanning ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-5 h-5"
                      >
                        <SpinnerIcon className="w-full h-full" />
                      </motion.div>
                    ) : (
                      <ScanIcon className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 font-medium mt-1 ml-1">
                将自动连接 http://IP:43111/api
              </p>
            </div>

            {/* Access Token Input — 服务器启用鉴权时必填 */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-500 ml-1">访问令牌</label>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessTokenState(e.target.value)}
                placeholder="未开启令牌验证时可留空"
                autoComplete="off"
                className="w-full bg-star-gray border-none rounded-2xl px-5 py-4 text-star-dark font-semibold placeholder:text-gray-300 placeholder:font-medium focus:ring-2 focus:ring-star-accent transition-all outline-none"
              />
              <p className="text-[11px] text-gray-400 font-medium mt-1 ml-1">
                向服务器管理员获取，用于公网访问验证
              </p>
            </div>

            {/* User ID Input with Dropdown - NOW SECOND */}
            <div className="space-y-1.5 relative" ref={userDropdownRef}>
              <label className="text-[13px] font-medium text-gray-500 ml-1">用户名</label>
              <div className="relative">
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  onFocus={() => setShowUserDropdown(true)}
                  placeholder="例如: test002"
                  className="w-full bg-star-gray border-none rounded-2xl px-5 py-4 pr-12 text-star-dark font-bold placeholder:text-gray-300 focus:ring-2 focus:ring-star-accent transition-all outline-none"
                />
                {/* Dropdown Arrow - Only show when users available */}
                {(users.length > 0 || isServerValid) && (
                  <button
                    onClick={() => setShowUserDropdown(!showUserDropdown)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-gray-400 hover:text-star-accent transition-all"
                  >
                    {isLoadingUsers ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-5 h-5"
                      >
                        <SpinnerIcon className="w-full h-full" />
                      </motion.div>
                    ) : (
                      <ChevronDownIcon className={`w-5 h-5 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} />
                    )}
                  </button>
                )}
              </div>

              <p className="text-[11px] text-gray-400 font-medium mt-1 ml-1">
                2-20 字符，支持字母、数字、下划线和中文
              </p>

              {/* User Dropdown List */}
              <AnimatePresence>
                {showUserDropdown && (users.length > 0 || isLoadingUsers || isServerValid) && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="absolute z-10 w-full mt-1 bg-white rounded-2xl shadow-2xl border border-gray-100 max-h-60 overflow-y-auto"
                  >
                    {isLoadingUsers ? (
                      <div className="p-4 text-center text-gray-400 text-sm font-bold">
                        加载用户列表...
                      </div>
                    ) : users.filter(u => getUserLabel(u)).length > 0 ? (
                      users.filter(u => getUserLabel(u)).map((user) => (
                        <button
                          key={user.id}
                          onClick={() => handleSelectUser(user)}
                          className="w-full text-left px-5 py-3 hover:bg-star-gray transition-all"
                        >
                          <span className="font-bold text-star-dark text-sm">{getUserLabel(user)}</span>
                        </button>
                      ))
                    ) : isServerValid ? (
                      <div className="p-4 text-center text-gray-400 text-sm">
                        服务器上暂无用户，请直接输入用户名创建
                      </div>
                    ) : (
                      <div className="p-4 text-center text-gray-400 text-sm">
                        请先输入有效的服务器 IP
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 text-red-500 text-xs font-bold p-4 rounded-2xl text-center"
            >
              {error}
            </motion.div>
          )}

          {/* Auto-login status（自动直连反馈：连接中禁点，失败后可手动重试） */}
          {autoLoginStatus !== 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`text-xs font-bold p-3 rounded-2xl text-center ${
                autoLoginStatus === 'connecting'
                  ? 'bg-star-gray text-gray-500'
                  : 'bg-amber-50 text-amber-600'
              }`}
            >
              {autoLoginStatus === 'connecting'
                ? '正在连接上次的服务器…'
                : '自动连接上次服务器失败，请检查后重试或重新扫描'}
            </motion.div>
          )}

          {/* Login Button — 胶囊主行动钮（对齐 SettlementV2 双钮规范） */}
          <button
            onClick={handleLogin}
            disabled={autoLoginStatus === 'connecting'}
            className={`w-full h-[50px] bg-star-dark text-white font-semibold text-[17px] rounded-full shadow-floating transition-all ${
              autoLoginStatus === 'connecting' ? 'opacity-60 cursor-wait' : 'active:scale-95'
            }`}
          >
            {autoLoginStatus === 'connecting' ? '正在连接…' : '登录'}
          </button>
        </div>
      </div>

      {/* QR Scanner Modal */}
      <QRScanner
        isOpen={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={handleQRScan}
      />

      {/* Server List Modal */}
      <AnimatePresence>
        {showServerList && discoveredServers.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setShowServerList(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-black text-star-dark mb-2">
                  发现 {discoveredServers.length} 个服务器
                </h3>
                <p className="text-xs text-gray-400 mb-4">点击选择服务器自动填入 IP</p>

                <div className="space-y-2">
                  {discoveredServers.map((server, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      onClick={() => handleSelectServer(server)}
                      className="w-full text-left p-4 bg-star-gray rounded-2xl hover:bg-star-accent/10 active:scale-95 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-star-dark text-sm truncate">
                            {formatServerUrl(server.url)}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-1 uppercase">
                            来源: {server.source}
                            {server.latency !== undefined && (
                              <span className="ml-2">延迟: {server.latency}ms</span>
                            )}
                          </p>
                        </div>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className="w-5 h-5 text-star-accent ml-2 group-hover:scale-110 transition-transform"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    </motion.button>
                  ))}
                </div>

                <button
                  onClick={() => setShowServerList(false)}
                  className="w-full mt-4 py-3 text-sm font-bold text-gray-400 hover:text-star-dark transition-colors"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LoginV2;
