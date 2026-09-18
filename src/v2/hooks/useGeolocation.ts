import { useState, useEffect, useRef, useCallback } from 'react';
import { TrackSmoother } from '../utils/trackSmoother';

export interface Position {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
  heading?: number;
  /** Doppler 速度 m/s（position.coords.speed，OS 提供；低速/静止判定最准；缺省=不可用） */
  speed?: number;
  isGapAfter?: boolean;
  gapDuration?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export type LocationStatus = 'idle' | 'acquiring' | 'active' | 'error' | 'permission_denied';

export interface GeolocationConfig {
  minDistance: number;
  minTime: number;
  maxAccuracy: number;
  maxSpeed: number;
  gapThreshold: number;
}

export const DEFAULT_CONFIG: GeolocationConfig = {
  minDistance: 10,
  minTime: 3000,
  maxAccuracy: 50,
  maxSpeed: 20,
  gapThreshold: 10000,
};

/**
 * 离群点剔除：与上一接受点的隐含速度超过该值（m/s）直接丢弃该点。
 * 取 8 m/s ≈ 28.8 km/h：高于任何跑步配速（短跑冲刺也 <10.5 m/s 但持续不了
 * 一个采样窗），低速 GPS 抖动的单点跳变 40m/3s=13m/s 会被这里拦截。
 * 注意独立于 maxSpeed（maxSpeed 语义=用户可达运动速度上限，此值=物理合理性上限）。
 */
export const OUTLIER_SPEED_MPS = 8;

export interface GeolocationReturn {
  positions: Position[];
  distance: number;
  reset: () => void;
  /** 暂停时调用：标记轨迹 gap，恢复后首点不算距不画线连接 */
  markPause: () => void;
  status: LocationStatus;
  error: string | null;
  hasPermission: boolean | null;
  isInBackground: boolean;
  backgroundDuration: number;
  totalGapDuration: number;
  gapCount: number;
  config: GeolocationConfig;
  updateConfig: (config: Partial<GeolocationConfig>) => void;
}

export const useGeolocation = (active: boolean, initialConfig?: Partial<GeolocationConfig>): GeolocationReturn => {
  const [config, setConfig] = useState<GeolocationConfig>({ ...DEFAULT_CONFIG, ...initialConfig });
  const [positions, setPositions] = useState<Position[]>([]);
  const [distance, setDistance] = useState(0);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isInBackground, setIsInBackground] = useState(false);
  const [backgroundDuration, setBackgroundDuration] = useState(0);
  const [totalGapDuration, setTotalGapDuration] = useState(0);
  const [gapCount, setGapCount] = useState(0);

  const watchId = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const backgroundStartTimeRef = useRef<number | null>(null);
  const backgroundTimerRef = useRef<number | null>(null);
  const lastPositionRef = useRef<Position | null>(null);
  // 卡尔曼平滑器：在第 2 层（阈值过滤）之后压噪
  const smootherRef = useRef<TrackSmoother>(new TrackSmoother());

