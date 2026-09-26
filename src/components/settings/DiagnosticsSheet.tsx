/**
 * DiagnosticsSheet — 同步诊断面板（从 History.tsx 原样抽取的底部 sheet）。
 *
 * C2（issue #6）信息页 ··· 菜单与旧历史页共用本组件，行为零改动：
 * console 捕获、连通性 ping、强制同步、手动 API 覆盖、版本指纹、身份信息。
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { SyncService } from '@/services/syncService';
import { storageSet } from '@/storage';
import { API_BASE, setApiBase, getHeaders } from '@/services/geminiService';
import { loadHistory } from '@/storage';
import { WatchDiagnosticsCard } from './WatchStatusCard';

export interface DiagnosticsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function DiagnosticsSheet({ open, onClose }: DiagnosticsSheetProps): JSX.Element | null {
  const [syncStatus, setSyncStatus] = useState('');
  const [pingResult, setPingResult] = useState<any>(null);
  const [netLogs, setNetLogs] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [userId, setUserId] = useState('');
  const [loginName, setLoginName] = useState('');

  // Auto-capture console logs when debug is open
  useEffect(() => {
    if (!open) return;

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const logToNet = (type: string, ...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        setNetLogs(prev => [`[${type}] ${msg}`, ...prev].slice(0, 100));
    };

    console.log = (...args) => {
        originalLog(...args);
        logToNet('LOG', ...args);
    };
    console.error = (...args) => {
        originalError(...args);
        logToNet('ERROR', ...args);
    };
    console.warn = (...args) => {
        originalWarn(...args);
        logToNet('WARN', ...args);
    };

    return () => {
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    SyncService.getDeviceId().then(setDeviceId);
    // Get current user ID from localStorage
    const currentUserId = localStorage.getItem('starfit_user_id');
    if (currentUserId) {
      setUserId(currentUserId);
    }
    // 登录名解析（2026-09-20）：优先 localStorage（登录时写入）；自动登录（UUID 直连）
    // 没写过 → 查 /admin/users 按 UUID 匹配 display_name，结果回写缓存。
    const cachedName = localStorage.getItem('starfit_login_username');
    if (cachedName) {
      setLoginName(cachedName);
    } else if (currentUserId) {
      (async () => {
        try {
          const res = await fetch(`${API_BASE}/admin/users`, { headers: getHeaders() });
          if (!res.ok) return;
          const users = await res.json();
          const match = Array.isArray(users)
            ? users.find((u: any) => u.user_id === currentUserId || u.id === currentUserId)
            : null;
          const name = match?.display_name || match?.username;
          if (name) {
            localStorage.setItem('starfit_login_username', String(name));
            setLoginName(String(name));
          }
        } catch { /* 后端不可达时保持空，显示占位提示 */ }
      })();
    }
  }, [open]);

  const handlePing = async () => {
    setPingResult('Testing...');
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);

    try {
        // 2026-09-20 修复：原实现裸 fetch 不带鉴权头，后端开启鉴权时 /api/ping 必 401，
        // 表现为"测试 ping 不正常"。统一走 getHeaders（与其他 API 一致），
        // 并先探根级 /healthz（免令牌通道）定位是网络问题还是鉴权问题。
        log(`GET /healthz (no-auth probe): ${API_BASE.replace('/api', '')}/healthz`);
        const hzStart = Date.now();
        const resHz = await fetch(`${API_BASE.replace('/api', '')}/healthz`, { mode: 'cors' });
        const hzMs = Date.now() - hzStart;
        log(resHz.ok ? `/healthz OK (${hzMs}ms)` : `/healthz Failed: ${resHz.status}`);

        log(`GET /api/ping (authed): ${API_BASE}/ping`);
        const start = Date.now();
        const resGet = await fetch(`${API_BASE}/ping`, { mode: 'cors', headers: getHeaders({}, false) });
        const end = Date.now();

        if (resGet.ok) {
            const data = await resGet.json();
            log(`GET Success (${end-start}ms): ${JSON.stringify(data)}`);
        } else {
            log(`GET Failed: ${resGet.status} ${resGet.statusText}`);
        }

        // Also test POST (preflight + body)
        log(`POST Test to: ${API_BASE}/sync/push`);
        const postStart = Date.now();
        const resPost = await fetch(`${API_BASE}/sync/push`, {
            method: 'POST',
            mode: 'cors',
            headers: { ...getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: 'ping-test', sessions: [] })
        });
        const postEnd = Date.now();

        if (resPost.ok) {
            log(`POST Success (${postEnd-postStart}ms)`);
            setPingResult(`Success (GET+POST)`);
        } else {
            const txt = await resPost.text();
            log(`POST Failed: ${resPost.status} - ${txt.substring(0, 20)}`);
            setPingResult(`POST Failed: ${resPost.status}`);
        }
    } catch (e: any) {
        log(`ERROR: ${e.message}`);
        setPingResult(`Error: ${e.message}`);
    }
    setNetLogs(prev => [...logs, ...prev]);
  };

  const handleForceSync = async () => {
      setSyncStatus('正在同步...');
      console.log('[Diagnostics] Starting Force Sync...');

      try {
          const did = await SyncService.getDeviceId();
          console.log(`[Diagnostics] DeviceID: ${did}`);

          const allHistory = await loadHistory() || [];
          const ids = allHistory.map((s: any) => s.id);
          console.log(`[Diagnostics] Found ${ids.length} sessions in history`);

          await storageSet('STARFIT_SYNC_QUEUE', ids);
          SyncService.queue = ids;

          console.log('[Diagnostics] Starting Push (via syncAll)...');
          await SyncService.syncAll();
          console.log('[Diagnostics] Push Done. Starting Pull...');

          await SyncService.pull();
          console.log('[Diagnostics] Pull Done.');

          setSyncStatus(`同步完成`);
          setTimeout(() => window.location.reload(), 1500); // Give time to read logs
      } catch (e: any) {
          console.error(`[Diagnostics] Force Sync Error: ${e.message}`, e);
          setSyncStatus(`失败: ${e.message}`);
      }
  };

  const handleResetSyncState = async () => {
      if(!window.confirm('确定要强制同步吗？')) return;
      // Full sync is now the default - this just triggers a fresh pull
      SyncService.pull().then(() => {
          setSyncStatus('同步完成');
          setTimeout(() => setSyncStatus(''), 2000);
      }).catch(e => {
          setSyncStatus(`同步失败: ${e.message}`);
      });
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fixed inset-x-0 bottom-0 z-[90] bg-gray-900 text-gray-200 p-4 rounded-t-[40px] shadow-2xl max-w-md mx-auto"
        style={{ paddingBottom: 'calc(16px + var(--safe-bottom, 0px))', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
            <h3 className="font-mono text-sm font-bold text-star-primary">DIAGNOSTICS</h3>
            <button onClick={onClose} aria-label="关闭诊断" className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 active:scale-90">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>

        {/* 0. Apple Watch 连接状态（实时，WCSession 真源；非 iOS 不渲染） */}
        <WatchDiagnosticsCard />

        {/* 1. Environment Info */}
        <div className="bg-black/30 p-2 rounded mb-3 space-y-1">
            <div className="text-[10px] text-gray-400">API_BASE (Current)</div>
            <div className="font-mono text-xs text-green-400 break-all">
                {API_BASE}
            </div>
            {/* Manual Override Input */}
            <div className="flex gap-1 mt-2">
                <input
                    id="manual-api-input"
                    type="text"
                    placeholder="Set Manual API URL (e.g. http://192.168.1.5:43111)"
                    className="flex-1 bg-black/50 border border-gray-700 rounded px-2 py-1 text-[10px] text-white font-mono focus:border-star-primary outline-none"
                    onKeyDown={(e) => {
                        if(e.key === 'Enter') {
                            setApiBase(e.currentTarget.value);
                        }
                    }}
                />
                <button
                    onClick={() => {
                        const input = document.getElementById('manual-api-input') as HTMLInputElement;
                        if (input && input.value) {
                            setApiBase(input.value);
                        } else {
                            alert('Please enter a URL first');
                        }
                    }}
                    className="bg-star-primary/80 hover:bg-star-primary text-white px-3 rounded text-[10px] font-bold transition-colors"
                >
                    Save
                </button>
                 <button
                    onClick={() => {
                        if(window.confirm('确定重置为自动检测的地址吗？')) {
                            localStorage.removeItem('STARFIT_API_BASE');
                            alert('已重置，应用即将重启。');
                            window.location.href = window.location.origin + window.location.pathname + '?r=' + Date.now();
                        }
                    }}
                    className="bg-red-900/30 text-red-400 px-2 rounded text-[9px] border border-red-900 hover:bg-red-900/50"
                >
                    Reset
                </button>
            </div>

            <div className="text-[10px] text-gray-400 mt-1">User Agent</div>
            <div className="font-mono text-[9px] text-gray-500 break-all leading-tight">
                {navigator.userAgent}
            </div>
        </div>

        {/* 2. Controls */}
        <div className="grid grid-cols-2 gap-2 mb-3">
            <button
                onClick={handlePing}
                className="bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 text-xs font-bold py-2 rounded border border-blue-800/50"
            >
                Test Connectivity (Ping)
            </button>
            <button
                onClick={handleForceSync}
                className="bg-star-primary/20 hover:bg-star-primary/30 text-star-primary text-xs font-bold py-2 rounded border border-star-primary/50"
            >
                Force Sync (Push+Pull)
            </button>
        </div>

        {/* 3. Results Area */}
        <div className="space-y-2">
            {/* Sync Status Badge */}
            {syncStatus && (
                <div className="flex items-center gap-2 px-2 py-1 bg-black/40 rounded border border-gray-800">
                    <div className={`w-2 h-2 rounded-full ${syncStatus.includes('失败') || syncStatus.includes('ERROR') ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`}></div>
                    <span className="text-[10px] font-mono text-gray-300">{syncStatus}</span>
                </div>
            )}

            {/* Ping Result */}
            {pingResult && (
                <div className={`p-2 rounded text-xs font-mono border ${pingResult.error ? 'bg-red-900/20 border-red-900' : 'bg-green-900/20 border-green-900'}`}>
                    <div className="font-bold mb-1">{pingResult.error ? 'PING FAILED' : 'PING SUCCESS'}</div>
                    <pre className="whitespace-pre-wrap break-all text-[10px] opacity-80">
                        {JSON.stringify(pingResult, null, 2)}
                    </pre>
                </div>
            )}

            {/* Sync Logs */}
            {netLogs.length > 0 && (
                <div className="bg-black/50 p-2 rounded text-[10px] font-mono text-gray-400 h-48 overflow-y-auto border border-gray-800">
                    {netLogs.map((l, i) => (
                        <div key={i} className={`border-b border-gray-900/50 py-0.5 ${l.includes('ERROR') ? 'text-red-400' : l.includes('SUCCESS') ? 'text-green-400' : ''}`}>
                            {l}
                        </div>
                    ))}
                </div>
            )}

            {/* Version Fingerprint（调试用：确认手机端是不是新包） */}
            <div className="bg-black/30 p-2 rounded mb-3 flex items-center justify-between">
                <div>
                    <div className="text-[10px] text-gray-400">App Version</div>
                    <div className="font-mono text-xs text-cyan-300">
                        v{import.meta.env.VITE_PKG_VERSION ?? '?'} · build {import.meta.env.VITE_BUILD_TS ?? '?'}
                    </div>
                </div>
            </div>

            {/* User ID Display */}
            <div className="text-[10px] text-gray-500 mt-2 flex items-center gap-2">
                <span>UserID:</span>
                <code className="bg-black/50 px-1 rounded select-all text-yellow-300 font-mono">{userId || 'Not logged in'}</code>
            </div>

            <div className="text-[10px] text-gray-500 flex items-center gap-2">
                <span>登录名:</span>
                <code className="bg-black/50 px-1 rounded select-all text-green-300 font-mono">
                    {loginName || '（解析中…后端不可达则空）'}
                </code>
            </div>

            <div className="text-[10px] text-gray-500 flex items-center gap-2">
                <span>DeviceID:</span>
                <code className="bg-black/50 px-1 rounded select-all text-gray-300 font-mono">{deviceId || 'Generating...'}</code>
            </div>
            <div className="flex justify-between items-center gap-2 mt-2">
                <button onClick={handleResetSyncState} className="text-[10px] text-red-500 underline">强制同步</button>
            </div>
        </div>
      </div>
    </motion.div>
  );
}
