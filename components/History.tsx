import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Session, Exercise } from '../types';
import { DEFAULT_BODYWEIGHT } from '../constants';
import SwipeableRow from './SwipeableRow';
import { SyncService } from '../services/syncService';
import { storageGet, storageSet } from '../storage';
import { Keys } from '../storage/schemas';
import { API_BASE, setApiBase, getHeaders } from '../services/geminiService';
import { useLoginStatus } from '../src/hooks/useLoginStatus';
import { motion, AnimatePresence } from 'framer-motion';
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
            <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-active:text-star-primary transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-gray-50">
            <div className="flex flex-col">
              <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">时长</span>
              <span className="text-sm font-mono font-black text-star-dark">{duration}<span className="text-[10px] ml-0.5 opacity-40">m</span></span>
            </div>
            <div className="flex flex-col border-l border-gray-100 pl-3">
              <span className="text-[9px] text-gray-400 uppercase font-black tracking-widest leading-none mb-1">容量</span>
              <span className="text-sm font-mono font-black text-star-dark">{totalVolume}<span className="text-[10px] ml-0.5 opacity-40">kg</span></span>
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

const History: React.FC<HistoryProps> = ({ sessions, onClose, onSelect, onImport, onDelete, isTransitioning = false }) => {
  const [showContent, setShowContent] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Sync Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [pingResult, setPingResult] = useState<any>(null);
  const [netLogs, setNetLogs] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [userId, setUserId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullThreshold = 80;
  const startY = useRef(0);
  const currentY = useRef(0);
  const isPulling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { logout } = useLoginStatus();

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      startY.current = e.touches[0].pageY;
      isPulling.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling.current) return;
    currentY.current = e.touches[0].pageY;
    const diff = currentY.current - startY.current;

    if (diff > 0) {
      if (e.cancelable) e.preventDefault();
      const progress = Math.min(diff, pullThreshold + 20);
      setPullProgress(progress);
    } else {
      isPulling.current = false;
      setPullProgress(0);
    }
  }, [pullThreshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    setPullProgress(prev => {
      if (prev >= pullThreshold) {
        setIsRefreshing(true);
        setPullProgress(pullThreshold);
        (async () => {
          try {
            await SyncService.push();
            await SyncService.pull();
          } catch (e) {
            console.error('Refresh failed', e);
          } finally {
            setTimeout(() => {
              setIsRefreshing(false);
              setPullProgress(0);
            }, 500);
          }
        })();
      }
      return 0;
    });
  }, [pullThreshold]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

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
    setExportMenuOpen(false);
  };

  const handleExportMarkdown = async () => {
    if (sessions.length === 0) {
        alert("暂无记录可导出");
        return;
    }
    
    try {
      const userId = localStorage.getItem('starfit_user_id');
      if (!userId) {
        alert("用户未登录，无法导出 Markdown 报告");
        return;
      }
      
      const res = await fetch(`${API_BASE}/admin/users/${userId}/export-markdown`, {
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
      a.download = `training_report_${userId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportMenuOpen(false);
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



  // 1. 获取 NetLogs (从 window 对象或 Service 注入，这里简单模拟/读取)
  // 为了真实抓取，我们需要在 fetch 上做文章，或者让 SyncService 暴露 log
  // 这里暂时只显示手动触发的 log
  
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

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      await SyncService.push();
      await SyncService.pull();
      // Simple alert as showToast is not defined in this scope
      alert('同步成功');
    } catch (e: any) {
      console.error(e);
      setSyncError(e.message || '同步失败');
      alert('同步失败: ' + (e.message || '未知错误'));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleForceSync = async () => {
      setSyncStatus('正在同步...');
      console.log('[History] Starting Force Sync...');
      
      try {
          const { API_BASE } = await import('../services/geminiService');
          console.log(`[History] API_BASE: ${API_BASE}`);
          
          const deviceId = await SyncService.getDeviceId();
          console.log(`[History] DeviceID: ${deviceId}`);
          
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
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -10 }}
      transition={{
        type: 'spring',
        stiffness: 350,
        damping: 28
      }}
      className="fixed inset-0 bg-star-gray/90 backdrop-blur-sm z-[100] overflow-y-auto"
    >
      {/* Pull to Refresh Indicator */}
      <div 
        className="absolute top-0 left-0 right-0 flex items-center justify-center overflow-hidden transition-all duration-200 pointer-events-none"
        style={{ 
          height: `${pullProgress}px`,
          opacity: pullProgress / pullThreshold
        }}
      >
        <div className={`p-2 rounded-full bg-white shadow-md border border-gray-100 transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
             style={{ transform: `rotate(${pullProgress * 3}deg)` }}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5 text-star-primary">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </div>
      </div>

      <div className="h-full flex flex-col px-4 py-6 pb-20 max-w-md mx-auto" style={{ transform: pullProgress > 0 ? `translateY(${pullProgress/2}px)` : 'none' }}>
        
        {/* Navbar */}
        <div className="flex justify-between items-center mb-8 sticky top-0 bg-star-gray/90 backdrop-blur-md py-4 z-10 -mx-4 px-4">
            <h2 className="text-2xl font-black text-star-dark tracking-tight">运动记录</h2>
            <div className="flex gap-2">
                <button 
                    onClick={() => setShowDebug(!showDebug)}
                    className={`p-2 rounded-full shadow-sm transition-all active:scale-90 ${showDebug ? 'bg-star-primary text-white' : 'bg-white text-gray-400'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                    </svg>
                </button>
                <button onClick={onClose} className="bg-white rounded-full p-2 shadow-sm text-gray-600 hover:text-black transition-all active:scale-90">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>

        {/* Sync Debug Panel */}
        {showDebug && (
            <div className="mb-6 bg-gray-900 text-gray-200 p-4 rounded-xl shadow-lg border border-gray-700 animate-in slide-in-from-top-5">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-mono text-sm font-bold text-star-primary">DIAGNOSTICS</h3>
                    <span className="text-[10px] bg-gray-800 px-2 py-1 rounded text-gray-400">V1.1</span>
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
                        <button
                          onClick={handleLogout}
                          className="text-[10px] bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded font-bold transition-colors"
                        >
                          注销登录
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* List */}
        {sessions.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-50">
                <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4 text-gray-400">
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

        {/* Data Management Section */}
        <div className="mt-4 pt-4 border-t border-gray-100 relative">
            <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">数据管理</h3>
                <span className="text-[8px] font-mono text-gray-300">DATA V2.1</span>
            </div>
            <div className="flex gap-3">
                <div className="flex-1 relative">
                    <button 
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        className={`w-full bg-white border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl shadow-sm hover:bg-gray-50 active:scale-95 transition-all flex items-center justify-center gap-2 ${exportMenuOpen ? 'border-star-primary ring-2 ring-star-primary/10' : ''}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5 text-gray-400">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                        <span className="text-[11px]">导出</span>
                    </button>

                    <AnimatePresence>
                        {exportMenuOpen && (
                            <>
                                <motion.div 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setExportMenuOpen(false)}
                                    className="fixed inset-0 z-40"
                                />
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-2xl shadow-2xl border border-gray-100 p-1.5 z-50 flex flex-col gap-1 overflow-hidden"
                                >
                                    <button 
                                        onClick={handleExportMarkdown}
                                        className="flex items-center gap-3 p-2.5 hover:bg-gray-50 rounded-xl transition-colors text-left group"
                                    >
                                        <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="text-[11px] font-black text-gray-900 uppercase italic">Markdown</div>
                                            <div className="text-[9px] text-gray-400 font-medium">战报报告 (推荐)</div>
                                        </div>
                                    </button>
                                    <button 
                                        onClick={handleExportJSON}
                                        className="flex items-center gap-3 p-2.5 hover:bg-gray-50 rounded-xl transition-colors text-left group"
                                    >
                                        <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="text-[11px] font-black text-gray-900 uppercase italic">JSON</div>
                                            <div className="text-[9px] text-gray-400 font-medium">原始数据备份</div>
                                        </div>
                                    </button>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                </div>

                <button 
                    onClick={handleImportClick}
                    className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl shadow-sm hover:bg-gray-50 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5 text-gray-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="text-[11px]">导入</span>
                </button>
            </div>
            <p className="text-[9px] text-gray-300 mt-2 text-center italic font-medium">
                数据加密存储于本地。建议定期备份以防丢失。
            </p>
        </div>

      </div>
    </motion.div>
  );
};

export default History;