  const calculateDistance = useCallback((pos1: Position, pos2: Position): number => {
    const R = 6371e3;
    const φ1 = (pos1.latitude * Math.PI) / 180;
    const φ2 = (pos2.latitude * Math.PI) / 180;
    const Δφ = ((pos2.latitude - pos1.latitude) * Math.PI) / 180;
    const Δλ = ((pos2.longitude - pos1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }, []);

  const calculateConfidence = useCallback((position: Position): 'high' | 'medium' | 'low' => {
    const accuracy = position.accuracy ?? 100;
    if (accuracy <= 10) return 'high';
    if (accuracy <= 30) return 'medium';
    return 'low';
  }, []);

  const detectGap = useCallback((lastPos: Position, newPos: Position): boolean => {
    const timeDiff = newPos.timestamp - lastPos.timestamp;
    return timeDiff > config.gapThreshold;
  }, [config.gapThreshold]);

  const shouldAcceptPosition = useCallback((
    lastPos: Position,
    newPos: Position,
    isGap: boolean
  ): boolean => {
    const distance = calculateDistance(lastPos, newPos);
    const timeDiff = newPos.timestamp - lastPos.timestamp;

    if (isGap) {
      return true;
    }

    if (timeDiff < config.minTime) {
      return false;
    }

    if (distance < config.minDistance) {
      return false;
    }

    if (newPos.accuracy && newPos.accuracy > config.maxAccuracy) {
      return false;
    }

    const speed = distance / (timeDiff / 1000);

    // 离群剔除：隐含速度超物理合理上限（GPS 静态跳变/隧道口鬼点），先于 maxSpeed 拦截
    if (speed > OUTLIER_SPEED_MPS) {
      return false;
    }

    if (speed > config.maxSpeed) {
      return false;
    }

    return true;
  }, [config, calculateDistance]);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Wake Lock acquired');
        
        wakeLockRef.current.addEventListener('release', () => {
          console.log('Wake Lock released');
          wakeLockRef.current = null;
        });
      }
    } catch (err) {
      console.warn('Wake Lock failed:', err);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      setIsInBackground(true);
      backgroundStartTimeRef.current = Date.now();
      
      backgroundTimerRef.current = window.setInterval(() => {
        if (backgroundStartTimeRef.current) {
          const duration = Date.now() - backgroundStartTimeRef.current;
          setBackgroundDuration(duration);
        }
      }, 1000);
    } else {
      setIsInBackground(false);
      
      if (backgroundTimerRef.current) {
        clearInterval(backgroundTimerRef.current);
        backgroundTimerRef.current = null;
      }
      
      if (backgroundStartTimeRef.current) {
        const duration = Date.now() - backgroundStartTimeRef.current;
        backgroundStartTimeRef.current = null;
        console.log(`App was in background for ${Math.round(duration / 1000)}s`);
      }
    }
  }, []);

  const startWatching = useCallback(async (highAccuracy = true) => {
    if (!('geolocation' in navigator)) {
      setStatus('error');
      setError('您的浏览器不支持地理位置功能');
      return;
    }

    setStatus('acquiring');
    setError(null);

    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    await requestWakeLock();

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        // Doppler 速度（m/s）：OS 依据多普勒频移给出，低速/静止判定远比位置差分准；
        // null/undefined/负值=不可用，静走滤波速度估计兜底
        const dopplerSpeed = position.coords.speed != null && position.coords.speed >= 0
          ? position.coords.speed
          : undefined;
        const newPos: Position = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: position.timestamp,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading ?? undefined,
          speed: dopplerSpeed,
          confidence: calculateConfidence({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: position.timestamp,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading ?? undefined,
          }),
        };

        setStatus('active');
        setError(null);

        setPositions((prev) => {
          if (prev.length === 0) {
            lastPositionRef.current = newPos;
            return [newPos];
          }

          const lastPos = prev[prev.length - 1];
          const isGap = detectGap(lastPos, newPos);

          if (isGap) {
            setTotalGapDuration((prev) => prev + (newPos.timestamp - lastPos.timestamp));
            setGapCount((prev) => prev + 1);
          }

          if (shouldAcceptPosition(lastPos, newPos, isGap)) {
            // 第 2 层：卡尔曼平滑（gap 点不参与滤波，保持跳变）；
            // Doppler 速度直传平滑器做静止判定/脱离（ZUPT 零速约束）
            const [fLat, fLon] = isGap
              ? [newPos.latitude, newPos.longitude]
              : smootherRef.current.filter(newPos.latitude, newPos.longitude, newPos.timestamp, newPos.accuracy ?? 50, newPos.speed);
            const smoothedPos: Position = {
              ...newPos,
              latitude: fLat,
              longitude: fLon,
              isGapAfter: isGap,
              gapDuration: isGap ? newPos.timestamp - lastPos.timestamp : undefined,
            };

            const distance = calculateDistance(lastPos, smoothedPos);
            // 静止门控：平滑器处于静止态时位置被冻结，此距离恒 ≈0，此处为兜底；
            // Doppler 明确报告静止（<0.2 m/s）时距离一律不累计，双保险防漂移虚增
            const dopplerStill = newPos.speed != null && newPos.speed < 0.2;
            if (!isGap && !dopplerStill) {
              setDistance((prevDist) => prevDist + distance);
            }

            lastPositionRef.current = smoothedPos;
            return [...prev, smoothedPos];
          }

          return prev;
        });
      },
      (error) => {
        console.error('Geolocation error:', error);

        if (error.code === error.TIMEOUT && highAccuracy) {
          console.log('High accuracy timeout, falling back to low accuracy...');
          startWatching(false);
          return;
        }

        switch (error.code) {
          case error.PERMISSION_DENIED:
            setStatus('permission_denied');
            setError('位置权限被拒绝，请在浏览器设置中允许位置访问');
            setHasPermission(false);
            break;
          case error.POSITION_UNAVAILABLE:
            setStatus('error');
            setError('无法获取位置信息，请检查设备定位服务');
            break;
          case error.TIMEOUT:
            setStatus('error');
            setError('获取位置超时，请稍后重试或移至开阔区域');
            break;
          default:
            setStatus('error');
            setError(`位置获取失败: ${error.message}`);
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 15000 : 30000,
        maximumAge: 0,
      }
    );
  }, [detectGap, shouldAcceptPosition, calculateDistance, calculateConfidence, requestWakeLock]);

  const stopWatching = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    releaseWakeLock();
    setStatus('idle');
  }, [releaseWakeLock]);

  const reset = useCallback(() => {
    setPositions([]);
    setDistance(0);
    setStatus('idle');
    setError(null);
    setBackgroundDuration(0);
    setTotalGapDuration(0);
    setGapCount(0);
    lastPositionRef.current = null;
    smootherRef.current.reset();
  }, []);

  /** 暂停标记：把 lastPosition 置空，恢复后首点按 gap 处理（不算距、平滑器 reset） */
  const markPause = useCallback(() => {
    lastPositionRef.current = null;
    smootherRef.current.reset();
  }, []);

  const updateConfig = useCallback((newConfig: Partial<GeolocationConfig>) => {
    setConfig((prev) => ({ ...prev, ...newConfig }));
  }, []);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleVisibilityChange]);

  useEffect(() => {
    if (active) {
      startWatching(true);
    } else {
      stopWatching();
    }

    return () => {
      stopWatching();
    };
  }, [active, startWatching, stopWatching]);

  return {
    positions,
    distance,
    reset,
    markPause,
    status,
    error,
    hasPermission,
    isInBackground,
    backgroundDuration,
    totalGapDuration,
    gapCount,
    config,
    updateConfig,
  };
};
