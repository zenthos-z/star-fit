import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ExerciseAction } from '../../../types/protocol';
import { Play, Pause, RotateCcw, CheckCircle2, Square, Timer, Ruler, Heart, Watch, Loader2, AlertCircle, Crosshair, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Polyline, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useGeolocation, LocationStatus } from '../../../hooks/useGeolocation';
import { wgs84ToGcj02 } from '../../../utils/coordTransform';
import { loadActiveTrack, saveActiveTrack, clearActiveTrack } from '../../../storage/activeTrack';
import { FollowModeController, LocationMarker } from './MapFollowController';
import { MapErrorBoundary } from './MapErrorBoundary';
import { CardHeader } from './CardHeader';
import { transitions } from '../../../lib/animations';
import { haptic } from '../../../../lib/nativeHaptics';
import { setTabBarHidden } from '../../../../lib/nativeTabBar';

interface OutdoorExerciseCardV2Props {
  exercise: ExerciseAction;
  isPaused?: boolean;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
}

const smoothSpring = transitions.springSmooth;

const OutdoorExerciseCardV2Content: React.FC<OutdoorExerciseCardV2Props> = ({ exercise, isPaused, onUpdate }) => {
  const metadata = exercise.metadata || {};
  const exerciseName = metadata.name || '户外运动';
  const targetHeartRateZone = metadata.targetHeartRateZone || '2';
  
  const currentSet = exercise.sets[0] || { index: 0, status: 'PLANNED', duration: 0, distance: 0 };
  
  const [isRunning, setIsRunning] = useState(false);
  const [isWaitingForGPS, setIsWaitingForGPS] = useState(false);
  const [isGpsTimeout, setIsGpsTimeout] = useState(false);
  const [elapsed, setElapsed] = useState(currentSet.duration || 0);
  const [isCompleted, setIsCompleted] = useState(currentSet.status === 'COMPLETED');
  // 心率录入：完成前可手动填（穿戴设备对接后可自动写入）
  const [heartRateInput, setHeartRateInput] = useState<string>(
    currentSet.heartRate ? String(currentSet.heartRate) : ''
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  // 断点续跑：检测到未完成轨迹时询问用户
  const [resumableTrack, setResumableTrack] = useState<{ elapsedSec: number; distanceM: number; points: number } | null>(null);
  // 全屏心率快填浮层
  const [showHrInput, setShowHrInput] = useState(false);
  // 瓦片源降级链：高德(国内直连最快) → 腾讯智图 → 标记失败
  const TILE_SOURCES = [
    {
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      attr: '&copy; 高德地图',
      subdomains: '1234',
    },
    {
      url: 'https://rt{s}.map.gtimg.com/realtimerender?z={z}&x={x}&y={y}&type=vector&style=0',
      attr: '&copy; 腾讯地图',
      subdomains: '012',
    },
  ] as const;
  const [tileIdx, setTileIdx] = useState(0);
  const tileUrl = TILE_SOURCES[tileIdx].url;
  const tileAttr = TILE_SOURCES[tileIdx].attr;
  const tileSubdomains = TILE_SOURCES[tileIdx].subdomains;
  const mapInstanceRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const uniqueMapId = useRef<string>(`map-${exercise.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const handleTileError = () => {
    if (tileIdx < TILE_SOURCES.length - 1) {
      console.log(`Tile source ${tileIdx} failed, switching to next...`);
      setTileIdx((i) => i + 1);
    } else {
      setMapLoadFailed(true);
    }
  };

  // Note: Map cleanup is handled internally by React Leaflet's MapContainer
  // Do NOT call map.remove() manually - it causes "Map container is being reused" error

  useEffect(() => {
    const handleBackButton = (e: Event) => {
      if (isFullscreen) {
        setIsFullscreen(false);
        e.preventDefault();
      }
    };

    window.addEventListener('starfit-back-button', handleBackButton);
    return () => window.removeEventListener('starfit-back-button', handleBackButton);
  }, [isFullscreen]);

  // 全屏时隐藏原生 TabBar（iOS 26 Liquid Glass 是原生层渲染，portal 到 body 盖不住它）
  useEffect(() => {
    if (isFullscreen) {
      setTabBarHidden(true);
      return () => setTabBarHidden(false);
    }
  }, [isFullscreen]);

  // 断点续跑：挂载时检查是否有未完成轨迹（刷新/闪退/切后台被杀后恢复入口）
  useEffect(() => {
    let cancelled = false;
    loadActiveTrack().then((track) => {
      if (!cancelled && track && track.positions.length > 0) {
        setResumableTrack({
          elapsedSec: track.elapsedSec,
          distanceM: track.distanceM,
          points: track.positions.length,
        });
      }
    }).catch((err) => console.warn('loadActiveTrack failed:', err));
    return () => { cancelled = true; };
  }, []);

  // 放弃恢复
  const handleDiscardResume = () => {
    clearActiveTrack().catch(() => undefined);
    setResumableTrack(null);
  };
  
  const { positions, distance: gpsDistance, reset: resetGps, markPause, status: locationStatus, error: locationError } = useGeolocation(isWaitingForGPS || (isRunning && !isPaused));
  
  const distance = (currentSet.distance || 0) + gpsDistance;
  
  const mode = (metadata.cardioMode || 'FREE_RUN') as 'TIME_COUNTDOWN' | 'DISTANCE_TARGET' | 'FREE_RUN';
  const targetDuration = metadata.targetDurationSec ? Number(metadata.targetDurationSec) : 0;
  const targetDistance = metadata.targetDistanceMeters ? Number(metadata.targetDistanceMeters) : 0;
  
  const timerRef = useRef<any>(null);
  const lastTickRef = useRef<number>(0);
  const gpsWaitStartTimeRef = useRef<number | null>(null);
  const gpsTimeoutCheckRef = useRef<number | null>(null);

  useEffect(() => {
    if (isWaitingForGPS && locationStatus === 'active') {
      setIsWaitingForGPS(false);
      setIsGpsTimeout(false);
      setIsRunning(true);
      if (gpsTimeoutCheckRef.current) {
        clearInterval(gpsTimeoutCheckRef.current);
        gpsTimeoutCheckRef.current = null;
      }
    }
  }, [isWaitingForGPS, locationStatus]);

  useEffect(() => {
    if (isWaitingForGPS && locationStatus === 'acquiring') {
      if (!gpsWaitStartTimeRef.current) {
        gpsWaitStartTimeRef.current = Date.now();
      }
      
      gpsTimeoutCheckRef.current = window.setInterval(() => {
        if (gpsWaitStartTimeRef.current) {
          const waitTime = Date.now() - gpsWaitStartTimeRef.current;
          if (waitTime >= 15000) {
            setIsGpsTimeout(true);
            if (gpsTimeoutCheckRef.current) {
              clearInterval(gpsTimeoutCheckRef.current);
              gpsTimeoutCheckRef.current = null;
            }
          }
        }
      }, 100);
    } else {
      if (gpsTimeoutCheckRef.current) {
        clearInterval(gpsTimeoutCheckRef.current);
        gpsTimeoutCheckRef.current = null;
      }
      gpsWaitStartTimeRef.current = null;
      if (!isWaitingForGPS) {
        setIsGpsTimeout(false);
      }
    }
    
    return () => {
      if (gpsTimeoutCheckRef.current) {
        clearInterval(gpsTimeoutCheckRef.current);
      }
    };
  }, [isWaitingForGPS, locationStatus]);

  useEffect(() => {
    if (isRunning && !isPaused) {
      lastTickRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const delta = (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;

        setElapsed(prev => {
          const next = prev + delta;
          if (mode === 'TIME_COUNTDOWN' && targetDuration > 0 && next >= targetDuration) {
            handleComplete(targetDuration);
            return targetDuration;
          }
          return next;
        });
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRunning, isPaused, mode, targetDuration]);

  // 轨迹节流落盘：每 10 个点写一次 Dexie，刷新/闪退/被杀最多丢 10 个点
  const lastSavedCountRef = useRef(0);
  useEffect(() => {
    if (!isRunning && !isWaitingForGPS) return;
    if (positions.length === 0) return;
    if (positions.length - lastSavedCountRef.current < 10) return;
    lastSavedCountRef.current = positions.length;
    saveActiveTrack({
      startedAt: Date.now() - elapsed * 1000,
      updatedAt: Date.now(),
      elapsedSec: elapsed,
      distanceM: gpsDistance,
      positions,
    }).catch((err) => console.warn('saveActiveTrack failed:', err));
  }, [positions, isRunning, isWaitingForGPS, elapsed, gpsDistance]);

  // 完成/撤销时清理持久化轨迹
  useEffect(() => {
    if (isCompleted) {
      clearActiveTrack().catch(() => undefined);
    }
  }, [isCompleted]);

  const syncToParent = (finalElapsed?: number, finalDistance?: number, finalStatus?: 'COMPLETED' | 'PLANNED') => {
    if (onUpdate) {
      const status = finalStatus ?? (isCompleted ? 'COMPLETED' : 'PLANNED');
      const hr = heartRateInput ? Number(heartRateInput) : undefined;
      onUpdate({
        sets: [{
          index: 0,
          duration: Math.floor(finalElapsed ?? elapsed),
          distance: Math.floor(finalDistance ?? distance),
          heartRate: hr && hr > 0 ? hr : undefined,
          status,
          timestamp: new Date().toISOString()
        }]
      });
    }
  };

  /** 心率输入变化：即时同步到父层（合法值才写） */
  const handleHeartRateChange = (value: string) => {
    setHeartRateInput(value);
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      // 直接带值同步，避免读旧 state
      if (onUpdate) {
        onUpdate({
          sets: [{
            index: 0,
            duration: Math.floor(elapsed),
            distance: Math.floor(distance),
            heartRate: n,
            status: isCompleted ? 'COMPLETED' : 'PLANNED',
            timestamp: new Date().toISOString()
          }]
        });
      }
    }
  };

  useEffect(() => {
    if (isRunning && mode === 'DISTANCE_TARGET' && targetDistance > 0 && distance >= targetDistance) {
      handleComplete(undefined, targetDistance);
    }
  }, [distance, isRunning, mode, targetDistance]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDistance = (meters: number) => {
    return (meters / 1000).toFixed(2);
  };

  // 配速（min/km，跑步行业标准）：最近 30 秒滑动窗口的瞬时配速，避免单点跳变
  const paceWindowRef = useRef<Array<{ t: number; d: number }>>([]);

  const currentPace = useMemo(() => {
    const now = elapsed;
    const win = paceWindowRef.current;
    win.push({ t: now, d: distance });
    // 只保留 30 秒窗口
    while (win.length > 2 && now - win[0].t > 30) win.shift();
    const first = win[0];
    const dt = now - first.t;
    const dd = distance - first.d;
    // 数据不足（<5 秒）或没在动 → 显示 --:--
    if (dt < 5 || dd < 1) return null;
    const secPerKm = (dt / dd) * 1000;
    // 异常防护：配速快于 1:00/km 或慢于 60:00/km 视为无效
    if (secPerKm < 60 || secPerKm > 3600) return null;
    const m = Math.floor(secPerKm / 60);
    const s = Math.floor(secPerKm % 60);
    return `${m}'${s.toString().padStart(2, '0')}"`;
  }, [elapsed, distance]);

  const handleToggle = () => {
    if (!isRunning) {
      setIsWaitingForGPS(true);
      gpsWaitStartTimeRef.current = Date.now();
      setIsGpsTimeout(false);
    } else {
      // 暂停：标记轨迹 gap，恢复后首点不算距不画线
      markPause();
      setIsRunning(false);
      setIsWaitingForGPS(false);
      setIsGpsTimeout(false);
      gpsWaitStartTimeRef.current = null;
    }

    syncToParent(undefined, undefined, 'PLANNED');
  };

  const handleForceStart = () => {
    setIsWaitingForGPS(false);
    setIsGpsTimeout(false);
    setIsRunning(true);
    gpsWaitStartTimeRef.current = null;
    syncToParent(undefined, undefined, 'PLANNED');
  };

  const handleCancelStart = () => {
    setIsWaitingForGPS(false);
    setIsGpsTimeout(false);
    gpsWaitStartTimeRef.current = null;
  };

  const handleComplete = (finalElapsed?: number, finalDistance?: number) => {
    setIsRunning(false);
    setIsCompleted(true);
    haptic('success'); // 户外完成：成功通知触感
    syncToParent(finalElapsed, finalDistance, 'COMPLETED');
  };

  const handleUndoComplete = () => {
    setIsCompleted(false);
    setIsRunning(false);
    setIsWaitingForGPS(false);
    setIsGpsTimeout(false);
    setElapsed(0);
    resetGps();
    syncToParent(0, 0, 'PLANNED');
  };

  // 轨迹渲染：WGS-84 → GCJ-02（国内底图加偏坐标系）。
  // 注意：useGeolocation 内部的距离累计仍用 WGS-84 原始值，不受此转换影响。
  const pathPositions: [number, number][] = positions.map(p => wgs84ToGcj02(p.latitude, p.longitude));
  const currentPosition = positions.length > 0 ? positions[positions.length - 1] : null;
  const currentHeading = currentPosition?.heading;
  // 人物标记坐标：必须与轨迹线同坐标系（GCJ-02），否则人在地图上偏移几百米
  const currentGcjPosition = pathPositions.length > 0 ? pathPositions[pathPositions.length - 1] : null;
  // 地图跟随：用户拖动后退出跟随，显示"回到中心"按钮
  const [following, setFollowing] = useState(true);
  const [followTrigger, setFollowTrigger] = useState(0);
  const recenter = () => {
    setFollowing(true);
    setFollowTrigger((n) => n + 1);
  };
  // 全屏切换时恢复跟随
  useEffect(() => {
    recenter();
  }, [isFullscreen]);

  const renderStats = () => {
    const isActive = isRunning || elapsed > 0 || isCompleted;

    return (
      <motion.div layout transition={smoothSpring} className="flex w-full items-center justify-center relative px-4 min-h-[5rem]">
        <AnimatePresence mode="popLayout">
          {mode === 'DISTANCE_TARGET' && (
            <motion.div layout key="dist-target-mode">
              {!isActive ? (
                <motion.div 
                  layout 
                  key="dist-target-only" 
                  initial={{ opacity: 0, scale: 0.9 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  exit={{ opacity: 0, scale: 0.9 }} 
                  transition={smoothSpring}
                  className="flex flex-col items-center mt-2"
                >
                  <div className="text-5xl font-bold tracking-tighter tabular-nums text-[#0f172a] leading-none">
                    {formatDistance(targetDistance)}
                  </div>
                  <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                    目标公里 (KM)
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  layout 
                  key="dist-active" 
                  initial={{ opacity: 0, x: 50 }} 
                  animate={{ opacity: 1, x: 0 }} 
                  exit={{ opacity: 0, x: -20 }} 
                  transition={smoothSpring}
                  className="flex flex-row items-center justify-between w-full px-4 mt-2"
                >
                   <div className="flex flex-col items-center">
                    <div className="text-[10px] font-bold text-gray-400 mb-1 tracking-widest uppercase">
                      目标 {formatDistance(targetDistance)}
                    </div>
                    <div className="text-5xl font-bold tracking-tighter tabular-nums text-[#0f172a] leading-none">
                      {formatDistance(distance)}
                    </div>
                    <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                      当前公里
                    </div>
                  </div>
                  <div className="w-px h-10 bg-gray-100 mx-4"></div>
                  <div className="flex flex-col items-center">
                    <div className="text-[10px] font-bold text-transparent mb-1 tracking-widest uppercase select-none">
                      目标 0.00
                    </div>
                    <div className="text-5xl font-bold tracking-tighter tabular-nums text-gray-400 leading-none">
                      {formatTime(elapsed)}
                    </div>
                    <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                      用时
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {mode === 'TIME_COUNTDOWN' && (
            <motion.div layout key="time-target-mode">
              {!isActive ? (
                <motion.div 
                  layout 
                  key="time-target-only" 
                  initial={{ opacity: 0, scale: 0.9 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  exit={{ opacity: 0, scale: 0.9 }} 
                  transition={smoothSpring}
                  className="flex flex-col items-center mt-2"
                >
                  <div className="text-5xl font-bold tracking-tighter tabular-nums text-[#0f172a] leading-none">
                    {formatTime(targetDuration)}
                  </div>
                  <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                    目标时长
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  layout 
                  key="time-active" 
                  initial={{ opacity: 0, x: 50 }} 
                  animate={{ opacity: 1, x: 0 }} 
                  exit={{ opacity: 0, x: -20 }} 
                  transition={smoothSpring}
                  className="flex flex-row items-center justify-between w-full px-4 mt-2"
                >
                   <div className="flex flex-col items-center">
                    <div className="text-[10px] font-bold text-transparent mb-1 tracking-widest uppercase select-none">
                      目标 0.00
                    </div>
                    <div className="text-5xl font-bold tracking-tighter tabular-nums text-gray-400 leading-none">
                      {formatDistance(distance)}
                    </div>
                    <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                      公里
                    </div>
                  </div>
                  <div className="w-px h-10 bg-gray-100 mx-4"></div>
                  <div className="flex flex-col items-center">
                    <div className="text-[10px] font-bold text-gray-400 mb-1 tracking-widest uppercase">
                      目标 {formatTime(targetDuration)}
                    </div>
                    <div className="text-5xl font-bold tracking-tighter tabular-nums text-[#0f172a] leading-none">
                      {isCompleted ? '00:00' : formatTime(Math.max(0, targetDuration - elapsed))}
                    </div>
                    <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                      {isCompleted ? '已达成' : '剩余时间'}
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {mode === 'FREE_RUN' && (
            <motion.div layout key="free-target-mode">
              {!isActive ? (
                <motion.div 
                  layout 
                  key="free-target-only" 
                  initial={{ opacity: 0, scale: 0.9 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  exit={{ opacity: 0, scale: 0.9 }} 
                  transition={smoothSpring}
                  className="flex flex-col items-center mt-2"
                >
                  <div className="text-5xl font-bold tracking-tighter tabular-nums text-[#0f172a] leading-none">
                    0.00
                  </div>
                  <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                    准备开跑 (KM)
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  layout 
                  key="free-active" 
                  initial={{ opacity: 0, x: 50 }} 
                  animate={{ opacity: 1, x: 0 }} 
                  exit={{ opacity: 0, x: -20 }} 
                  transition={smoothSpring}
                  className="flex flex-row items-center justify-between w-full px-4 mt-2"
                >
                  <div className="flex flex-col items-center">
                    <div className="text-[10px] font-bold text-transparent mb-1 tracking-widest uppercase select-none">
                      目标 0.00
                    </div>
                    <div className="text-5xl font-bold tracking-tighter tabular-nums text-[#0f172a] leading-none">
                      {formatDistance(distance)}
                    </div>
                    <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                      公里
                    </div>
                  </div>
                  <div className="w-px h-10 bg-gray-100 mx-4"></div>
                  <div className="flex flex-col items-center">
                    <div className="text-[10px] font-bold text-transparent mb-1 tracking-widest uppercase select-none">
                      目标 00:00
                    </div>
                    <div className="text-5xl font-bold tracking-tighter tabular-nums text-gray-400 leading-none">
                      {formatTime(elapsed)}
                    </div>
                    <div className="text-[10px] font-bold text-[#94a3b8] mt-2 uppercase tracking-widest">
                      用时
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  /** 心率录入行（统一色彩语义：心率=红色系） */
  const renderHeartRateInput = () => (
    <div className="w-full px-6 pb-3 pt-1 flex items-center justify-center gap-3">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-2xl border shrink-0 bg-white border-rose-100">
        <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-100" />
        <span className="text-[10px] font-semibold tracking-wide text-gray-500">目标 Zone {targetHeartRateZone}</span>
      </div>
      <div className="flex items-center gap-2 bg-white border border-rose-100 rounded-2xl px-3 py-1 flex-1 max-w-[10rem]">
        <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-100 shrink-0" />
        <input
          type="number"
          inputMode="numeric"
          min={40}
          max={220}
          placeholder="实时"
          value={heartRateInput}
          onChange={(e) => handleHeartRateChange(e.target.value)}
          disabled={isCompleted}
          className="w-full min-w-0 bg-transparent text-sm font-bold text-rose-600 outline-none placeholder-gray-300 placeholder:text-[10px] placeholder:tracking-wide [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[10px] font-semibold text-rose-400 tracking-wide shrink-0">BPM</span>
      </div>
    </div>
  );

  const renderMapContent = () => {
    if (!isRunning && !isWaitingForGPS && elapsed === 0 && !isCompleted) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
          <div className="flex flex-col items-center gap-3">
            <Maximize2 className="w-12 h-12 text-gray-300" />
            <div className="text-sm font-medium text-gray-400">点击开始后显示地图</div>
          </div>
        </div>
      );
    }

    return (
      <>
        {mapLoadFailed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 z-[999]">
            <AlertCircle className="w-12 h-12 text-gray-400 mb-3" />
            <div className="text-sm font-medium text-gray-600">地图加载失败</div>
            <button 
              onClick={() => setMapLoadFailed(false)}
              className="mt-3 px-4 py-2 bg-blue-500 text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors"
            >
              重试
            </button>
          </div>
        ) : (
          <MapErrorBoundary>
            <MapContainer
              key={isFullscreen ? 'fullscreen' : 'inline'}
              center={currentGcjPosition ?? [39.9042, 116.4074]}
              zoom={17}
              zoomSnap={0.5}
              scrollWheelZoom={isFullscreen}
              dragging={isFullscreen}
              touchZoom={isFullscreen}
              doubleClickZoom={isFullscreen}
              style={{ height: '100%', width: '100%', background: '#f9fafb' }}
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer
                url={tileUrl}
                attribution={tileAttr}
                subdomains={tileSubdomains}
                maxZoom={18}
                eventHandlers={{
                  tileerror: handleTileError
                }}
              />
              {pathPositions.length > 1 && (
                <Polyline
                  positions={pathPositions}
                  color="#10b981"
                  weight={5}
                  opacity={0.85}
                  lineJoin="round"
                  lineCap="round"
                />
              )}
              {currentGcjPosition && (
                <LocationMarker position={currentGcjPosition} heading={currentHeading} />
              )}
              <FollowModeController
                positions={pathPositions}
                followTrigger={followTrigger}
                onUserGesture={() => setFollowing(false)}
              />
            </MapContainer>
          </MapErrorBoundary>
        )}

        {resumableTrack && !isRunning && elapsed === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm z-[1001] p-4">
            <AlertCircle className="w-8 h-8 text-blue-500 mb-2" />
            <div className="text-sm font-bold text-gray-800">检测到未完成的运动</div>
            <div className="text-xs text-gray-500 mt-1 text-center">
              上次记录 {Math.floor(resumableTrack.elapsedSec / 60)} 分钟 · {(resumableTrack.distanceM / 1000).toFixed(2)} km · {resumableTrack.points} 个定位点
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleDiscardResume}
                className="px-4 py-2 border-2 border-gray-200 text-gray-600 text-xs font-bold rounded-full active:scale-95 transition-transform"
              >
                放弃
              </button>
              <button
                onClick={() => {
                  // 恢复：清掉持久化提示，直接进入 GPS 等待（本次会话重新累计；历史数据已同步到 sets）
                  setResumableTrack(null);
                  clearActiveTrack().catch(() => undefined);
                  handleToggle();
                }}
                className="px-4 py-2 bg-blue-500 text-white text-xs font-bold rounded-full shadow-lg shadow-blue-500/30 active:scale-95 transition-transform"
              >
                重新开始记录
              </button>
            </div>
          </div>
        )}

        {isWaitingForGPS && locationStatus === 'acquiring' && !isGpsTimeout && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-[1000]">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <div className="text-sm font-medium text-gray-600">正在获取位置...</div>
            <div className="text-xs text-gray-400 mt-1">请确保GPS已开启</div>
            <div className="text-xs text-gray-400 mt-2">等待GPS信号后自动开始计时</div>
          </div>
        )}

        {isWaitingForGPS && isGpsTimeout && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-orange-50/90 backdrop-blur-sm z-[1000] p-4">
            <AlertCircle className="w-8 h-8 text-orange-500 mb-2" />
            <div className="text-sm font-medium text-gray-700 text-center">无法获取GPS信号</div>
            <div className="text-xs text-gray-500 mt-2 text-center">已等待超过15秒，建议移至开阔区域或检查设置</div>
            <button 
              onClick={() => {
                setIsWaitingForGPS(false);
                setIsGpsTimeout(false);
                setIsRunning(true);
              }}
              className="mt-4 px-4 py-2 bg-orange-500 text-white text-xs font-bold rounded-full shadow-lg active:scale-95 transition-transform"
            >
              直接开始 (不记录轨迹)
            </button>
          </div>
        )}

        {(locationStatus === 'error' || locationStatus === 'permission_denied') && locationError && !isWaitingForGPS && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm z-[1000] p-4">
            <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
            <div className="text-sm font-medium text-gray-700 text-center">{locationError}</div>
            <div className="text-xs text-gray-400 mt-2 text-center max-w-[200px]">位置信息对记录轨迹和距离至关重要</div>
          </div>
        )}

        {locationStatus === 'active' && positions.length > 0 && (
          <div className="absolute top-3 left-3 z-[400] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/90 backdrop-blur-md shadow-sm border border-gray-100">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34C759] animate-pulse" />
            <span className="text-[9px] font-semibold tracking-wide text-gray-600">GPS</span>
          </div>
        )}
      </>
    );
  };



  return (
    <>
    <div className="p-8 bg-white rounded-[40px] shadow-sm border border-gray-50 relative overflow-hidden">
      <CardHeader name={exerciseName} type={exercise.type} className="mb-6" />

        <div className="flex flex-col rounded-3xl border border-gray-100 overflow-hidden mb-6 bg-gray-50/30">
        <div className={`relative flex flex-col items-center justify-center py-6 border-b border-gray-100 transition-all duration-500 ${
            isCompleted ? 'bg-[#f0fdf4]/50' : 'bg-transparent'
        }`}>
            <div className="w-full mt-1">
              {renderStats()}
            </div>
            {renderHeartRateInput()}
        </div>

        {isFullscreen ? (
          // 全屏：portal 到 body。SwipeableRow 的 contain:paint + transform 会让 fixed 以卡片为基准，
          // portal 是唯一可靠的全屏方式。视觉规范：Apple 体能训练（黑底大数字，数据在上、地图铺满）。
          createPortal(
            <div className="fixed inset-0 z-[99999] bg-black">
              {/* 地图铺满全屏 */}
              <div className="absolute inset-0">
                {renderMapContent()}
              </div>

              {/* 顶部返回按钮（iOS 导航规范：左上圆形玻璃按钮） */}
              <button
                onClick={() => setIsFullscreen(false)}
                aria-label="返回"
                className="absolute top-0 left-4 z-[100002] w-11 h-11 rounded-full liquid-glass-dark flex items-center justify-center active:scale-95 transition-transform"
                style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
              >
                <svg className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="none">
                  <path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* 底部悬浮玻璃数据栏（Apple Liquid Glass：圆角胶囊，浮于地图之上）
                  两行排布：上行=距离+时间（主指标），下行=配速+心率 */}
              <div
                className="absolute left-4 right-4 z-[100001] glass-clear rounded-[40px] px-6 pt-3.5 pb-4"
                style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
              >
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div className="flex flex-col gap-2">
                    <span className="text-[15px] font-semibold tracking-wide text-[#A3E635] whitespace-nowrap">距离</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[34px] font-bold tabular-nums text-white leading-none tracking-tight whitespace-nowrap">{formatDistance(distance)}</span>
                      <span className="text-[14px] font-semibold text-[#A3E635] whitespace-nowrap">公里</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-[15px] font-semibold tracking-wide text-[#FBBF24] whitespace-nowrap">时间</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[34px] font-bold tabular-nums text-white leading-none tracking-tight whitespace-nowrap">{formatTime(elapsed)}</span>
                      <span className="text-[14px] font-semibold text-[#FBBF24] whitespace-nowrap">分:秒</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-[15px] font-semibold tracking-wide text-[#38BDF8] whitespace-nowrap">配速</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-[34px] font-bold tabular-nums leading-none tracking-tight whitespace-nowrap ${currentPace ? 'text-white' : 'text-white/30'}`}>{currentPace ?? "--'--\""}</span>
                      <span className="text-[14px] font-semibold text-[#38BDF8] whitespace-nowrap">/公里</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowHrInput(true)}
                    className="flex flex-col gap-2 items-start active:opacity-70 transition-opacity"
                  >
                    <span className="text-[15px] font-semibold tracking-wide text-[#FB7185] whitespace-nowrap">心率</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-[34px] font-bold tabular-nums leading-none tracking-tight whitespace-nowrap ${heartRateInput ? 'text-white' : 'text-white/30'}`}>{heartRateInput || '--'}</span>
                      <span className="text-[14px] font-semibold text-[#FB7185] whitespace-nowrap">BPM</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* 定位按钮：数据栏上方 */}
              <button
                onClick={recenter}
                aria-label="回到我的位置"
                className={`absolute right-4 z-[100001] w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                  following
                    ? 'bg-[#007AFF] shadow-lg shadow-[#007AFF]/40'
                    : 'liquid-glass'
                }`}
                style={{ bottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + 168px)' }}
              >
                <Crosshair className={`w-5 h-5 ${following ? 'text-white' : 'text-[#007AFF]'}`} />
              </button>

              {/* 心率快填浮层 */}
              {showHrInput && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100003] liquid-glass-dark rounded-3xl p-5 flex items-center gap-3">
                  <Heart className="w-5 h-5 text-[#FB7185] fill-[#FB7185]/20 shrink-0" />
                  <input
                    autoFocus
                    type="number"
                    inputMode="numeric"
                    min={40}
                    max={220}
                    placeholder="实时心率"
                    value={heartRateInput}
                    onChange={(e) => handleHeartRateChange(e.target.value)}
                    className="w-24 bg-transparent text-xl font-bold tabular-nums text-white outline-none text-center placeholder-white/30 placeholder:text-sm"
                  />
                  <span className="text-xs font-semibold text-white/50 tracking-wide">BPM</span>
                  <button
                    onClick={() => setShowHrInput(false)}
                    className="ml-2 px-5 py-2 bg-[#007AFF] text-white text-sm font-semibold rounded-full active:opacity-70 transition-opacity"
                  >
                    完成
                  </button>
                </div>
              )}
            </div>,
            document.body
          )
        ) : (
          <div className="relative bg-gray-50 overflow-hidden h-48 w-full">
            {/* 全屏入口（右上角，规范尺寸） */}
            <button
              onClick={() => setIsFullscreen(true)}
              aria-label="进入全屏地图"
              className="absolute top-3 right-3 z-[1001] w-9 h-9 rounded-full bg-white/95 shadow-lg flex items-center justify-center active:scale-95 transition-transform"
            >
              <Maximize2 className="w-4 h-4 text-gray-700" />
            </button>
            {/* 定位按钮（仅自由浏览时出现，跟随中不打扰） */}
            {!following && positions.length > 0 && (
              <button
                onClick={recenter}
                aria-label="回到我的位置"
                className="absolute bottom-3 right-3 z-[1001] w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
              >
                <Crosshair className="w-4 h-4 text-[#007AFF]" />
              </button>
            )}
            <div
              id={`map-container-${uniqueMapId.current}`}
              ref={mapContainerRef}
              className="absolute top-0 left-0 w-full h-full"
            >
              {renderMapContent()}
            </div>
          </div>
        )}
      </div>

      <motion.div layout transition={smoothSpring} className="flex gap-3 h-12 w-full relative">
        <AnimatePresence mode="popLayout">
          {(isRunning || elapsed > 0 || isCompleted) && (
            <motion.div key="secondary" initial={{ opacity: 0, scale: 0.8, width: 0 }} animate={{ opacity: 1, scale: 1, width: 'auto' }} exit={{ opacity: 0, scale: 0.8, width: 0 }} transition={smoothSpring} className="flex-1 overflow-hidden">
              {isCompleted ? (
                <button onClick={handleUndoComplete} className="w-full h-full rounded-full flex items-center justify-center gap-2 border-2 bg-white text-gray-400 border-gray-100 active:scale-90 transition-all shadow-sm active:bg-gray-50">
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-widest">撤销</span>
                </button>
              ) : (
                <button onClick={() => handleComplete()} className={`w-full h-full rounded-full flex items-center justify-center gap-2 border-2 active:scale-90 transition-all shadow-sm ${isRunning ? 'bg-rose-50 text-rose-500 border-rose-100 active:bg-rose-100' : 'bg-emerald-50 text-emerald-500 border-emerald-100 active:bg-emerald-100'}`}>
                  {isRunning ? <Square className="w-4 h-4 fill-current" /> : <CheckCircle2 className="w-5 h-5" />}
                  <span className="text-sm font-bold uppercase tracking-widest">{isRunning ? '结束' : '完成'}</span>
                </button>
              )}
            </motion.div>
          )}

          <motion.div key="main" layout transition={smoothSpring} className="flex-[2.5]">
            {isWaitingForGPS && isGpsTimeout ? (
              <div className="w-full h-full flex gap-2">
                <button
                  onClick={handleCancelStart}
                  className="flex-1 h-full rounded-full flex items-center justify-center gap-2 border-2 border-gray-200 text-gray-600 active:scale-90 transition-all shadow-sm hover:bg-gray-50"
                >
                  <span className="text-sm font-bold uppercase tracking-widest">取消</span>
                </button>
                <button
                  onClick={handleForceStart}
                  className="flex-1 h-full rounded-full flex items-center justify-center gap-2 border-2 bg-blue-500 text-white active:scale-90 transition-all shadow-lg shadow-blue-500/30 hover:bg-blue-600"
                >
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-widest">强行开始</span>
                </button>
              </div>
            ) : (
              <button
                onClick={handleToggle}
                className={`w-full h-full rounded-full flex items-center justify-center gap-3 border-2 active:scale-90 transition-all shadow-sm relative overflow-hidden ${
                  isRunning 
                    ? 'bg-orange-50 text-orange-600 border-orange-200 active:bg-orange-100' 
                    : 'bg-white text-gray-800 border-gray-100 active:bg-gray-50'
                }`}
              >
                {isWaitingForGPS ? (
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                ) : isRunning ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current text-blue-500" />
                )}
                <span className="text-lg font-bold uppercase tracking-widest">{isWaitingForGPS ? '获取GPS中...' : (isRunning ? '暂停' : (elapsed > 0 ? '继续' : '开始'))}</span>
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
    </>
  );
};

export const OutdoorExerciseCardV2 = OutdoorExerciseCardV2Content;
