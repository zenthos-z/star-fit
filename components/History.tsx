/**
 * History — 运动记录页（iOS Large Title 形态）
 *
 * 2026-09-08 设计规范改造：
 * - 去右上角 ×（tab 页无关闭语义，与 tab bar 重复）
 * - 导出/导入/设置/诊断/注销 整合为右上角单「···」菜单
 * - Large Title：滚动前 34px 大标题，滚动后导航栏 17px 居中小标题淡入
 * - 安全区：顶部 var(--safe-top)，底部 pb 留 tab bar 余量
 * - 诊断面板改为底部 sheet（圆角 rounded-t-[40px] 全局统一）
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Session, Exercise } from '../types';
import { DEFAULT_BODYWEIGHT } from '../constants';
import SwipeableRow from './SwipeableRow';
import { SyncService } from '../services/syncService';
import { storageSet } from '../storage';
import { API_BASE, setApiBase, getHeaders } from '../services/geminiService';
import { useLoginStatus } from '../src/hooks/useLoginStatus';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../src/lib/nativeHaptics';
import { List } from 'react-window';

const calculateVolume = (ex: Exercise) => {
   let vol = 0;
   const bodyweight = ex.referenceBodyweight || DEFAULT_BODYWEIGHT;
   const isCardioOrOutdoor = ex.type === 'cardio' || ex.type === 'outdoor' || ex.metadata?.isOutdoor;

   ex.sets.forEach(set => {
       if (!set.completed) return;
       const reps = set.reps || 0;
       const weight = set.weight || 0;
       const duration = set.duration || 0;

       switch (ex.type) {
           case 'resistance': vol += weight * reps; break;
           case 'unilateral': vol += weight * reps * 2; break;
           case 'bodyweight': vol += (bodyweight + weight) * reps; break;
           case 'assisted': vol += Math.max(0, (bodyweight - weight)) * reps; break;
           case 'isometric': vol += (weight > 0 ? weight : bodyweight) * duration; break;
           case 'cardio':
           case 'outdoor':
               break;
       }
   });
   return vol;
};

interface HistoryProps {
  sessions: Session[];
  onClose: () => void;
  onSelect: (s: Session) => void;
  onImport: (data: Session[]) => void;
  onDelete: (sessionId: string) => void;
  onOpenSettings?: () => void;
  isTransitioning?: boolean;
}

const SessionItem = ({ index, style, sessions, onSelect, onDelete }: { index: number; style: any; sessions: Session[]; onSelect: (s: Session) => void; onDelete: (sessionId: string) => void }) => {
  const session = sessions[index];
  const dateObj = new Date(session.startTime);
  const dateStr = dateObj.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  const timeStr = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const duration = Math.floor((session.endTime! - session.startTime - session.pausedDuration) / 1000 / 60);
  const totalVolume = session.exercises.reduce((acc, ex) => acc + calculateVolume(ex), 0);
  const exerciseCount = session.exercises.length;
  const exerciseNames = session.exercises.map(e => e.name).slice(0, 3).join(', ');

  return (
    <div style={{ ...style, paddingBottom: '16px', paddingLeft: '8px', paddingRight: '8px' }}>
      <SwipeableRow
        key={session.id}
        className="rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
        leftActions={[
          {
            label: '删除',
            icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
            color: 'bg-red-500',
            onClick: () => onDelete(session.id)
          }
        ]}
        rightActions={[]}
      >
        <div
          onClick={() => onSelect(session)}
          role="button"
          aria-label={`${dateStr} 训练记录，${duration} 分钟`}
          className="w-full bg-white p-5 text-left active:bg-gray-50 transition-all rounded-2xl rounded-tl-sm"
        >
          <div className="flex justify-between items-start mb-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-star-primary shadow-[0_0_8px_rgba(24,24,27,0.2)]"></div>
                <span className="text-sm font-black text-star-dark uppercase tracking-tight">{dateStr}</span>
                <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">{timeStr}</span>
              </div>
              <p className="text-[11px] text-gray-400 font-medium truncate max-w-[240px] italic">
                {exerciseNames}{session.exercises.length > 3 ? '...' : ''}
              </p>
            </div>
            <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-active:text-star-primary transition-colors" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-gray-50">
            <div className="flex flex-col">
              <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">时长</span>
              <span className="text-sm font-mono font-black text-star-dark">{duration}<span className="text-[10px] ml-0.5 font-sans font-bold text-gray-400">分</span></span>
            </div>
            <div className="flex flex-col border-l border-gray-100 pl-3">
              <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">容量</span>
              <span className="text-sm font-mono font-black text-star-dark">{totalVolume}<span className="text-[10px] ml-0.5 font-sans font-bold text-gray-400">kg</span></span>
            </div>
            <div className="flex flex-col border-l border-gray-100 pl-3">
              <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">组数</span>
              <span className="text-sm font-mono font-black text-star-dark">{session.exercises.reduce((acc, ex) => acc + ex.sets.filter(s => s.completed).length, 0)}</span>
            </div>
          </div>
        </div>
      </SwipeableRow>
    </div>
  );
};

// --- 菜单项（···菜单用，iOS Action Menu 风格）---
const MENU_ICONS: Record<string, React.ReactNode> = {
  export: <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />,
  json: <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />,
  import: <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-18-9l6.75-6.75L12 4.5m-9 3L9.75 11.25M12 4.5v9" />,
  settings: <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
  debug: <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M4.5 15.5l-.5 3.5m15-3.5l.5 3.5M7.5 21h9" />,
  logout: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />,
};

function MenuItem({ icon, label, onClick, danger = false }: { icon: string; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left active:bg-gray-100 ${danger ? 'text-red-600' : 'text-gray-800'}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5 opacity-70" aria-hidden="true">
        {MENU_ICONS[icon]}
      </svg>
      <span className="text-[15px] font-medium">{label}</span>
    </button>
  );
}

const History: React.FC<HistoryProps> = ({ sessions, onSelect, onImport, onDelete, onOpenSettings }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 30);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Sync Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [pingResult, setPingResult] = useState<any>(null);
  const [netLogs, setNetLogs] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [userId, setUserId] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const { logout } = useLoginStatus();

  // Auto-capture console logs when debug is open
  React.useEffect(() => {
    if (!showDebug) return;

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
  }, [showDebug]);

  React.useEffect(() => {
    SyncService.getDeviceId().then(setDeviceId);
    // Get current user ID from localStorage
    const currentUserId = localStorage.getItem('starfit_user_id');
    if (currentUserId) {
      setUserId(currentUserId);
    }
  }, []);

  // --- Data Management Handlers ---

  const handleExportJSON = () => {
    if (sessions.length === 0) {
        alert("暂无记录可导出");
        return;
    }
    const dataStr = JSON.stringify(sessions, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starfit_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = async () => {
    if (sessions.length === 0) {
        alert("暂无记录可导出");
        return;
    }

    try {
      const uid = localStorage.getItem('starfit_user_id');
      if (!uid) {
        alert("用户未登录，无法导出 Markdown 报告");
        return;
      }

      const res = await fetch(`${API_BASE}/admin/users/${uid}/export-markdown`, {
        headers: getHeaders()
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `导出失败: ${res.status}`);
      }

      const data = await res.json();
      const blob = new Blob([data.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_report_${uid.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出报告失败: ' + (err as Error).message);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const result = evt.target?.result as string;
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
                // Simple validation check
                const isValid = parsed.every(s => s.id && s.startTime && Array.isArray(s.exercises));
                if (!isValid) {
                    alert("文件格式不正确，无法识别为 Starfit 数据。");
                    return;
                }

                if (window.confirm(`解析到 ${parsed.length} 条记录。\n是否导入并合并到现有记录中？`)) {
                    onImport(parsed);
                }
            } else {
                alert("文件格式错误 (非数组)。");
            }
        } catch (err) {
            alert("文件解析失败，请确保是有效的 JSON 备份文件。");
        }
    };
    reader.readAsText(file);
    // Reset to allow selecting same file again
    e.target.value = '';
  };

  const handlePing = async () => {
    setPingResult('Testing...');
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);

    try {
        log(`GET Ping to: ${API_BASE.replace('/api', '')}/api/ping`);
        const start = Date.now();
        const resGet = await fetch(`${API_BASE.replace('/api', '')}/api/ping`, { mode: 'cors' });
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
            headers: { 'Content-Type': 'application/json' },
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
      console.log('[History] Starting Force Sync...');

      try {
          const { API_BASE } = await import('../services/geminiService');
          console.log(`[History] API_BASE: ${API_BASE}`);

          const did = await SyncService.getDeviceId();
          console.log(`[History] DeviceID: ${did}`);

          const { loadHistory } = await import('../storage/index');
          const allHistory = await loadHistory() || [];
          const ids = allHistory.map((s: any) => s.id);
          console.log(`[History] Found ${ids.length} sessions in history`);

          await storageSet('STARFIT_SYNC_QUEUE', ids);
          SyncService.queue = ids;

          console.log('[History] Starting Push (via syncAll)...');
          await SyncService.syncAll();
          console.log('[History] Push Done. Starting Pull...');

          await SyncService.pull();
          console.log('[History] Pull Done.');

          setSyncStatus(`同步完成`);
          setTimeout(() => window.location.reload(), 1500); // Give time to read logs
      } catch (e: any) {
          console.error(`[History] Force Sync Error: ${e.message}`, e);
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

  const handleLogout = async () => {
    if(!window.confirm('确定要注销登录吗？')) return;
    await logout();
    window.location.reload();
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="fixed inset-0 bg-star-gray z-[100] overflow-y-auto"
      onScroll={handleScroll}
    >
      {/* 隐藏文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="h-full flex flex-col px-4 pb-20 max-w-md mx-auto">

        {/* Navbar — iOS Large Title：滚动后居中小标题淡入；右上角单「···」菜单 */}
        <div
          className="sticky top-0 z-20 -mx-4 px-4 bg-star-gray/85 backdrop-blur-md"
          style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)', paddingBottom: '10px' }}
        >
          <div className="relative flex justify-end items-center h-11">
            <span
              className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold text-star-dark transition-opacity duration-200 pointer-events-none"
              style={{ opacity: isScrolled ? 1 : 0 }}
              aria-hidden={!isScrolled}
            >
              运动记录
            </span>
            <button
                onClick={() => { haptic('light'); setMenuOpen(!menuOpen); }}
                aria-label="更多操作"
                aria-expanded={menuOpen}
                className={`w-11 h-11 rounded-full shadow-sm transition-all active:scale-90 flex items-center justify-center ${menuOpen ? 'bg-star-primary text-white' : 'bg-white text-gray-600'}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-5 h-5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
            </button>
          </div>
        </div>

        {/* Large Title — 滚动时折叠 */}
        <h2
          className="text-[34px] leading-[41px] font-black text-star-dark tracking-tight transition-all duration-200 overflow-hidden"
          style={{ opacity: isScrolled ? 0 : 1, maxHeight: isScrolled ? 0 : 60, marginBottom: isScrolled ? 0 : 16 }}
        >
          运动记录
        </h2>

        {/* ··· 菜单：导出/导入/设置/诊断/注销 */}
        <AnimatePresence>
          {menuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-30"
              />
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                role="menu"
                className="absolute right-4 z-40 w-60 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100 p-1.5 flex flex-col gap-0.5"
                style={{ top: 'calc(var(--safe-top, 0px) + 60px)' }}
              >
                <MenuItem icon="export" label="导出 Markdown 战报" onClick={() => { setMenuOpen(false); handleExportMarkdown(); haptic('light'); }} />
                <MenuItem icon="json" label="导出 JSON 备份" onClick={() => { setMenuOpen(false); handleExportJSON(); haptic('light'); }} />
                <MenuItem icon="import" label="导入备份" onClick={() => { setMenuOpen(false); handleImportClick(); haptic('medium'); }} />
                <div className="my-1 h-px bg-gray-100 mx-2" />
                {onOpenSettings && <MenuItem icon="settings" label="设置" onClick={() => { setMenuOpen(false); onOpenSettings(); haptic('light'); }} />}
                <MenuItem icon="debug" label="诊断" onClick={() => { setMenuOpen(false); setShowDebug(true); haptic('light'); }} />
                <div className="my-1 h-px bg-gray-100 mx-2" />
                <MenuItem icon="logout" label="注销登录" danger onClick={() => { setMenuOpen(false); handleLogout(); }} />
                <div className="text-[9px] text-gray-300 text-center pt-1.5 pb-0.5 italic">数据加密存储于本地 · 建议定期备份</div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Sync Debug Panel — 底部 sheet（rounded-t-[40px] 全局统一）*/}
        {showDebug && (
            <div className="fixed inset-x-0 bottom-0 z-50 bg-gray-900 text-gray-200 p-4 rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom-6 max-w-md mx-auto" style={{ paddingBottom: 'calc(16px + var(--safe-bottom, 0px))' }}>
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-mono text-sm font-bold text-star-primary">DIAGNOSTICS</h3>
                    <button onClick={() => setShowDebug(false)} aria-label="关闭诊断" className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 active:scale-90">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

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

                    {/* User ID Display */}
                    <div className="text-[10px] text-gray-500 mt-2 flex items-center gap-2">
                        <span>UserID:</span>
                        <code className="bg-black/50 px-1 rounded select-all text-yellow-300 font-mono">{userId || 'Not logged in'}</code>
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
        )}

        {/* List */}
        {sessions.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-50" role="status">
                <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4 text-gray-400" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <p className="text-gray-500 font-medium">暂无历史记录</p>
                <p className="text-xs text-gray-400 mt-1">完成一次训练后在此查看</p>
            </div>
        ) : (
            <div className="flex-1 overflow-hidden">
              <List
                defaultHeight={600}
                rowCount={sessions.length}
                rowHeight={150}
                rowProps={{ sessions, onSelect, onDelete } as any}
                rowComponent={SessionItem}
                style={{ height: 600, width: '100%' }}
              />
            </div>
        )}

      </div>
    </motion.div>
  );
};

export default History;
