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
}

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
  const userDropdownRef = useRef<HTMLDivElement>(null);

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
          headers: { 'Accept': 'application/json' },
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
      } else {
        setError('未发现可用的服务器，请手动输入 IP 地址');
      }
    } catch (e) {
      setError('扫描失败: ' + (e as Error).message);
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
    // Use username for login
    setUserId(user.username || user.id);
    setShowUserDropdown(false);
  };

  const handleQRScan = (scannedUrl: string) => {
    setServerIp(formatServerUrl(scannedUrl));
  };

  const handleLogin = async () => {
    if (!serverIp.trim()) {
      setError('请输入服务器 IP');
      return;
    }
    if (!userId.trim()) {
      setError('请输入用户名或选择用户');
      return;
    }

    // Validate input format
    const validation = validateUsernameInput(userId);
    if (!validation.valid) {
      setError(validation.error || '输入格式无效');
      return;
    }

    const serverUrl = parseServerInput(serverIp);
    const trimmedUserId = userId.trim();

    // Verify server is reachable
    setError('');
    const healthCheck = await checkServerHealth(serverUrl, 5000);

    if (!healthCheck.ok) {
      setError(`无法连接到服务器: ${healthCheck.message}`);
      return;
    }

    try {
      // 调用登录或创建用户的 API
      const response = await fetch(`${serverUrl}/admin/login-or-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: trimmedUserId })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '登录失败' }));
        throw new Error(errorData.error || '登录失败');
      }

      const data = await response.json();

      // 使用后端返回的 userId（可能是新创建的）
      const finalUserId = data.userId || trimmedUserId;

      // 保存凭据
      await saveLoginCredentials(finalUserId, serverUrl);
      await addServerToHistory(serverUrl, healthCheck.latency);

      onLogin(finalUserId, serverUrl);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!hydrated) {
    return (
      <div className="fixed inset-0 z-[100] bg-star-white flex items-center justify-center">
        <div className="text-gray-400 text-sm font-bold">加载中...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-star-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black text-star-dark tracking-tighter">PROJECT STARFIT</h1>
          <p className="text-gray-400 font-bold text-sm tracking-widest uppercase">Agent Data Isolation</p>
        </div>

        {/* Login Form */}
        <div className="bg-white p-8 rounded-3xl shadow-white-model space-y-6">
          <div className="space-y-4">
            {/* Server IP Input with Integrated Scan Buttons - NOW FIRST */}
            <div className="space-y-1">
              <label className="text-xs font-black text-gray-400 uppercase ml-1">服务器 IP</label>
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
              <p className="text-[10px] text-gray-400 font-bold mt-1 ml-1 uppercase">
                系统将自动连接到 http://IP:43111/api
              </p>
            </div>

            {/* User ID Input with Dropdown - NOW SECOND */}
            <div className="space-y-1 relative" ref={userDropdownRef}>
              <label className="text-xs font-black text-gray-400 uppercase ml-1">用户名</label>
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

              <p className="text-[10px] text-gray-400 font-bold mt-1 ml-1 uppercase">
                用户名：2-20字符，支持字母、数字、下划线和中文
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
                    ) : users.filter(u => u.username).length > 0 ? (
                      users.filter(u => u.username).map((user) => (
                        <button
                          key={user.id}
                          onClick={() => handleSelectUser(user)}
                          className="w-full text-left px-5 py-3 hover:bg-star-gray transition-all"
                        >
                          <span className="font-bold text-star-dark text-sm">{user.username}</span>
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

          {/* Login Button */}
          <button
            onClick={handleLogin}
            className="w-full bg-star-dark text-white font-black py-5 rounded-2xl shadow-floating active:scale-95 transition-all"
          >
            开始同步与训练
          </button>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
            Starfit v2.0 - Deep Isolation Protocol
          </p>
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
