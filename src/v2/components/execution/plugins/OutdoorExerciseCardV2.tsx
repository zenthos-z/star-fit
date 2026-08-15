import React, { useState, useEffect, useRef } from 'react';
import { ExerciseAction } from '../../../types/protocol';
import { Play, Pause, RotateCcw, CheckCircle2, MapPin, Square, Navigation, Map as MapIcon, Timer, Ruler, Heart, Watch, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Polyline, useMap, CircleMarker, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useGeolocation, LocationStatus } from '../../../hooks/useGeolocation';
import { MapErrorBoundary } from './MapErrorBoundary';
import { getExerciseTypeLabel } from '../../../../utils/exerciseTypeLabels';

const fixLeafletIcon = () => {
  if (typeof window !== 'undefined' && L.Icon.Default) {
    // @ts-ignore
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    });
  }
};

fixLeafletIcon();

const DirectionArrow = ({ center, heading }: { center: [number, number], heading?: number }) => {
  const map = useMap();

  const icon = L.divIcon({
    className: 'custom-direction-icon',
    html: `
      <div style="
        width: 32px;
        height: 32px;
        background: #10b981;
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(${heading ?? 0}deg);
      ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M12 2L4 22L12 16L20 22L12 2Z"/>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  if (heading === undefined || heading === null) {
    return null;
  }

  return <Marker position={center} icon={icon} />;
};

interface OutdoorExerciseCardV2Props {
  exercise: ExerciseAction;
  isPaused?: boolean;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
}

const smoothSpring = {
  type: "spring",
  stiffness: 400,
  damping: 30,
  mass: 0.8
} as const;

const MapController = ({ positions, isInteractive }: { positions: [number, number][], isInteractive: boolean }) => {
  const map = useMap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (positions.length > 0) {
      const lastPos = positions[positions.length - 1];
      
      if (!isInteractive || !hasInitialized.current) {
        map.setView(lastPos, map.getZoom());
        hasInitialized.current = true;
      }
    }
  }, [positions, map, isInteractive]);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);
    return () => clearTimeout(timer);
  }, [isInteractive, map]);

  return null;
};

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [tileUrl, setTileUrl] = useState('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
  const [tileAttr, setTileAttr] = useState('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>');
  const mapInstanceRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const uniqueMapId = useRef<string>(`map-${exercise.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const handleTileError = () => {
    if (tileUrl.includes('cartocdn')) {
      console.log('CartoDB tiles failed, switching to OSM...');
      setTileUrl('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      setTileAttr('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
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
  
  const { positions, distance: gpsDistance, reset: resetGps, status: locationStatus, error: locationError } = useGeolocation(isWaitingForGPS || (isRunning && !isPaused));
  
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

  const syncToParent = (finalElapsed?: number, finalDistance?: number, finalStatus?: 'COMPLETED' | 'PLANNED') => {
    if (onUpdate) {
      const status = finalStatus ?? (isCompleted ? 'COMPLETED' : 'PLANNED');
      onUpdate({
        sets: [{
          index: 0,
          duration: Math.floor(finalElapsed ?? elapsed),
          distance: Math.floor(finalDistance ?? distance),
          status,
          timestamp: new Date().toISOString()
        }]
      });
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

  const handleToggle = () => {
    if (!isRunning) {
      setIsWaitingForGPS(true);
      gpsWaitStartTimeRef.current = Date.now();
      setIsGpsTimeout(false);
    } else {
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

  const pathPositions: [number, number][] = positions.map(p => [p.latitude, p.longitude]);
  const currentPosition = positions.length > 0 ? positions[positions.length - 1] : null;
  const currentHeading = currentPosition?.heading;

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

  const renderMapContent = () => {
    if (!isRunning && !isWaitingForGPS && elapsed === 0 && !isCompleted) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-50 to-emerald-50">
          <div className="flex flex-col items-center gap-3">
            <MapIcon className="w-12 h-12 text-gray-300" />
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
              {...{ whenCreated: ((map: any) => { mapInstanceRef.current = map; }) } as any}
              center={pathPositions.length > 0 ? pathPositions[pathPositions.length - 1] : [39.9042, 116.4074]}
              zoom={16}
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
                maxZoom={19}
                eventHandlers={{
                  tileerror: handleTileError
                }}
              />
              {pathPositions.length > 0 && (
                <>
                  <Polyline 
                    positions={pathPositions} 
                    color="#10b981" 
                    weight={4} 
                    opacity={0.8}
                    lineJoin="round"
                  />
                  <CircleMarker 
                    center={pathPositions[pathPositions.length - 1]} 
                    radius={6} 
                    fillColor="#10b981" 
                    fillOpacity={1} 
                    color="white" 
                    weight={2} 
                  />
                  {currentPosition && (
                    <DirectionArrow 
                      center={[currentPosition.latitude, currentPosition.longitude]} 
                      heading={currentHeading} 
                    />
                  )}
                </>
              )}
              <MapController positions={pathPositions} isInteractive={isFullscreen} />
            </MapContainer>
          </MapErrorBoundary>
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
          <div className="absolute top-3 left-3 z-[400] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/90 backdrop-blur-md shadow-sm border border-emerald-100">
            <MapPin className="w-3 h-3 text-emerald-600 fill-emerald-600" />
            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">GPS已连接</span>
          </div>
        )}

        <div className={`absolute bottom-3 left-3 z-[400] flex items-center gap-1 px-2.5 py-1 rounded-full border bg-white/90 backdrop-blur-md shadow-sm transition-all ${
            isCompleted ? 'text-emerald-600 border-emerald-200' : 'text-rose-600 border-rose-100'
        }`}>
          <Heart className={`w-3 h-3 ${isCompleted ? 'fill-emerald-600' : 'fill-rose-600'}`} />
          <span className="text-[9px] font-black uppercase tracking-widest">Zone {targetHeartRateZone}</span>
        </div>

        <div className={`absolute ${isFullscreen ? 'top-8 right-8' : 'top-4 right-4'} z-[10001]`}>
          <button 
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`shadow-2xl transition-all active:scale-95 flex items-center justify-center ${
              isFullscreen 
                ? 'w-12 h-12 rounded-2xl bg-star-dark text-white' 
                : 'w-10 h-10 rounded-xl bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'
            }`}
          >
            {isFullscreen ? <Square className="w-6 h-6" /> : <MapIcon className="w-5 h-5" />}
          </button>
        </div>

        {isFullscreen && (
          <div className="absolute top-8 left-8 z-[10001] bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-gray-100 flex flex-col gap-1">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">当前位置</div>
            <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              正在记录运动轨迹...
            </div>
          </div>
        )}

        {isFullscreen && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[10001] bg-star-dark/90 backdrop-blur-md text-white px-8 py-3 rounded-full text-sm font-bold shadow-2xl flex items-center gap-3">
            <Navigation className="w-4 h-4 text-emerald-400" />
            全屏模式：可自由缩放和拖动
          </div>
        )}
      </>
    );
  };



  return (
    <>
    <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-50 relative overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-6 bg-blue-500 rounded-2xl shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
          <h3 className="text-xl font-black text-gray-900 tracking-tight">{exerciseName}</h3>
        </div>
        <div className="flex items-center gap-2">
           <span className="flex items-center gap-1 text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded-2xl font-bold uppercase tracking-widest border border-gray-100">
               <Navigation className="w-3 h-3" />
               {getExerciseTypeLabel(exercise.type)}
           </span>
         </div>
      </div>

      <div className="flex flex-col rounded-2xl border border-gray-100 overflow-hidden mb-6 bg-gray-50/30">
        <div className={`relative flex flex-col items-center justify-center py-6 border-b border-gray-100 transition-all duration-500 ${
            isCompleted ? 'bg-[#f0fdf4]/50' : 'bg-transparent'
        }`}>
            <div className="w-full mt-1">
              {renderStats()}
            </div>
        </div>

        <div 
          className={`relative bg-gray-50 overflow-hidden transition-all duration-300 ${
            isFullscreen ? 'fixed inset-0 z-[99999] h-screen' : 'h-48 w-full'
          }`}
        >
          <div 
            id={`map-container-${uniqueMapId.current}`}
            ref={mapContainerRef}
            className="absolute top-0 left-0 w-full h-full"
          >
            {renderMapContent()}
          </div>
        </div>
      </div>

      <motion.div layout transition={smoothSpring} className="flex gap-3 h-12 w-full relative">
        <AnimatePresence mode="popLayout">
          {(isRunning || elapsed > 0 || isCompleted) && (
            <motion.div key="secondary" initial={{ opacity: 0, scale: 0.8, width: 0 }} animate={{ opacity: 1, scale: 1, width: 'auto' }} exit={{ opacity: 0, scale: 0.8, width: 0 }} transition={smoothSpring} className="flex-1 overflow-hidden">
              {isCompleted ? (
                <button onClick={handleUndoComplete} className="w-full h-full rounded-2xl flex items-center justify-center gap-2 border-2 bg-white text-gray-400 border-gray-100 active:scale-90 transition-all shadow-sm active:bg-gray-50">
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-widest">撤销</span>
                </button>
              ) : (
                <button onClick={() => handleComplete()} className={`w-full h-full rounded-2xl flex items-center justify-center gap-2 border-2 active:scale-90 transition-all shadow-sm ${isRunning ? 'bg-rose-50 text-rose-500 border-rose-100 active:bg-rose-100' : 'bg-emerald-50 text-emerald-500 border-emerald-100 active:bg-emerald-100'}`}>
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
                  className="flex-1 h-full rounded-2xl flex items-center justify-center gap-2 border-2 border-gray-200 text-gray-600 active:scale-90 transition-all shadow-sm hover:bg-gray-50"
                >
                  <span className="text-sm font-bold uppercase tracking-widest">取消</span>
                </button>
                <button
                  onClick={handleForceStart}
                  className="flex-1 h-full rounded-2xl flex items-center justify-center gap-2 border-2 bg-blue-500 text-white active:scale-90 transition-all shadow-lg shadow-blue-500/30 hover:bg-blue-600"
                >
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-widest">强行开始</span>
                </button>
              </div>
            ) : (
              <button
                onClick={handleToggle}
                className={`w-full h-full rounded-2xl flex items-center justify-center gap-3 border-2 active:scale-90 transition-all shadow-sm relative overflow-hidden ${
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
